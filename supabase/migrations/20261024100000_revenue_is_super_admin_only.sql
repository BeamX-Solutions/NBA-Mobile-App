-- Subscription revenue is the super administrator's figure alone.
--
-- Every subscription is paid into one central account, whatever branch the
-- practitioner belongs to. It is not the branch's money, so a branch
-- administrator has nothing to answer for in it, and the client asked that
-- they not see it. Until now dashboard_summary() gave them their own
-- branch's share, revenue_total, revenue_month and revenue_by_plan, and the
-- same per branch row.
--
-- Two changes.
--
-- First, the branch administrator no longer reads subscriptions rows. The
-- policy from 20260922110000 gave them the amount along with the rest, so
-- adding up their branch's revenue was one query away whatever the console
-- showed. RLS admits rows, not columns, so the policy goes, and what the
-- branch does need, who is subscribed and until when, is read through
-- member_subscriptions: the same rows the policies admitted, without the
-- amount. The owner and the super administrator keep their table policies.
--
-- Second, dashboard_summary() is reproduced from 20261020100000 with the
-- revenue figures null for anybody who is not a super administrator. Null
-- rather than zero: zero would say nothing was paid, which may not be true.
-- Subscriber counts stay, read from member_subscriptions now that a branch
-- administrator cannot read the table.

drop policy "branch admin reads branch subscriptions" on public.subscriptions;

-- Runs with its owner's rights, so it filters for itself, exactly as the
-- three table policies did between them.
create view public.member_subscriptions
with (security_invoker = false)
as
  select s.id, s.user_id, s.plan, s.rate_type, s.status, s.starts_at, s.expires_at, s.created_at
  from public.subscriptions s
  where public.is_privileged_actor()
    or s.user_id = auth.uid()
    or (
      public.current_user_role() = 'branch_admin'
      and exists (
        select 1 from public.profiles p
        where p.id = s.user_id
          and p.branch_id = public.current_user_branch()
      )
    );

revoke all on public.member_subscriptions from public, anon, authenticated;
grant select on public.member_subscriptions to authenticated;

create or replace function public.dashboard_summary(p_branch_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  month_start as (
    select date_trunc('month', now() at time zone 'Africa/Lagos') as at
  ),
  practitioners as (
    -- Administrators practise too, since 20261017100000.
    select id, branch_id
    from public.profiles
    where role in ('branch_member', 'branch_admin')
      and membership_status = 'approved'
      and (p_branch_id is null or branch_id = p_branch_id)
  ),
  live_subscriptions as (
    select s.user_id, s.expires_at
    from public.member_subscriptions s
    where s.status = 'active' and s.expires_at > now()
  ),
  subscribers as (
    -- One per practitioner, however many overlapping subscriptions they hold,
    -- judged by the one that runs longest. Practitioners only, so "2 of 9"
    -- compares like with like: a subscription left behind by somebody who
    -- became a super administrator is not a subscriber.
    select ls.user_id, max(ls.expires_at) as expires_at
    from live_subscriptions ls
    where ls.user_id in (select id from practitioners)
    group by ls.user_id
  ),
  paid as (
    -- A subscription belongs to the branch its holder is in now. Only a
    -- super administrator's call counts any; see above.
    select s.amount, s.plan, s.created_at, s.user_id
    from public.subscriptions s
    where s.paystack_reference is not null
      and public.is_privileged_actor()
      and (
        p_branch_id is null
        or exists (
          select 1 from public.profiles p
          where p.id = s.user_id and p.branch_id = p_branch_id
        )
      )
  ),
  held as (
    select t.branch_id, t.due_to_practitioner
    from public.transactions t
    where t.status = 'verified' and t.remitted_at is null
      and (p_branch_id is null or t.branch_id = p_branch_id)
  ),
  visible_branches as (
    select b.id, b.name, b.branch_code, b.activation_status
    from public.branches b
    where (public.is_privileged_actor() or b.id = public.current_user_branch())
      and (p_branch_id is null or b.id = p_branch_id)
  )
  select jsonb_build_object(
    'practitioners', (select count(*) from practitioners),
    'subscribers', (select count(*) from subscribers),
    'expiring_30d', (select count(*) from subscribers where expires_at <= now() + interval '30 days'),
    'revenue_total', case when public.is_privileged_actor() then
      (select coalesce(sum(amount), 0) from paid)
    end,
    'revenue_month', case when public.is_privileged_actor() then (
      select coalesce(sum(amount), 0) from paid
      where (created_at at time zone 'Africa/Lagos') >= (select at from month_start)
    ) end,
    'revenue_by_plan', case when public.is_privileged_actor() then (
      select coalesce(jsonb_object_agg(plan, total), '{}'::jsonb)
      from (select plan::text as plan, sum(amount) as total from paid group by plan) p
    ) end,
    'held_for_practitioners', (select coalesce(sum(due_to_practitioner), 0) from held),
    'branches', (
      select coalesce(jsonb_agg(row_data order by row_data ->> 'name'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', b.id,
          'name', b.name,
          'branch_code', b.branch_code,
          -- The directory lists every branch in the country; the console
          -- shows the active ones and any with activity, and counts the rest.
          'active', b.activation_status = 'active',
          'practitioners', (select count(*) from practitioners p where p.branch_id = b.id),
          'subscribers', (
            select count(*) from subscribers s
            join public.profiles p on p.id = s.user_id
            where p.branch_id = b.id
          ),
          'revenue_total', case when public.is_privileged_actor() then (
            select coalesce(sum(pd.amount), 0) from paid pd
            join public.profiles p on p.id = pd.user_id
            where p.branch_id = b.id
          ) end,
          'pending', (
            select count(*) from public.transactions t
            where t.branch_id = b.id and t.status = 'pending_verification'
          ),
          'fees_verified', (
            select coalesce(sum(t.branch_fee), 0) from public.transactions t
            where t.branch_id = b.id and t.status = 'verified'
          ),
          'held_for_practitioners', (
            select coalesce(sum(h.due_to_practitioner), 0) from held h where h.branch_id = b.id
          )
        ) as row_data
        from visible_branches b
      ) rows
    )
  );
$$;

-- The Overview's figures, worked out in the database.
--
-- The console counted in the browser: seven queries, every verified fee row
-- fetched just to be added up. The new figures (subscribers, subscription
-- revenue, money held for practitioners, a row per branch) would have meant
-- fetching every subscription and transaction the same way.
--
-- security invoker, deliberately. The function runs with the caller's own
-- rights, so RLS decides what it counts exactly as it decides what the
-- console may read row by row: a branch administrator gets their branch, a
-- super administrator gets everything. It grants nothing new.
--
-- The one exception is branches, which every signed-in user may read in full
-- (signup lists them). The per-branch rows are therefore limited here, not by
-- RLS: a branch administrator gets their own row only.
--
-- Revenue counts subscriptions with a Paystack reference only. Rows entered
-- by hand before Paystack existed carry made-up or zero amounts, and adding
-- them up would present them as money received. Until Paystack is live the
-- figure is honestly zero.
--
-- "This month" is the calendar month in Lagos, not UTC, so a payment at
-- 00:30 on the 1st counts in the month the branch would say it fell in.

create or replace function public.dashboard_summary()
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
  ),
  live_subscriptions as (
    select s.user_id, s.expires_at
    from public.subscriptions s
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
    select s.amount, s.plan, s.created_at, s.user_id
    from public.subscriptions s
    where s.paystack_reference is not null
  ),
  held as (
    select t.branch_id, t.due_to_practitioner
    from public.transactions t
    where t.status = 'verified' and t.remitted_at is null
  ),
  visible_branches as (
    select b.id, b.name, b.branch_code, b.activation_status
    from public.branches b
    where public.is_privileged_actor() or b.id = public.current_user_branch()
  )
  select jsonb_build_object(
    'practitioners', (select count(*) from practitioners),
    'subscribers', (select count(*) from subscribers),
    'expiring_30d', (select count(*) from subscribers where expires_at <= now() + interval '30 days'),
    'revenue_total', (select coalesce(sum(amount), 0) from paid),
    'revenue_month', (
      select coalesce(sum(amount), 0) from paid
      where (created_at at time zone 'Africa/Lagos') >= (select at from month_start)
    ),
    'revenue_by_plan', (
      select coalesce(jsonb_object_agg(plan, total), '{}'::jsonb)
      from (select plan::text as plan, sum(amount) as total from paid group by plan) p
    ),
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
          'revenue_total', (
            select coalesce(sum(pd.amount), 0) from paid pd
            join public.profiles p on p.id = pd.user_id
            where p.branch_id = b.id
          ),
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

revoke execute on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary() to authenticated;

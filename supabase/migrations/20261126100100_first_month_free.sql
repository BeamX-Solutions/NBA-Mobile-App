-- The first month free, for practitioners who join from now on.
--
-- A free month is an ordinary subscriptions row: plan 'monthly', rate type
-- 'free_trial', amount 0, no Paystack reference. Every gate that asks for an
-- active, unexpired subscription (create_transaction, the assistant, the apps)
-- therefore admits a practitioner on their free month without changing.
--
-- When it starts: when the branch approves the membership, not at sign-up.
-- Until then the practitioner can neither invoice nor subscribe, so a month
-- counted from sign-up would be spent waiting on the branch.
--
-- Who gets it: a practitioner approved after this migration, once in their
-- life. Not anybody approved before it, whether they paid or not; they are
-- recorded in free_trial_excluded below, so a later re-approval (an SCN
-- correction sends an approved member back to pending) does not hand them one.
-- Not anybody who has ever held a subscription. The unique index makes "once"
-- a fact of the table rather than of this trigger.
--
-- No card is taken. A free month that is not followed by a payment simply
-- lapses. A practitioner who pays during it keeps the free days left:
-- record_subscription_payment carries unused time into the new term.
--
-- Revenue counts only rows with a Paystack reference, so free months add
-- nothing to it. dashboard_summary now counts them apart from paying
-- subscribers.

-- ---------------------------------------------------------------------------
-- Once per practitioner
-- ---------------------------------------------------------------------------

create unique index subscriptions_one_free_trial_idx
  on public.subscriptions (user_id)
  where rate_type = 'free_trial';

-- ---------------------------------------------------------------------------
-- free_trial_excluded: practitioners who joined before the free month existed
-- ---------------------------------------------------------------------------

create table public.free_trial_excluded (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  excluded_at timestamptz not null default now()
);

comment on table public.free_trial_excluded is
  'Practitioners never to be granted the free first month: those already approved when it was introduced on 2026-11-26.';

alter table public.free_trial_excluded enable row level security;
revoke all on public.free_trial_excluded from public, anon, authenticated;

insert into public.free_trial_excluded (user_id)
select id from public.profiles
where membership_status = 'approved'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The notification it sends
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'membership_approved',
  'membership_rejected',
  'payment_rejected',
  'certificate_issued',
  'share_paid',
  'certificate_revoked',
  'certificate_restored',
  'free_trial_started'
));

-- ---------------------------------------------------------------------------
-- grant_free_trial: on approval
-- ---------------------------------------------------------------------------

create function public.grant_free_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz := now() + interval '1 month';
begin
  if new.role not in ('branch_member', 'branch_admin') then
    return null;
  end if;

  if exists (select 1 from public.free_trial_excluded where user_id = new.id)
     or exists (select 1 from public.subscriptions where user_id = new.id) then
    return null;
  end if;

  insert into public.subscriptions
    (user_id, plan, rate_type, amount, starts_at, expires_at, status)
  values
    (new.id, 'monthly', 'free_trial', 0, now(), v_expires, 'active');

  perform public.notify(
    new.id,
    'free_trial_started',
    'Your first month is free',
    'You can generate invoices free until '
      || to_char(v_expires at time zone 'Africa/Lagos', 'FMDD FMMonth YYYY')
      || '. Subscribe any time before then and you keep the free days left.',
    '/profile/plans'
  );

  return null;
end;
$$;

revoke execute on function public.grant_free_trial() from public, anon, authenticated;

create trigger grant_free_trial
  after update of membership_status on public.profiles
  for each row
  when (old.membership_status is distinct from new.membership_status
        and new.membership_status = 'approved')
  execute function public.grant_free_trial();

-- ---------------------------------------------------------------------------
-- dashboard_summary, reproduced from 20261120100000
--
-- CHANGED. 'subscribers' and 'expiring_30d' count paying subscribers only,
-- and 'on_trial' counts practitioners on their free month, in total and per
-- branch. A practitioner holds one active row at a time, so the two never
-- count the same person.
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_summary(p_branch_id uuid default null)
returns jsonb
language sql
stable
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
      and (not public.is_demo_branch(branch_id) or branch_id = public.current_user_branch())
  ),
  live_subscriptions as (
    select s.user_id, s.expires_at, s.rate_type = 'free_trial' as is_trial
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
      and not ls.is_trial
    group by ls.user_id
  ),
  trialists as (
    select distinct ls.user_id
    from live_subscriptions ls
    where ls.user_id in (select id from practitioners)
      and ls.is_trial
      and ls.user_id not in (select user_id from subscribers)
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
      and (not b.is_demo or b.id = public.current_user_branch())
  )
  select jsonb_build_object(
    'practitioners', (select count(*) from practitioners),
    'subscribers', (select count(*) from subscribers),
    'on_trial', (select count(*) from trialists),
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
          'on_trial', (
            select count(*) from trialists tr
            join public.profiles p on p.id = tr.user_id
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

-- ---------------------------------------------------------------------------
-- The assistant: say when the subscription is the free month
-- ---------------------------------------------------------------------------
--
-- Both reproduced from 20261109100000 with 'free_trial' added, so the
-- assistant says "your free month ends on…" rather than "your monthly plan".

create or replace function public.assistant_pending_items()
returns jsonb
language sql
stable
set search_path = public
as $$
  with me as (select auth.uid() as id)
  select jsonb_build_object(
    'invoices_awaiting_payment_proof', (
      select coalesce(jsonb_agg(public.assistant_transaction_json(t) order by t.created_at desc), '[]'::jsonb)
      from public.transactions t, me
      where t.user_id = me.id and t.status = 'awaiting_payment'),
    'proofs_waiting_for_branch', (
      select coalesce(jsonb_agg(public.assistant_transaction_json(t) order by t.created_at desc), '[]'::jsonb)
      from public.transactions t, me
      where t.user_id = me.id and t.status = 'pending_verification'),
    'proofs_rejected', (
      select coalesce(jsonb_agg(public.assistant_transaction_json(t) order by t.created_at desc), '[]'::jsonb)
      from public.transactions t, me
      where t.user_id = me.id and t.status = 'rejected'),
    'verified_but_share_not_yet_paid', (
      select coalesce(jsonb_agg(public.assistant_transaction_json(t) order by t.verified_at), '[]'::jsonb)
      from public.transactions t, me
      where t.user_id = me.id and t.status = 'verified'
        and t.payout_id is null and t.remitted_at is null),
    'membership', (
      select case p.membership_status
        when 'approved' then null
        else jsonb_build_object('status', p.membership_status, 'reason', p.membership_rejection_reason) end
      from public.profiles p, me where p.id = me.id),
    'subscription_ending_soon', (
      select jsonb_build_object(
        'plan', s.plan,
        'free_trial', s.rate_type = 'free_trial',
        'expires_on', (s.expires_at at time zone 'Africa/Lagos')::date)
      from public.subscriptions s, me
      where s.user_id = me.id and s.status = 'active'
        and s.expires_at > now() and s.expires_at <= now() + interval '7 days')
  );
$$;

create or replace function public.assistant_subscription()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'plan', s.plan,
      'free_trial', s.rate_type = 'free_trial',
      'status', case when s.status = 'active' and s.expires_at > now() then 'active' else 'expired' end,
      'started_on', (s.starts_at at time zone 'Africa/Lagos')::date,
      'expires_on', (s.expires_at at time zone 'Africa/Lagos')::date,
      'renewal_open', s.expires_at <= now() + interval '7 days')
    from public.subscriptions s
    where s.user_id = auth.uid()
    order by s.expires_at desc
    limit 1
  ), jsonb_build_object('status', 'none'));
$$;

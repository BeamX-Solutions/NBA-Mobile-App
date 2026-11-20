-- Demo branches: somewhere to demonstrate the product without touching real
-- records, and whose certificates cannot pass as real ones.
--
-- Requested 2026-11-20 by an Anaocha administrator who had used live Anaocha
-- records as samples for other branches; five of them had to be deleted by
-- hand. A demo branch is an ordinary branch with is_demo set:
--
--   * Only its own members see its records. The super administrator's view of
--     transactions and certificates, and dashboard_summary's practitioner and
--     branch figures, leave demo branches out, so they never reach real totals.
--     (Money figures in dashboard_summary come from transactions, which RLS
--     already filters, so they follow automatically.)
--   * verify_rbin reports is_demo, so the public verification page can say a
--     demonstration certificate is exactly that instead of "verified".
--   * No client can set or clear the flag. Otherwise a branch administrator
--     could hide their branch's real transactions from the super administrator
--     by flagging it. It is set by migration or by SQL run as postgres.
--
-- RBINs and certificate numbers are sequenced per branch (issue_rbin), so a
-- demo branch never consumes a real branch's numbers.

-- ---------------------------------------------------------------------------
-- The flag
-- ---------------------------------------------------------------------------

alter table public.branches
  add column if not exists is_demo boolean not null default false;

-- True when the branch is a demo branch. SECURITY DEFINER so policies can ask
-- without depending on the caller's view of branches.
create or replace function public.is_demo_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_demo from public.branches where id = p_branch_id), false);
$$;

revoke execute on function public.is_demo_branch(uuid) from public, anon;
grant execute on function public.is_demo_branch(uuid) to authenticated, service_role;

-- True when the transaction belongs to a demo branch. SECURITY DEFINER for the
-- same reason, and one more: the certificates policy below asks about a
-- transaction the super administrator can no longer see, and an ordinary
-- subquery would find nothing and let the certificate through.
create or replace function public.is_demo_transaction(p_transaction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select b.is_demo from public.transactions t
    join public.branches b on b.id = t.branch_id
    where t.id = p_transaction_id
  ), false);
$$;

revoke execute on function public.is_demo_transaction(uuid) from public, anon;
grant execute on function public.is_demo_transaction(uuid) to authenticated, service_role;

-- Clients reach the database as anon or authenticated. Migrations and
-- maintenance run as postgres, and SECURITY DEFINER functions as their owner;
-- none of those is refused.
create or replace function public.guard_branch_is_demo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and new.is_demo then
      raise exception 'A demo branch can only be created by the operators.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.is_demo is distinct from old.is_demo then
      raise exception 'Whether a branch is a demo branch cannot be changed here.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_branch_is_demo on public.branches;
create trigger guard_branch_is_demo
  before insert or update on public.branches
  for each row execute function public.guard_branch_is_demo();

-- ---------------------------------------------------------------------------
-- The super administrator does not see demo records
-- ---------------------------------------------------------------------------

drop policy if exists "super admin reads all transactions" on public.transactions;
create policy "super admin reads all transactions" on public.transactions
  for select to authenticated
  using (current_user_role() = 'super_admin' and not public.is_demo_branch(branch_id));

drop policy if exists "super admin reads all certificates" on public.certificates;
create policy "super admin reads all certificates" on public.certificates
  for select to authenticated
  using (current_user_role() = 'super_admin' and not public.is_demo_transaction(transaction_id));

-- ---------------------------------------------------------------------------
-- verify_rbin, reproduced from 20260904140000 with is_demo added
--
-- A new output column changes the return type, which CREATE OR REPLACE cannot
-- do, so it is dropped and recreated. Callers that ignore unknown fields keep
-- working unchanged.
-- ---------------------------------------------------------------------------

drop function if exists public.verify_rbin(text);

create function public.verify_rbin(p_rbin text)
returns table (
  found boolean, rbin text, practitioner_name text, scn text, document_type text,
  branch_name text, issued_at timestamptz, certificate_number text,
  revoked boolean, revocation_reason text, is_demo boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    true as found,
    t.rbin,
    p.full_name as practitioner_name,
    p.scn,
    t.document_type::text,
    b.name as branch_name,
    c.issued_at,
    c.certificate_number,
    c.revoked_at is not null as revoked,
    c.revocation_reason,
    b.is_demo
  from public.transactions t
  join public.profiles p on p.id = t.user_id
  join public.branches b on b.id = t.branch_id
  join public.certificates c on c.transaction_id = t.id
  where t.rbin = upper(trim(p_rbin))
    and t.status = 'verified';
$$;

grant execute on function public.verify_rbin(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- dashboard_summary, reproduced from 20261020100000
--
-- Practitioners and the branch list leave out demo branches unless the caller
-- belongs to that branch, so a demo branch's own administrator still sees
-- their figures. Subscriptions and transactions follow from those and from RLS.
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
      and (not b.is_demo or b.id = public.current_user_branch())
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

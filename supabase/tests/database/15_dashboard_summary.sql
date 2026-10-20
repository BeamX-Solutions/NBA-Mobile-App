-- What the Overview counts, and for whom.
--
-- dashboard_summary() runs with the caller's own rights, so RLS decides what
-- it counts. These assertions pin that a branch administrator's figures cover
-- their branch alone, that branches (readable by everyone) are limited by the
-- function itself, and that revenue means money received through Paystack,
-- not amounts somebody typed in.
--
-- The hosted database holds real rows, so every assertion is about the two
-- fixture branches, never about platform totals.

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

create function pg_temp.impersonate(uid uuid, jwt_role text default 'authenticated')
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', jwt_role)::text,
    true
  );
  perform set_config('role', jwt_role, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
--
-- Branch X: an administrator, two approved members and one still pending.
--   member 1 paid through Paystack; member 2's subscription was entered by
--   hand and ends in ten days.
--   one verified submission not yet remitted, one awaiting verification.
-- Branch Y: one approved member who paid through Paystack, and a verified
--   submission not yet remitted.
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('1a000000-0000-0000-0000-0000000000aa', 'Dash X Branch', 'DSX', 'Anambra', 'Q1', 'X Account', 'active', now()),
  ('1a000000-0000-0000-0000-0000000000bb', 'Dash Y Branch', 'DSY', 'Anambra', 'Q2', 'Y Account', 'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2a000000-0000-0000-0000-0000000000a1', 'dash.admin@example.com',
   '{"full_name": "Dash Admin", "scn": "DSH0001", "branch_code": "DSX"}'::jsonb),
  ('2a000000-0000-0000-0000-0000000000a2', 'dash.one@example.com',
   '{"full_name": "Dash One", "scn": "DSH0002", "branch_code": "DSX"}'::jsonb),
  ('2a000000-0000-0000-0000-0000000000a3', 'dash.two@example.com',
   '{"full_name": "Dash Two", "scn": "DSH0003", "branch_code": "DSX"}'::jsonb),
  ('2a000000-0000-0000-0000-0000000000a4', 'dash.pending@example.com',
   '{"full_name": "Dash Pending", "scn": "DSH0004", "branch_code": "DSX"}'::jsonb),
  ('2a000000-0000-0000-0000-0000000000b1', 'dash.y@example.com',
   '{"full_name": "Dash Y", "scn": "DSH0005", "branch_code": "DSY"}'::jsonb),
  ('2a000000-0000-0000-0000-0000000000c1', 'dash.super@example.com',
   '{"full_name": "Dash Super", "scn": "DSH0006", "branch_code": "DSX"}'::jsonb);

update public.profiles set membership_status = 'approved'
where id::text like '2a000000-%' and id <> '2a000000-0000-0000-0000-0000000000a4';

update public.profiles set role = 'branch_admin'
where id = '2a000000-0000-0000-0000-0000000000a1';

update public.profiles set role = 'super_admin', branch_id = null
where id = '2a000000-0000-0000-0000-0000000000c1';

insert into public.subscriptions
  (user_id, plan, rate_type, amount, starts_at, expires_at, status, paystack_reference) values
  ('2a000000-0000-0000-0000-0000000000a2', 'yearly', 'standard', 30000000,
   now(), now() + interval '1 year', 'active', 'dash-ref-1'),
  ('2a000000-0000-0000-0000-0000000000a3', 'monthly', 'standard', 3000000,
   now() - interval '20 days', now() + interval '10 days', 'active', null),
  ('2a000000-0000-0000-0000-0000000000b1', 'quarterly', 'standard', 8500000,
   now(), now() + interval '3 months', 'active', 'dash-ref-2');

insert into public.transactions
  (id, user_id, branch_id, parties, document_type, consideration, amount_payable, branch_fee,
   status, verified_at) values
  ('3a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-0000000000a2',
   '1a000000-0000-0000-0000-0000000000aa', 'A to B', 'deed_of_assignment', 1000000, 100000, 2000,
   'verified', now()),
  ('3a000000-0000-0000-0000-000000000002', '2a000000-0000-0000-0000-0000000000a3',
   '1a000000-0000-0000-0000-0000000000aa', 'C to D', 'deed_of_assignment', 1000000, 50000, 1000,
   'pending_verification', null),
  ('3a000000-0000-0000-0000-000000000003', '2a000000-0000-0000-0000-0000000000b1',
   '1a000000-0000-0000-0000-0000000000bb', 'E to F', 'deed_of_assignment', 1000000, 70000, 1400,
   'verified', now());

-- ---------------------------------------------------------------------------
-- Branch X's administrator
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2a000000-0000-0000-0000-0000000000a1');

create temporary table x_summary as select public.dashboard_summary() as s;
grant select on x_summary to authenticated;

select is(
  (select (s ->> 'practitioners')::int from x_summary), 3,
  'practitioners are the approved members and the administrator, not the pending signup'
);

select is(
  (select (s ->> 'subscribers')::int from x_summary), 2,
  'both of the branch''s subscribers are counted, paid or not'
);

select is(
  (select (s ->> 'expiring_30d')::int from x_summary), 1,
  'one subscription ends within 30 days'
);

select is(
  (select (s ->> 'revenue_total')::bigint from x_summary), 30000000::bigint,
  'revenue is the Paystack payment only; the subscription entered by hand is not money received'
);

select is(
  (select (s ->> 'held_for_practitioners')::bigint from x_summary), 98000::bigint,
  'held for practitioners is the verified submission''s share, not the pending one'
);

select is(
  (select jsonb_array_length(s -> 'branches') from x_summary), 1,
  'a branch administrator gets one branch row, although every branch is readable'
);

select results_eq(
  $$ select s -> 'branches' -> 0 ->> 'name', (s -> 'branches' -> 0 ->> 'pending')::int
     from x_summary $$,
  $$ values ('Dash X Branch'::text, 1) $$,
  'and it is their own, with its one pending verification'
);

-- ---------------------------------------------------------------------------
-- A member of branch Y
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2a000000-0000-0000-0000-0000000000b1');

select results_eq(
  $$ select (s ->> 'subscribers')::int, (s ->> 'revenue_total')::bigint,
            jsonb_array_length(s -> 'branches')
     from (select public.dashboard_summary() as s) x $$,
  $$ values (1, 8500000::bigint, 1) $$,
  'a member''s figures are their own: one subscriber, their payment, their branch'
);

-- ---------------------------------------------------------------------------
-- A super administrator
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2a000000-0000-0000-0000-0000000000c1');

create temporary table platform_summary as select public.dashboard_summary() as s;

select is(
  (select count(*)::int from platform_summary, jsonb_array_elements(s -> 'branches') b
   where b ->> 'name' in ('Dash X Branch', 'Dash Y Branch')),
  2,
  'a super administrator gets a row for every branch'
);

select is(
  (select b from platform_summary, jsonb_array_elements(s -> 'branches') b
   where b ->> 'name' = 'Dash X Branch'),
  (select s -> 'branches' -> 0 from x_summary),
  'and branch X''s row is the same as its own administrator sees'
);

select is(
  (select (b ->> 'revenue_total')::bigint from platform_summary, jsonb_array_elements(s -> 'branches') b
   where b ->> 'name' = 'Dash Y Branch'),
  8500000::bigint,
  'per-branch revenue is attributed to the subscriber''s branch'
);

-- ---------------------------------------------------------------------------
-- Filtered to one branch
-- ---------------------------------------------------------------------------

create temporary table y_summary as
select public.dashboard_summary('1a000000-0000-0000-0000-0000000000bb') as s;

select results_eq(
  $$ select (s ->> 'practitioners')::int, (s ->> 'subscribers')::int,
            (s ->> 'revenue_total')::bigint, (s ->> 'held_for_practitioners')::bigint
     from y_summary $$,
  $$ values (1, 1, 8500000::bigint, 68600::bigint) $$,
  'filtered to branch Y, every figure is branch Y''s alone'
);

select results_eq(
  $$ select jsonb_array_length(s -> 'branches'), s -> 'branches' -> 0 ->> 'name' from y_summary $$,
  $$ values (1, 'Dash Y Branch'::text) $$,
  'and the per-branch rows are that branch only'
);

-- The argument narrows and never widens.
select pg_temp.impersonate('2a000000-0000-0000-0000-0000000000a1');

select results_eq(
  $$ select (s ->> 'held_for_practitioners')::bigint, jsonb_array_length(s -> 'branches')
     from (select public.dashboard_summary('1a000000-0000-0000-0000-0000000000bb') as s) x $$,
  $$ values (0::bigint, 0) $$,
  'a branch administrator who names another branch sees nothing of it'
);

-- ---------------------------------------------------------------------------
-- Not signed in
-- ---------------------------------------------------------------------------

select pg_temp.impersonate(null, 'anon');

select throws_ok(
  $$ select public.dashboard_summary() $$,
  '42501',
  null,
  'nobody signed out may read the figures'
);

select * from finish();

rollback;

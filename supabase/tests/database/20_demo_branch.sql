-- Demo branches (20261120100000).
--
-- A demo branch's records are visible to its own members only, never in the
-- super administrator's lists or totals; verify_rbin says when a certificate
-- is a demonstration; and no client can set or clear the flag.
--
-- The hosted database holds real rows, so every assertion is about the
-- fixture branches, never about platform totals.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

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
-- Real branch R: one member with a verified-and-certified submission.
-- Demo branch D: an administrator and a member; the member's submission is
--   certified by the administrator during the test.
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at, is_demo) values
  ('1d000000-0000-0000-0000-0000000000aa', 'Demo Test Real Branch', 'DTR', 'Anambra', 'R9', 'R Account', 'active', now(), false),
  ('1d000000-0000-0000-0000-0000000000dd', 'Demo Test Demo Branch', 'DTD', 'Anambra', 'D9', 'D Account', 'active', now(), true);

insert into auth.users (id, email, raw_user_meta_data) values
  ('2d000000-0000-0000-0000-0000000000a1', 'dt.real@example.com',
   '{"full_name": "DT Real", "scn": "DTS0001", "branch_code": "DTR"}'::jsonb),
  ('2d000000-0000-0000-0000-0000000000a2', 'dt.real.admin@example.com',
   '{"full_name": "DT Real Admin", "scn": "DTS0002", "branch_code": "DTR"}'::jsonb),
  ('2d000000-0000-0000-0000-0000000000d1', 'dt.demo.admin@example.com',
   '{"full_name": "DT Demo Admin", "scn": "DTS0003", "branch_code": "DTD"}'::jsonb),
  ('2d000000-0000-0000-0000-0000000000d2', 'dt.demo.member@example.com',
   '{"full_name": "DT Demo Member", "scn": "DTS0004", "branch_code": "DTD"}'::jsonb),
  ('2d000000-0000-0000-0000-0000000000c1', 'dt.super@example.com',
   '{"full_name": "DT Super", "scn": "DTS0005", "branch_code": "DTR"}'::jsonb);

update public.profiles set membership_status = 'approved' where id::text like '2d000000-%';
update public.profiles set role = 'branch_admin'
where id in ('2d000000-0000-0000-0000-0000000000a2', '2d000000-0000-0000-0000-0000000000d1');
update public.profiles set role = 'super_admin', branch_id = null
where id = '2d000000-0000-0000-0000-0000000000c1';

insert into public.transactions
  (id, user_id, branch_id, parties, document_type, consideration, amount_payable, branch_fee, status) values
  ('3d000000-0000-0000-0000-0000000000a1', '2d000000-0000-0000-0000-0000000000a1',
   '1d000000-0000-0000-0000-0000000000aa', 'A to B', 'deed_of_assignment', 1000000, 100000, 2000,
   'pending_verification'),
  ('3d000000-0000-0000-0000-0000000000d1', '2d000000-0000-0000-0000-0000000000d2',
   '1d000000-0000-0000-0000-0000000000dd', 'C to D', 'deed_of_assignment', 1000000, 100000, 2000,
   'pending_verification');

-- Each branch's administrator certifies their member's submission.
select pg_temp.impersonate('2d000000-0000-0000-0000-0000000000a2');
create temporary table real_issued as
  select * from public.issue_rbin('3d000000-0000-0000-0000-0000000000a1');

select pg_temp.impersonate('2d000000-0000-0000-0000-0000000000d1');
create temporary table demo_issued as
  select * from public.issue_rbin('3d000000-0000-0000-0000-0000000000d1');

reset role;
grant select on real_issued, demo_issued to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The super administrator
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2d000000-0000-0000-0000-0000000000c1');

select is(
  (select count(*)::int from public.transactions where id = '3d000000-0000-0000-0000-0000000000d1'), 0,
  'the super administrator does not see a demo transaction'
);
select is(
  (select count(*)::int from public.transactions where id = '3d000000-0000-0000-0000-0000000000a1'), 1,
  'the super administrator still sees a real transaction'
);
select is(
  (select count(*)::int from public.certificates where transaction_id = '3d000000-0000-0000-0000-0000000000d1'), 0,
  'the super administrator does not see a demo certificate'
);
select is(
  (select count(*)::int from public.certificates where transaction_id = '3d000000-0000-0000-0000-0000000000a1'), 1,
  'the super administrator still sees a real certificate'
);

create temporary table super_summary as select public.dashboard_summary() as s;
select is(
  (select count(*)::int from super_summary, jsonb_array_elements(s -> 'branches') b
   where b ->> 'id' = '1d000000-0000-0000-0000-0000000000dd'), 0,
  'the demo branch is not in the super administrator''s branch figures'
);
select is(
  (select count(*)::int from super_summary, jsonb_array_elements(s -> 'branches') b
   where b ->> 'id' = '1d000000-0000-0000-0000-0000000000aa'), 1,
  'a real branch still is'
);
select is(
  (select (public.dashboard_summary('1d000000-0000-0000-0000-0000000000dd') ->> 'practitioners')::int), 0,
  'asked about the demo branch directly, the super administrator counts no practitioners'
);

-- ---------------------------------------------------------------------------
-- The demo branch's own administrator
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2d000000-0000-0000-0000-0000000000d1');

select is(
  (select count(*)::int from public.transactions where id = '3d000000-0000-0000-0000-0000000000d1'), 1,
  'the demo branch''s administrator sees its transaction'
);
select is(
  (select (public.dashboard_summary() ->> 'practitioners')::int), 2,
  'and counts its two practitioners'
);

-- ---------------------------------------------------------------------------
-- Public verification
-- ---------------------------------------------------------------------------

select pg_temp.impersonate(null, 'anon');

select is(
  (select is_demo from public.verify_rbin((select rbin from demo_issued))), true,
  'verify_rbin marks a demo certificate'
);
select is(
  (select is_demo from public.verify_rbin((select rbin from real_issued))), false,
  'and does not mark a real one'
);

-- ---------------------------------------------------------------------------
-- Nobody outside the operators can change the flag
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2d000000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$ update public.branches set is_demo = true where id = '1d000000-0000-0000-0000-0000000000aa' $$,
  '42501', null,
  'a branch administrator cannot turn their branch into a demo branch'
);

select pg_temp.impersonate('2d000000-0000-0000-0000-0000000000c1');
select throws_ok(
  $$ update public.branches set is_demo = false where id = '1d000000-0000-0000-0000-0000000000dd' $$,
  '42501', null,
  'a super administrator cannot clear the flag from the console'
);
select lives_ok(
  $$ update public.branches set account_name = 'Renamed' where id = '1d000000-0000-0000-0000-0000000000aa' $$,
  'other branch edits still work'
);

select * from finish();
rollback;

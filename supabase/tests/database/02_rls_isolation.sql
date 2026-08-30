-- Row level security and lifecycle enforcement. The point of this file is
-- the spec's Phase 1 acceptance test: cross-branch reads must fail, clients
-- must not escalate privileges, and the transaction lifecycle must hold at
-- the database layer. Run with `supabase test db`.

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

-- ---------------------------------------------------------------------------
-- Impersonation helpers
-- ---------------------------------------------------------------------------

-- set_config(..., true) is transaction local and, unlike SET LOCAL issued
-- through EXECUTE, is unambiguous about surviving the function call. This is
-- the same mechanism Supabase's own RLS test helpers use.
create function pg_temp.impersonate(uid uuid, jwt_role text default 'authenticated')
returns void
language plpgsql
as $$
begin
  -- Return to the session role first, so a second call can switch roles
  -- rather than trying to escalate out of the role currently set.
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', jwt_role)::text,
    true
  );
  perform set_config('role', jwt_role, true);
end;
$$;

create function pg_temp.reset_actor()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: two branches, a member and an admin in each
-- ---------------------------------------------------------------------------

insert into public.branches (id, name, branch_code, account_name) values
  ('10000000-0000-0000-0000-0000000000aa', 'Branch A', 'BRA', 'A Account'),
  ('10000000-0000-0000-0000-0000000000bb', 'Branch B', 'BRB', 'B Account');

insert into auth.users (id, email, raw_user_meta_data) values
  ('20000000-0000-0000-0000-0000000000a1', 'member.a@example.com',
   '{"full_name": "Member A", "scn": "RLS0001", "branch_code": "BRA"}'::jsonb),
  ('20000000-0000-0000-0000-0000000000a2', 'admin.a@example.com',
   '{"full_name": "Admin A", "scn": "RLS0002", "branch_code": "BRA"}'::jsonb),
  ('20000000-0000-0000-0000-0000000000b1', 'member.b@example.com',
   '{"full_name": "Member B", "scn": "RLS0003", "branch_code": "BRB"}'::jsonb),
  ('20000000-0000-0000-0000-0000000000b2', 'admin.b@example.com',
   '{"full_name": "Admin B", "scn": "RLS0004", "branch_code": "BRB"}'::jsonb);

update public.profiles set role = 'branch_admin'
where id in ('20000000-0000-0000-0000-0000000000a2',
             '20000000-0000-0000-0000-0000000000b2');

insert into public.fee_scales (order_name, effective_from, is_active)
values ('Test Order', date '2023-05-16', false);

-- ---------------------------------------------------------------------------
-- Member A creates a transaction and tries to smuggle in a verified status
-- and a BAIN. The insert trigger must strip both.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('20000000-0000-0000-0000-0000000000a1');

insert into public.transactions
  (id, user_id, branch_id, parties, document_type, consideration, amount_payable, status, bain)
values
  ('30000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-0000000000a1',
   '10000000-0000-0000-0000-0000000000aa',
   'Okafor to Eze', 'assignment', 5000000000, 50000000,
   'verified', 'NBA/BRA/2026/000001');

select is(
  (select status::text from public.transactions
   where id = '30000000-0000-0000-0000-000000000001'),
  'awaiting_payment',
  'client-supplied status is forced back to awaiting_payment'
);

select is(
  (select bain from public.transactions
   where id = '30000000-0000-0000-0000-000000000001'),
  null,
  'client-supplied BAIN is stripped on insert'
);

select throws_ok(
  $$ insert into public.transactions
       (user_id, branch_id, parties, document_type, consideration, amount_payable)
     values ('20000000-0000-0000-0000-0000000000b1',
             '10000000-0000-0000-0000-0000000000aa',
             'Forged', 'assignment', 100, 10) $$,
  '42501',
  null,
  'cannot create a transaction for another user'
);

select is(
  (select count(*) from public.transactions
   where user_id = '20000000-0000-0000-0000-0000000000a1')::int,
  1,
  'owner sees their own transaction'
);

select is(
  (select count(*) from public.profiles
   where id = '20000000-0000-0000-0000-0000000000b1')::int,
  0,
  'member cannot read a profile from another branch'
);

select throws_ok(
  $$ update public.profiles set role = 'super_admin'
     where id = '20000000-0000-0000-0000-0000000000a1' $$,
  '42501',
  null,
  'member cannot escalate their own role'
);

select lives_ok(
  $$ update public.profiles set phone = '0800000099'
     where id = '20000000-0000-0000-0000-0000000000a1' $$,
  'member can update their own contact details'
);

select throws_ok(
  $$ insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at)
     values ('20000000-0000-0000-0000-0000000000a1', 'monthly', 'standard',
             2000000, now(), now() + interval '30 days') $$,
  '42501',
  null,
  'members cannot write their own subscriptions'
);

select is(
  (select count(*) from public.audit_log)::int,
  0,
  'member cannot read the audit log'
);

-- ---------------------------------------------------------------------------
-- Cross-branch isolation
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('20000000-0000-0000-0000-0000000000b1');

select is(
  (select count(*) from public.transactions
   where id = '30000000-0000-0000-0000-000000000001')::int,
  0,
  'member of another branch cannot see the transaction'
);

select pg_temp.impersonate('20000000-0000-0000-0000-0000000000b2');

select is(
  (select count(*) from public.transactions
   where id = '30000000-0000-0000-0000-000000000001')::int,
  0,
  'admin of another branch cannot see the transaction'
);

select pg_temp.impersonate('20000000-0000-0000-0000-0000000000a2');

select is(
  (select count(*) from public.transactions
   where id = '30000000-0000-0000-0000-000000000001')::int,
  1,
  'admin of the owning branch sees the transaction'
);

-- ---------------------------------------------------------------------------
-- Lifecycle: submit, then verify. Wrong-order and wrong-actor attempts fail.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.transactions set status = 'verified'
     where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'admin cannot verify before proof is submitted'
);

select pg_temp.impersonate('20000000-0000-0000-0000-0000000000a1');

select lives_ok(
  $$ update public.transactions
     set proof_url = 'proofs/t1.pdf', status = 'pending_verification'
     where id = '30000000-0000-0000-0000-000000000001' $$,
  'owner submits proof of payment'
);

select is(
  (select status::text from public.transactions
   where id = '30000000-0000-0000-0000-000000000001'),
  'pending_verification',
  'submission moved the transaction to pending_verification'
);

select throws_ok(
  $$ update public.transactions set status = 'verified'
     where id = '30000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'owner cannot verify their own transaction'
);

select pg_temp.impersonate('20000000-0000-0000-0000-0000000000a2');

select throws_ok(
  $$ update public.transactions set status = 'rejected'
     where id = '30000000-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'rejection without a reason is refused'
);

select lives_ok(
  $$ update public.transactions set status = 'verified'
     where id = '30000000-0000-0000-0000-000000000001' $$,
  'branch admin verifies the transaction'
);

select pg_temp.reset_actor();

select is(
  (select verified_by from public.transactions
   where id = '30000000-0000-0000-0000-000000000001'),
  '20000000-0000-0000-0000-0000000000a2'::uuid,
  'verified_by is stamped with the admin, not client input'
);

select ok(
  exists (
    select 1 from public.audit_log
    where entity_type = 'transactions'
      and entity_id = '30000000-0000-0000-0000-000000000001'
      and action = 'transactions.update'
  ),
  'the verification wrote an audit log row'
);

-- ---------------------------------------------------------------------------
-- Branch management boundaries
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('20000000-0000-0000-0000-0000000000a2');

select lives_ok(
  $$ update public.branches set account_name = 'A Account Updated'
     where id = '10000000-0000-0000-0000-0000000000aa' $$,
  'branch admin updates own branch bank details'
);

select throws_ok(
  $$ update public.branches set activation_status = 'active'
     where id = '10000000-0000-0000-0000-0000000000aa' $$,
  '42501',
  null,
  'branch admin cannot change activation status'
);

update public.branches set account_name = 'HACKED'
where id = '10000000-0000-0000-0000-0000000000bb';

select pg_temp.reset_actor();

select is(
  (select account_name from public.branches
   where id = '10000000-0000-0000-0000-0000000000bb'),
  'B Account',
  'branch admin cannot touch another branch (update matched no rows)'
);

select is(
  (select count(*) from public.profiles
   where id = '20000000-0000-0000-0000-0000000000a2')::int,
  1,
  'sanity: fixtures intact after impersonation dance'
);

-- ---------------------------------------------------------------------------
-- Anonymous clients: reference data is public, records are not
-- ---------------------------------------------------------------------------

select pg_temp.impersonate(null, 'anon');

select ok(
  (select count(*) > 0 from public.fee_scales),
  'anonymous clients can read fee scales for the offline calculator'
);

select is(
  (select count(*) from public.transactions)::int,
  0,
  'anonymous clients see no transactions'
);

select pg_temp.reset_actor();

select * from finish();

rollback;

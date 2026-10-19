-- Editing and deleting a branch.
--
-- The super administrator may correct any branch, but a branch's two codes are
-- printed on every RBIN and certificate number it issues, so they freeze at
-- the first issuance. A branch may be deleted only while nobody belongs to it.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

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

create function pg_temp.as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
--
--   EDA  has a member with an issued RBIN       codes frozen, not deletable
--   EDB  has nobody                              deletable
--   EDC  has an administrator, nothing issued    codes editable, not deletable
--   EDD  has nobody                              codes editable
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('16000000-0000-0000-0000-0000000000aa', 'Edit Branch A', 'EDA', 'Anambra', 'EA', 'EA Account',
   'active', now()),
  ('16000000-0000-0000-0000-0000000000bb', 'Edit Branch B', 'EDB', 'Lagos', 'EB', null,
   'inactive', null),
  ('16000000-0000-0000-0000-0000000000cc', 'Edit Branch C', 'EDC', 'Abia', 'EC', 'EC Account',
   'active', now()),
  ('16000000-0000-0000-0000-0000000000dd', 'Edit Branch D', 'EDD', 'Enugu', 'ED', null,
   'inactive', null);

-- create_transaction refuses a branch with no published bank details
-- (20261019110000). These fixtures publish them; created_at = now() is
-- this transaction's start, so only the branches inserted above match.
update public.branches set account_number = '0123456789', bank_name = 'Test Bank'
where created_at = now() and account_name is not null;

insert into auth.users (id, email, raw_user_meta_data) values
  ('26000000-0000-0000-0000-0000000000a1', 'edit.member.a@example.com',
   '{"full_name": "Edit Member A", "scn": "EDT0001", "branch_code": "EDA"}'::jsonb),
  ('26000000-0000-0000-0000-0000000000c2', 'edit.admin.c@example.com',
   '{"full_name": "Edit Admin C", "scn": "EDT0002", "branch_code": "EDC"}'::jsonb),
  ('26000000-0000-0000-0000-0000000000a9', 'edit.super@example.com',
   '{"full_name": "Edit Super", "scn": "EDT0003", "branch_code": "EDA"}'::jsonb);

update public.profiles set membership_status = 'approved'
where id::text like '26000000-%';

update public.profiles set role = 'branch_admin'
where id = '26000000-0000-0000-0000-0000000000c2';

update public.profiles set role = 'super_admin'
where id = '26000000-0000-0000-0000-0000000000a9';

update public.profiles
set bank_account_name = full_name, bank_account_number = '0123456789', bank_name = 'Test Bank'
where id::text like '26000000-%';

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
values ('26000000-0000-0000-0000-0000000000a1', 'yearly', 'standard',
        1400000, now(), now() + interval '1 year', 'active');

-- An invoice in EDA, then an RBIN on it. The RBIN is written directly as the
-- service: what matters here is that one exists, not how it was approved.
select pg_temp.impersonate('26000000-0000-0000-0000-0000000000a1');

create temporary table ed_txn as
select * from public.create_transaction(
  'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
  'Edit Party A to Edit Party B');

select pg_temp.as_service();

update public.transactions
set rbin = 'NBA/EDA/0001/2026'
where id = (select transaction_id from pg_temp.ed_txn);

-- ---------------------------------------------------------------------------
-- Editing
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('26000000-0000-0000-0000-0000000000a9');

select lives_ok(
  $$ update public.branches set name = 'Edit Branch A Renamed', state = 'Lagos'
     where id = '16000000-0000-0000-0000-0000000000aa' $$,
  'a super admin edits the name and state of a branch that has issued certificates'
);

select throws_ok(
  $$ update public.branches set branch_code = 'EDAX'
     where id = '16000000-0000-0000-0000-0000000000aa' $$,
  '42501', null,
  'a super admin cannot change the branch code once an RBIN has been issued'
);

select throws_ok(
  $$ update public.branches set short_code = 'EAX'
     where id = '16000000-0000-0000-0000-0000000000aa' $$,
  '42501', null,
  'a super admin cannot change the certificate abbreviation once an RBIN has been issued'
);

select lives_ok(
  $$ update public.branches set branch_code = 'EDDX', short_code = 'EDX'
     where id = '16000000-0000-0000-0000-0000000000dd' $$,
  'a super admin changes both codes of a branch that has issued nothing'
);

select pg_temp.as_service();

select is(
  (select branch_code || '/' || short_code from public.branches
   where id = '16000000-0000-0000-0000-0000000000dd'),
  'EDDX/EDX',
  'the new codes were saved'
);

select pg_temp.impersonate('26000000-0000-0000-0000-0000000000c2');

select throws_ok(
  $$ update public.branches set short_code = 'ECX'
     where id = '16000000-0000-0000-0000-0000000000cc' $$,
  '42501', null,
  'a branch admin cannot change their own branch''s certificate abbreviation'
);

select lives_ok(
  $$ update public.branches set bank_name = 'Edited Bank'
     where id = '16000000-0000-0000-0000-0000000000cc' $$,
  'a branch admin still edits their own branch''s bank details'
);

-- ---------------------------------------------------------------------------
-- Deleting
-- ---------------------------------------------------------------------------

-- RLS filters the row out rather than raising, so the proof is that it
-- survives.
delete from public.branches where id = '16000000-0000-0000-0000-0000000000dd';

select pg_temp.as_service();

select is(
  (select count(*)::int from public.branches where id = '16000000-0000-0000-0000-0000000000dd'),
  1,
  'a branch admin cannot delete a branch'
);

select pg_temp.impersonate('26000000-0000-0000-0000-0000000000a9');

select throws_ok(
  $$ delete from public.branches where id = '16000000-0000-0000-0000-0000000000aa' $$,
  '23503', null,
  'a super admin cannot delete a branch with members and transactions'
);

select throws_ok(
  $$ delete from public.branches where id = '16000000-0000-0000-0000-0000000000cc' $$,
  '23503', null,
  'a super admin cannot delete a branch with an administrator'
);

select lives_ok(
  $$ delete from public.branches where id = '16000000-0000-0000-0000-0000000000bb' $$,
  'a super admin deletes a branch nobody belongs to'
);

select pg_temp.as_service();

select is(
  (select count(*)::int from public.branches where id = '16000000-0000-0000-0000-0000000000bb'),
  0,
  'the empty branch is gone'
);

select * from finish();

rollback;

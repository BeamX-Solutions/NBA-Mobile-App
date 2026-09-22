-- What a super administrator may and may not do.
--
-- The role used to mean "an administrator with every permission". These
-- assertions are what make it a role rather than the absence of one, and most
-- of them are about powers it no longer has.

begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

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
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('16000000-0000-0000-0000-0000000000aa', 'SA Branch', 'SAA', 'Anambra', 'SA', 'SA Account',
   'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('26000000-0000-0000-0000-0000000000a1', 'sa.member@example.com',
   '{"full_name": "SA Member", "scn": "SAD0001", "branch_code": "SAA"}'::jsonb),
  ('26000000-0000-0000-0000-0000000000a2', 'sa.admin@example.com',
   '{"full_name": "SA Admin", "scn": "SAD0002", "branch_code": "SAA"}'::jsonb),
  ('26000000-0000-0000-0000-0000000000a3', 'sa.other@example.com',
   '{"full_name": "SA Other", "scn": "SAD0003", "branch_code": "SAA"}'::jsonb),
  ('26000000-0000-0000-0000-0000000000c1', 'sa.super@example.com',
   '{"full_name": "SA Super", "scn": "SAD0004", "branch_code": "SAA"}'::jsonb),
  ('26000000-0000-0000-0000-0000000000c2', 'sa.super2@example.com',
   '{"full_name": "SA Super Two", "scn": "SAD0005", "branch_code": "SAA"}'::jsonb);

update public.profiles set role = 'branch_admin'
where id = '26000000-0000-0000-0000-0000000000a2';

-- Both platform accounts are detached from the branch, which is the state the
-- migration puts every super administrator into.
update public.profiles set role = 'super_admin', branch_id = null, practice_state = null
where id in ('26000000-0000-0000-0000-0000000000c1',
             '26000000-0000-0000-0000-0000000000c2');

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
values ('26000000-0000-0000-0000-0000000000a1', 'yearly', 'standard',
        1400000, now(), now() + interval '1 year', 'active');

-- A submission waiting to be approved, used for the issuance assertions.
select pg_temp.impersonate('26000000-0000-0000-0000-0000000000a1');

create temporary table sa_txn as
select * from public.create_transaction(
  'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
  'SA Party A to SA Party B');

update public.transactions
set proof_url = '26000000-0000-0000-0000-0000000000a1/slip.pdf',
    status = 'pending_verification'
where id = (select transaction_id from pg_temp.sa_txn);

-- ---------------------------------------------------------------------------
-- Approving is branch work
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('26000000-0000-0000-0000-0000000000c1');

-- The change this migration makes. A platform overseer approving a branch's
-- payment holds both the work and the oversight of the work, which is the
-- arrangement the separation of duties rule exists to prevent.
select throws_ok(
  format('select public.issue_rbin(%L)', (select transaction_id from pg_temp.sa_txn)),
  '42501',
  null,
  'a super administrator cannot approve a submission'
);

-- ---------------------------------------------------------------------------
-- Who may change a role
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('26000000-0000-0000-0000-0000000000a1');

select throws_ok(
  format('select public.set_user_role(%L, %L)',
         '26000000-0000-0000-0000-0000000000a3', 'branch_admin'),
  '42501',
  null,
  'a practitioner cannot appoint an administrator'
);

select pg_temp.impersonate('26000000-0000-0000-0000-0000000000a2');

-- A branch administrator appointing another would make the role
-- self-propagating within a branch, with nobody above it deciding.
select throws_ok(
  format('select public.set_user_role(%L, %L)',
         '26000000-0000-0000-0000-0000000000a3', 'branch_admin'),
  '42501',
  null,
  'a branch administrator cannot appoint another administrator'
);

-- ---------------------------------------------------------------------------
-- Appointing and removing
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('26000000-0000-0000-0000-0000000000c1');

select lives_ok(
  format('select public.set_user_role(%L, %L)',
         '26000000-0000-0000-0000-0000000000a3', 'branch_admin'),
  'a super administrator appoints a branch administrator'
);

select is(
  (select role::text from public.profiles where id = '26000000-0000-0000-0000-0000000000a3'),
  'branch_admin',
  'the appointment is recorded'
);

select lives_ok(
  format('select public.set_user_role(%L, %L)',
         '26000000-0000-0000-0000-0000000000a3', 'branch_member'),
  'a super administrator removes a branch administrator'
);

select is(
  (select role::text from public.profiles where id = '26000000-0000-0000-0000-0000000000a3'),
  'branch_member',
  'the removal is recorded'
);

-- ---------------------------------------------------------------------------
-- What the function refuses
-- ---------------------------------------------------------------------------

-- The lockout guard. A super administrator demoting themselves would be the
-- last one, and no screen could appoint another.
select throws_ok(
  format('select public.set_user_role(%L, %L)',
         '26000000-0000-0000-0000-0000000000c1', 'branch_member'),
  '42501',
  null,
  'a super administrator cannot change their own role'
);

select throws_ok(
  format('select public.set_user_role(%L, %L)',
         '26000000-0000-0000-0000-0000000000c2', 'branch_member'),
  '42501',
  null,
  'one super administrator cannot demote another'
);

-- An interface that can mint platform administrators is an interface that can
-- be used to mint one.
select throws_ok(
  format('select public.set_user_role(%L, %L)',
         '26000000-0000-0000-0000-0000000000a1', 'super_admin'),
  '22023',
  null,
  'nobody can be promoted to super administrator here'
);

select throws_ok(
  format('select public.set_user_role(%L, %L)',
         '26000000-0000-0000-0000-0000000000a1', 'branch_member'),
  '22023',
  null,
  'setting a role somebody already holds is refused'
);

-- An administrator administers a branch. Promoting somebody unattached would
-- create an administrator of nothing.
update public.profiles set branch_id = null
where id = '26000000-0000-0000-0000-0000000000a3';

select throws_ok(
  format('select public.set_user_role(%L, %L)',
         '26000000-0000-0000-0000-0000000000a3', 'branch_admin'),
  '22023',
  null,
  'somebody with no branch cannot be made an administrator'
);

-- ---------------------------------------------------------------------------
-- The branch administrator keeps the power that was taken from the platform
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('26000000-0000-0000-0000-0000000000a2');

select lives_ok(
  format('select public.issue_rbin(%L)', (select transaction_id from pg_temp.sa_txn)),
  'the branch administrator still approves their own branch submission'
);

select * from finish();

rollback;

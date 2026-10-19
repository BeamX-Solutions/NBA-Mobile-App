-- Somebody who is not signed in changes nothing.
--
-- The anon key is public, and until 20261019100000 it could switch a branch
-- off and revoke or restore certificates. With nobody signed in the role is
-- NULL, and a NULL condition in plpgsql skips the raise. Each assertion here
-- runs as anon and has to be refused, by the grant or by the function itself.
--
-- The NULL-safe checks are asserted separately, as an authenticated caller
-- with no profile row: that caller still holds the execute grant, so only
-- the function's own check stands in the way.

begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

create function pg_temp.as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Signed in, but no profile: current_user_role() is NULL exactly as for anon.
create function pg_temp.as_profileless()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '29000000-0000-0000-0000-0000000000ff', 'role', 'authenticated')::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: an active branch with one issued certificate, and a revoked one.
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('19000000-0000-0000-0000-0000000000aa', 'Anon Branch', 'ANB', 'Anambra', 'ZQ', 'Anon Account',
   'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('29000000-0000-0000-0000-0000000000a1', 'anon.member@example.com',
   '{"full_name": "Anon Member", "scn": "ANO0001", "branch_code": "ANB"}'::jsonb);

update public.profiles set membership_status = 'approved'
where id = '29000000-0000-0000-0000-0000000000a1';

insert into public.transactions
  (id, user_id, branch_id, parties, document_type, consideration, amount_payable, branch_fee) values
  ('39000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-0000000000a1',
   '19000000-0000-0000-0000-0000000000aa', 'A to B', 'deed_of_assignment', 1000, 20, 1),
  ('39000000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-0000000000a1',
   '19000000-0000-0000-0000-0000000000aa', 'C to D', 'deed_of_assignment', 1000, 20, 1);

insert into public.certificates (id, transaction_id, certificate_number) values
  ('49000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000001', 'NBA/ZQ/CC/2026/90001'),
  ('49000000-0000-0000-0000-000000000002', '39000000-0000-0000-0000-000000000002', 'NBA/ZQ/CC/2026/90002');

update public.certificates set revoked_at = now(), revocation_reason = 'Fixture'
where id = '49000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- Not signed in
-- ---------------------------------------------------------------------------

select pg_temp.as_anon();

select is(public.is_privileged_actor(), false, 'nobody signed in is not privileged, rather than NULL');

select throws_ok(
  $$ select * from public.set_branch_activation('19000000-0000-0000-0000-0000000000aa', 'inactive') $$,
  '42501', null, 'not signed in, a branch cannot be switched off'
);

select throws_ok(
  $$ select * from public.revoke_certificate('49000000-0000-0000-0000-000000000001', 'Probe') $$,
  '42501', null, 'not signed in, a certificate cannot be revoked'
);

select throws_ok(
  $$ select * from public.restore_certificate('49000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'not signed in, a revocation cannot be reversed'
);

select throws_ok(
  $$ select * from public.set_user_role('29000000-0000-0000-0000-0000000000a1', 'branch_admin') $$,
  '42501', null, 'not signed in, nobody can be made an administrator'
);

-- What the public pages need still works.
select lives_ok(
  $$ select * from public.verify_rbin('NBA/ANB/0001/2026') $$,
  'public verification still works without signing in'
);

select lives_ok(
  $$ select * from public.list_branches_for_signup() $$,
  'registration can still list branches'
);

-- ---------------------------------------------------------------------------
-- Signed in with no profile: the functions' own checks
-- ---------------------------------------------------------------------------

select pg_temp.as_profileless();

select throws_ok(
  $$ select * from public.set_branch_activation('19000000-0000-0000-0000-0000000000aa', 'inactive') $$,
  '42501', 'Only a super administrator may change branch activation',
  'a caller with no role cannot switch a branch off'
);

select throws_ok(
  $$ select * from public.revoke_certificate('49000000-0000-0000-0000-000000000001', 'Probe') $$,
  '42501', 'Only a branch administrator may revoke a certificate',
  'a caller with no role cannot revoke a certificate'
);

select throws_ok(
  $$ select * from public.restore_certificate('49000000-0000-0000-0000-000000000002') $$,
  '42501', 'Only a super administrator may reverse a revocation',
  'a caller with no role cannot reverse a revocation'
);

-- And nothing above changed anything.
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '', true);

select results_eq(
  $$ select (select activation_status::text from public.branches
             where id = '19000000-0000-0000-0000-0000000000aa'),
            (select revoked_at is null from public.certificates
             where id = '49000000-0000-0000-0000-000000000001'),
            (select revoked_at is not null from public.certificates
             where id = '49000000-0000-0000-0000-000000000002') $$,
  $$ values ('active'::text, true, true) $$,
  'the branch is still active and both certificates are as they were'
);

select * from finish();

rollback;

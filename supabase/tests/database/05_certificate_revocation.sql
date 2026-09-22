-- Certificate revocation.
--
-- revoke_certificate and restore_certificate are the only writers of
-- certificates.revoked_at, and what they report is published to anyone who
-- runs a verification, so the assertions here are as much about who is refused
-- as about what succeeds.
--
-- The end-to-end assertion at the bottom is the one that matters most: that a
-- revocation actually reaches verify_rbin, which is the only surface a land
-- registry ever sees.

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
-- Fixtures: two branches, a practitioner and an administrator in each, plus a
-- super administrator
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at, expires_at) values
  ('13000000-0000-0000-0000-0000000000aa', 'Revoke Branch A', 'RVA', 'Anambra', 'RA', 'RA Account',
   'active', now(), now() + interval '1 year'),
  ('13000000-0000-0000-0000-0000000000bb', 'Revoke Branch B', 'RVB', 'Lagos', 'RB', 'RB Account',
   'active', now(), now() + interval '1 year');

insert into auth.users (id, email, raw_user_meta_data) values
  ('23000000-0000-0000-0000-0000000000a1', 'revoke.member.a@example.com',
   '{"full_name": "Revoke Member A", "scn": "RVK0001", "branch_code": "RVA"}'::jsonb),
  ('23000000-0000-0000-0000-0000000000a2', 'revoke.admin.a@example.com',
   '{"full_name": "Revoke Admin A", "scn": "RVK0002", "branch_code": "RVA"}'::jsonb),
  ('23000000-0000-0000-0000-0000000000b2', 'revoke.admin.b@example.com',
   '{"full_name": "Revoke Admin B", "scn": "RVK0003", "branch_code": "RVB"}'::jsonb),
  ('23000000-0000-0000-0000-0000000000c1', 'revoke.super@example.com',
   '{"full_name": "Revoke Super", "scn": "RVK0004", "branch_code": "RVA"}'::jsonb);

update public.profiles set role = 'branch_admin'
where id in ('23000000-0000-0000-0000-0000000000a2',
             '23000000-0000-0000-0000-0000000000b2');

update public.profiles set role = 'super_admin'
where id = '23000000-0000-0000-0000-0000000000c1';

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
values ('23000000-0000-0000-0000-0000000000a1', 'yearly', 'standard',
        1400000, now(), now() + interval '1 year', 'active');

-- A certificate, made the way the application makes one: submitted by the
-- practitioner, then approved by an administrator who is not the submitter.
select pg_temp.impersonate('23000000-0000-0000-0000-0000000000a1');

create temporary table rv_txn as
select * from public.create_transaction(
  'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
  'Revoke Party A to Revoke Party B');

update public.transactions
set proof_url = '23000000-0000-0000-0000-0000000000a1/slip.pdf',
    status = 'pending_verification'
where id = (select transaction_id from pg_temp.rv_txn);

select pg_temp.impersonate('23000000-0000-0000-0000-0000000000a2');

create temporary table rv_issued as
select * from public.issue_rbin((select transaction_id from pg_temp.rv_txn));

create temporary table rv_cert as
select c.id, c.certificate_number
from public.certificates c
where c.transaction_id = (select transaction_id from pg_temp.rv_txn);

-- ---------------------------------------------------------------------------
-- Who may not revoke
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('23000000-0000-0000-0000-0000000000a1');

select throws_ok(
  format('select public.revoke_certificate(%L, %L)',
         (select id from pg_temp.rv_cert), 'Practitioner tried it'),
  '42501',
  null,
  'a practitioner cannot revoke their own certificate'
);

-- The branch check is the whole of the isolation between branches here: an
-- administrator elsewhere has every other qualification to run this.
select pg_temp.impersonate('23000000-0000-0000-0000-0000000000b2');

select throws_ok(
  format('select public.revoke_certificate(%L, %L)',
         (select id from pg_temp.rv_cert), 'Wrong branch'),
  '42501',
  null,
  'a branch administrator cannot revoke another branch certificate'
);

select pg_temp.impersonate('23000000-0000-0000-0000-0000000000a2');

select throws_ok(
  format('select public.revoke_certificate(%L, %L)',
         '00000000-0000-0000-0000-0000000000ff', 'No such certificate'),
  'P0002',
  null,
  'revoking a certificate that does not exist is refused'
);

-- ---------------------------------------------------------------------------
-- A reason is required, because it is published
-- ---------------------------------------------------------------------------

select throws_ok(
  format('select public.revoke_certificate(%L, %L)', (select id from pg_temp.rv_cert), ''),
  '22023',
  null,
  'an empty reason is refused'
);

select throws_ok(
  format('select public.revoke_certificate(%L, %L)', (select id from pg_temp.rv_cert), '   '),
  '22023',
  null,
  'a reason of only whitespace is refused'
);

select throws_ok(
  format('select public.revoke_certificate(%L, null)', (select id from pg_temp.rv_cert)),
  '22023',
  null,
  'a null reason is refused'
);

-- ---------------------------------------------------------------------------
-- The revocation itself
-- ---------------------------------------------------------------------------

select lives_ok(
  format('select public.revoke_certificate(%L, %L)',
         (select id from pg_temp.rv_cert), '  Issued against an unverified payment  '),
  'the issuing branch administrator revokes the certificate'
);

select is(
  (select revocation_reason from public.certificates
   where id = (select id from pg_temp.rv_cert)),
  'Issued against an unverified payment',
  'the reason is stored trimmed'
);

-- The original reason is the record of why, so a second administrator must not
-- be able to write over it with their own account of the same event.
select throws_ok(
  format('select public.revoke_certificate(%L, %L)',
         (select id from pg_temp.rv_cert), 'A different reason'),
  '22023',
  null,
  'a revoked certificate cannot be revoked again'
);

-- ---------------------------------------------------------------------------
-- What the public sees, which is the only surface that matters
-- ---------------------------------------------------------------------------

select pg_temp.as_service();

select is(
  (select v.revoked from public.verify_rbin(
     (select rbin from public.transactions
      where id = (select transaction_id from pg_temp.rv_txn))) v),
  true,
  'verify_rbin reports the certificate as revoked'
);

-- ---------------------------------------------------------------------------
-- Reversing a revocation is the super administrator's alone
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('23000000-0000-0000-0000-0000000000a2');

select throws_ok(
  format('select public.restore_certificate(%L)', (select id from pg_temp.rv_cert)),
  '42501',
  null,
  'the branch administrator who revoked it cannot reverse it'
);

select pg_temp.impersonate('23000000-0000-0000-0000-0000000000c1');

select lives_ok(
  format('select public.restore_certificate(%L)', (select id from pg_temp.rv_cert)),
  'a super administrator reverses the revocation'
);

select * from finish();

rollback;

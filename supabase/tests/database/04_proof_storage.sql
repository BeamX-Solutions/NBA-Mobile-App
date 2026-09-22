-- Storage policies on the proofs bucket.
--
-- A proof of payment is the evidence behind a certificate that a land
-- registry may rely on, so who may read, replace and remove one matters as
-- much as who may read a transaction row. None of it had ever been tested:
-- suites 01 to 03 cover the public tables and stop at the bucket's edge.

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

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
-- Fixtures: two branches, a practitioner and administrators in each
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('12000000-0000-0000-0000-0000000000aa', 'Proof Branch A', 'PFA', 'Anambra', 'PA', 'PA Account',
   'active', now()),
  ('12000000-0000-0000-0000-0000000000bb', 'Proof Branch B', 'PFB', 'Lagos', 'PB', 'PB Account',
   'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('22000000-0000-0000-0000-0000000000a1', 'proof.member.a@example.com',
   '{"full_name": "Proof Member A", "scn": "PRF0001", "branch_code": "PFA"}'::jsonb),
  ('22000000-0000-0000-0000-0000000000a2', 'proof.admin.a@example.com',
   '{"full_name": "Proof Admin A", "scn": "PRF0002", "branch_code": "PFA"}'::jsonb),
  ('22000000-0000-0000-0000-0000000000b1', 'proof.member.b@example.com',
   '{"full_name": "Proof Member B", "scn": "PRF0004", "branch_code": "PFB"}'::jsonb),
  ('22000000-0000-0000-0000-0000000000b2', 'proof.admin.b@example.com',
   '{"full_name": "Proof Admin B", "scn": "PRF0005", "branch_code": "PFB"}'::jsonb);

update public.profiles set role = 'branch_admin'
where id in ('22000000-0000-0000-0000-0000000000a2',
             '22000000-0000-0000-0000-0000000000b2');

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
values ('22000000-0000-0000-0000-0000000000a1', 'yearly', 'standard',
        1400000, now(), now() + interval '1 year', 'active');

insert into public.fee_scales (order_name, effective_from, is_active)
values ('Proof Test Order', date '2023-05-16', false);

-- ---------------------------------------------------------------------------
-- Upload: own folder only
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('22000000-0000-0000-0000-0000000000a1');

create temporary table proof_txn as
select * from public.create_transaction(
  'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
  'Proof Party A to Proof Party B');

select lives_ok(
  $probe$ insert into storage.objects (bucket_id, name, owner_id)
     values ('proofs',
             '22000000-0000-0000-0000-0000000000a1/'
               || (select transaction_id from pg_temp.proof_txn) || '.pdf',
             '22000000-0000-0000-0000-0000000000a1') $probe$,
  'a practitioner uploads a proof into their own folder'
);

-- The folder check is the whole of the isolation between practitioners.
select throws_ok(
  $probe$ insert into storage.objects (bucket_id, name, owner_id)
     values ('proofs',
             '22000000-0000-0000-0000-0000000000b1/planted.pdf',
             '22000000-0000-0000-0000-0000000000a1') $probe$,
  '42501',
  null,
  'a practitioner cannot upload into another practitioner folder'
);

select pg_temp.impersonate('22000000-0000-0000-0000-0000000000b1');

select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'proofs'
     and name like '22000000-0000-0000-0000-0000000000a1/%'),
  0,
  'a practitioner cannot read another practitioner proof'
);

-- ---------------------------------------------------------------------------
-- Branch administrators: the proof of a transaction in their own branch only
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('22000000-0000-0000-0000-0000000000a1');

update public.transactions
set proof_url = '22000000-0000-0000-0000-0000000000a1/'
                  || (select transaction_id from pg_temp.proof_txn) || '.pdf',
    status = 'pending_verification'
where id = (select transaction_id from pg_temp.proof_txn);

select pg_temp.impersonate('22000000-0000-0000-0000-0000000000a2');

select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'proofs'
     and name = (select proof_url from public.transactions
                 where id = (select transaction_id from pg_temp.proof_txn))),
  1,
  'the owning branch administrator can read the proof'
);

select pg_temp.impersonate('22000000-0000-0000-0000-0000000000b2');

select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'proofs'
     and name like '22000000-0000-0000-0000-0000000000a1/%'),
  0,
  'an administrator of another branch cannot read the proof'
);

-- ---------------------------------------------------------------------------
-- Once verified, the evidence is fixed
--
-- The delete policy was written to stop a practitioner erasing the payment
-- their own certificate rests on. Replacing the file in place erases it just
-- as thoroughly, so the same guard has to sit on the update policy.
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('22000000-0000-0000-0000-0000000000a2');

select lives_ok(
  $probe$ select public.issue_rbin((select transaction_id from pg_temp.proof_txn)) $probe$,
  'the branch administrator verifies the transaction'
);

select pg_temp.impersonate('22000000-0000-0000-0000-0000000000a1');

select is(
  (select status::text from public.transactions
   where id = (select transaction_id from pg_temp.proof_txn)),
  'verified',
  'the transaction is verified, so its proof is now evidence'
);

-- Only the replace path is asserted here. Deletion cannot be reached from
-- SQL at all: storage.protect_delete is a statement level BEFORE DELETE
-- trigger that raises for any direct delete, whatever the policy says, so the
-- delete policy is exercisable only through the Storage API. An assertion
-- written against it here would be testing that trigger, not the policy.
--
-- The replace does not raise. A policy that admits no row makes the statement
-- match nothing rather than fail, so the assertion is on the file afterwards,
-- read back as a service actor: a practitioner denied the write may also be
-- denied the read, and an assertion that cannot see the file would pass
-- whether the file survived or not.

update storage.objects
set metadata = jsonb_build_object('overwritten', true)
where bucket_id = 'proofs'
  and name = (select proof_url from public.transactions
              where id = (select transaction_id from pg_temp.proof_txn));

select pg_temp.as_service();

select is(
  (select metadata ->> 'overwritten' from storage.objects
   where bucket_id = 'proofs'
     and name = (select proof_url from public.transactions
                 where id = (select transaction_id from pg_temp.proof_txn))),
  null,
  'the practitioner cannot replace the proof behind a verified transaction'
);

-- The guard must not reach further than that. A rejected submission is
-- resubmitted by uploading over the same path, so a practitioner whose proof
-- was turned down has to be able to replace it.
update public.transactions
set status = 'rejected', rejection_reason = 'Slip unreadable'
where id = (select transaction_id from pg_temp.proof_txn);

select pg_temp.impersonate('22000000-0000-0000-0000-0000000000a1');

update storage.objects
set metadata = jsonb_build_object('resubmitted', true)
where bucket_id = 'proofs'
  and name = (select proof_url from public.transactions
              where id = (select transaction_id from pg_temp.proof_txn));

select pg_temp.as_service();

select is(
  (select metadata ->> 'resubmitted' from storage.objects
   where bucket_id = 'proofs'
     and name = (select proof_url from public.transactions
                 where id = (select transaction_id from pg_temp.proof_txn))),
  'true',
  'a practitioner can still replace the proof on a rejected transaction'
);

select * from finish();

rollback;

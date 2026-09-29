-- The client pays the branch, and the branch pays the practitioner.
--
-- The client pays the full professional fee into the branch account. The
-- branch keeps 2% and sends the balance to the practitioner, and records that
-- it has done so through record_remittance. These assertions cover the figures
-- a transaction carries, who may record the transfer, and that nobody can
-- write the remittance or the branch's share around the functions.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

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
-- Fixtures: two branches, a practitioner and an administrator in the first,
-- an administrator in the second, and a practitioner with no bank details
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('15000000-0000-0000-0000-0000000000aa', 'Remit Branch A', 'RMA', 'Anambra', 'MA', 'MA Account',
   'active', now()),
  ('15000000-0000-0000-0000-0000000000bb', 'Remit Branch B', 'RMB', 'Lagos', 'MB', 'MB Account',
   'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('27000000-0000-0000-0000-0000000000a1', 'remit.member.a@example.com',
   '{"full_name": "Remit Member A", "scn": "RMT0001", "branch_code": "RMA"}'::jsonb),
  ('27000000-0000-0000-0000-0000000000a2', 'remit.admin.a@example.com',
   '{"full_name": "Remit Admin A", "scn": "RMT0002", "branch_code": "RMA"}'::jsonb),
  ('27000000-0000-0000-0000-0000000000a3', 'remit.member.nobank@example.com',
   '{"full_name": "Remit Member No Bank", "scn": "RMT0003", "branch_code": "RMA"}'::jsonb),
  ('27000000-0000-0000-0000-0000000000b2', 'remit.admin.b@example.com',
   '{"full_name": "Remit Admin B", "scn": "RMT0004", "branch_code": "RMB"}'::jsonb);

update public.profiles set role = 'branch_admin'
where id in ('27000000-0000-0000-0000-0000000000a2',
             '27000000-0000-0000-0000-0000000000b2');

update public.profiles
set bank_account_name = 'Remit Member A', bank_account_number = '0123456789',
    bank_name = 'Test Bank'
where id = '27000000-0000-0000-0000-0000000000a1';

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
values
  ('27000000-0000-0000-0000-0000000000a1', 'yearly', 'standard',
   1400000, now(), now() + interval '1 year', 'active'),
  ('27000000-0000-0000-0000-0000000000a3', 'yearly', 'standard',
   1400000, now(), now() + interval '1 year', 'active');

-- ---------------------------------------------------------------------------
-- Drawing the invoice
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('27000000-0000-0000-0000-0000000000a3');

select throws_ok(
  $$ select public.create_transaction(
       'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
       'No Bank A to No Bank B') $$,
  'P0001',
  null,
  'a practitioner with no bank details cannot draw an invoice'
);

select pg_temp.impersonate('27000000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select public.create_transaction(
       'deed_of_assignment'::public.document_type, 2500000000, 250000000, 0,
       'Cheap A to Cheap B') $$,
  '23514',
  'The branch fee does not match the professional fee',
  'a practitioner cannot name their own branch fee'
);

create temporary table rm_txn as
select * from public.create_transaction(
  'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
  'Remit Party A to Remit Party B');

select is(
  (select amount_payable from public.transactions
   where id = (select transaction_id from pg_temp.rm_txn)),
  250000000::bigint,
  'the client pays the whole professional fee into the branch account'
);

select is(
  (select branch_fee from public.transactions
   where id = (select transaction_id from pg_temp.rm_txn)),
  5000000::bigint,
  'the branch keeps 2% of it'
);

select is(
  (select due_to_practitioner from public.transactions
   where id = (select transaction_id from pg_temp.rm_txn)),
  245000000::bigint,
  'and owes the practitioner the rest'
);

-- ---------------------------------------------------------------------------
-- Nobody writes around the functions
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.transactions set branch_fee = 0
     where id = (select transaction_id from pg_temp.rm_txn) $$,
  '42501',
  null,
  'the practitioner cannot change the branch fee'
);

select throws_ok(
  $$ update public.transactions
     set remitted_at = now(),
         remitted_by = '27000000-0000-0000-0000-0000000000a1',
         remitted_to = 'Mine'
     where id = (select transaction_id from pg_temp.rm_txn) $$,
  '42501',
  null,
  'the practitioner cannot mark themselves paid'
);

insert into public.transactions
  (id, user_id, branch_id, parties, document_type, consideration, amount_payable, branch_fee)
values
  ('37000000-0000-0000-0000-000000000001',
   '27000000-0000-0000-0000-0000000000a1',
   '15000000-0000-0000-0000-0000000000aa',
   'Direct A to Direct B', 'deed_of_assignment', 2500000000, 250000000, 0);

select is(
  (select branch_fee from public.transactions
   where id = '37000000-0000-0000-0000-000000000001'),
  5000000::bigint,
  'a row written directly gets the branch fee the server computes, not the one supplied'
);

select throws_ok(
  $$ update public.profiles set bank_account_number = '12345'
     where id = '27000000-0000-0000-0000-0000000000a1' $$,
  '23514',
  null,
  'a bank account number must be a ten digit NUBAN'
);

-- ---------------------------------------------------------------------------
-- Recording the transfer to the practitioner
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('27000000-0000-0000-0000-0000000000a2');

select throws_ok(
  $$ select public.record_remittance((select transaction_id from pg_temp.rm_txn), 'EARLY') $$,
  'P0001',
  null,
  'nothing is sent on before the client''s payment is verified'
);

-- Submitted by the practitioner and verified by the branch, as the
-- application does it.
select pg_temp.impersonate('27000000-0000-0000-0000-0000000000a1');

update public.transactions
set proof_url = '27000000-0000-0000-0000-0000000000a1/slip.pdf',
    status = 'pending_verification'
where id = (select transaction_id from pg_temp.rm_txn);

select pg_temp.impersonate('27000000-0000-0000-0000-0000000000a2');

select * from public.issue_rbin((select transaction_id from pg_temp.rm_txn));

select pg_temp.impersonate('27000000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select public.record_remittance((select transaction_id from pg_temp.rm_txn), 'SELF') $$,
  '42501',
  null,
  'the practitioner cannot record their own payment'
);

select pg_temp.impersonate('27000000-0000-0000-0000-0000000000b2');

select throws_ok(
  $$ select public.record_remittance((select transaction_id from pg_temp.rm_txn), 'OTHER') $$,
  '42501',
  null,
  'another branch cannot record it'
);

select pg_temp.impersonate('27000000-0000-0000-0000-0000000000a2');

select lives_ok(
  $$ select public.record_remittance((select transaction_id from pg_temp.rm_txn), ' TRF-001 ') $$,
  'the branch records that it has paid the practitioner'
);

select is(
  (select remitted_to from public.transactions
   where id = (select transaction_id from pg_temp.rm_txn)),
  'Remit Member A, 0123456789, Test Bank',
  'the account it was sent to is kept as it stood'
);

select is(
  (select remittance_reference from public.transactions
   where id = (select transaction_id from pg_temp.rm_txn)),
  'TRF-001',
  'with the transfer reference'
);

select throws_ok(
  $$ select public.record_remittance((select transaction_id from pg_temp.rm_txn), 'AGAIN') $$,
  'P0001',
  null,
  'a transfer is recorded once'
);

select * from finish();

rollback;

-- The database owns the fee and the invoice's particulars (20261019110000).
--
-- A certificate attests that a document's fee was charged at Scale 4. Until
-- this migration the fee was whatever the caller said, a direct insert skipped
-- every check, and the owner could change the amount the certificate prints
-- after the fee was drawn. These assertions pin each of those shut, and check
-- that both clients' ordinary submission paths still work.

begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

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
-- Scale 4, figures as mobile's calculate.test.ts has them
-- ---------------------------------------------------------------------------

select is(public.professional_fee_for('deed_of_assignment', 5000000000), 500000000::bigint,
  '4A: ₦50m is 10% throughout');
select is(public.professional_fee_for('deed_of_assignment', 6000000000), 550000000::bigint,
  '4A: ₦60m is ₦5,000,000 plus 5% of ₦10m');
select is(public.professional_fee_for('deed_of_conveyance', 15000000000), 900000000::bigint,
  '4A: ₦150m reaches the 3% band');
select is(public.professional_fee_for('mortgage_deed', 15000000000), 450000000::bigint,
  '4B: ₦150m is 4%, 3% and 2% by band');
select is(public.professional_fee_for('tenancy_agreement', 1200000000), 85000000::bigint,
  '4C: ₦12m annual rent is 10%, then 5%');
select is(public.professional_fee_for('deed_of_assignment', 105), 11::bigint,
  'half a kobo rounds up, as the clients round it');
select is(public.professional_fee_for('deed_of_assignment', 0), 0::bigint,
  'zero is a real answer, not an error');

select throws_ok(
  $$ select public.professional_fee_for('power_of_attorney', 100000000) $$,
  '22023', null,
  'a power of attorney has no scale fee to compute'
);

select throws_ok(
  $$ select public.professional_fee_for('deed_of_assignment', -1) $$,
  '22023', null,
  'a negative amount is refused'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one branch, two practitioners and an administrator
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('1e000000-0000-0000-0000-0000000000aa', 'Fee Branch', 'FSC', 'Anambra', 'QX', 'QX Account',
   'active', now());

-- create_transaction refuses a branch with no published bank details
-- (20261019110000). These fixtures publish them; created_at = now() is
-- this transaction's start, so only the branches inserted above match.
update public.branches set account_number = '0123456789', bank_name = 'Test Bank'
where created_at = now() and account_name is not null;

insert into auth.users (id, email, raw_user_meta_data) values
  ('2e000000-0000-0000-0000-0000000000a1', 'fee.member.a@example.com',
   '{"full_name": "Fee Member A", "scn": "FEE0001", "branch_code": "FSC"}'::jsonb),
  ('2e000000-0000-0000-0000-0000000000a2', 'fee.admin@example.com',
   '{"full_name": "Fee Admin", "scn": "FEE0002", "branch_code": "FSC"}'::jsonb),
  ('2e000000-0000-0000-0000-0000000000b1', 'fee.member.b@example.com',
   '{"full_name": "Fee Member B", "scn": "FEE0003", "branch_code": "FSC"}'::jsonb);

update public.profiles set membership_status = 'approved'
where id::text like '2e000000-%';

update public.profiles set role = 'branch_admin'
where id = '2e000000-0000-0000-0000-0000000000a2';

update public.profiles
set bank_account_name = 'Fee Member A', bank_account_number = '0123456789',
    bank_name = 'Test Bank'
where id = '2e000000-0000-0000-0000-0000000000a1';

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
values ('2e000000-0000-0000-0000-0000000000a1', 'yearly', 'standard',
        1400000, now(), now() + interval '1 year', 'active');

-- A second branch that has named its account but published no number or
-- bank, as Awka stood on 19 October 2026, and a member ready in every other
-- respect.
insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('1e000000-0000-0000-0000-0000000000bb', 'Unpaid Branch', 'FSD', 'Anambra', 'QY', 'QY Account',
   'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2e000000-0000-0000-0000-0000000000c1', 'fee.member.c@example.com',
   '{"full_name": "Fee Member C", "scn": "FEE0004", "branch_code": "FSD"}'::jsonb);

update public.profiles
set membership_status = 'approved',
    bank_account_name = 'Fee Member C', bank_account_number = '0123456789',
    bank_name = 'Test Bank'
where id = '2e000000-0000-0000-0000-0000000000c1';

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
values ('2e000000-0000-0000-0000-0000000000c1', 'yearly', 'standard',
        1400000, now(), now() + interval '1 year', 'active');

-- ---------------------------------------------------------------------------
-- Drawing the invoice
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000c1');

select throws_ok(
  $$ select public.create_transaction(
       'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
       'Unpaid A to Unpaid B') $$,
  'P0001',
  null,
  'no invoice is drawn on a branch that has published no bank details'
);

select throws_like(
  $$ select public.create_transaction(
       'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
       'Unpaid A to Unpaid B') $$,
  'Unpaid Branch has not published its bank details yet%',
  'and the member is told which branch must add them'
);

select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select public.create_transaction(
       'deed_of_assignment'::public.document_type, 2500000000, 100, 2,
       'Cheap A to Cheap B') $$,
  '23514',
  'The fee does not match Scale 4 for this amount. Recalculate and try again.',
  'a practitioner cannot name their own professional fee'
);

select throws_ok(
  $$ select public.create_transaction(
       'power_of_attorney'::public.document_type, 2500000000, 0, 0,
       'Donor to Donee') $$,
  '22023',
  null,
  'a power of attorney cannot be invoiced at a computed fee'
);

-- One kobo above the scale, as mobile's float rounding can land.
create temporary table fee_txn as
select * from public.create_transaction(
  'deed_of_assignment'::public.document_type, 2500000000, 250000001, 5000000,
  'Fee Party A to Fee Party B');

select is(
  (select amount_payable from public.transactions
   where id = (select transaction_id from pg_temp.fee_txn)),
  250000000::bigint,
  'a figure a kobo off is accepted, and the scale''s figure is stored'
);

select is(
  (select branch_fee from public.transactions
   where id = (select transaction_id from pg_temp.fee_txn)),
  5000000::bigint,
  'and the branch fee is 2% of the stored figure'
);

select throws_ok(
  $$ insert into public.transactions
       (user_id, branch_id, parties, document_type, consideration, amount_payable)
     values ('2e000000-0000-0000-0000-0000000000a1',
             '1e000000-0000-0000-0000-0000000000aa',
             'Direct A to Direct B', 'deed_of_assignment', 2500000000, 1) $$,
  '42501',
  'Transactions are created through create_transaction',
  'a transaction cannot be written around create_transaction'
);

-- ---------------------------------------------------------------------------
-- The particulars stand as drawn
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.transactions set consideration = 50000000000
     where id = (select transaction_id from pg_temp.fee_txn) $$,
  '42501',
  'an invoice''s particulars cannot be changed once it is drawn',
  'the owner cannot change the amount the fee was charged on'
);

select throws_ok(
  $$ update public.transactions set document_type = 'tenancy_agreement'
     where id = (select transaction_id from pg_temp.fee_txn) $$,
  '42501', null,
  'the owner cannot change the document type'
);

select throws_ok(
  $$ update public.transactions set parties = 'Someone Else'
     where id = (select transaction_id from pg_temp.fee_txn) $$,
  '42501', null,
  'the owner cannot change the parties'
);

select throws_ok(
  $$ update public.transactions set rejection_reason = 'Planted'
     where id = (select transaction_id from pg_temp.fee_txn) $$,
  '42501', null,
  'the owner cannot write a rejection reason'
);

-- ---------------------------------------------------------------------------
-- A proof is a file uploaded for this transaction
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.transactions
     set proof_url = '2e000000-0000-0000-0000-0000000000b1/'
                       || (select transaction_id from pg_temp.fee_txn) || '.pdf',
         status = 'pending_verification'
     where id = (select transaction_id from pg_temp.fee_txn) $$,
  '42501',
  'proof of payment must be a file uploaded for this transaction',
  'a proof cannot point into another practitioner''s folder'
);

select throws_ok(
  $$ update public.transactions
     set proof_url = '2e000000-0000-0000-0000-0000000000a1/3e000000-0000-0000-0000-000000000099.pdf',
         status = 'pending_verification'
     where id = (select transaction_id from pg_temp.fee_txn) $$,
  '42501', null,
  'a proof cannot be another transaction''s file'
);

select throws_ok(
  $$ update public.transactions
     set proof_url = '2e000000-0000-0000-0000-0000000000a1/'
                       || (select transaction_id from pg_temp.fee_txn) || '/../other.pdf',
         status = 'pending_verification'
     where id = (select transaction_id from pg_temp.fee_txn) $$,
  '42501', null,
  'a proof path cannot climb out of its folder'
);

-- The web app's path.
select lives_ok(
  $$ update public.transactions
     set proof_url = '2e000000-0000-0000-0000-0000000000a1/'
                       || (select transaction_id from pg_temp.fee_txn) || '/first.pdf',
         status = 'pending_verification'
     where id = (select transaction_id from pg_temp.fee_txn) $$,
  'the owner submits a proof the way the web app names it'
);

select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000a2');

select lives_ok(
  $$ update public.transactions
     set status = 'rejected', rejection_reason = 'Slip is unreadable'
     where id = (select transaction_id from pg_temp.fee_txn) $$,
  'the branch can still reject it'
);

select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000a1');

-- Mobile's path, on resubmission.
select lives_ok(
  $$ update public.transactions
     set proof_url = '2e000000-0000-0000-0000-0000000000a1/'
                       || (select transaction_id from pg_temp.fee_txn) || '.pdf',
         status = 'pending_verification'
     where id = (select transaction_id from pg_temp.fee_txn) $$,
  'the owner resubmits a proof the way mobile names it'
);

select is(
  (select rejection_reason from public.transactions
   where id = (select transaction_id from pg_temp.fee_txn)),
  null,
  'resubmission still clears the branch''s reason'
);

select pg_temp.impersonate('2e000000-0000-0000-0000-0000000000a2');

select lives_ok(
  $$ select * from public.issue_rbin((select transaction_id from pg_temp.fee_txn)) $$,
  'the branch can still verify it'
);

select is(
  (select status::text from public.transactions
   where id = (select transaction_id from pg_temp.fee_txn)),
  'verified',
  'and it is verified on the particulars it was drawn with'
);

select * from finish();

rollback;

-- Administrator and practitioner separation, receipt numbering, and RBIN
-- issuance.
--
-- Every assertion here corresponds to a defect that reached a running system
-- and was found by a person tripping over it rather than by a test:
--
--   * create_transaction returned a receipt number it never stored, because
--     the insert trigger stripped it. SECURITY DEFINER changes the database
--     role a function runs as, not the JWT, so the function was not privileged
--     in the eyes of a trigger that reads auth.role().
--   * issue_rbin could never issue anything, for the same reason in the other
--     direction: its own update was refused by the trigger guarding rbin.
--   * An administrator could submit transactions, before the two roles were
--     separated in the database rather than only in the app.
--
-- The pattern worth remembering: SECURITY DEFINER does not make a caller
-- privileged to these triggers, because privilege here is read from the JWT.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- Impersonation, as in 02. set_config(..., true) is transaction local and is
-- the mechanism Supabase's own RLS helpers use.
-- ---------------------------------------------------------------------------

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
-- Fixtures: one branch, a practitioner and two administrators.
--
-- Two administrators, because separation of duties means one of them has to
-- be able to approve a submission the other made.
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at, expires_at)
values ('11000000-0000-0000-0000-0000000000aa', 'Sep Branch', 'SEPBR', 'Anambra', 'SB', 'Sep Account',
        'active', now(), now() + interval '1 year');

insert into auth.users (id, email, raw_user_meta_data) values
  ('21000000-0000-0000-0000-0000000000a1', 'sep.member@example.com',
   '{"full_name": "Sep Member", "scn": "SEP0001", "branch_code": "SEPBR"}'::jsonb),
  ('21000000-0000-0000-0000-0000000000a2', 'sep.admin@example.com',
   '{"full_name": "Sep Admin", "scn": "SEP0002", "branch_code": "SEPBR"}'::jsonb),
  ('21000000-0000-0000-0000-0000000000a3', 'sep.admin2@example.com',
   '{"full_name": "Sep Admin Two", "scn": "SEP0003", "branch_code": "SEPBR"}'::jsonb);

update public.profiles set role = 'branch_admin'
where id in ('21000000-0000-0000-0000-0000000000a2',
             '21000000-0000-0000-0000-0000000000a3');

-- create_transaction refuses without an active subscription, so the
-- practitioner gets one. Written as a service actor, which is the only path
-- there is: no client policy permits writing a subscription.
insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
values ('21000000-0000-0000-0000-0000000000a1', 'yearly', 'standard',
        1400000, now(), now() + interval '1 year', 'active');

insert into public.fee_scales (order_name, effective_from, is_active)
values ('Sep Test Order', date '2023-05-16', false);

-- ---------------------------------------------------------------------------
-- An administrator account administers, and nothing else
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('21000000-0000-0000-0000-0000000000a2');

select throws_ok(
  $$ select public.create_transaction(
       'deed_of_assignment'::public.document_type, 100000000, 10000000, 200000, 'A and B') $$,
  '42501',
  'Administrator accounts cannot submit transactions. Use a practitioner account.',
  'an administrator cannot call create_transaction'
);

-- The function is one route to the table. A crafted POST is another, and the
-- insert policy has to refuse it independently.
select throws_ok(
  $$ insert into public.transactions
       (user_id, branch_id, parties, document_type, consideration, amount_payable)
     values ('21000000-0000-0000-0000-0000000000a2',
             '11000000-0000-0000-0000-0000000000aa',
             'Direct', 'deed_of_assignment', 1000, 20) $$,
  '42501',
  null,
  'an administrator cannot insert a transaction directly'
);

-- ---------------------------------------------------------------------------
-- A practitioner can, and the receipt number survives
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('21000000-0000-0000-0000-0000000000a1');

create temporary table created_txn as
select * from public.create_transaction(
  'deed_of_assignment'::public.document_type, 2500000000, 250000000, 5000000,
  'Okeke to Eze');

select isnt(
  (select transaction_id from created_txn), null,
  'a practitioner can create a transaction'
);

-- The defect this pins: the function returned a reference the trigger had
-- already stripped, so the practitioner quoted a number on their bank
-- transfer that the branch could not find.
select is(
  (select t.receipt_number from public.transactions t
   where t.id = (select transaction_id from created_txn)),
  (select receipt_number from created_txn),
  'the stored receipt number is the one create_transaction returned'
);

select matches(
  (select receipt_number from created_txn),
  '^TXN-[0-9]{5}-DOA$',
  'the receipt number carries the branch sequence and document code'
);

-- The marker that lets the function through must not let anything else
-- through. A client-supplied receipt number is still stripped.
insert into public.transactions
  (id, user_id, branch_id, parties, document_type, consideration, amount_payable, receipt_number)
values
  ('31000000-0000-0000-0000-000000000002',
   '21000000-0000-0000-0000-0000000000a1',
   '11000000-0000-0000-0000-0000000000aa',
   'Forged reference', 'deed_of_assignment', 1000, 20, 'TXN-99999-FAKE');

select is(
  (select receipt_number from public.transactions
   where id = '31000000-0000-0000-0000-000000000002'),
  null,
  'a client-supplied receipt number is still stripped on a direct insert'
);

-- ---------------------------------------------------------------------------
-- Issuance
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ update public.transactions
     set proof_url = 'proofs/sep.pdf', status = 'pending_verification'
     where id = (select transaction_id from created_txn) $$,
  'the practitioner submits proof of payment'
);

select pg_temp.impersonate('21000000-0000-0000-0000-0000000000a2');

-- The defect this pins: issue_rbin's own update was refused by the trigger
-- guarding rbin, so no administrator could ever approve anything.
create temporary table issued as
select * from public.issue_rbin((select transaction_id from created_txn));

select matches(
  (select rbin from issued),
  '^NBA/SEPBR/[0-9]{4}/[0-9]{4}$',
  'the RBIN is branch scoped, as printed on the certificate'
);

select matches(
  (select certificate_number from issued),
  '^NBA/SB/CC/[0-9]{4}/[0-9]{5}$',
  'the certificate number is branch scoped'
);

select is(
  (select status::text from public.transactions
   where id = (select transaction_id from created_txn)),
  'verified',
  'issuance moved the transaction to verified'
);

-- A retry after a dropped connection must not mint a second number.
--
-- The refusal comes from the status check rather than the rbin check, and the
-- distinction is worth pinning. issue_rbin tests status before it tests rbin,
-- so once the first call has moved the transaction to verified, the second is
-- turned away with 22023 and the 23505 guard behind it is never reached. That
-- guard is not dead weight, it is the backstop if a transaction ever reaches
-- pending_verification with an rbin already set, but it is unreachable by this
-- route and a test expecting it would be asserting the wrong thing.
select throws_ok(
  $$ select public.issue_rbin((select transaction_id from pg_temp.created_txn)) $$,
  '22023',
  null,
  'issuance refuses to run twice on the same transaction'
);

-- The guard the marker routes around is still closed to everyone else.
select throws_ok(
  $$ update public.transactions set rbin = 'NBA/SEPBR/9999/2026'
     where id = '31000000-0000-0000-0000-000000000002' $$,
  '42501',
  'this field is managed by the server',
  'an administrator still cannot write an RBIN directly'
);

-- ---------------------------------------------------------------------------
-- Separation of duties
-- ---------------------------------------------------------------------------

-- Point the second transaction at the administrator and submit it on their
-- behalf, which only a service actor can do, then have them try to approve it.
select pg_temp.as_service();

update public.transactions
set user_id = '21000000-0000-0000-0000-0000000000a2',
    proof_url = 'proofs/own.pdf',
    status = 'pending_verification'
where id = '31000000-0000-0000-0000-000000000002';

select pg_temp.impersonate('21000000-0000-0000-0000-0000000000a2');

select throws_ok(
  $$ select public.issue_rbin('31000000-0000-0000-0000-000000000002') $$,
  '42501',
  'You cannot approve your own submission. Another administrator must review it.',
  'an administrator cannot approve their own submission'
);

-- A second administrator in the same branch can.
select pg_temp.impersonate('21000000-0000-0000-0000-0000000000a3');

select lives_ok(
  $$ select public.issue_rbin('31000000-0000-0000-0000-000000000002') $$,
  'another administrator in the branch can approve it'
);

select * from finish();

rollback;

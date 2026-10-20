-- Payables: one transfer settles everything a branch owes a practitioner.
--
-- record_payout records the transfer against the invoices the administrator
-- was shown, with the receipt they uploaded. These assertions cover a payout
-- settling several invoices at once, the money held going down, the one
-- notification, who may read the payout and its receipt, and that nobody
-- writes a payout or links an invoice to one around the function.

begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

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
-- Branch P: an administrator, practitioner 1 with three verified invoices and
--   bank details, practitioner 2 with one verified invoice.
-- Branch Q: an administrator.
-- A super administrator.
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('1b000000-0000-0000-0000-0000000000aa', 'Pay P Branch', 'PYP', 'Anambra', 'P1', 'P Account', 'active', now()),
  ('1b000000-0000-0000-0000-0000000000bb', 'Pay Q Branch', 'PYQ', 'Anambra', 'P2', 'Q Account', 'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2b000000-0000-0000-0000-0000000000a1', 'pay.admin.p@example.com',
   '{"full_name": "Pay Admin P", "scn": "PAY0001", "branch_code": "PYP"}'::jsonb),
  ('2b000000-0000-0000-0000-0000000000a2', 'pay.one@example.com',
   '{"full_name": "Pay One", "scn": "PAY0002", "branch_code": "PYP"}'::jsonb),
  ('2b000000-0000-0000-0000-0000000000a3', 'pay.two@example.com',
   '{"full_name": "Pay Two", "scn": "PAY0003", "branch_code": "PYP"}'::jsonb),
  ('2b000000-0000-0000-0000-0000000000b1', 'pay.admin.q@example.com',
   '{"full_name": "Pay Admin Q", "scn": "PAY0004", "branch_code": "PYQ"}'::jsonb),
  ('2b000000-0000-0000-0000-0000000000c1', 'pay.super@example.com',
   '{"full_name": "Pay Super", "scn": "PAY0005", "branch_code": "PYP"}'::jsonb);

update public.profiles set membership_status = 'approved'
where id::text like '2b000000-%';

update public.profiles set role = 'branch_admin'
where id in ('2b000000-0000-0000-0000-0000000000a1', '2b000000-0000-0000-0000-0000000000b1');

update public.profiles set role = 'super_admin', branch_id = null
where id = '2b000000-0000-0000-0000-0000000000c1';

update public.profiles
set bank_account_name = 'Pay One', bank_account_number = '0123456789', bank_name = 'Test Bank'
where id = '2b000000-0000-0000-0000-0000000000a2';

update public.profiles
set bank_account_name = 'Pay Two', bank_account_number = '9876543210', bank_name = 'Test Bank'
where id = '2b000000-0000-0000-0000-0000000000a3';

-- Inserted as the owner, already verified: how they got there is 09's concern.
insert into public.transactions
  (id, user_id, branch_id, parties, document_type, consideration, amount_payable, branch_fee,
   status, verified_at) values
  ('3b000000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-0000000000a2',
   '1b000000-0000-0000-0000-0000000000aa', 'A to B', 'deed_of_assignment', 1000000, 100000, 2000,
   'verified', now()),
  ('3b000000-0000-0000-0000-000000000002', '2b000000-0000-0000-0000-0000000000a2',
   '1b000000-0000-0000-0000-0000000000aa', 'C to D', 'deed_of_assignment', 1000000, 50000, 1000,
   'verified', now()),
  ('3b000000-0000-0000-0000-000000000003', '2b000000-0000-0000-0000-0000000000a2',
   '1b000000-0000-0000-0000-0000000000aa', 'E to F', 'deed_of_assignment', 1000000, 20000, 400,
   'verified', now()),
  ('3b000000-0000-0000-0000-000000000004', '2b000000-0000-0000-0000-0000000000a3',
   '1b000000-0000-0000-0000-0000000000aa', 'G to H', 'deed_of_assignment', 1000000, 10000, 200,
   'verified', now());

-- ---------------------------------------------------------------------------
-- Uploading the receipt
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a1');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('payout-receipts',
             '1b000000-0000-0000-0000-0000000000aa/2b000000-0000-0000-0000-0000000000a2/one.pdf',
             '2b000000-0000-0000-0000-0000000000a1') $$,
  'a branch administrator uploads a receipt into their branch''s folder'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('payout-receipts',
             '1b000000-0000-0000-0000-0000000000bb/2b000000-0000-0000-0000-0000000000a2/planted.pdf',
             '2b000000-0000-0000-0000-0000000000a1') $$,
  '42501',
  null,
  'but not into another branch''s'
);

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a2');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('payout-receipts',
             '1b000000-0000-0000-0000-0000000000aa/2b000000-0000-0000-0000-0000000000a2/forged.pdf',
             '2b000000-0000-0000-0000-0000000000a2') $$,
  '42501',
  null,
  'a practitioner cannot upload a receipt of their own'
);

-- ---------------------------------------------------------------------------
-- Who may record it
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000c1');

select throws_ok(
  $$ select public.record_payout('2b000000-0000-0000-0000-0000000000a2',
       array['3b000000-0000-0000-0000-000000000001']::uuid[],
       '1b000000-0000-0000-0000-0000000000aa/2b000000-0000-0000-0000-0000000000a2/one.pdf') $$,
  '42501',
  null,
  'the super administrator holds no branch''s money and cannot record a payout'
);

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select public.record_payout('2b000000-0000-0000-0000-0000000000a2',
       array['3b000000-0000-0000-0000-000000000001',
             '3b000000-0000-0000-0000-000000000004']::uuid[],
       '1b000000-0000-0000-0000-0000000000aa/2b000000-0000-0000-0000-0000000000a2/one.pdf') $$,
  '42501',
  null,
  'one payout cannot settle another practitioner''s invoice'
);

select throws_ok(
  $$ insert into public.payouts (branch_id, user_id, amount, paid_to, receipt_path, recorded_by)
     values ('1b000000-0000-0000-0000-0000000000aa', '2b000000-0000-0000-0000-0000000000a2', 1,
             'Mine', '1b000000-0000-0000-0000-0000000000aa/2b000000-0000-0000-0000-0000000000a2/one.pdf',
             '2b000000-0000-0000-0000-0000000000a1') $$,
  '42501',
  null,
  'nobody writes a payout around the function'
);

-- ---------------------------------------------------------------------------
-- One transfer, two invoices
-- ---------------------------------------------------------------------------

create temporary table p_payout as
select public.record_payout('2b000000-0000-0000-0000-0000000000a2',
  array['3b000000-0000-0000-0000-000000000001',
        '3b000000-0000-0000-0000-000000000002']::uuid[],
  '1b000000-0000-0000-0000-0000000000aa/2b000000-0000-0000-0000-0000000000a2/one.pdf',
  'TRF-PAY-1') as id;

select is(
  (select amount from public.payouts where id = (select id from pg_temp.p_payout)),
  147000::bigint,
  'the payout is the sum of what the two invoices owed'
);

select is(
  (select count(*)::int from public.transactions
   where payout_id = (select id from pg_temp.p_payout) and remitted_at is not null),
  2,
  'both invoices are marked paid by it'
);

select is(
  (select remitted_at from public.transactions where id = '3b000000-0000-0000-0000-000000000003'),
  null,
  'the invoice it was not asked to cover stays owed'
);

select is(
  (select (public.dashboard_summary() ->> 'held_for_practitioners')::bigint),
  29400::bigint,
  'held for practitioners falls by the amount paid'
);

select throws_ok(
  $$ select public.record_payout('2b000000-0000-0000-0000-0000000000a2',
       array['3b000000-0000-0000-0000-000000000003']::uuid[],
       '1b000000-0000-0000-0000-0000000000aa/2b000000-0000-0000-0000-0000000000a2/one.pdf') $$,
  'P0001',
  'This receipt is already attached to another payment',
  'a receipt settles one payout only'
);

select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'payout-receipts'
     and name = '1b000000-0000-0000-0000-0000000000aa/2b000000-0000-0000-0000-0000000000a2/one.pdf'),
  1,
  'the branch reads its receipt'
);

-- A failed payout leaves its upload behind, and the branch may tidy that up,
-- but an attached receipt is evidence and stays.
insert into storage.objects (bucket_id, name, owner_id)
values ('payout-receipts',
        '1b000000-0000-0000-0000-0000000000aa/2b000000-0000-0000-0000-0000000000a2/stray.pdf',
        '2b000000-0000-0000-0000-0000000000a1');

-- Newer storage versions refuse a direct delete unless this is set, to steer
-- clients to the Storage API; the policy under test is the same either way.
select set_config('storage.allow_delete_query', 'true', true);

delete from storage.objects
where bucket_id = 'payout-receipts' and name like '1b000000-0000-0000-0000-0000000000aa/%';

select is(
  (select array_agg(name order by name) from storage.objects
   where bucket_id = 'payout-receipts' and name like '1b000000-0000-0000-0000-0000000000aa/%'),
  array['1b000000-0000-0000-0000-0000000000aa/2b000000-0000-0000-0000-0000000000a2/one.pdf'],
  'an unattached upload can be removed, an attached receipt cannot'
);

-- ---------------------------------------------------------------------------
-- The practitioner's side
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a2');

select is(
  (select count(*)::int from public.notifications
   where user_id = '2b000000-0000-0000-0000-0000000000a2' and kind = 'share_paid'),
  1,
  'one payout, one notification, though it settled two invoices'
);

select matches(
  (select body from public.notifications
   where user_id = '2b000000-0000-0000-0000-0000000000a2' and kind = 'share_paid'),
  '₦1,470.00 for 2 invoices .*TRF-PAY-1',
  'which says how much, for how many invoices, and the reference'
);

select results_eq(
  $$ select amount, paid_to from public.payouts $$,
  $$ values (147000::bigint, 'Pay One, 0123456789, Test Bank'::text) $$,
  'the practitioner reads their payout, and the account it went to'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'payout-receipts'),
  1,
  'and its receipt'
);

select throws_ok(
  $$ update public.transactions set payout_id = null
     where id = '3b000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'the practitioner cannot unlink an invoice from its payout'
);

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a3');

select results_eq(
  $$ select (select count(*)::int from public.payouts),
            (select count(*)::int from storage.objects where bucket_id = 'payout-receipts') $$,
  $$ values (0, 0) $$,
  'another practitioner in the branch sees neither'
);

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000b1');

select results_eq(
  $$ select (select count(*)::int from public.payouts),
            (select count(*)::int from storage.objects
             where bucket_id = 'payout-receipts' and name like '1b000000-%') $$,
  $$ values (0, 0) $$,
  'nor does another branch''s administrator'
);

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000c1');

select is(
  (select count(*)::int from public.payouts where id = (select id from pg_temp.p_payout)),
  1,
  'the super administrator reads every payout'
);

select * from finish();

rollback;

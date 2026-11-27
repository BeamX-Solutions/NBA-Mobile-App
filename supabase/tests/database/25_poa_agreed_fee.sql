-- Power of Attorney invoices at the agreed fee (20261127100000): refused until
-- the branch accepts them, then drawn on the practitioner's agreed fee with
-- the branch's usual share, and nothing else about pricing loosened.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Fixtures here hold the subscriptions they need; the free first month
-- (23_free_trial.sql) would add another on approval.
alter table public.profiles disable trigger grant_free_trial;

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
--   p1  practitioner, ready to invoice, in the POA branch
--   a1  that branch's administrator
--   a2  another branch's administrator
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, account_number, bank_name,
   activation_status, activated_at) values
  ('1f000000-0000-0000-0000-0000000000aa', 'Attorney Branch', 'ATB', 'Anambra', 'AT',
   'AT Account', '0123456789', 'Test Bank', 'active', now()),
  ('1f000000-0000-0000-0000-0000000000bb', 'Other Branch', 'OTB', 'Anambra', 'OT',
   'OT Account', '0123456789', 'Test Bank', 'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2f100000-0000-0000-0000-0000000000a1', 'poa.member@example.com',
   '{"full_name": "Poa Member", "scn": "POA0001", "branch_code": "ATB"}'::jsonb),
  ('2f100000-0000-0000-0000-0000000000a2', 'poa.admin@example.com',
   '{"full_name": "Poa Admin", "scn": "POA0002", "branch_code": "ATB"}'::jsonb),
  ('2f100000-0000-0000-0000-0000000000a3', 'poa.other.admin@example.com',
   '{"full_name": "Other Admin", "scn": "POA0003", "branch_code": "OTB"}'::jsonb);

update public.profiles set membership_status = 'approved' where id::text like '2f100000-%';
update public.profiles set role = 'branch_admin'
where id in ('2f100000-0000-0000-0000-0000000000a2', '2f100000-0000-0000-0000-0000000000a3');

update public.profiles
set bank_account_name = 'Poa Member', bank_account_number = '0123456789', bank_name = 'Test Bank'
where id = '2f100000-0000-0000-0000-0000000000a1';

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
values ('2f100000-0000-0000-0000-0000000000a1', 'yearly', 'standard',
        30000000, now(), now() + interval '1 year', 'active');

-- ---------------------------------------------------------------------------
-- Off until the branch turns it on
-- ---------------------------------------------------------------------------

select is(
  (select accepts_poa_invoices from public.branches where id = '1f000000-0000-0000-0000-0000000000aa'),
  false,
  'a branch does not accept Power of Attorney invoices until it chooses to'
);

select pg_temp.impersonate('2f100000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select * from public.create_transaction('power_of_attorney', 0, 50000000,
       public.branch_fee_for(50000000), 'Donor to Donee', '{}'::jsonb, 'Plot 1, Awka') $$,
  'P0001',
  'Attorney Branch does not accept Power of Attorney invoices. Its fee is agreed with the client under paragraph 2 of the Order.',
  'so a practitioner there cannot draw one yet'
);

-- A member cannot turn it on: the update policy admits administrators only.
update public.branches set accepts_poa_invoices = true
where id = '1f000000-0000-0000-0000-0000000000aa';

select pg_temp.impersonate('2f100000-0000-0000-0000-0000000000a3');

-- Nor another branch's administrator.
update public.branches set accepts_poa_invoices = true
where id = '1f000000-0000-0000-0000-0000000000aa';

select pg_temp.impersonate('2f100000-0000-0000-0000-0000000000a2');

select is(
  (select accepts_poa_invoices from public.branches where id = '1f000000-0000-0000-0000-0000000000aa'),
  false,
  'neither a member nor another branch''s administrator can turn it on'
);

select lives_ok(
  $$ update public.branches set accepts_poa_invoices = true
     where id = '1f000000-0000-0000-0000-0000000000aa' $$,
  'the branch''s own administrator can'
);

select is(
  (select accepts_poa_invoices from public.branches where id = '1f000000-0000-0000-0000-0000000000aa'),
  true,
  'and it is on'
);

-- ---------------------------------------------------------------------------
-- Drawing one
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2f100000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select * from public.create_transaction('power_of_attorney', 0, 0, 0,
       'Donor to Donee', '{}'::jsonb, 'Plot 1, Awka') $$,
  '23514',
  'Enter the fee agreed with the client',
  'the agreed fee must be more than nothing'
);

select throws_ok(
  $$ select * from public.create_transaction('power_of_attorney', 0, 100000000000001,
       public.branch_fee_for(100000000000001), 'Donor to Donee', '{}'::jsonb, 'Plot 1, Awka') $$,
  '23514',
  'The agreed fee is larger than the calculator accepts.',
  'nor beyond the calculator''s ceiling'
);

select throws_ok(
  $$ select * from public.create_transaction('power_of_attorney', 2500000000, 50000000,
       public.branch_fee_for(50000000), 'Donor to Donee', '{}'::jsonb, 'Plot 1, Awka') $$,
  '23514',
  null,
  'no consideration is recorded, since no value is assessed'
);

select throws_ok(
  $$ select * from public.create_transaction('power_of_attorney', 0, 50000000, 1,
       'Donor to Donee', '{}'::jsonb, 'Plot 1, Awka') $$,
  '23514',
  'The branch fee does not match the professional fee',
  'the branch takes its usual share, not a figure the caller names'
);

create temporary table poa as
select * from public.create_transaction('power_of_attorney', 0, 50000000,
  public.branch_fee_for(50000000), 'Donor to Donee', '{"agreed": "50000000"}'::jsonb,
  'Plot 1, Awka');
grant select on poa to authenticated;

select results_eq(
  $$ select t.document_type::text, t.consideration, t.amount_payable, t.branch_fee,
            t.status::text, t.calculation_id is null, t.invoice_number like 'TXN-AT-%-POA'
     from public.transactions t join poa on poa.transaction_id = t.id $$,
  $$ values ('power_of_attorney'::text, 0::bigint, 50000000::bigint,
             public.branch_fee_for(50000000), 'awaiting_payment'::text, true, true) $$,
  'with the branch accepting, the invoice is drawn on the agreed fee and the branch''s share'
);

select is(
  (select t.amount_payable - t.branch_fee from public.transactions t join poa on poa.transaction_id = t.id),
  50000000 - public.branch_fee_for(50000000),
  'and the practitioner is due the rest, as for any invoice'
);

-- ---------------------------------------------------------------------------
-- Nothing else loosened
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from public.create_transaction('deed_of_assignment', 2500000000, 1000,
       public.branch_fee_for(1000), 'A to B', '{}'::jsonb, 'Plot 2, Awka') $$,
  '23514',
  'The fee does not match Scale 4 for this amount. Recalculate and try again.',
  'a scale document still cannot name its own fee'
);

select lives_ok(
  $$ select * from public.create_transaction('deed_of_assignment', 2500000000,
       public.professional_fee_for('deed_of_assignment', 2500000000),
       public.branch_fee_for(public.professional_fee_for('deed_of_assignment', 2500000000)),
       'A to B', '{}'::jsonb, 'Plot 2, Awka') $$,
  'and is still drawn at the scale fee'
);

select is(
  (select count(*)::int from public.calculations c
   join public.transactions t on t.calculation_id = c.id
   where t.user_id = '2f100000-0000-0000-0000-0000000000a1'),
  1,
  'which records its calculation, while the agreed fee records none'
);

-- Turning it off stops new ones; the invoice already drawn stands.
select pg_temp.impersonate('2f100000-0000-0000-0000-0000000000a2');
update public.branches set accepts_poa_invoices = false
where id = '1f000000-0000-0000-0000-0000000000aa';

select pg_temp.impersonate('2f100000-0000-0000-0000-0000000000a1');

select throws_ok(
  $$ select * from public.create_transaction('power_of_attorney', 0, 50000000,
       public.branch_fee_for(50000000), 'Donor to Donee', '{}'::jsonb, 'Plot 1, Awka') $$,
  'P0001',
  null,
  'turned off again, new Power of Attorney invoices are refused'
);

select is(
  (select t.status::text from public.transactions t join poa on poa.transaction_id = t.id),
  'awaiting_payment',
  'while the one already drawn stands'
);

select * from finish();

rollback;

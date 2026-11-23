-- Invoice numbers are unique across branches (20261123090000).
--
-- Each branch used to count from TXN-00001 while the column is unique
-- system-wide, so the second branch to invoice collided with the first. Two
-- fresh branches now each draw their first Deed of Assignment invoice, and
-- each number carries its branch's short code.

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

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

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, account_number, bank_name, activation_status, activated_at) values
  ('1f000000-0000-0000-0000-0000000000aa', 'Inv Test P Branch', 'INVP', 'Anambra', 'IP', 'P Account', '0123456789', 'Test Bank', 'active', now()),
  ('1f000000-0000-0000-0000-0000000000bb', 'Inv Test Q Branch', 'INVQ', 'Anambra', 'IQ', 'Q Account', '0123456789', 'Test Bank', 'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2f000000-0000-0000-0000-0000000000a1', 'inv.p@example.com',
   '{"full_name": "Inv P", "scn": "INV0001", "branch_code": "INVP"}'::jsonb),
  ('2f000000-0000-0000-0000-0000000000b1', 'inv.q@example.com',
   '{"full_name": "Inv Q", "scn": "INV0002", "branch_code": "INVQ"}'::jsonb);

update public.profiles
set membership_status = 'approved',
    bank_account_name = full_name, bank_account_number = '0123456789', bank_name = 'Test Bank'
where id::text like '2f000000-%';

insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status) values
  ('2f000000-0000-0000-0000-0000000000a1', 'yearly', 'standard', 0, now(), now() + interval '1 year', 'active'),
  ('2f000000-0000-0000-0000-0000000000b1', 'yearly', 'standard', 0, now(), now() + interval '1 year', 'active');

-- A ₦10,000,000 assignment: 10% is ₦1,000,000; the branch keeps 2%.
select pg_temp.impersonate('2f000000-0000-0000-0000-0000000000a1');
create temporary table p_invoice as
  select * from public.create_transaction('deed_of_assignment', 1000000000, 100000000, 2000000, 'A to B');

select pg_temp.impersonate('2f000000-0000-0000-0000-0000000000b1');
create temporary table q_invoice as
  select * from public.create_transaction('deed_of_assignment', 1000000000, 100000000, 2000000, 'C to D');

reset role;

select is((select invoice_number from p_invoice), 'TXN-IP-00001-DOA', 'the first branch''s first invoice carries its code');
select is((select invoice_number from q_invoice), 'TXN-IQ-00001-DOA', 'the second branch''s first invoice does not collide with it');

select pg_temp.impersonate('2f000000-0000-0000-0000-0000000000a1');
create temporary table p_second as
  select * from public.create_transaction('deed_of_assignment', 1000000000, 100000000, 2000000, 'E to F');
reset role;
select is((select invoice_number from p_second), 'TXN-IP-00002-DOA', 'a branch''s invoices count up');

-- The counter is not keyed by year, so next January cannot repeat a number.
select is(
  (select count(*)::int from public.number_sequences where scope = 'invoice:1f000000-0000-0000-0000-0000000000aa'),
  1, 'the branch has one counter, not one per year'
);
select ok(
  (select count(*) from public.number_sequences where scope like 'receipt:INVP:%') = 0,
  'and the old per-year counter is no longer used'
);

select * from finish();
rollback;

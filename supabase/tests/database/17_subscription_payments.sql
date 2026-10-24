-- Buying a subscription: who may start a checkout, what it costs, and what
-- a confirmed payment grants.
--
-- The Edge Functions talk to Paystack; these assertions pin the database half,
-- which is where the money rules live. A checkout is priced here, recorded
-- before Paystack sees it, and turned into a subscription only by the service
-- role, once, for the amount it was priced at.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

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
-- Fixtures: an approved practitioner, a pending one, and a super administrator
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('1b000000-0000-0000-0000-0000000000aa', 'Pay X Branch', 'PYX', 'Anambra', 'P1', 'X Account', 'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2b000000-0000-0000-0000-0000000000a1', 'pay.one@example.com',
   '{"full_name": "Pay One", "scn": "PAY0001", "branch_code": "PYX"}'::jsonb),
  ('2b000000-0000-0000-0000-0000000000a2', 'pay.pending@example.com',
   '{"full_name": "Pay Pending", "scn": "PAY0002", "branch_code": "PYX"}'::jsonb),
  ('2b000000-0000-0000-0000-0000000000a3', 'pay.two@example.com',
   '{"full_name": "Pay Two", "scn": "PAY0003", "branch_code": "PYX"}'::jsonb),
  ('2b000000-0000-0000-0000-0000000000c1', 'pay.super@example.com',
   '{"full_name": "Pay Super", "scn": "PAY0004", "branch_code": "PYX"}'::jsonb);

update public.profiles set membership_status = 'approved'
where id in ('2b000000-0000-0000-0000-0000000000a1', '2b000000-0000-0000-0000-0000000000a3',
             '2b000000-0000-0000-0000-0000000000c1');

update public.profiles set role = 'super_admin', branch_id = null
where id = '2b000000-0000-0000-0000-0000000000c1';

-- ---------------------------------------------------------------------------
-- The price list
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select public.subscription_price('monthly'), public.subscription_price('quarterly'),
            public.subscription_price('yearly'), public.subscription_price('weekly') $$,
  $$ values (3000000::bigint, 8500000::bigint, 30000000::bigint, null::bigint) $$,
  'the plans cost the client''s prices in kobo, and weekly is not on sale'
);

-- ---------------------------------------------------------------------------
-- Starting a checkout
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a1');

create temporary table checkout as
select public.begin_subscription_payment('quarterly') as c;
grant select on checkout to authenticated, service_role;

select results_eq(
  $$ select (c ->> 'amount')::bigint, c ->> 'email', c ->> 'reference' like 'NBA-%' from checkout $$,
  $$ values (8500000::bigint, 'pay.one@example.com'::text, true) $$,
  'a checkout is priced by the database, for the caller''s own email'
);

select results_eq(
  $$ select user_id, plan::text, amount, status::text from public.subscription_payments
     where reference = (select c ->> 'reference' from checkout) $$,
  $$ values ('2b000000-0000-0000-0000-0000000000a1'::uuid, 'quarterly'::text, 8500000::bigint, 'pending'::text) $$,
  'and recorded as pending before Paystack sees it'
);

select throws_ok(
  $$ select public.begin_subscription_payment('weekly') $$,
  '22023',
  'That plan is not on sale',
  'a withdrawn plan cannot be bought'
);

select throws_ok(
  $$ insert into public.subscription_payments (reference, user_id, plan, amount)
     values ('NBA-forged', '2b000000-0000-0000-0000-0000000000a1', 'yearly', 1) $$,
  '42501',
  null,
  'a practitioner cannot write a checkout of their own'
);

select throws_ok(
  $$ select public.record_subscription_payment((select c ->> 'reference' from checkout), 8500000) $$,
  '42501',
  null,
  'nor grant themselves the subscription'
);

select is(
  (select count(*)::int from public.subscriptions where user_id = '2b000000-0000-0000-0000-0000000000a1'),
  0,
  'starting a checkout grants nothing'
);

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a2');

select throws_ok(
  $$ select public.begin_subscription_payment('monthly') $$,
  'P0001',
  'Your branch has not approved your membership yet. You can subscribe once it has.',
  'a member awaiting approval cannot subscribe'
);

select is(
  (select count(*)::int from public.subscription_payments
   where reference = (select c ->> 'reference' from checkout)),
  0,
  'and cannot see somebody else''s checkout'
);

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000c1');

select throws_ok(
  $$ select public.begin_subscription_payment('monthly') $$,
  '42501',
  null,
  'a super administrator cannot subscribe'
);

select pg_temp.impersonate(null, 'anon');

select throws_ok(
  $$ select public.begin_subscription_payment('monthly') $$,
  '42501',
  null,
  'nobody signed out can start a checkout'
);

-- ---------------------------------------------------------------------------
-- Recording a confirmed payment
-- ---------------------------------------------------------------------------

select pg_temp.impersonate(null, 'service_role');

select throws_ok(
  $$ select public.record_subscription_payment((select c ->> 'reference' from checkout), 100) $$,
  '22023',
  null,
  'a payment for less than the price grants nothing'
);

select throws_ok(
  $$ select public.record_subscription_payment('NBA-never-issued', 8500000) $$,
  'P0002',
  null,
  'a reference this database did not issue grants nothing'
);

create temporary table recorded as
select public.record_subscription_payment((select c ->> 'reference' from checkout), 8500000) as r;
grant select on recorded to authenticated, service_role;

select results_eq(
  $$ select plan::text, amount, status::text, paystack_reference,
            expires_at between now() + interval '3 months' - interval '1 minute'
                           and now() + interval '3 months' + interval '1 minute'
     from public.subscriptions where user_id = '2b000000-0000-0000-0000-0000000000a1' $$,
  $$ values ('quarterly'::text, 8500000::bigint, 'active'::text,
             (select c ->> 'reference' from checkout), true) $$,
  'the confirmed payment becomes a quarterly subscription, three months from now'
);

select is(
  (select status::text from public.subscription_payments
   where reference = (select c ->> 'reference' from checkout)),
  'paid',
  'and the checkout is marked paid'
);

select is(
  public.record_subscription_payment((select c ->> 'reference' from checkout), 8500000),
  (select r from recorded),
  'recording the same payment again returns the same answer'
);

select is(
  (select count(*)::int from public.subscriptions where user_id = '2b000000-0000-0000-0000-0000000000a1'),
  1,
  'and grants nothing twice'
);

-- ---------------------------------------------------------------------------
-- Renewing early keeps the unused time; a lapsed row carries nothing
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a1');
create temporary table renewal as select public.begin_subscription_payment('monthly') as c;
grant select on renewal to authenticated, service_role;

select pg_temp.impersonate(null, 'service_role');
select public.record_subscription_payment((select c ->> 'reference' from renewal), 3000000);

select results_eq(
  $$ select status::text, count(*)::int from public.subscriptions
     where user_id = '2b000000-0000-0000-0000-0000000000a1' group by status order by status $$,
  $$ values ('active'::text, 1), ('cancelled'::text, 1) $$,
  'renewing leaves one active subscription, the earlier one closed'
);

select is(
  (select expires_at from public.subscriptions
   where user_id = '2b000000-0000-0000-0000-0000000000a1' and status = 'active'),
  (select expires_at from public.subscriptions
   where user_id = '2b000000-0000-0000-0000-0000000000a1' and status = 'cancelled')
    + interval '1 month',
  'and runs a month past where the earlier one would have ended'
);

-- Pay Two had a subscription that lapsed but is still marked active, as every
-- lapsed subscription is: nothing flips the status when the date passes.
select pg_temp.impersonate(null, 'postgres');
insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status) values
  ('2b000000-0000-0000-0000-0000000000a3', 'monthly', 'standard', 3000000,
   now() - interval '2 months', now() - interval '1 month', 'active');

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a3');
create temporary table lapsed as select public.begin_subscription_payment('yearly') as c;
grant select on lapsed to authenticated, service_role;

select pg_temp.impersonate(null, 'service_role');
select public.record_subscription_payment((select c ->> 'reference' from lapsed), 30000000);

select results_eq(
  $$ select status::text,
            expires_at between now() + interval '1 year' - interval '1 minute'
                           and now() + interval '1 year' + interval '1 minute'
     from public.subscriptions
     where user_id = '2b000000-0000-0000-0000-0000000000a3' order by expires_at $$,
  $$ values ('expired'::text, false), ('active'::text, true) $$,
  'a lapsed subscription is closed as expired and the new one runs a year from now'
);

-- The practitioner can now invoice: create_transaction's own test.
select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a3');

select is(
  (select count(*)::int from public.subscriptions
   where user_id = auth.uid() and status = 'active' and expires_at > now()),
  1,
  'the practitioner holds exactly the active subscription create_transaction asks for'
);

select pg_temp.impersonate('2b000000-0000-0000-0000-0000000000a3');

select throws_ok(
  $$ select public.fail_subscription_payment((select c ->> 'reference' from lapsed)) $$,
  '42501',
  null,
  'a practitioner cannot mark a checkout failed either'
);

select * from finish();

rollback;

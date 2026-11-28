-- The first month free: who gets it, when, how often, and what paying during
-- it does.
--
-- A practitioner approved after 20261126100100 is granted one ₦0 month from
-- the moment of approval. Practitioners approved before it, or who have ever
-- held a subscription, are not. Revenue ignores the free month and the
-- dashboard counts it apart from paying subscribers.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- The free month is paused in production (20261128100000); these tests are
-- about how it behaves when on.
update public.feature_flags set enabled = true where name = 'free_trial';

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

create function pg_temp.as_postgres()
returns void
language sql
as $$ select set_config('role', 'postgres', true); $$;

-- ---------------------------------------------------------------------------
-- Fixtures
--
--   t1  new, pending: approved during the test, gets the free month
--   t2  "existing": excluded as if approved before the free month existed
--   t3  pending, but once held a paid subscription
--   t4  pending, to be made super administrator before approval
--   c1  super administrator, for the dashboard
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('1c000000-0000-0000-0000-0000000000aa', 'Trial Branch', 'TRL', 'Anambra', 'T1', 'T Account', 'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2c000000-0000-0000-0000-0000000000a1', 'trial.one@example.com',
   '{"full_name": "Trial One", "scn": "TRL0001", "branch_code": "TRL"}'::jsonb),
  ('2c000000-0000-0000-0000-0000000000a2', 'trial.existing@example.com',
   '{"full_name": "Trial Existing", "scn": "TRL0002", "branch_code": "TRL"}'::jsonb),
  ('2c000000-0000-0000-0000-0000000000a3', 'trial.paidbefore@example.com',
   '{"full_name": "Trial Paid Before", "scn": "TRL0003", "branch_code": "TRL"}'::jsonb),
  ('2c000000-0000-0000-0000-0000000000a4', 'trial.super@example.com',
   '{"full_name": "Trial Super", "scn": "TRL0004", "branch_code": "TRL"}'::jsonb),
  ('2c000000-0000-0000-0000-0000000000c1', 'trial.console@example.com',
   '{"full_name": "Trial Console", "scn": "TRL0005", "branch_code": "TRL"}'::jsonb);

select is(
  (select count(*)::int from public.profiles
   where id::text like '2c000000-%' and membership_status = 'pending'),
  5,
  'everybody signs up pending'
);

insert into public.free_trial_excluded (user_id) values ('2c000000-0000-0000-0000-0000000000a2');

insert into public.subscriptions
  (user_id, plan, rate_type, amount, starts_at, expires_at, status, paystack_reference) values
  ('2c000000-0000-0000-0000-0000000000a3', 'monthly', 'standard', 3000000,
   now() - interval '3 months', now() - interval '2 months', 'expired', 'NBA-trial-old');

update public.profiles set role = 'super_admin', branch_id = null
where id in ('2c000000-0000-0000-0000-0000000000a4', '2c000000-0000-0000-0000-0000000000c1');

-- ---------------------------------------------------------------------------
-- Approval grants the free month
-- ---------------------------------------------------------------------------

update public.profiles set membership_status = 'approved'
where id::text like '2c000000-%';

select results_eq(
  $$ select plan::text, rate_type::text, amount, status::text, paystack_reference,
            starts_at between now() - interval '1 minute' and now() + interval '1 minute',
            expires_at between now() + interval '1 month' - interval '1 minute'
                           and now() + interval '1 month' + interval '1 minute'
     from public.subscriptions where user_id = '2c000000-0000-0000-0000-0000000000a1' $$,
  $$ values ('monthly'::text, 'free_trial'::text, 0::bigint, 'active'::text, null::text, true, true) $$,
  'approval grants a new practitioner a free month, from now, costing nothing'
);

select results_eq(
  $$ select kind, link from public.notifications
     where user_id = '2c000000-0000-0000-0000-0000000000a1' and kind = 'free_trial_started' $$,
  $$ values ('free_trial_started'::text, '/profile/plans'::text) $$,
  'and tells them, pointing at the plans'
);

select is(
  (select count(*)::int from public.subscriptions where user_id = '2c000000-0000-0000-0000-0000000000a2'),
  0,
  'a practitioner approved before the free month existed gets none'
);

select is(
  (select count(*)::int from public.subscriptions
   where user_id = '2c000000-0000-0000-0000-0000000000a3' and rate_type = 'free_trial'),
  0,
  'nor does anybody who has held a subscription before'
);

select is(
  (select count(*)::int from public.subscriptions where user_id = '2c000000-0000-0000-0000-0000000000a4'),
  0,
  'nor a super administrator, who belongs to no branch and cannot invoice'
);

-- ---------------------------------------------------------------------------
-- Once in a lifetime
-- ---------------------------------------------------------------------------

-- An SCN correction sends an approved member back to pending; approval again.
update public.profiles set membership_status = 'pending' where id = '2c000000-0000-0000-0000-0000000000a1';
update public.profiles set membership_status = 'approved' where id = '2c000000-0000-0000-0000-0000000000a1';
update public.profiles set membership_status = 'pending' where id = '2c000000-0000-0000-0000-0000000000a2';
update public.profiles set membership_status = 'approved' where id = '2c000000-0000-0000-0000-0000000000a2';

select is(
  (select count(*)::int from public.subscriptions where user_id = '2c000000-0000-0000-0000-0000000000a1'),
  1,
  're-approval does not grant a second free month'
);

select is(
  (select count(*)::int from public.subscriptions where user_id = '2c000000-0000-0000-0000-0000000000a2'),
  0,
  'nor a first one to somebody excluded'
);

select throws_ok(
  $$ insert into public.subscriptions (user_id, plan, rate_type, amount, starts_at, expires_at, status)
     values ('2c000000-0000-0000-0000-0000000000a1', 'monthly', 'free_trial', 0,
             now() - interval '1 year', now() - interval '11 months', 'expired') $$,
  '23505',
  null,
  'the table itself refuses a second free month'
);

-- ---------------------------------------------------------------------------
-- The practitioner sees it as a free month
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000a1');

select results_eq(
  $$ select s ->> 'status', (s ->> 'free_trial')::boolean from (select public.assistant_subscription() as s) x $$,
  $$ values ('active'::text, true) $$,
  'the assistant reports an active free month'
);

-- ---------------------------------------------------------------------------
-- The dashboard counts it apart, and revenue ignores it
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000c1');

create temporary table before_paying as
select public.dashboard_summary('1c000000-0000-0000-0000-0000000000aa') as d;
grant select on before_paying to authenticated, service_role;

select results_eq(
  $$ select (d ->> 'practitioners')::int, (d ->> 'subscribers')::int, (d ->> 'on_trial')::int,
            (d ->> 'revenue_total')::bigint
     from before_paying $$,
  $$ values (3, 0, 1, 3000000::bigint) $$,
  'a free month counts as on trial, not as a subscriber, and earns nothing'
);

-- ---------------------------------------------------------------------------
-- Paying during the free month keeps the free days
-- ---------------------------------------------------------------------------

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000a1');

create temporary table checkout as
select public.begin_subscription_payment('monthly') as c;
grant select on checkout to authenticated, service_role;

select pg_temp.as_postgres();

create temporary table trial_ends as
select expires_at as at from public.subscriptions
where user_id = '2c000000-0000-0000-0000-0000000000a1' and rate_type = 'free_trial';
grant select on trial_ends to authenticated, service_role;

select pg_temp.impersonate(null, 'service_role');

select lives_ok(
  $$ select public.record_subscription_payment((select c ->> 'reference' from checkout), 3000000) $$,
  'a practitioner on their free month can pay'
);

select pg_temp.as_postgres();

select results_eq(
  $$ select rate_type::text, status::text,
            expires_at = (select at from trial_ends) + interval '1 month'
     from public.subscriptions
     where user_id = '2c000000-0000-0000-0000-0000000000a1' and status = 'active' $$,
  $$ values ('standard'::text, 'active'::text, true) $$,
  'the paid month starts when the free one would have ended'
);

select is(
  (select status::text from public.subscriptions
   where user_id = '2c000000-0000-0000-0000-0000000000a1' and rate_type = 'free_trial'),
  'cancelled',
  'and the free month is closed, still counting as their one'
);

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000c1');

select results_eq(
  $$ select (d ->> 'subscribers')::int, (d ->> 'on_trial')::int, (d ->> 'revenue_total')::bigint
     from (select public.dashboard_summary('1c000000-0000-0000-0000-0000000000aa') as d) x $$,
  $$ values (1, 0, 6000000::bigint) $$,
  'once paid they count as a subscriber, and revenue counts only what was paid'
);

select pg_temp.impersonate('2c000000-0000-0000-0000-0000000000a1');

select results_eq(
  $$ select (s ->> 'free_trial')::boolean from (select public.assistant_subscription() as s) x $$,
  $$ values (false) $$,
  'the assistant no longer calls it a free month'
);

select * from finish();

rollback;

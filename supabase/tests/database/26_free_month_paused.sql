-- The free month is paused until the client activates it (20261128100000):
-- off by default, approval grants nothing while off, and turning the switch on
-- restores the behaviour 23_free_trial.sql pins.

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('1a100000-0000-0000-0000-0000000000aa', 'Paused Branch', 'PSB', 'Anambra', 'PS', 'PS Account', 'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2a100000-0000-0000-0000-0000000000a1', 'paused.one@example.com',
   '{"full_name": "Paused One", "scn": "PSB0001", "branch_code": "PSB"}'::jsonb),
  ('2a100000-0000-0000-0000-0000000000a2', 'paused.two@example.com',
   '{"full_name": "Paused Two", "scn": "PSB0002", "branch_code": "PSB"}'::jsonb);

select is(
  (select enabled from public.feature_flags where name = 'free_trial'),
  false,
  'the free month starts paused'
);

update public.profiles set membership_status = 'approved'
where id = '2a100000-0000-0000-0000-0000000000a1';

select is(
  (select count(*)::int from public.subscriptions where user_id = '2a100000-0000-0000-0000-0000000000a1'),
  0,
  'while paused, approval grants no free month'
);

select is(
  (select count(*)::int from public.notifications
   where user_id = '2a100000-0000-0000-0000-0000000000a1' and kind = 'free_trial_started'),
  0,
  'and sends no free-month notification'
);

update public.feature_flags set enabled = true, updated_at = now() where name = 'free_trial';

update public.profiles set membership_status = 'approved'
where id = '2a100000-0000-0000-0000-0000000000a2';

select is(
  (select rate_type::text from public.subscriptions where user_id = '2a100000-0000-0000-0000-0000000000a2'),
  'free_trial',
  'turned on, the next approval grants it'
);

select is(
  (select count(*)::int from public.subscriptions where user_id = '2a100000-0000-0000-0000-0000000000a1'),
  0,
  'while somebody approved during the pause is not given one retrospectively'
);

select * from finish();

rollback;

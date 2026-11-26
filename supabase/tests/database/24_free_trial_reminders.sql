-- Reminders before the free month ends: five days out and on the last day,
-- each once, never to somebody who has paid, and run by a daily job.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- ---------------------------------------------------------------------------
-- Fixtures: four practitioners approved now, so each holds a free month
--
--   r1  free month ends in 4 days
--   r2  free month ends in 12 hours
--   r3  free month ends in 20 days
--   r4  free month ends in 4 days, but has paid
-- ---------------------------------------------------------------------------

insert into public.branches
  (id, name, branch_code, state, short_code, account_name, activation_status, activated_at) values
  ('1d000000-0000-0000-0000-0000000000aa', 'Remind Branch', 'RMD', 'Anambra', 'R1', 'R Account', 'active', now());

insert into auth.users (id, email, raw_user_meta_data) values
  ('2d000000-0000-0000-0000-0000000000a1', 'remind.one@example.com',
   '{"full_name": "Remind One", "scn": "RMD0001", "branch_code": "RMD"}'::jsonb),
  ('2d000000-0000-0000-0000-0000000000a2', 'remind.two@example.com',
   '{"full_name": "Remind Two", "scn": "RMD0002", "branch_code": "RMD"}'::jsonb),
  ('2d000000-0000-0000-0000-0000000000a3', 'remind.three@example.com',
   '{"full_name": "Remind Three", "scn": "RMD0003", "branch_code": "RMD"}'::jsonb),
  ('2d000000-0000-0000-0000-0000000000a4', 'remind.four@example.com',
   '{"full_name": "Remind Four", "scn": "RMD0004", "branch_code": "RMD"}'::jsonb);

update public.profiles set membership_status = 'approved' where id::text like '2d000000-%';

-- Move each free month to where the test needs it to end.
update public.subscriptions s set starts_at = v.ends - interval '1 month', expires_at = v.ends
from (values
  ('2d000000-0000-0000-0000-0000000000a1'::uuid, now() + interval '4 days'),
  ('2d000000-0000-0000-0000-0000000000a2'::uuid, now() + interval '12 hours'),
  ('2d000000-0000-0000-0000-0000000000a3'::uuid, now() + interval '20 days'),
  ('2d000000-0000-0000-0000-0000000000a4'::uuid, now() + interval '4 days')
) as v(user_id, ends)
where s.user_id = v.user_id and s.rate_type = 'free_trial';

-- r4 pays: as record_subscription_payment does, the free month is closed.
update public.subscriptions set status = 'cancelled'
where user_id = '2d000000-0000-0000-0000-0000000000a4' and rate_type = 'free_trial';
insert into public.subscriptions
  (user_id, plan, rate_type, amount, starts_at, expires_at, status, paystack_reference) values
  ('2d000000-0000-0000-0000-0000000000a4', 'monthly', 'standard', 3000000,
   now(), now() + interval '4 days' + interval '1 month', 'active', 'NBA-remind-paid');

create function pg_temp.kinds(uid uuid)
returns text[]
language sql
as $$
  select coalesce(array_agg(kind order by kind), '{}')
  from public.notifications
  where user_id = uid and kind in ('free_trial_ending', 'free_trial_last_day');
$$;

-- ---------------------------------------------------------------------------
-- The first run
-- ---------------------------------------------------------------------------

select is(public.remind_free_trials_ending(), 2, 'the first run sends two reminders');

select is(pg_temp.kinds('2d000000-0000-0000-0000-0000000000a1'), array['free_trial_ending'],
  'five days out, the practitioner is told it ends soon');

select is(pg_temp.kinds('2d000000-0000-0000-0000-0000000000a2'), array['free_trial_last_day'],
  'on the last day, only the last-day reminder, not both at once');

select is(pg_temp.kinds('2d000000-0000-0000-0000-0000000000a3'), '{}'::text[],
  'a free month with weeks left is not mentioned');

select is(pg_temp.kinds('2d000000-0000-0000-0000-0000000000a4'), '{}'::text[],
  'somebody who has paid is not reminded');

select is(
  (select link from public.notifications
   where user_id = '2d000000-0000-0000-0000-0000000000a1' and kind = 'free_trial_ending'),
  '/profile/plans',
  'the reminder points at the plans'
);

-- ---------------------------------------------------------------------------
-- Later runs
-- ---------------------------------------------------------------------------

select is(public.remind_free_trials_ending(), 0, 'running again the same day sends nothing twice');

-- r1 reaches their last day.
update public.subscriptions set expires_at = now() + interval '6 hours'
where user_id = '2d000000-0000-0000-0000-0000000000a1' and rate_type = 'free_trial';

select is(public.remind_free_trials_ending(), 1, 'a day later, the last-day reminder follows');

select is(pg_temp.kinds('2d000000-0000-0000-0000-0000000000a1'),
  array['free_trial_ending', 'free_trial_last_day'],
  'so the practitioner has had both, once each');

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select schedule, command, active from cron.job where jobname = 'free-trial-reminders' $$,
  $$ values ('0 8 * * *'::text, 'select public.remind_free_trials_ending()'::text, true) $$,
  'the reminders run daily at 09:00 Lagos time'
);

select * from finish();

rollback;

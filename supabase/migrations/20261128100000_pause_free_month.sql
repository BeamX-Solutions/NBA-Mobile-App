-- Pause the first month free until the client says to activate it.
--
-- 20261126100100 granted a free month on every approval from 27 November
-- 2026. On 28 November the client asked to hold it. Nobody had been granted
-- one by then (checked on the hosted database), so there is nothing to undo.
--
-- feature_flags holds switches the client turns on and off without a release.
-- grant_free_trial now does nothing unless 'free_trial' is enabled. To
-- activate the free month, run in the SQL editor:
--
--   update public.feature_flags set enabled = true, updated_at = now()
--   where name = 'free_trial';
--
-- and to pause it again, the same with false.
--
-- Who counts as new on activation: free_trial_excluded still holds everyone
-- approved by 27 November, and the trigger fires only on approval, so
-- practitioners approved while the switch is off get nothing either. The free
-- month goes to those approved after it is turned on. The reminder job is left
-- scheduled: with no free months it sends nothing, and on activation it
-- reminds without further work.

create table public.feature_flags (
  name text primary key,
  enabled boolean not null default false,
  description text not null,
  updated_at timestamptz not null default now()
);

comment on table public.feature_flags is
  'Switches the client turns on and off from the SQL editor, without a release. Read by database functions only.';

alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from public, anon, authenticated;

insert into public.feature_flags (name, enabled, description) values
  ('free_trial', false,
   'First month free for practitioners approved while this is on (20261126100100). Paused 2026-11-28 at the client''s request.');

create or replace function public.feature_enabled(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from public.feature_flags where name = p_name), false);
$$;

revoke execute on function public.feature_enabled(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- grant_free_trial, reproduced from 20261126100100 with the switch added
-- ---------------------------------------------------------------------------

create or replace function public.grant_free_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz := now() + interval '1 month';
begin
  -- CHANGED. Paused unless the client has turned the free month on.
  if not public.feature_enabled('free_trial') then
    return null;
  end if;

  if new.role not in ('branch_member', 'branch_admin') then
    return null;
  end if;

  if exists (select 1 from public.free_trial_excluded where user_id = new.id)
     or exists (select 1 from public.subscriptions where user_id = new.id) then
    return null;
  end if;

  insert into public.subscriptions
    (user_id, plan, rate_type, amount, starts_at, expires_at, status)
  values
    (new.id, 'monthly', 'free_trial', 0, now(), v_expires, 'active');

  perform public.notify(
    new.id,
    'free_trial_started',
    'Your first month is free',
    'You can generate invoices free until '
      || to_char(v_expires at time zone 'Africa/Lagos', 'FMDD FMMonth YYYY')
      || '. Subscribe any time before then and you keep the free days left.',
    '/profile/plans'
  );

  return null;
end;
$$;

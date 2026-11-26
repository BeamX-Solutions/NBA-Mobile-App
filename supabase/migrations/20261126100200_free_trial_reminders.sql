-- Remind a practitioner before their free month ends.
--
-- No card is taken for the free month (20261126100100), so it ends without a
-- payment unless the practitioner acts. Two in-app reminders, five days and one
-- day before the end, written by a daily job. The same job is where an email
-- reminder will go once email is set up.
--
-- Each reminder is sent once: the kind names the stage, and a practitioner has
-- one free month in their life, so "has this kind been sent to them" is the
-- whole record. A practitioner who has paid has no active free month (paying
-- closes it), so they are not reminded.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'membership_approved',
  'membership_rejected',
  'payment_rejected',
  'certificate_issued',
  'share_paid',
  'certificate_revoked',
  'certificate_restored',
  'free_trial_started',
  'free_trial_ending',
  'free_trial_last_day'
));

-- ---------------------------------------------------------------------------
-- remind_free_trials_ending: run daily
-- ---------------------------------------------------------------------------
--
-- Five days out is "ending"; the last day is the final 24 hours. A run that
-- finds a free month already inside its last day sends only the last-day
-- reminder, so a missed run never sends both at once. Returns how many it sent.

create function public.remind_free_trials_ending()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sent integer := 0;
  v_row record;
begin
  for v_row in
    select s.user_id, s.expires_at,
           s.expires_at <= now() + interval '1 day' as last_day
    from public.subscriptions s
    where s.rate_type = 'free_trial'
      and s.status = 'active'
      and s.expires_at > now()
      and s.expires_at <= now() + interval '5 days'
  loop
    if v_row.last_day then
      if not exists (select 1 from public.notifications
                     where user_id = v_row.user_id and kind = 'free_trial_last_day') then
        perform public.notify(
          v_row.user_id,
          'free_trial_last_day',
          'Your free month ends tomorrow',
          'Your free month ends on '
            || to_char(v_row.expires_at at time zone 'Africa/Lagos', 'FMDD FMMonth YYYY')
            || '. Subscribe now to keep generating invoices without a break.',
          '/profile/plans'
        );
        v_sent := v_sent + 1;
      end if;
    elsif not exists (select 1 from public.notifications
                      where user_id = v_row.user_id and kind = 'free_trial_ending') then
      perform public.notify(
        v_row.user_id,
        'free_trial_ending',
        'Your free month ends soon',
        'Your free month ends on '
          || to_char(v_row.expires_at at time zone 'Africa/Lagos', 'FMDD FMMonth YYYY')
          || '. Subscribe before then and you keep the free days left.',
        '/profile/plans'
      );
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.remind_free_trials_ending() from public, anon, authenticated;
grant execute on function public.remind_free_trials_ending() to service_role;

-- ---------------------------------------------------------------------------
-- The schedule: every day at 09:00 Lagos time (08:00 UTC)
-- ---------------------------------------------------------------------------

-- cron.schedule replaces a job of the same name, so this is safe to rerun.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'free-trial-reminders',
  '0 8 * * *',
  'select public.remind_free_trials_ending()'
);

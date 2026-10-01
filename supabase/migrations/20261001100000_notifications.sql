-- Practitioners are told when something happens to their account or work.
--
-- Until now nothing told them: a member found out they had been approved by
-- trying again, and a rejected proof of payment sat unnoticed until they
-- opened the transaction. This adds an in-app inbox, filled by the database
-- itself, so every client that changes these rows (the admin console, the
-- mobile app, SQL run by hand) produces the same notification.
--
-- Decided with the user on 1 October 2026:
--
--   * In-app first. Email follows once the project has a sending domain; it
--     will be driven from these rows.
--   * One event, one notification. issue_rbin() verifies the payment and
--     issues the certificate together, so it raises a single
--     "payment verified, certificate issued".
--   * Nobody writes a notification from a client. Rows come only from the
--     triggers below, so a practitioner cannot forge "certificate issued".
--     The owner may only mark them read, through mark_notifications_read().

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'membership_approved',
    'membership_rejected',
    'payment_rejected',
    'certificate_issued',
    'share_paid',
    'certificate_revoked',
    'certificate_restored'
  )),
  title text not null,
  body text not null,
  -- An app path such as /transactions/<id>, shared by the web and mobile apps.
  link text check (link is null or link like '/%'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

comment on table public.notifications is
  'In-app notifications. Written only by triggers; the owner reads them and marks them read.';

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- Access: the owner reads; nobody writes from a client
-- ---------------------------------------------------------------------------

alter table public.notifications enable row level security;

create policy "Owners read their notifications"
  on public.notifications for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;
grant all on table public.notifications to service_role;

-- ---------------------------------------------------------------------------
-- mark_notifications_read
-- ---------------------------------------------------------------------------
--
-- Marks the caller's own notifications read: the ones named, or all of them
-- when none are named. Returns how many changed.

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer;
begin
  if v_actor is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = now()
  where user_id = v_actor
    and read_at is null
    and (p_ids is null or id = any (p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- notify: the one writer, reachable only from the triggers
-- ---------------------------------------------------------------------------

create or replace function public.notify(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  values (p_user_id, p_kind, p_title, p_body, p_link);
$$;

revoke execute on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;

-- Naira from kobo, as the apps print it: ₦2,450,000.00
create or replace function public.format_naira(p_kobo bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select '₦' || to_char(coalesce(p_kobo, 0) / 100.0, 'FM999,999,999,999,990.00');
$$;

-- ---------------------------------------------------------------------------
-- Membership decided
-- ---------------------------------------------------------------------------

create or replace function public.notify_membership_decided()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_needs_bank boolean;
begin
  if new.membership_status = 'approved' then
    v_needs_bank := nullif(trim(new.bank_account_name), '') is null
                 or nullif(trim(new.bank_account_number), '') is null
                 or nullif(trim(new.bank_name), '') is null;
    perform public.notify(
      new.id,
      'membership_approved',
      'Membership approved',
      case when v_needs_bank
        then 'Your branch has approved your account. Add your bank details so you can generate invoices.'
        else 'Your branch has approved your account. You can now generate invoices.'
      end,
      case when v_needs_bank then '/profile/edit' else '/' end
    );
  elsif new.membership_status = 'rejected' then
    perform public.notify(
      new.id,
      'membership_rejected',
      'Membership not approved',
      coalesce(nullif(trim(new.membership_rejection_reason), ''), 'Your branch did not approve your account.')
        || ' Correct your details and resubmit.',
      '/membership'
    );
  end if;
  return null;
end;
$$;

create trigger notify_membership_decided
  after update of membership_status on public.profiles
  for each row
  when (old.membership_status is distinct from new.membership_status)
  execute function public.notify_membership_decided();

-- ---------------------------------------------------------------------------
-- Proof rejected, share paid
-- ---------------------------------------------------------------------------

create or replace function public.notify_transaction_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice text := coalesce(new.invoice_number, 'Your invoice');
begin
  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    perform public.notify(
      new.user_id,
      'payment_rejected',
      'Payment proof rejected',
      v_invoice || ': ' || coalesce(nullif(trim(new.rejection_reason), ''), 'No reason was given.')
        || ' Upload a new proof to resubmit.',
      '/transactions/' || new.id
    );
  end if;

  if new.remitted_at is not null and old.remitted_at is null then
    perform public.notify(
      new.user_id,
      'share_paid',
      'Your share has been paid',
      'Your branch has sent ' || public.format_naira(new.due_to_practitioner) || ' for ' || v_invoice
        || coalesce(' (reference ' || nullif(trim(new.remittance_reference), '') || ')', '') || '.',
      '/transactions/' || new.id
    );
  end if;
  return null;
end;
$$;

create trigger notify_transaction_changed
  after update of status, remitted_at on public.transactions
  for each row
  when (old.status is distinct from new.status or old.remitted_at is distinct from new.remitted_at)
  execute function public.notify_transaction_changed();

-- ---------------------------------------------------------------------------
-- Certificate issued, revoked, restored
-- ---------------------------------------------------------------------------

create or replace function public.notify_certificate_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn record;
begin
  select user_id, invoice_number, rbin into v_txn
  from public.transactions
  where id = new.transaction_id;
  if not found then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform public.notify(
      v_txn.user_id,
      'certificate_issued',
      'Payment verified, certificate issued',
      coalesce(v_txn.invoice_number, 'Your invoice') || ' is verified. RBIN '
        || coalesce(v_txn.rbin, new.certificate_number) || '. Your Certificate of Compliance is ready.',
      '/certificates/' || new.id
    );
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform public.notify(
      v_txn.user_id,
      'certificate_revoked',
      'Certificate revoked',
      'Certificate ' || new.certificate_number || ' was revoked: '
        || coalesce(nullif(trim(new.revocation_reason), ''), 'no reason was given') || '.',
      '/certificates/' || new.id
    );
  elsif new.revoked_at is null and old.revoked_at is not null then
    perform public.notify(
      v_txn.user_id,
      'certificate_restored',
      'Certificate restored',
      'Certificate ' || new.certificate_number || ' is valid again.',
      '/certificates/' || new.id
    );
  end if;
  return null;
end;
$$;

create trigger notify_certificate_issued
  after insert on public.certificates
  for each row
  execute function public.notify_certificate_changed();

create trigger notify_certificate_revocation
  after update of revoked_at on public.certificates
  for each row
  when (old.revoked_at is distinct from new.revoked_at)
  execute function public.notify_certificate_changed();

revoke execute on function public.notify_membership_decided() from public, anon, authenticated;
revoke execute on function public.notify_transaction_changed() from public, anon, authenticated;
revoke execute on function public.notify_certificate_changed() from public, anon, authenticated;

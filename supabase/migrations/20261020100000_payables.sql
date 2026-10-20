-- Payables: the branch pays a practitioner in one transfer, and proves it.
--
-- Until now the branch recorded a transfer one invoice at a time, through
-- record_remittance, with an optional reference and nothing else. The client
-- asked for three things on 20 October 2026:
--
--   * A Payables list of the practitioners the branch owes, with the account,
--     bank and SCN needed to pay them.
--   * The administrator uploads the bank's transfer receipt after paying, and
--     the practitioner can see it and check it against their own statement.
--   * "Held for practitioners" goes down once the payment is confirmed.
--
-- Decided with the user on 20 October 2026:
--
--   * Uploading the receipt IS the confirmation. There is no second step in
--     which the practitioner acknowledges it, so nothing can sit waiting on a
--     practitioner who never opens the app. The practitioner sees the payout
--     as Confirmed, with the receipt.
--   * One row per practitioner. A branch pays a practitioner everything it
--     owes them in one transfer, so one payout settles several invoices and
--     carries one receipt.
--
-- record_remittance is dropped. It recorded a transfer with no receipt, and a
-- path that skips the receipt would make the receipt optional again. The rows
-- it already recorded keep their remitted_* columns and simply have no payout.
--
-- The Overview also gains a branch filter for the super administrator, so
-- dashboard_summary() takes an optional branch.

-- ---------------------------------------------------------------------------
-- payouts
-- ---------------------------------------------------------------------------

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  user_id uuid not null references public.profiles (id),
  amount bigint not null check (amount > 0),
  -- The account the money went to, as it stood when the branch recorded it,
  -- the same snapshot remitted_to carries on each transaction.
  paid_to text not null,
  reference text,
  -- An object in the payout-receipts bucket, {branch_id}/{user_id}/{file}.
  receipt_path text not null unique,
  recorded_by uuid not null references public.profiles (id),
  recorded_at timestamptz not null default now()
);

comment on table public.payouts is
  'One transfer from a branch to a practitioner, settling one or more verified invoices. Written only by record_payout().';
comment on column public.payouts.amount is
  'Kobo. The sum of due_to_practitioner across the invoices it settles.';

create index payouts_user_recorded_idx on public.payouts (user_id, recorded_at desc);
create index payouts_branch_recorded_idx on public.payouts (branch_id, recorded_at desc);

alter table public.transactions
  add column payout_id uuid references public.payouts (id);

comment on column public.transactions.payout_id is
  'The payout that settled this invoice. Null until paid, and for invoices paid before payouts existed.';

create index transactions_payout_idx on public.transactions (payout_id)
  where payout_id is not null;

-- Read only, from a client. Rows come from record_payout(), and there is no
-- update or delete: a record of money sent that can be quietly withdrawn is
-- not a record.
alter table public.payouts enable row level security;

create policy "practitioners read own payouts" on public.payouts
  for select to authenticated
  using (user_id = auth.uid());

create policy "branch admin reads branch payouts" on public.payouts
  for select to authenticated
  using (
    public.current_user_role() = 'branch_admin'
    and branch_id = public.current_user_branch()
  );

create policy "super admin reads all payouts" on public.payouts
  for select to authenticated
  using (public.current_user_role() = 'super_admin');

create trigger write_audit after insert or update or delete on public.payouts
  for each row execute function public.write_audit();

-- payout_id is server managed, like the remitted_* columns beside it.
-- enforce_transaction_update predates it and does not list it, and its
-- verifier path would otherwise let a branch administrator set it while
-- approving a payment. A separate guard rather than a fourth copy of that
-- function.
create or replace function public.guard_transaction_payout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_service_actor()
     or coalesce(current_setting('app.recording_remittance', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.payout_id := null;
  elsif new.payout_id is distinct from old.payout_id then
    raise exception 'this field is managed by the server' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_transaction_payout
  before insert or update on public.transactions
  for each row execute function public.guard_transaction_payout();

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------
--
-- Private, like proofs: a transfer receipt carries account numbers. Files are
-- addressed as {branch_id}/{user_id}/{name}, so the branch's own folder is the
-- upload check, and the practitioner is admitted per file, by the payout that
-- names it, never by folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payout-receipts',
  'payout-receipts',
  false,
  10485760, -- 10MB, matching proofs and the console's check
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

create policy "branch admin uploads payout receipt" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payout-receipts'
    and public.current_user_role() = 'branch_admin'
    and (storage.foldername(name))[1] = public.current_user_branch()::text
  );

create policy "branch admin reads branch payout receipts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payout-receipts'
    and public.current_user_role() = 'branch_admin'
    and (storage.foldername(name))[1] = public.current_user_branch()::text
  );

create policy "super admin reads payout receipts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payout-receipts'
    and public.current_user_role() = 'super_admin'
  );

create policy "practitioner reads own payout receipt" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payout-receipts'
    and exists (
      select 1 from public.payouts p
      where p.receipt_path = storage.objects.name
        and p.user_id = auth.uid()
    )
  );

-- The console uploads the receipt before calling record_payout, so a refused
-- payout leaves a file behind. The branch may remove its own files that no
-- payout names, and nothing else: once a receipt is attached it is evidence.
create policy "branch admin removes unattached payout receipt" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'payout-receipts'
    and public.current_user_role() = 'branch_admin'
    and (storage.foldername(name))[1] = public.current_user_branch()::text
    and not exists (
      select 1 from public.payouts p where p.receipt_path = storage.objects.name
    )
  );

-- ---------------------------------------------------------------------------
-- record_payout
-- ---------------------------------------------------------------------------
--
-- The branch records that it has paid a practitioner, attaching the receipt.
-- It does not move money: the transfer happens at the bank, and this records
-- it.
--
-- The caller names the invoices the transfer covers rather than "everything
-- owed", because the administrator transfers the total they were shown. If
-- another payment is verified between reading the list and recording the
-- transfer, "everything owed" would mark that invoice paid with money that
-- was never sent.
--
-- Branch administrators only. The super administrator oversees but holds no
-- branch's money, the same separation issue_rbin keeps for verification.

create or replace function public.record_payout(
  p_practitioner_id uuid,
  p_transaction_ids uuid[],
  p_receipt_path text,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_branch uuid := public.current_user_branch();
  v_ids uuid[];
  v_found integer;
  v_total bigint;
  v_invoice text;
  v_payee public.profiles%rowtype;
  v_receipt text := nullif(trim(p_receipt_path), '');
  v_reference text := nullif(trim(p_reference), '');
  v_paid_to text;
  v_payout uuid;
begin
  if v_actor is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  if public.current_user_role() is distinct from 'branch_admin' or v_branch is null then
    raise exception 'Only the practitioner''s branch can record paying them'
      using errcode = '42501';
  end if;

  select array_agg(distinct id) into v_ids
  from unnest(p_transaction_ids) as id
  where id is not null;

  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'Choose the invoices this transfer covers' using errcode = 'P0001';
  end if;

  perform 1 from public.transactions where id = any (v_ids) for update;

  select count(*), coalesce(sum(due_to_practitioner), 0), min(invoice_number)
  into v_found, v_total, v_invoice
  from public.transactions
  where id = any (v_ids)
    and user_id = p_practitioner_id
    and branch_id = v_branch;

  if v_found <> cardinality(v_ids) then
    raise exception 'Every invoice must be this practitioner''s, at your branch'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.transactions where id = any (v_ids) and status <> 'verified') then
    raise exception 'Verify the client''s payment before paying the practitioner'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.transactions where id = any (v_ids) and remitted_at is not null) then
    raise exception 'Some of these invoices have already been paid. Reload the list.'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.transactions where id = any (v_ids) and due_to_practitioner <= 0) then
    raise exception 'Nothing is due to the practitioner on one of these invoices'
      using errcode = 'P0001';
  end if;

  select * into v_payee from public.profiles where id = p_practitioner_id;
  if v_payee.bank_account_number is null then
    raise exception 'The practitioner has not given their bank details'
      using errcode = 'P0001';
  end if;

  if v_receipt is null then
    raise exception 'Upload the transfer receipt' using errcode = 'P0001';
  end if;
  if (storage.foldername(v_receipt))[1] is distinct from v_branch::text
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'payout-receipts' and o.name = v_receipt
     ) then
    raise exception 'The receipt could not be found. Upload it again.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payouts where receipt_path = v_receipt) then
    raise exception 'This receipt is already attached to another payment'
      using errcode = 'P0001';
  end if;

  v_paid_to := concat_ws(', ', v_payee.bank_account_name,
                         v_payee.bank_account_number, v_payee.bank_name);

  insert into public.payouts (branch_id, user_id, amount, paid_to, reference, receipt_path, recorded_by)
  values (v_branch, p_practitioner_id, v_total, v_paid_to, v_reference, v_receipt, v_actor)
  returning id into v_payout;

  perform set_config('app.recording_remittance', 'on', true);

  update public.transactions
  set remitted_at = now(),
      remitted_by = v_actor,
      remittance_reference = v_reference,
      remitted_to = v_paid_to,
      payout_id = v_payout
  where id = any (v_ids);

  perform set_config('app.recording_remittance', 'off', true);

  -- One payout, one notification, however many invoices it settles.
  perform public.notify(
    p_practitioner_id,
    'share_paid',
    'Your branch has paid you',
    'Your branch has sent ' || public.format_naira(v_total)
      || case when cardinality(v_ids) = 1
           then ' for ' || coalesce(v_invoice, 'your invoice')
           else ' for ' || cardinality(v_ids) || ' invoices'
         end
      || coalesce(' (reference ' || v_reference || ')', '')
      || '. The transfer receipt is under Payments.',
    '/payments'
  );

  return v_payout;
end;
$$;

revoke execute on function public.record_payout(uuid, uuid[], text, text) from public, anon;
grant execute on function public.record_payout(uuid, uuid[], text, text) to authenticated;

drop function public.record_remittance(uuid, text);

-- notify_transaction_changed, reproduced from 20261001100000 without the
-- share_paid branch. record_payout raises that notification once per payout;
-- left here it would raise one per invoice as well.
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
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- dashboard_summary, filtered by branch
-- ---------------------------------------------------------------------------
--
-- Reproduced from 20261019130000 with one optional argument. Null means every
-- branch the caller can see, which is what it did before. A branch means that
-- branch only, in every figure, including the per-branch rows.
--
-- It is still security invoker, so the argument narrows and never widens: a
-- branch administrator who names another branch gets zeros, because RLS
-- shows them none of its rows.
--
-- The old signature is dropped rather than overloaded. Two candidates for a
-- call with no arguments is an ambiguity PostgREST refuses.

drop function public.dashboard_summary();

create function public.dashboard_summary(p_branch_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  month_start as (
    select date_trunc('month', now() at time zone 'Africa/Lagos') as at
  ),
  practitioners as (
    -- Administrators practise too, since 20261017100000.
    select id, branch_id
    from public.profiles
    where role in ('branch_member', 'branch_admin')
      and membership_status = 'approved'
      and (p_branch_id is null or branch_id = p_branch_id)
  ),
  live_subscriptions as (
    select s.user_id, s.expires_at
    from public.subscriptions s
    where s.status = 'active' and s.expires_at > now()
  ),
  subscribers as (
    -- One per practitioner, however many overlapping subscriptions they hold,
    -- judged by the one that runs longest. Practitioners only, so "2 of 9"
    -- compares like with like: a subscription left behind by somebody who
    -- became a super administrator is not a subscriber.
    select ls.user_id, max(ls.expires_at) as expires_at
    from live_subscriptions ls
    where ls.user_id in (select id from practitioners)
    group by ls.user_id
  ),
  paid as (
    -- A subscription belongs to the branch its holder is in now.
    select s.amount, s.plan, s.created_at, s.user_id
    from public.subscriptions s
    where s.paystack_reference is not null
      and (
        p_branch_id is null
        or exists (
          select 1 from public.profiles p
          where p.id = s.user_id and p.branch_id = p_branch_id
        )
      )
  ),
  held as (
    select t.branch_id, t.due_to_practitioner
    from public.transactions t
    where t.status = 'verified' and t.remitted_at is null
      and (p_branch_id is null or t.branch_id = p_branch_id)
  ),
  visible_branches as (
    select b.id, b.name, b.branch_code, b.activation_status
    from public.branches b
    where (public.is_privileged_actor() or b.id = public.current_user_branch())
      and (p_branch_id is null or b.id = p_branch_id)
  )
  select jsonb_build_object(
    'practitioners', (select count(*) from practitioners),
    'subscribers', (select count(*) from subscribers),
    'expiring_30d', (select count(*) from subscribers where expires_at <= now() + interval '30 days'),
    'revenue_total', (select coalesce(sum(amount), 0) from paid),
    'revenue_month', (
      select coalesce(sum(amount), 0) from paid
      where (created_at at time zone 'Africa/Lagos') >= (select at from month_start)
    ),
    'revenue_by_plan', (
      select coalesce(jsonb_object_agg(plan, total), '{}'::jsonb)
      from (select plan::text as plan, sum(amount) as total from paid group by plan) p
    ),
    'held_for_practitioners', (select coalesce(sum(due_to_practitioner), 0) from held),
    'branches', (
      select coalesce(jsonb_agg(row_data order by row_data ->> 'name'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', b.id,
          'name', b.name,
          'branch_code', b.branch_code,
          -- The directory lists every branch in the country; the console
          -- shows the active ones and any with activity, and counts the rest.
          'active', b.activation_status = 'active',
          'practitioners', (select count(*) from practitioners p where p.branch_id = b.id),
          'subscribers', (
            select count(*) from subscribers s
            join public.profiles p on p.id = s.user_id
            where p.branch_id = b.id
          ),
          'revenue_total', (
            select coalesce(sum(pd.amount), 0) from paid pd
            join public.profiles p on p.id = pd.user_id
            where p.branch_id = b.id
          ),
          'pending', (
            select count(*) from public.transactions t
            where t.branch_id = b.id and t.status = 'pending_verification'
          ),
          'fees_verified', (
            select coalesce(sum(t.branch_fee), 0) from public.transactions t
            where t.branch_id = b.id and t.status = 'verified'
          ),
          'held_for_practitioners', (
            select coalesce(sum(h.due_to_practitioner), 0) from held h where h.branch_id = b.id
          )
        ) as row_data
        from visible_branches b
      ) rows
    )
  );
$$;

revoke execute on function public.dashboard_summary(uuid) from public, anon;
grant execute on function public.dashboard_summary(uuid) to authenticated;

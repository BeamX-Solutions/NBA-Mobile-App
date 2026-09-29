-- The client pays the branch, and the branch pays the practitioner.
--
-- Confirmed with the branch. The client pays the full professional fee (the
-- remuneration) into the branch's account. The branch keeps its fee, 2% of
-- the remuneration, and sends the balance to the practitioner.
--
-- Until now the app was built on the opposite flow: the practitioner paid the
-- branch its fee and nothing more. So amount_payable held the branch fee, the
-- practitioner's bank account was never asked for, and nothing recorded the
-- branch paying anyone.
--
-- After this migration:
--
--   amount_payable        what the client pays into the branch account: the
--                         professional fee.
--   branch_fee            what the branch keeps out of it.
--   due_to_practitioner   generated: what the branch sends on.
--   remitted_*            when the branch sent it, who recorded it, the
--                         transfer reference, and the account it went to.
--
-- The practitioner's bank account is held on their profile, and
-- create_transaction refuses to draw an invoice without it.
--
-- EXISTING TRANSACTIONS. Every transaction in the system when this was written
-- was test data: no real payment had been made against any of them. They are
-- all moved to the new flow, whatever their status, so a verified one becomes
-- a verified one awaiting remittance. Those with no calculation on record
-- cannot be moved, because nothing says what their professional fee was; they
-- keep their amount, with the branch fee equal to it and so nothing due on.

-- ---------------------------------------------------------------------------
-- The branch's share, in one place
-- ---------------------------------------------------------------------------
--
-- Mirrors BRANCH_SHARE_PERCENTAGE in mobile/lib/fees/scale-2023.ts and rounds
-- the same way: to the nearest kobo, halves up. If one changes, so must the
-- other, or create_transaction will refuse every invoice the app draws.

create or replace function public.branch_fee_for(p_professional_fee bigint)
returns bigint
language sql
immutable
as $$
  select round(p_professional_fee * 2 / 100.0)::bigint;
$$;

-- ---------------------------------------------------------------------------
-- Where the branch sends the practitioner's share
-- ---------------------------------------------------------------------------
--
-- Readable by the practitioner, their branch administrators and the super
-- admin under the existing profile policies, and editable by the practitioner
-- under "users update own profile": protect_profile_columns does not name
-- these columns, so it leaves them to the owner.

alter table public.profiles
  add column bank_account_name text,
  add column bank_account_number text,
  add column bank_name text;

alter table public.profiles
  add constraint profiles_bank_account_number_is_nuban
  check (bank_account_number is null or bank_account_number ~ '^[0-9]{10}$');

comment on column public.profiles.bank_account_number is
  'Ten digit NUBAN the branch sends the practitioner''s share of each fee to.';

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column branch_fee bigint check (branch_fee >= 0),
  add column remitted_at timestamptz,
  add column remitted_by uuid references public.profiles (id),
  add column remittance_reference text,
  add column remitted_to text;

-- Existing rows, as described at the top. branch_fee first, from the old
-- meaning of amount_payable, so that rows with no calculation have one too.
update public.transactions set branch_fee = amount_payable;

update public.transactions t
set amount_payable = c.professional_fee,
    branch_fee = c.branch_fee
from public.calculations c
where c.id = t.calculation_id;

alter table public.transactions alter column branch_fee set not null;

alter table public.transactions
  add constraint transactions_branch_fee_within_amount_payable
  check (branch_fee <= amount_payable);

alter table public.transactions
  add column due_to_practitioner bigint
  generated always as (amount_payable - branch_fee) stored;

-- A remittance is recorded whole or not at all.
alter table public.transactions
  add constraint transactions_remittance_is_complete
  check ((remitted_at is null) = (remitted_by is null)
     and (remitted_at is null) = (remitted_to is null));

comment on column public.transactions.amount_payable is
  'What the client pays into the branch account: the professional fee.';
comment on column public.transactions.branch_fee is
  'What the branch keeps out of amount_payable.';
comment on column public.transactions.due_to_practitioner is
  'What the branch sends the practitioner once the payment is verified.';
comment on column public.transactions.remitted_to is
  'The account the practitioner''s share was sent to, as it stood when the branch recorded it.';

create index transactions_awaiting_remittance_idx
  on public.transactions (branch_id, verified_at)
  where status = 'verified' and remitted_at is null;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
--
-- Both reproduced from 20260923100000. The insert guard now clears the
-- remittance and, on the direct path, sets the branch fee itself. The update
-- guard adds the new columns to those only the server may change, and lets
-- record_remittance through on a transaction-local marker, as issue_rbin is.

CREATE OR REPLACE FUNCTION public.enforce_transaction_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  new.remitted_at := null;
  new.remitted_by := null;
  new.remittance_reference := null;
  new.remitted_to := null;

  if coalesce(current_setting('app.issuing_receipt', true), '') = 'on' then
    new.status := 'awaiting_payment';
    new.rejection_reason := null;
    new.verified_by := null;
    new.verified_at := null;
    new.rbin := null;
    new.rbin_issued_at := null;
    return new;
  end if;

  -- A row written directly rather than through create_transaction does not
  -- get to name the branch's share of it.
  new.branch_fee := public.branch_fee_for(new.amount_payable);
  new.status := 'awaiting_payment';
  new.invoice_number := null;
  new.rejection_reason := null;
  new.verified_by := null;
  new.verified_at := null;
  new.rbin := null;
  new.rbin_issued_at := null;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_transaction_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  -- Set only by issue_rbin(), transaction-local, unreachable from a client.
  if coalesce(current_setting('app.issuing_rbin', true), '') = 'on' then
    return new;
  end if;

  -- Set only by record_remittance(), on the same terms.
  if coalesce(current_setting('app.recording_remittance', true), '') = 'on' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.branch_id is distinct from old.branch_id
     or new.calculation_id is distinct from old.calculation_id
     or new.amount_payable is distinct from old.amount_payable
     or new.branch_fee is distinct from old.branch_fee
     or new.remitted_at is distinct from old.remitted_at
     or new.remitted_by is distinct from old.remitted_by
     or new.remittance_reference is distinct from old.remittance_reference
     or new.remitted_to is distinct from old.remitted_to
     or new.invoice_number is distinct from old.invoice_number
     or new.rbin is distinct from old.rbin
     or new.rbin_issued_at is distinct from old.rbin_issued_at then
    raise exception 'this field is managed by the server' using errcode = '42501';
  end if;

  if v_actor = old.user_id then
    if old.status not in ('awaiting_payment', 'rejected') then
      raise exception 'transaction can no longer be edited' using errcode = '42501';
    end if;
    if new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at then
      raise exception 'this field is managed by the server' using errcode = '42501';
    end if;
    if new.status = old.status then
      return new;
    end if;
    if new.status = 'pending_verification' then
      if new.proof_url is null then
        raise exception 'proof of payment is required before submission' using errcode = '23514';
      end if;
      new.rejection_reason := null;
      return new;
    end if;
    raise exception 'invalid status transition' using errcode = '42501';
  end if;

  if v_role = 'branch_admin' and old.branch_id = public.current_user_branch() then
    if old.status <> 'pending_verification'
       or new.status not in ('verified', 'rejected') then
      raise exception 'invalid status transition' using errcode = '42501';
    end if;
    if new.parties is distinct from old.parties
       or new.document_type is distinct from old.document_type
       or new.consideration is distinct from old.consideration
       or new.proof_url is distinct from old.proof_url then
      raise exception 'verifiers cannot alter transaction details' using errcode = '42501';
    end if;
    if new.status = 'rejected' and nullif(trim(new.rejection_reason), '') is null then
      raise exception 'a reason is required when rejecting' using errcode = '23514';
    end if;
    new.verified_by := v_actor;
    new.verified_at := now();
    return new;
  end if;

  raise exception 'you may not modify this transaction' using errcode = '42501';
end;
$function$;

-- ---------------------------------------------------------------------------
-- record_remittance
-- ---------------------------------------------------------------------------
--
-- The branch records that it has sent the practitioner their share. It does
-- not move money: the transfer happens at the bank, and this records it.
-- There is no undo, because a record of money sent that can be quietly
-- withdrawn is not a record.

create or replace function public.record_remittance(
  p_transaction_id uuid,
  p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
  v_txn public.transactions%rowtype;
  v_payee public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  select * into v_txn from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Transaction not found' using errcode = 'P0002';
  end if;

  if not (v_role = 'super_admin'
          or (v_role = 'branch_admin' and v_txn.branch_id = public.current_user_branch())) then
    raise exception 'Only the branch can record that it has paid the practitioner'
      using errcode = '42501';
  end if;

  if v_txn.status <> 'verified' then
    raise exception 'Verify the client''s payment before recording the transfer to the practitioner'
      using errcode = 'P0001';
  end if;
  if v_txn.remitted_at is not null then
    raise exception 'The transfer to the practitioner has already been recorded'
      using errcode = 'P0001';
  end if;
  if v_txn.due_to_practitioner <= 0 then
    raise exception 'Nothing is due to the practitioner on this transaction'
      using errcode = 'P0001';
  end if;

  select * into v_payee from public.profiles where id = v_txn.user_id;
  if v_payee.bank_account_number is null then
    raise exception 'The practitioner has not given their bank details'
      using errcode = 'P0001';
  end if;

  perform set_config('app.recording_remittance', 'on', true);

  update public.transactions
  set remitted_at = now(),
      remitted_by = v_actor,
      remittance_reference = nullif(trim(p_reference), ''),
      remitted_to = concat_ws(', ', v_payee.bank_account_name,
                              v_payee.bank_account_number, v_payee.bank_name)
  where id = p_transaction_id;

  perform set_config('app.recording_remittance', 'off', true);
end;
$$;

revoke execute on function public.record_remittance(uuid, text) from public, anon;
grant execute on function public.record_remittance(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_transaction
-- ---------------------------------------------------------------------------
--
-- Reproduced from 20260928100000 with three changes: it refuses a
-- practitioner with no bank details, it refuses a branch fee that is not the
-- branch's share of the professional fee, and it records the professional fee
-- as the amount payable with the branch fee beside it. Signature and return
-- type unchanged, so the grant survives.

create or replace function public.create_transaction(
  p_document_type public.document_type,
  p_consideration bigint,
  p_professional_fee bigint,
  p_branch_fee bigint,
  p_parties text,
  p_breakdown jsonb default '{}'::jsonb
)
returns table (transaction_id uuid, invoice_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_branch public.branches%rowtype;
  v_scale_id uuid;
  v_calculation_id uuid;
  v_invoice text;
  v_txn_id uuid;
  v_parties text := nullif(trim(p_parties), '');
begin
  if v_actor is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_profile.role in ('branch_admin', 'super_admin') then
    raise exception 'Administrator accounts cannot submit transactions. Use a practitioner account.'
      using errcode = '42501';
  end if;

  if v_profile.branch_id is null then
    raise exception 'You are not affiliated with a branch. Request affiliation from Edit Profile before generating an invoice.'
      using errcode = 'P0001';
  end if;

  select * into v_branch from public.branches where id = v_profile.branch_id;
  if not found then
    raise exception 'Your branch could not be found' using errcode = 'P0002';
  end if;

  if not public.branch_is_active(v_profile.branch_id) then
    raise exception
      '% is not currently active, so invoices cannot be generated for it. Your branch must renew its activation with the Association. Calculations remain free.',
      v_branch.name
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.subscriptions
    where user_id = v_actor
      and status = 'active'
      and expires_at > now()
  ) then
    raise exception 'An active subscription is required to generate an invoice. Calculations remain free.'
      using errcode = 'P0001';
  end if;

  -- The client's money goes to the branch, and the branch sends the
  -- practitioner their share. With no account to send it to, the branch
  -- would be holding it with nowhere to put it.
  if nullif(trim(v_profile.bank_account_name), '') is null
     or v_profile.bank_account_number is null
     or nullif(trim(v_profile.bank_name), '') is null then
    raise exception 'Add your bank details in Edit Profile before generating an invoice. Your branch sends your fee to that account.'
      using errcode = 'P0001';
  end if;

  if v_parties is null then
    raise exception 'Name the parties to the document' using errcode = '23514';
  end if;
  if p_consideration < 0 or p_professional_fee < 0 or p_branch_fee < 0 then
    raise exception 'Amounts cannot be negative' using errcode = '23514';
  end if;
  -- Both figures come from the client. The branch keeps the branch fee out of
  -- money paid into its own account, so it is checked here rather than
  -- trusted.
  if p_branch_fee <> public.branch_fee_for(p_professional_fee) then
    raise exception 'The branch fee does not match the professional fee' using errcode = '23514';
  end if;

  select id into v_scale_id from public.fee_scales where is_active limit 1;

  if v_scale_id is not null then
    insert into public.calculations (
      user_id, fee_scale_id, document_type, consideration,
      professional_fee, branch_fee, breakdown
    )
    values (
      v_actor, v_scale_id, p_document_type, p_consideration,
      p_professional_fee, p_branch_fee,
      coalesce(p_breakdown, '{}'::jsonb)
    )
    returning id into v_calculation_id;
  end if;

  -- Drawn before the marker is raised: consuming a sequence value is the part
  -- that must not happen twice, and it is unrelated to the insert path.
  v_invoice := 'TXN-'
    || lpad(
         public.next_sequence_value(
           'receipt:' || v_branch.branch_code || ':' || extract(year from now())::text
         )::text, 5, '0')
    || '-' || public.document_type_code(p_document_type);

  perform set_config('app.issuing_receipt', 'on', true);

  insert into public.transactions (
    user_id, branch_id, calculation_id, parties, document_type,
    consideration, amount_payable, branch_fee, invoice_number, status
  )
  values (
    v_actor, v_profile.branch_id, v_calculation_id, v_parties, p_document_type,
    p_consideration, p_professional_fee, p_branch_fee, v_invoice, 'awaiting_payment'
  )
  returning id into v_txn_id;

  perform set_config('app.issuing_receipt', 'off', true);

  return query select v_txn_id, v_invoice;
end;
$$;

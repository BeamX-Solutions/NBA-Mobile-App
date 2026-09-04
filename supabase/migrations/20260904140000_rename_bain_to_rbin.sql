-- Rename BAIN to RBIN throughout.
--
-- The branch calls this reference an RBIN, its certificate is printed with
-- that label, and the format is now branch-scoped. Only the schema still said
-- BAIN, which left the column, the functions and the public verification page
-- disagreeing with the document a land registry actually holds.
--
-- Renaming a column is safe here in a way it usually is not: every consumer is
-- in this repository, and both clients are redeployed with this change.
--
-- The public verification page is the one thing that cannot be allowed to go
-- dark, because the URL is printed into certificates. verify_bain is therefore
-- kept for now as a thin wrapper over verify_rbin, so the currently deployed
-- console keeps answering during the minutes between this migration and its
-- redeploy. It is marked for removal once that deploy has landed.
--
-- The path shape /verify/{reference} does not change, so every QR code already
-- printed keeps resolving.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.transactions rename column bain to rbin;
alter table public.transactions rename column bain_issued_at to rbin_issued_at;

comment on column public.transactions.rbin is
  'Branch reference issued on verification, e.g. NBA/ANAOCHA/0001/2026. Server-assigned; no client may write it.';

-- ---------------------------------------------------------------------------
-- Triggers that guard the renamed columns
-- ---------------------------------------------------------------------------

create or replace function public.enforce_transaction_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  if coalesce(current_setting('app.issuing_receipt', true), '') = 'on' then
    new.status := 'awaiting_payment';
    new.rejection_reason := null;
    new.verified_by := null;
    new.verified_at := null;
    new.rbin := null;
    new.rbin_issued_at := null;
    return new;
  end if;

  new.status := 'awaiting_payment';
  new.receipt_number := null;
  new.rejection_reason := null;
  new.verified_by := null;
  new.verified_at := null;
  new.rbin := null;
  new.rbin_issued_at := null;
  return new;
end;
$$;

create or replace function public.enforce_transaction_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.branch_id is distinct from old.branch_id
     or new.calculation_id is distinct from old.calculation_id
     or new.amount_payable is distinct from old.amount_payable
     or new.receipt_number is distinct from old.receipt_number
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
$$;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

drop function if exists public.format_bain(text, bigint, int);

create or replace function public.format_rbin(
  p_branch_code text, p_sequence bigint, p_year int
)
returns text
language sql
immutable
as $$
  select 'NBA/' || p_branch_code || '/' || lpad(p_sequence::text, 4, '0') || '/' || p_year::text;
$$;

drop function if exists public.issue_bain(uuid);

create or replace function public.issue_rbin(p_transaction_id uuid)
returns table (rbin text, certificate_number text, certificate_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
  v_actor_branch uuid := public.current_user_branch();
  v_txn public.transactions%rowtype;
  v_branch public.branches%rowtype;
  v_year int := extract(year from now())::int;
  v_rbin text;
  v_cert_number text;
  v_cert_id uuid;
begin
  select * into v_txn from public.transactions where id = p_transaction_id for update;

  if not found then
    raise exception 'Transaction not found' using errcode = 'P0002';
  end if;

  if not public.is_service_actor() then
    if v_role not in ('branch_admin', 'super_admin') then
      raise exception 'Only a branch administrator may issue an RBIN' using errcode = '42501';
    end if;

    if v_role = 'branch_admin' and v_txn.branch_id is distinct from v_actor_branch then
      raise exception 'This transaction belongs to another branch' using errcode = '42501';
    end if;

    if v_txn.user_id = v_actor then
      raise exception 'You cannot approve your own submission. Another administrator must review it.'
        using errcode = '42501';
    end if;
  end if;

  if v_txn.status <> 'pending_verification' then
    raise exception 'Only a transaction awaiting verification can be approved (current status: %)',
      v_txn.status using errcode = '22023';
  end if;

  if v_txn.rbin is not null then
    raise exception 'This transaction already has RBIN %', v_txn.rbin using errcode = '23505';
  end if;

  select * into v_branch from public.branches where id = v_txn.branch_id;
  if not found then
    raise exception 'The issuing branch could not be found' using errcode = 'P0002';
  end if;

  v_rbin := public.format_rbin(
    v_branch.branch_code,
    public.next_sequence_value('rbin:' || v_branch.branch_code || ':' || v_year::text),
    v_year
  );
  v_cert_number := public.format_certificate_number(
    v_branch.short_code,
    v_year,
    public.next_sequence_value('certificate:' || v_branch.branch_code || ':' || v_year::text)
  );

  perform set_config('app.issuing_rbin', 'on', true);

  update public.transactions
  set status = 'verified',
      verified_by = v_actor,
      verified_at = now(),
      rejection_reason = null,
      rbin = v_rbin,
      rbin_issued_at = now()
  where id = p_transaction_id;

  perform set_config('app.issuing_rbin', 'off', true);

  insert into public.certificates (transaction_id, certificate_number)
  values (p_transaction_id, v_cert_number)
  returning id into v_cert_id;

  return query select v_rbin, v_cert_number, v_cert_id;
end;
$$;

revoke execute on function public.issue_rbin(uuid) from public, anon;
grant execute on function public.issue_rbin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public verification
-- ---------------------------------------------------------------------------

create or replace function public.verify_rbin(p_rbin text)
returns table (
  found boolean, rbin text, practitioner_name text, scn text, document_type text,
  branch_name text, issued_at timestamptz, certificate_number text,
  revoked boolean, revocation_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    true as found,
    t.rbin,
    p.full_name as practitioner_name,
    p.scn,
    t.document_type::text,
    b.name as branch_name,
    c.issued_at,
    c.certificate_number,
    c.revoked_at is not null as revoked,
    c.revocation_reason
  from public.transactions t
  join public.profiles p on p.id = t.user_id
  join public.branches b on b.id = t.branch_id
  join public.certificates c on c.transaction_id = t.id
  where t.rbin = upper(trim(p_rbin))
    and t.status = 'verified';
$$;

grant execute on function public.verify_rbin(text) to anon, authenticated;

-- DEPRECATED. Kept only so the deployed verification page keeps answering
-- between this migration and its redeploy. Drop once that has landed.
create or replace function public.verify_bain(p_bain text)
returns table (
  found boolean, bain text, practitioner_name text, scn text, document_type text,
  branch_name text, issued_at timestamptz, certificate_number text,
  revoked boolean, revocation_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select found, rbin as bain, practitioner_name, scn, document_type,
         branch_name, issued_at, certificate_number, revoked, revocation_reason
  from public.verify_rbin(p_bain);
$$;

grant execute on function public.verify_bain(text) to anon, authenticated;

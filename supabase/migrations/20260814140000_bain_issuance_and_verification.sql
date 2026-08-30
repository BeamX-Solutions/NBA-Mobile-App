-- BAIN issuance and public verification.
--
-- Both are database functions rather than application code, deliberately.
-- Issuing a BAIN has to be atomic with verifying the transaction and creating
-- the certificate: if any part fails, none of it may take effect, or a
-- transaction ends up verified with no certificate, or a sequence number is
-- consumed by a certificate that was never created. A single function in a
-- single transaction gives that for free.

-- ---------------------------------------------------------------------------
-- Number formats
--
-- BAIN is national, not branch scoped: NBA/{YEAR}/{5 digits}. That follows the
-- mockups, which show NBA/2024/09842 with the branch carried separately.
-- SPEC.md question 3 proposed a branch scoped format; the designs answer it.
--
-- Certificate numbers are a separate sequence: NBA-CC-{YEAR}-{4 digits},
-- again from the mockups, which show both on one certificate.
-- ---------------------------------------------------------------------------

create or replace function public.format_bain(p_year int, p_sequence bigint)
returns text
language sql
immutable
as $$
  select 'NBA/' || p_year::text || '/' || lpad(p_sequence::text, 5, '0');
$$;

create or replace function public.format_certificate_number(p_year int, p_sequence bigint)
returns text
language sql
immutable
as $$
  select 'NBA-CC-' || p_year::text || '-' || lpad(p_sequence::text, 4, '0');
$$;

-- ---------------------------------------------------------------------------
-- issue_bain: verify a transaction, issue its BAIN, create its certificate
--
-- security definer because it must draw from number_sequences, which no client
-- role can reach, and write to certificates, which has no client insert
-- policy. Authorisation is therefore checked explicitly in the body rather
-- than being inherited from RLS.
-- ---------------------------------------------------------------------------

create or replace function public.issue_bain(p_transaction_id uuid)
returns table (bain text, certificate_number text, certificate_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
  v_actor_branch uuid := public.current_user_branch();
  v_txn public.transactions%rowtype;
  v_year int := extract(year from now())::int;
  v_bain text;
  v_cert_number text;
  v_cert_id uuid;
begin
  -- Lock the row for the duration. Two administrators approving the same
  -- submission at the same moment would otherwise both pass the status check
  -- and both draw a sequence number.
  select * into v_txn from public.transactions where id = p_transaction_id for update;

  if not found then
    raise exception 'Transaction not found' using errcode = 'P0002';
  end if;

  -- Only an administrator of the branch the transaction belongs to. The
  -- service role is allowed through for server side automation.
  if not public.is_service_actor() then
    if v_role not in ('branch_admin', 'super_admin') then
      raise exception 'Only a branch administrator may issue a BAIN' using errcode = '42501';
    end if;
    if v_role = 'branch_admin' and v_txn.branch_id is distinct from v_actor_branch then
      raise exception 'This transaction belongs to another branch' using errcode = '42501';
    end if;
  end if;

  if v_txn.status <> 'pending_verification' then
    raise exception 'Only a transaction awaiting verification can be approved (current status: %)',
      v_txn.status using errcode = '22023';
  end if;

  -- Idempotence: a retry after a dropped connection must not mint a second
  -- number for the same transaction.
  if v_txn.bain is not null then
    raise exception 'This transaction already has BAIN %', v_txn.bain using errcode = '23505';
  end if;

  v_bain := public.format_bain(v_year, public.next_sequence_value('bain:' || v_year::text));
  v_cert_number := public.format_certificate_number(
    v_year, public.next_sequence_value('certificate:' || v_year::text)
  );

  update public.transactions
  set status = 'verified',
      verified_by = v_actor,
      verified_at = now(),
      rejection_reason = null,
      bain = v_bain,
      bain_issued_at = now()
  where id = p_transaction_id;

  insert into public.certificates (transaction_id, certificate_number)
  values (p_transaction_id, v_cert_number)
  returning id into v_cert_id;

  return query select v_bain, v_cert_number, v_cert_id;
end;
$$;

revoke execute on function public.issue_bain(uuid) from public, anon;
grant execute on function public.issue_bain(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- verify_bain: public authenticity check
--
-- SPEC.md question 9. Without this a Certificate of Compliance is trivially
-- forgeable, because nothing lets a land registry or opposing counsel confirm
-- one is genuine.
--
-- Deliberately returns NO consideration and NO party names. Anyone holding a
-- BAIN can call this, so it must confirm authenticity without disclosing the
-- commercial terms of a client's transaction.
-- ---------------------------------------------------------------------------

create or replace function public.verify_bain(p_bain text)
returns table (
  found boolean,
  bain text,
  practitioner_name text,
  scn text,
  document_type text,
  branch_name text,
  issued_at timestamptz,
  certificate_number text,
  revoked boolean,
  revocation_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    true as found,
    t.bain,
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
  where t.bain = upper(trim(p_bain))
    and t.status = 'verified';
$$;

-- Anonymous access is the entire point: the person checking a certificate is
-- not a user of this app.
grant execute on function public.verify_bain(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Certificates gain a stored PDF path and a revocation audit trail already
-- present on the table. Nothing to add there, but the certificate row is now
-- created by issue_bain rather than by any client, so no insert policy is
-- introduced: clients still cannot mint certificates.
-- ---------------------------------------------------------------------------

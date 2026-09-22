-- Revoking a Certificate of Compliance.
--
-- certificates.revoked_at and .revocation_reason have existed since the
-- initial schema, and verify_rbin has always reported them, so the public
-- verification page has a "This certificate has been revoked" branch and tells
-- every visitor the check confirms a certificate "has not been revoked".
-- Nothing ever wrote those columns. There was no function, no policy and no
-- console action: the branch could state a certificate was genuine but had no
-- way to withdraw one issued in error, on a document a land registry relies on.
--
-- Revocation is a write to certificates, and certificates carries select
-- policies only. That is deliberate and stays: the table is the register, and
-- a register that any client can update is not a register. So this arrives the
-- same way issuance did, as a security definer function that is the only door.
--
-- Who may revoke mirrors who may issue. A branch administrator may revoke a
-- certificate their own branch issued; a super administrator may revoke any.
-- The separation of duties rule from issue_rbin is deliberately NOT repeated
-- here. There, the concern is an administrator approving their own submission,
-- which is self-dealing. Revocation is the opposite motion: it withdraws a
-- benefit rather than granting one, and an administrator who spots that they
-- approved something in error must be able to undo it immediately rather than
-- wait for a colleague. A branch with one administrator would otherwise have
-- no way to correct its own mistake.
--
-- A reason is required. The reason is shown to the public by verify_rbin, and
-- a certificate that says only "revoked" invites the holder to argue it was an
-- administrative slip. Saying why is the point of saying anything.

-- ---------------------------------------------------------------------------
-- revoke_certificate
-- ---------------------------------------------------------------------------

create or replace function public.revoke_certificate(
  p_certificate_id uuid,
  p_reason text
)
returns table (certificate_number text, revoked_at timestamptz, revocation_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_actor_branch uuid := public.current_user_branch();
  v_cert public.certificates%rowtype;
  v_branch_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- for update, because two administrators revoking at the same moment must
  -- not both believe they were the one who did it, and the already-revoked
  -- check below is only meaningful under a lock.
  select * into v_cert from public.certificates where id = p_certificate_id for update;

  if not found then
    raise exception 'Certificate not found' using errcode = 'P0002';
  end if;

  select t.branch_id into v_branch_id
  from public.transactions t
  where t.id = v_cert.transaction_id;

  if not public.is_service_actor() then
    if v_role not in ('branch_admin', 'super_admin') then
      raise exception 'Only a branch administrator may revoke a certificate' using errcode = '42501';
    end if;

    if v_role = 'branch_admin' and v_branch_id is distinct from v_actor_branch then
      raise exception 'This certificate was issued by another branch' using errcode = '42501';
    end if;
  end if;

  if v_reason is null then
    raise exception 'A reason is required, and is shown to anyone who verifies this certificate'
      using errcode = '22023';
  end if;

  -- Not an error worth a distinct code: revoking a revoked certificate changes
  -- nothing, but silently succeeding would let a second administrator overwrite
  -- the first one's stated reason, and the original reason is the record.
  if v_cert.revoked_at is not null then
    raise exception 'This certificate was already revoked on %', v_cert.revoked_at::date
      using errcode = '22023';
  end if;

  update public.certificates
  set revoked_at = now(),
      revocation_reason = v_reason
  where id = p_certificate_id;

  return query
  select c.certificate_number, c.revoked_at, c.revocation_reason
  from public.certificates c
  where c.id = p_certificate_id;
end;
$$;

grant execute on function public.revoke_certificate(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- restore_certificate
-- ---------------------------------------------------------------------------
--
-- Reversing a revocation is a narrower power than making one, so it is the
-- super administrator's alone.
--
-- The asymmetry is the point. Revocation is a public statement that a document
-- should not be relied on, and a third party may already have acted on it, so
-- taking it back is not simply an edit. A branch administrator who revoked the
-- wrong certificate has a route to correct it, but the route runs through
-- someone who was not the person who made the mistake.
--
-- The reason is cleared with the timestamp. Leaving a stale reason on a live
-- certificate would mean verify_rbin held text explaining a revocation that no
-- longer applies, one schema change away from being shown.

create or replace function public.restore_certificate(p_certificate_id uuid)
returns table (certificate_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cert public.certificates%rowtype;
begin
  select * into v_cert from public.certificates where id = p_certificate_id for update;

  if not found then
    raise exception 'Certificate not found' using errcode = 'P0002';
  end if;

  if not public.is_service_actor() and public.current_user_role() <> 'super_admin' then
    raise exception 'Only a super administrator may reverse a revocation' using errcode = '42501';
  end if;

  if v_cert.revoked_at is null then
    raise exception 'This certificate is not revoked' using errcode = '22023';
  end if;

  update public.certificates
  set revoked_at = null,
      revocation_reason = null
  where id = p_certificate_id;

  return query
  select c.certificate_number from public.certificates c where c.id = p_certificate_id;
end;
$$;

grant execute on function public.restore_certificate(uuid) to authenticated;

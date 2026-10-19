-- Somebody who is not signed in could switch a branch off and revoke or
-- restore certificates.
--
-- Found 19 October 2026. The anon key is public by design (it is in the app
-- bundle and the website), and three administrative functions let it through:
--
--   set_branch_activation   if not public.is_privileged_actor() then raise
--   revoke_certificate      if v_role not in ('branch_admin', 'super_admin') then raise
--   restore_certificate     if ... and public.current_user_role() <> 'super_admin' then raise
--
-- With no signed-in user, current_user_role() is NULL. is_privileged_actor()
-- is then false OR NULL, which is NULL, and every one of those conditions is
-- NULL too. plpgsql treats a NULL condition as false, so the raise is skipped
-- and the function carries on. set_user_role has the same first check and was
-- stopped only because protect_profile_columns tests the opposite way round.
--
-- No sign of use: on the day it was found no certificate had ever been
-- revoked and every branch was still active.
--
-- Two fixes, each sufficient on its own:
--
--   1. The checks are made NULL safe, so a caller with no role is refused
--      rather than waved through. This also covers a signed-in account whose
--      profile row is missing, which anon grants alone would not.
--   2. anon may no longer execute any function that changes something. It
--      keeps what signup and public verification need.

-- ---------------------------------------------------------------------------
-- 1. NULL-safe checks
-- ---------------------------------------------------------------------------

create or replace function public.is_privileged_actor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- coalesce: with nobody signed in the comparison is NULL, and a NULL here
  -- reads as "not refused" in every "if not is_privileged_actor()" check.
  select public.is_service_actor() or coalesce(public.current_user_role() = 'super_admin', false);
$$;

-- revoke_certificate, reproduced from 20260921100000 with the role check
-- made NULL safe.
create or replace function public.revoke_certificate(p_certificate_id uuid, p_reason text)
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
    -- CHANGED: "v_role is null or". Not signed in, v_role is NULL and the
    -- not in test alone is NULL, which did not raise.
    if v_role is null or v_role not in ('branch_admin', 'super_admin') then
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

-- restore_certificate, reproduced from 20260921100000 with the role check
-- made NULL safe.
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

  -- CHANGED: is_privileged_actor() rather than "<> 'super_admin'", which was
  -- NULL, and so did not raise, for a caller with no role.
  if not public.is_privileged_actor() then
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

-- ---------------------------------------------------------------------------
-- 2. anon executes nothing that changes anything
-- ---------------------------------------------------------------------------
--
-- Revoked from public as well as anon, because a function is executable by
-- PUBLIC unless that is taken away, and anon inherits it. What anon keeps:
-- validate_branch_code and list_branches_for_signup (registration),
-- verify_rbin (the public verification page), and the pure helpers.
-- membership_approved is taken away too: it answers "is this person approved"
-- for any user id, which nobody signed out needs to know.

revoke execute on function public.set_branch_activation(uuid, public.branch_activation_status) from public, anon;
revoke execute on function public.revoke_certificate(uuid, text) from public, anon;
revoke execute on function public.restore_certificate(uuid) from public, anon;
revoke execute on function public.set_user_role(uuid, public.user_role) from public, anon;
revoke execute on function public.create_transaction(public.document_type, bigint, bigint, bigint, text, jsonb) from public, anon;
revoke execute on function public.membership_approved(uuid) from public, anon;

grant execute on function public.set_branch_activation(uuid, public.branch_activation_status) to authenticated, service_role;
grant execute on function public.revoke_certificate(uuid, text) to authenticated, service_role;
grant execute on function public.restore_certificate(uuid) to authenticated, service_role;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated, service_role;
grant execute on function public.create_transaction(public.document_type, bigint, bigint, bigint, text, jsonb) to authenticated, service_role;
grant execute on function public.membership_approved(uuid) to authenticated, service_role;

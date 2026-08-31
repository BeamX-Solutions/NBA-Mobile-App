-- issue_bain() could never issue a BAIN.
--
-- The same defect as the receipt number one, in the other direction.
--
-- enforce_transaction_update refuses any write that changes bain,
-- bain_issued_at, verified_by or verified_at unless is_privileged_actor() is
-- true. That resolves to is_service_actor(), which reads auth.role() — a claim
-- from the JWT. SECURITY DEFINER changes the database role a function runs as;
-- it does not change the JWT. So inside issue_bain the caller is still
-- 'authenticated' and still a branch_admin, the trigger fires on the function's
-- own update, and the exception 'this field is managed by the server' aborts
-- the whole issuance.
--
-- Every administrator approving a submission through either client hit 42501.
-- Nothing was ever issued and nothing was left half-done — the function runs in
-- one transaction, so the failure rolled back cleanly, including the sequence
-- draw. The defect was masked during seeding because a direct database
-- connection is a service actor, which takes the trigger's early return.
--
-- Rejection was unaffected: it sets status and rejection_reason only, neither
-- of which the trigger guards, so it took the verifier path and succeeded.
--
-- The fix is the marker already used by create_transaction. PostgREST lets a
-- client influence the request.* namespace and the role, never an arbitrary
-- app.* GUC, so a crafted REST call cannot claim to be issuing a BAIN. The
-- trigger keeps refusing these fields on every other path, which is what it
-- exists to do.

-- ---------------------------------------------------------------------------
-- The trigger: honour the marker, guard everything else exactly as before
-- ---------------------------------------------------------------------------

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

  -- Set only by issue_bain(), transaction-local, and unreachable from a
  -- client. The function has already established that the caller administers
  -- the branch, is not the submitter, and that the transaction is awaiting
  -- verification, so re-checking here would only duplicate it.
  if coalesce(current_setting('app.issuing_bain', true), '') = 'on' then
    return new;
  end if;

  -- Fields no client may ever touch directly.
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.branch_id is distinct from old.branch_id
     or new.calculation_id is distinct from old.calculation_id
     or new.amount_payable is distinct from old.amount_payable
     or new.receipt_number is distinct from old.receipt_number
     or new.bain is distinct from old.bain
     or new.bain_issued_at is distinct from old.bain_issued_at then
    raise exception 'this field is managed by the server' using errcode = '42501';
  end if;

  if v_actor = old.user_id then
    -- Owner path.
    if old.status not in ('awaiting_payment', 'rejected') then
      raise exception 'transaction can no longer be edited' using errcode = '42501';
    end if;
    if new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at then
      raise exception 'this field is managed by the server' using errcode = '42501';
    end if;
    if new.status = old.status then
      return new; -- editing details before submission
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
    -- Verifier path. Rejection reaches here; approval goes through issue_bain.
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
-- The function: raise the marker around its own update
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

  if not public.is_service_actor() then
    if v_role not in ('branch_admin', 'super_admin') then
      raise exception 'Only a branch administrator may issue a BAIN' using errcode = '42501';
    end if;

    if v_role = 'branch_admin' and v_txn.branch_id is distinct from v_actor_branch then
      raise exception 'This transaction belongs to another branch' using errcode = '42501';
    end if;

    -- Separation of duties.
    if v_txn.user_id = v_actor then
      raise exception 'You cannot approve your own submission. Another administrator must review it.'
        using errcode = '42501';
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

  perform set_config('app.issuing_bain', 'on', true);

  update public.transactions
  set status = 'verified',
      verified_by = v_actor,
      verified_at = now(),
      rejection_reason = null,
      bain = v_bain,
      bain_issued_at = now()
  where id = p_transaction_id;

  -- Lowered immediately. is_local is true so it would fall away at commit
  -- anyway, but leaving it raised would let a later update in the same
  -- transaction bypass the guard.
  perform set_config('app.issuing_bain', 'off', true);

  insert into public.certificates (transaction_id, certificate_number)
  values (p_transaction_id, v_cert_number)
  returning id into v_cert_id;

  return query select v_bain, v_cert_number, v_cert_id;
end;
$$;

revoke execute on function public.issue_bain(uuid) from public, anon;
grant execute on function public.issue_bain(uuid) to authenticated, service_role;

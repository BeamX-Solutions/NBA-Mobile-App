-- Separation of duties: an administrator may not approve their own submission.
--
-- issue_bain previously checked that the caller administers the branch the
-- transaction belongs to, but not that they were a different person from the
-- practitioner who submitted it. One person could therefore calculate a fee,
-- submit proof of their own payment, and issue themselves a Certificate of
-- Compliance with no second pair of eyes anywhere in the chain.
--
-- That is a weak control on a document that a land registry may rely on. The
-- check below is a rewrite of the whole function rather than a patch, because
-- create or replace needs the complete definition.
--
-- Consequence to be aware of: a branch whose only administrator is also a
-- practising member cannot process that administrator's own transactions.
-- They need a second administrator, or the super admin, to approve. That is
-- the intended cost of the control, not an oversight.
--
-- The service role is exempt. It is server side automation, not a person, and
-- exempting it keeps a future automated issuance path open.

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

-- The same principle applies to rejection, which is enforced by the
-- enforce_transaction_update trigger rather than by this function. A
-- practitioner rejecting their own submission is harmless (it only returns
-- the transaction to them for correction), so it is deliberately not blocked.

-- What a super administrator is for.
--
-- The role existed as "an administrator with every permission", which is not a
-- role so much as the absence of one. In practice that produced three
-- problems, and this migration answers all three.
--
-- FIRST, the super administrator belonged to a branch. handle_new_user
-- requires a branch code at signup, so the platform account was created as a
-- member of NBA Anaocha like anybody else. Every branch-scoped screen then
-- showed that branch's data to the person whose job is to oversee all of them:
-- Branch Records offered Anaocha's bank details and chairman for editing, not
-- because anyone decided it should, but because the row said so.
--
-- A platform role belongs to no branch. branch_id is already nullable, so
-- detaching costs nothing structurally, and it makes every branch-scoped
-- screen naturally empty for a super administrator rather than quietly
-- correct for one arbitrary branch. Screens that would otherwise have to
-- remember to exclude them now exclude them by construction.
--
-- SECOND, a super administrator could approve submissions. Approving is
-- ordinary branch work and it carries a separation of duties rule that exists
-- because a document a land registry relies on should have had two people look
-- at it. A platform overseer approving a branch's payment puts the work and
-- the oversight of the work in the same hands, which is the arrangement the
-- rule was written to prevent. issue_rbin is now the branch administrator's
-- alone.
--
-- Revocation is deliberately NOT removed in the same way. A bad certificate is
-- a platform level risk, the branch that issued it may be the reason it is
-- bad, and withdrawing one is the opposite motion from granting it. That
-- remains available to a super administrator as a backstop.
--
-- THIRD, and the substantive gap: there was no way to appoint a branch
-- administrator. protect_profile_columns raises 42501 when a non-privileged
-- actor changes a role, and nothing offered the privileged path, so the one
-- operation that makes the super administrator a manager of administrators
-- was the one that required a database console.

-- ---------------------------------------------------------------------------
-- Detach the platform role from any branch
-- ---------------------------------------------------------------------------

update public.profiles
set branch_id = null,
    practice_state = null
where role = 'super_admin';

-- Kept true from here on. A super administrator created later through the
-- ordinary signup route arrives as a branch_member and is promoted, and
-- set_user_role below refuses to leave a super administrator holding a branch.

-- ---------------------------------------------------------------------------
-- set_user_role: appoint and remove branch administrators
-- ---------------------------------------------------------------------------
--
-- Only between branch_member and branch_admin, in either direction. Promotion
-- to super_admin is not offered here and stays a deliberate out of band
-- operation: an interface that can mint platform administrators is an
-- interface that can be used to mint one.
--
-- The self check matters more than it looks. A super administrator demoting
-- themselves would be the last one, and there would then be no way to appoint
-- another through any screen, which is the lockout this whole function exists
-- to avoid.

create or replace function public.set_user_role(
  p_user_id uuid,
  p_role public.user_role
)
returns table (id uuid, full_name text, role public.user_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles%rowtype;
begin
  if not public.is_privileged_actor() then
    raise exception 'Only a super administrator may change a role' using errcode = '42501';
  end if;

  if p_role not in ('branch_member', 'branch_admin') then
    raise exception 'A role may only be set to branch_member or branch_admin here'
      using errcode = '22023';
  end if;

  -- profiles.id, not id. This function returns a table whose first column is
  -- named id, which makes a bare "id" ambiguous between that output parameter
  -- and the column: plpgsql raises 42702 rather than guessing.
  select * into v_target from public.profiles where profiles.id = p_user_id for update;

  if not found then
    raise exception 'That person could not be found' using errcode = 'P0002';
  end if;

  if v_target.id = auth.uid() then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;

  if v_target.role = 'super_admin' then
    raise exception 'A super administrator''s role cannot be changed here'
      using errcode = '42501';
  end if;

  -- An administrator administers a branch. Promoting somebody unattached
  -- would create an administrator of nothing, who would then see an empty
  -- console and no way to fix it.
  if p_role = 'branch_admin' and v_target.branch_id is null then
    raise exception 'This person is not attached to a branch, so cannot administer one'
      using errcode = '22023';
  end if;

  if v_target.role = p_role then
    raise exception 'They already hold that role' using errcode = '22023';
  end if;

  update public.profiles
  set role = p_role
  where profiles.id = p_user_id;

  return query
  select p.id, p.full_name, p.role from public.profiles p where p.id = p_user_id;
end;
$$;

grant execute on function public.set_user_role(uuid, public.user_role) to authenticated;

-- ---------------------------------------------------------------------------
-- issue_rbin: the branch administrator's alone
-- ---------------------------------------------------------------------------
--
-- Recreated whole from 20260922100000 with one change, marked below. The
-- service actor bypass stays: it is what lets the test suites drive issuance
-- directly, and it is not reachable with an anon or authenticated key.

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
    -- CHANGED. Was 'branch_admin' or 'super_admin'. Approving a payment is
    -- branch work carrying a separation of duties rule, and a platform
    -- overseer doing it would hold both the work and the oversight of it.
    if v_role <> 'branch_admin' then
      raise exception 'Only a branch administrator may issue an RBIN' using errcode = '42501';
    end if;

    if v_txn.branch_id is distinct from v_actor_branch then
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

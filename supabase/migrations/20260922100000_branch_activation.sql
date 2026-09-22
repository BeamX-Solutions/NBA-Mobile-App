-- Branch activation: enforcing it, and giving the super administrator a way
-- to set it.
--
-- branches.activation_status has existed since the initial schema. The console
-- displays it, protect_branch_columns guards who may change it, and the
-- All Branches screen tells the operator the branch is "created inactive".
-- Nothing has ever read it. Not registration, not create_transaction, not
-- issue_rbin. A branch that never paid an activation fee behaved in every
-- respect like one that did, so the fee in SPEC.md section 2.0 had no
-- mechanism behind it at all.
--
-- expires_at was in the same position: set when a branch is activated, never
-- consulted and never acted on. A branch whose year ran out stayed 'active'
-- for ever, because nothing computes the transition and no job runs to do it.
-- Rather than add a scheduled job to rewrite rows, expiry is computed at the
-- point of use: a branch past its expires_at is not active, whatever the
-- column says. The stored status is then the commercial decision, and the date
-- is what bounds it.
--
-- WHERE THIS IS ENFORCED, AND WHERE IT DELIBERATELY IS NOT.
--
-- Enforced in create_transaction, which is the moment a branch fee is charged
-- and a receipt drawn. That is the revenue event, and it is the same place the
-- practitioner's own subscription is already checked, so the two gates sit
-- together and read alike.
--
-- NOT enforced in issue_rbin. A practitioner who has already paid their branch
-- must receive the certificate they paid for, and a branch lapsing between
-- submission and approval is the branch's problem with the Association, not
-- the practitioner's with their client. Blocking issuance would strand paid
-- work and would punish the wrong party.
--
-- Enforced at registration, in two places. list_branches_for_signup stops
-- offering a branch that has not been activated, so the signup picker shows
-- only branches that have actually joined; and handle_new_user refuses one
-- anyway, because the picker is a convenience and the branch code arrives in
-- client-supplied metadata that a crafted payload could name directly.
--
-- This gates new registrations only. A member who has already signed up keeps
-- their account if their branch is later deactivated, and keeps every
-- certificate they hold, which is what SPEC.md question 8 settled: issued
-- certificates stay available regardless. Losing the ability to register new
-- members and draw new receipts is the proportionate consequence, and all of
-- it is reversible the moment the branch is activated again.

-- ---------------------------------------------------------------------------
-- branch_is_active
-- ---------------------------------------------------------------------------

create or replace function public.branch_is_active(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.branches b
    where b.id = p_branch_id
      and b.activation_status = 'active'
      -- A null expiry is an activation with no end date, which is what a
      -- founding branch or a waived fee looks like. It is not "expired".
      and (b.expires_at is null or b.expires_at > now())
  );
$$;

grant execute on function public.branch_is_active(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_branch_activation
-- ---------------------------------------------------------------------------
--
-- The super administrator's alone, matching protect_branch_columns, which
-- already refuses this change from anyone else. It exists as a function rather
-- than being left to a direct update so that the bookkeeping around a status
-- change happens in one place: activating stamps activated_at the first time
-- and leaves it alone thereafter, and deactivating clears any expiry rather
-- than leaving a future date on a branch that is no longer trading.
--
-- One branch at a time, deliberately. Branches join when they decide to join,
-- which is a conversation with each one rather than a sweep over all of them,
-- and the operator activating a branch should be looking at that branch.
--
-- Until this existed, activating a branch meant connecting to the database by
-- hand. Branch onboarding is the growth mechanism, so the one operation that
-- turns a prospect into a member was the one with no interface.

create or replace function public.set_branch_activation(
  p_branch_id uuid,
  p_status public.branch_activation_status,
  p_expires_at timestamptz default null
)
returns table (
  branch_code text,
  activation_status public.branch_activation_status,
  activated_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch public.branches%rowtype;
  v_expires timestamptz;
begin
  select * into v_branch from public.branches where id = p_branch_id for update;

  if not found then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  if not public.is_privileged_actor() then
    raise exception 'Only a super administrator may change branch activation'
      using errcode = '42501';
  end if;

  if p_status = 'active' then
    -- Null means no end date, and that is the default on purpose. Activating a
    -- branch is an administrative act by the super administrator, not a
    -- purchase: the Association has on the order of 129 branches and bringing
    -- them onto the platform must not be gated behind a payment flow that does
    -- not exist yet. A term is set only when someone deliberately sets one.
    v_expires := p_expires_at;

    if v_expires is not null and v_expires <= now() then
      raise exception 'An activation that has already expired is not an activation'
        using errcode = '22023';
    end if;
  else
    v_expires := null;
  end if;

  update public.branches
  set activation_status = p_status,
      -- Kept from the first activation, so the record shows when the branch
      -- joined rather than when it last renewed.
      activated_at = case
        when p_status = 'active' then coalesce(v_branch.activated_at, now())
        else v_branch.activated_at
      end,
      expires_at = v_expires
  where id = p_branch_id;

  return query
  select b.branch_code, b.activation_status, b.activated_at, b.expires_at
  from public.branches b
  where b.id = p_branch_id;
end;
$$;

grant execute on function public.set_branch_activation(
  uuid, public.branch_activation_status, timestamptz
) to authenticated;

-- ---------------------------------------------------------------------------
-- list_branches_for_signup: only branches that have joined
-- ---------------------------------------------------------------------------
--
-- This feeds the branch picker on the registration screen, and it listed every
-- row in the table. A branch that had been entered in readiness, or had lapsed,
-- was offered to a lawyer as somewhere they could register, and nothing
-- downstream disagreed.
--
-- Activating a branch is now what puts it on this list. That is the whole
-- visible consequence of activation for everyone outside the console: the
-- branch decides to join, the super administrator activates it, and it becomes
-- selectable at signup.
--
-- state is still returned. The registration screen no longer shows it, but the
-- column is what handle_new_user writes to profiles.practice_state, and
-- removing it from the signature would be a schema change for a field the
-- caller is simply free to ignore.

create or replace function public.list_branches_for_signup()
returns table (id uuid, branch_code text, name text, state text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.branch_code, b.name, b.state
  from public.branches b
  where public.branch_is_active(b.id)
  order by b.name;
$$;

grant execute on function public.list_branches_for_signup() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- handle_new_user: the branch must have joined
-- ---------------------------------------------------------------------------
--
-- Recreated whole from 20260816100000_branch_required_at_signup.sql, with the
-- activation check added. The picker already filters, but branch_code reaches
-- this trigger inside client-supplied signup metadata, so a payload naming an
-- inactive branch directly would otherwise be honoured.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code text := nullif(upper(trim(meta ->> 'branch_code')), '');
  v_branch_id uuid;
  v_state text;
begin
  if v_code is null then
    raise exception 'A branch code is required to register'
      using errcode = 'P0001';
  end if;

  select id, state into v_branch_id, v_state
  from public.branches
  where branch_code = v_code;

  if v_branch_id is null then
    raise exception 'Unknown branch code %', v_code using errcode = 'P0001';
  end if;

  -- NEW. Worded for the person reading it, who is a lawyer trying to register
  -- and has done nothing wrong: the branch has not joined yet, and that is not
  -- something they can fix by retyping anything.
  if not public.branch_is_active(v_branch_id) then
    raise exception
      'That branch is not yet registered on this service, so accounts cannot be opened for it. Ask your branch secretariat to contact the Association.'
      using errcode = 'P0001';
  end if;

  -- practice_state is taken from the branch, never from client metadata. The
  -- app no longer sends it, and ignoring it here means a crafted signup
  -- payload cannot set a state that contradicts the branch.
  insert into public.profiles (id, full_name, email, phone, scn, branch_id, practice_state, role)
  values (
    new.id,
    coalesce(meta ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(trim(meta ->> 'phone'), ''),
    nullif(trim(meta ->> 'scn'), ''),
    v_branch_id,
    v_state,
    'branch_member'
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_transaction: the branch must be active
-- ---------------------------------------------------------------------------
--
-- Recreated whole rather than patched, because plpgsql has no way to amend a
-- function body. Everything below is as it stood in
-- 20260831140000_fix_receipt_number_stripped_on_insert.sql apart from the
-- branch activation check, which is marked where it appears.

create or replace function public.create_transaction(
  p_document_type public.document_type,
  p_consideration bigint,
  p_professional_fee bigint,
  p_branch_fee bigint,
  p_parties text,
  p_breakdown jsonb default '{}'::jsonb
)
returns table (transaction_id uuid, receipt_number text)
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
  v_receipt text;
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
    raise exception 'You are not affiliated with a branch. Request affiliation from Edit Profile before generating a receipt.'
      using errcode = 'P0001';
  end if;

  select * into v_branch from public.branches where id = v_profile.branch_id;
  if not found then
    raise exception 'Your branch could not be found' using errcode = 'P0002';
  end if;

  -- NEW. The branch's own standing with the Association, checked beside the
  -- practitioner's subscription because they are the same kind of gate. The
  -- message names the branch and says who can fix it: a practitioner reading
  -- this has done nothing wrong and cannot resolve it themselves.
  if not public.branch_is_active(v_profile.branch_id) then
    raise exception
      '% is not currently active, so receipts cannot be generated for it. Your branch must renew its activation with the Association. Calculations remain free.',
      v_branch.name
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.subscriptions
    where user_id = v_actor
      and status = 'active'
      and expires_at > now()
  ) then
    raise exception 'An active subscription is required to generate a receipt. Calculations remain free.'
      using errcode = 'P0001';
  end if;

  if v_parties is null then
    raise exception 'Name the parties to the document' using errcode = '23514';
  end if;
  if p_consideration < 0 or p_professional_fee < 0 or p_branch_fee < 0 then
    raise exception 'Amounts cannot be negative' using errcode = '23514';
  end if;

  select id into v_scale_id from public.fee_scales where is_active limit 1;

  if v_scale_id is not null then
    insert into public.calculations (
      user_id, fee_scale_id, document_type, consideration,
      professional_fee, branch_fee, total, breakdown
    )
    values (
      v_actor, v_scale_id, p_document_type, p_consideration,
      p_professional_fee, p_branch_fee, p_professional_fee + p_branch_fee,
      coalesce(p_breakdown, '{}'::jsonb)
    )
    returning id into v_calculation_id;
  end if;

  -- Drawn before the marker is raised: consuming a sequence value is the part
  -- that must not happen twice, and it is unrelated to the insert path.
  v_receipt := 'TXN-'
    || lpad(
         public.next_sequence_value(
           'receipt:' || v_branch.branch_code || ':' || extract(year from now())::text
         )::text, 5, '0')
    || '-' || public.document_type_code(p_document_type);

  perform set_config('app.issuing_receipt', 'on', true);

  insert into public.transactions (
    user_id, branch_id, calculation_id, parties, document_type,
    consideration, amount_payable, receipt_number, status
  )
  values (
    v_actor, v_profile.branch_id, v_calculation_id, v_parties, p_document_type,
    p_consideration, p_branch_fee, v_receipt, 'awaiting_payment'
  )
  returning id into v_txn_id;

  -- Lowered immediately. is_local is true so it would fall away at commit
  -- anyway, but leaving it raised for the rest of the transaction would let a
  -- later insert in the same transaction keep a client-supplied receipt.
  perform set_config('app.issuing_receipt', 'off', true);

  return query select v_txn_id, v_receipt;
end;
$$;

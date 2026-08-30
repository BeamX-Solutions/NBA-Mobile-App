-- Phase 1: helper functions, registration trigger, column protection,
-- lifecycle enforcement, gapless sequences and audit logging.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'state_bands', 'branches', 'profiles', 'fee_scales', 'fee_scale_bands',
    'subscriptions', 'calculations', 'transactions', 'certificates', 'number_sequences'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Actor helpers. security definer so RLS policies on profiles can call them
-- without recursing into their own policy checks.
-- ---------------------------------------------------------------------------

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_user_branch()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

-- True when running as the service role key or as a direct database role
-- (migrations, server code). Client JWTs are 'anon' or 'authenticated'.
create or replace function public.is_service_actor()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role(), 'none') not in ('anon', 'authenticated');
$$;

create or replace function public.is_privileged_actor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_service_actor() or public.current_user_role() = 'super_admin';
$$;

-- ---------------------------------------------------------------------------
-- Registration: create a profile whenever an auth user is created.
-- Reads full_name, phone, scn, branch_code and practice_state from the
-- signup metadata. A valid branch code makes the user a branch_member;
-- an invalid one aborts signup so nobody silently loses the branch rate.
-- ---------------------------------------------------------------------------

create or replace function public.validate_branch_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.branches where branch_code = upper(trim(p_code))
  );
$$;

grant execute on function public.validate_branch_code(text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code text := nullif(upper(trim(meta ->> 'branch_code')), '');
  v_state text := nullif(trim(meta ->> 'practice_state'), '');
  v_branch_id uuid;
  v_role public.user_role := 'individual';
begin
  if v_code is not null then
    select id into v_branch_id from public.branches where branch_code = v_code;
    if v_branch_id is null then
      raise exception 'Unknown branch code %', v_code
        using errcode = 'P0001';
    end if;
    v_role := 'branch_member';
  end if;

  -- An unrecognised state must not block signup; the profile can be
  -- completed later. The seeded mapping is provisional (SPEC.md section 10).
  if v_state is not null
     and not exists (select 1 from public.state_bands where state = v_state) then
    v_state := null;
  end if;

  insert into public.profiles (id, full_name, email, phone, scn, branch_id, practice_state, role)
  values (
    new.id,
    coalesce(meta ->> 'full_name', ''),
    coalesce(new.email, ''),
    nullif(trim(meta ->> 'phone'), ''),
    nullif(trim(meta ->> 'scn'), ''),
    v_branch_id,
    v_state,
    v_role
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- profiles: users may edit their own contact details but never their role,
-- branch or SCN. Those change only through the server or a super admin.
-- ---------------------------------------------------------------------------

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.branch_id is distinct from old.branch_id
     or new.scn is distinct from old.scn
     or new.id is distinct from old.id then
    raise exception 'role, branch and SCN can only be changed by an administrator'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------------
-- branches: a branch admin may manage the branch profile and bank details
-- but never its code, activation or expiry. Those belong to the super admin.
-- ---------------------------------------------------------------------------

create or replace function public.protect_branch_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  if new.branch_code is distinct from old.branch_code
     or new.activation_status is distinct from old.activation_status
     or new.activated_at is distinct from old.activated_at
     or new.expires_at is distinct from old.expires_at
     or new.id is distinct from old.id then
    raise exception 'branch code and activation can only be changed by the super admin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_branch_columns
  before update on public.branches
  for each row execute function public.protect_branch_columns();

-- ---------------------------------------------------------------------------
-- transactions: enforce the lifecycle at the database layer so no client,
-- and no bug in server code short of the service key, can skip a state.
--
--   owner:        awaiting_payment or rejected -> pending_verification
--                 (requires proof_url; may edit details while unsubmitted)
--   branch admin: pending_verification -> verified or rejected
--                 (rejection requires a reason; core figures immutable)
--   service:      anything (receipt numbering and BAIN issuance in later
--                 phases run server side inside a database transaction)
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

  new.status := 'awaiting_payment';
  new.receipt_number := null;
  new.rejection_reason := null;
  new.verified_by := null;
  new.verified_at := null;
  new.bain := null;
  new.bain_issued_at := null;
  return new;
end;
$$;

create trigger enforce_transaction_insert
  before insert on public.transactions
  for each row execute function public.enforce_transaction_insert();

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
    -- Verifier path.
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
      raise exception 'a rejection reason is required' using errcode = '23514';
    end if;
    if new.status = 'verified' then
      new.rejection_reason := null;
    end if;
    new.verified_by := v_actor;
    new.verified_at := now();
    return new;
  end if;

  raise exception 'not permitted' using errcode = '42501';
end;
$$;

create trigger enforce_transaction_update
  before update on public.transactions
  for each row execute function public.enforce_transaction_update();

-- ---------------------------------------------------------------------------
-- Gapless sequences. Scope examples: 'bain:ANA:2026', 'receipt:ANA:2026',
-- 'certificate:ANA:2026'. The upsert takes a row lock, so concurrent callers
-- serialise; a rolled-back caller rolls the increment back too, so numbers
-- neither gap nor collide. Server side only.
-- ---------------------------------------------------------------------------

create or replace function public.next_sequence_value(p_scope text)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.number_sequences as ns (scope, last_value)
  values (p_scope, 1)
  on conflict (scope)
  do update set last_value = ns.last_value + 1
  returning ns.last_value;
$$;

revoke execute on function public.next_sequence_value(text) from public, anon, authenticated;
grant execute on function public.next_sequence_value(text) to service_role;

-- ---------------------------------------------------------------------------
-- Audit log. security definer so the trigger can insert even though no RLS
-- policy allows clients to write to audit_log directly.
-- ---------------------------------------------------------------------------

create or replace function public.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text;
begin
  begin
    v_ip := current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for';
  exception when others then
    v_ip := null;
  end;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after, ip)
  values (
    auth.uid(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, ''),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    v_ip
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['branches', 'subscriptions', 'transactions', 'certificates']
  loop
    execute format(
      'create trigger write_audit after insert or update or delete on public.%I
         for each row execute function public.write_audit()', t);
  end loop;
end;
$$;

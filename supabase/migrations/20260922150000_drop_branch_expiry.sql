-- Branches do not expire.
--
-- expires_at came from the activation-fee model in SPEC.md section 2.0, where
-- a branch bought a year at a time. That model is not how this works:
-- activating a branch is an administrative act by the super administrator, it
-- carries no fee, and a branch stays on the platform until somebody takes it
-- off. A date that nothing sells and nobody renews is a trapdoor, and the one
-- branch carrying a real date would have fallen through it in August 2027 with
-- no warning and no way for its administrator to understand why receipts had
-- stopped.
--
-- Removed rather than left unused. A nullable column that every code path
-- ignores is an invitation to a future reader to start honouring it again, and
-- branch_is_active reading it was the only thing standing between this system
-- and a branch going dark on a date nobody set deliberately.
--
-- activated_at stays. It records when a branch joined, which is history rather
-- than a rule, and nothing decides anything by it.

-- ---------------------------------------------------------------------------
-- branch_is_active: status alone
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
  );
$$;

-- ---------------------------------------------------------------------------
-- set_branch_activation: no term to set
-- ---------------------------------------------------------------------------
--
-- The p_expires_at parameter goes with the column. The old three-argument
-- signature is dropped rather than left in place: leaving it would mean two
-- functions with the same name where the wrong one is one keystroke away, and
-- a caller passing a date would have it silently accepted and ignored.

drop function if exists public.set_branch_activation(
  uuid, public.branch_activation_status, timestamptz
);

create or replace function public.set_branch_activation(
  p_branch_id uuid,
  p_status public.branch_activation_status
)
returns table (
  branch_code text,
  activation_status public.branch_activation_status,
  activated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch public.branches%rowtype;
begin
  select * into v_branch from public.branches where branches.id = p_branch_id for update;

  if not found then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  if not public.is_privileged_actor() then
    raise exception 'Only a super administrator may change branch activation'
      using errcode = '42501';
  end if;

  update public.branches
  set activation_status = p_status,
      -- Kept from the first activation, so the record shows when the branch
      -- joined rather than when it was last switched back on.
      activated_at = case
        when p_status = 'active' then coalesce(v_branch.activated_at, now())
        else v_branch.activated_at
      end
  where branches.id = p_branch_id;

  return query
  select b.branch_code, b.activation_status, b.activated_at
  from public.branches b
  where b.id = p_branch_id;
end;
$$;

grant execute on function public.set_branch_activation(
  uuid, public.branch_activation_status
) to authenticated;

-- ---------------------------------------------------------------------------
-- protect_branch_columns: stop guarding a column that is gone
-- ---------------------------------------------------------------------------
--
-- The trigger names expires_at explicitly, so dropping the column while the
-- function still referenced it would leave every update to a branch failing
-- with 42703, "record new has no field expires_at". Recreated first, with that
-- one clause removed and nothing else changed; the column is dropped below.

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
     or new.id is distinct from old.id then
    raise exception 'branch code and activation can only be changed by the super admin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

alter table public.branches drop column if exists expires_at;

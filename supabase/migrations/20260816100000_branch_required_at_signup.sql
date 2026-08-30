-- Branch affiliation becomes compulsory at registration, and the practice
-- state is derived from the branch rather than chosen by the practitioner.
--
-- Client decision, 16 August 2026: every practitioner must belong to a branch.
-- This supersedes section 1A of the brief, which offered Individual
-- Registration as an alternative. The 'individual' role is retained in the
-- enum because existing rows may carry it and dropping an enum value is
-- destructive, but nothing assigns it any more.

-- ---------------------------------------------------------------------------
-- branches.state
--
-- A branch sits in exactly one state, so the practitioner's practice state is
-- a property of the branch they join. Asking for it separately let the two
-- disagree, and produced a required field the user had to guess at.
-- ---------------------------------------------------------------------------

alter table public.branches add column if not exists state text;

-- The only branch in existence. Anaocha is a local government area of Anambra.
update public.branches set state = 'Anambra' where branch_code = 'ANAOCHA' and state is null;

-- Any branch created from here on must declare its state, so the derivation
-- below can never silently produce null.
alter table public.branches alter column state set not null;

-- ---------------------------------------------------------------------------
-- Branch list for the registration screen
--
-- The register screen runs BEFORE the user has an account, so it is anonymous.
-- The policy on public.branches only admits authenticated readers, which would
-- leave the dropdown empty.
--
-- This is a function rather than a widened policy on purpose: branches carry
-- account_name, account_number and bank_name. Granting anon select on the
-- table to populate a dropdown would publish every branch's bank details to
-- anyone with the anon key. Only the four fields a signup needs are exposed.
-- ---------------------------------------------------------------------------

create or replace function public.list_branches_for_signup()
returns table (id uuid, branch_code text, name text, state text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.branch_code, b.name, b.state
  from public.branches b
  order by b.name;
$$;

grant execute on function public.list_branches_for_signup() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- handle_new_user: branch code now required, practice_state derived
-- ---------------------------------------------------------------------------

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

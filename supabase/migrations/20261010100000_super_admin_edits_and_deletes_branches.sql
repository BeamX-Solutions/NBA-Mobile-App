-- The super administrator edits and deletes branches.
--
-- Client decision, 10 October 2026: a super administrator may correct any
-- branch, and may remove one, from All Branches.
--
-- EDITING. The update policy already admitted the super administrator, and
-- protect_branch_columns waved them straight through, so a super admin could
-- change a branch's codes at any point. That was too loose in one respect.
-- branch_code is printed inside every RBIN the branch issues and short_code
-- inside every certificate number, and both are drawn from per-branch
-- sequences, so changing either after issuance would leave certificates in
-- circulation that name a code the branch no longer has. The two codes are
-- now editable only until the branch has issued its first RBIN, by the super
-- administrator alone. short_code was not guarded at all before, which let a
-- branch administrator rename their own certificate prefix; it is now.
--
-- DELETING. Only a branch with nobody in it. A profile's branch_id is what
-- ties a lawyer or an administrator to the branch, and transactions and
-- certificates hang from the members, so a branch anyone belongs to is
-- deactivated rather than deleted. The foreign keys would refuse the delete
-- anyway; the trigger exists to refuse it with a sentence an operator can act
-- on instead of a constraint name. The audit trigger on branches already
-- journals deletes, so the removed row survives in audit_log.

-- ---------------------------------------------------------------------------
-- protect_branch_columns
-- ---------------------------------------------------------------------------

create or replace function public.protect_branch_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_service_actor() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.activation_status is distinct from old.activation_status
     or new.activated_at is distinct from old.activated_at then
    if public.current_user_role() <> 'super_admin' then
      raise exception 'branch activation can only be changed by the super admin'
        using errcode = '42501';
    end if;
  end if;

  if new.branch_code is distinct from old.branch_code
     or new.short_code is distinct from old.short_code then
    if public.current_user_role() <> 'super_admin' then
      raise exception 'branch codes can only be changed by the super admin'
        using errcode = '42501';
    end if;

    if exists (
      select 1 from public.transactions t
      where t.branch_id = old.id and t.rbin is not null
    ) then
      raise exception 'This branch has already issued certificates, so its codes can no longer be changed. They are printed on every RBIN and certificate number it has issued.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deleting
-- ---------------------------------------------------------------------------

grant delete on public.branches to authenticated;

create policy "super admin deletes branches" on public.branches
  for delete to authenticated
  using (public.current_user_role() = 'super_admin');

create or replace function public.guard_branch_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles p where p.branch_id = old.id) then
    raise exception 'This branch has members or administrators, so it cannot be deleted. Deactivate it instead.'
      using errcode = '23503';
  end if;

  if exists (select 1 from public.transactions t where t.branch_id = old.id) then
    raise exception 'This branch has transactions on record, so it cannot be deleted. Deactivate it instead.'
      using errcode = '23503';
  end if;

  return old;
end;
$$;

create trigger guard_branch_delete
  before delete on public.branches
  for each row execute function public.guard_branch_delete();

-- A branch's chairman signature is readable only by the people who need it.
--
-- The policy from 20260921110000 let any signed-in user read every file in
-- the signatures bucket, so a practitioner in one branch could download every
-- other branch's chairman signature (confirmed 2026-11-22). Writes were
-- already limited to the branch's administrator and the super administrator.
--
-- A signature lives in the folder named after its branch's id. It is read by:
--
--   * the super administrator, who manages every branch;
--   * anyone whose current branch it is: its members, who print it on their
--     certificates, and its administrators, who preview it in the console;
--   * anyone with a verified transaction drawn on that branch. A certificate
--     carries the signature of the branch the transaction was drawn on, so a
--     practitioner who has since moved branch still needs the old one to
--     download their old certificates.
--
-- A reader this misses gets a certificate with the chairman's name over an
-- empty line, which is the documented fallback; nothing fails.

-- SECURITY DEFINER so the transaction check does not depend on the caller's
-- view of transactions. Returns a boolean only.
create or replace function public.can_read_branch_signature(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_user_role() = 'super_admin'
    or p_folder = public.current_user_branch()::text
    or exists (
      select 1 from public.transactions t
      where t.user_id = auth.uid()
        and t.status = 'verified'
        and t.branch_id::text = p_folder
    ),
    false
  );
$$;

revoke execute on function public.can_read_branch_signature(text) from public, anon;
grant execute on function public.can_read_branch_signature(text) to authenticated, service_role;

drop policy if exists "authenticated users read signatures" on storage.objects;
drop policy if exists "branch signature readers" on storage.objects;

create policy "branch signature readers" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'signatures'
    and public.can_read_branch_signature((storage.foldername(name))[1])
  );

-- Private storage for proof of payment.
--
-- Bank slips carry account numbers and client names, so this bucket is
-- private and is never served from a public URL (SPEC.md section 6). Files
-- are addressed as {user_id}/{transaction_id}.{ext}, which lets the owner
-- policy match on the leading folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proofs',
  'proofs',
  false,
  10485760, -- 10MB, matching the client side check
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- Owner may upload into their own folder only. The path check is what stops
-- a practitioner writing into another practitioner's folder.
create policy "owner uploads own proof" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Replacing a rejected proof is an update, because the client uploads with
-- upsert so a resubmission reuses the same path.
create policy "owner replaces own proof" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owner reads own proof" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- A branch admin has to see the slip to verify it. Access is granted per
-- file rather than per folder: the object must be the recorded proof_url of
-- a transaction belonging to the admin's own branch. Matching on the folder
-- instead would expose every file that practitioner ever uploaded, including
-- proofs submitted to a different branch.
create policy "branch admin reads branch proof" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proofs'
    and public.current_user_role() = 'branch_admin'
    and exists (
      select 1
      from public.transactions t
      where t.proof_url = storage.objects.name
        and t.branch_id = public.current_user_branch()
    )
  );

-- No delete policy. Proof of payment is evidence behind a certificate that
-- carries legal weight, so it is retained rather than removable by the
-- practitioner who submitted it.

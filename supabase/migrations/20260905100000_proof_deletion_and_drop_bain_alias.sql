-- Two pieces of housekeeping.
--
-- 1. Proofs of payment could never be deleted by anyone. The bucket has
--    policies for upload, read and replace, but none for delete, so a
--    practitioner who attached the wrong document could only overwrite it, and
--    a file left behind by a deleted transaction stayed for good.
--
-- 2. verify_bain was kept as a wrapper over verify_rbin so the deployed
--    verification page would not go dark between the rename and its redeploy.
--    That deploy landed several releases ago, so the wrapper is now a second
--    door into the same room that nothing walks through.

-- ---------------------------------------------------------------------------
-- Deleting a proof of payment
-- ---------------------------------------------------------------------------

-- A practitioner may remove their own proof, but only while the transaction is
-- still theirs to change. Once a branch has verified it, that file is the
-- evidence behind an issued certificate: a land registry relying on the
-- certificate should not find the payment it rests on has been erased by the
-- person who benefits from erasing it.
create policy "owner deletes own unverified proof" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.transactions t
      where t.proof_url = objects.name
        and t.status in ('verified', 'pending_verification')
    )
  );

-- The super administrator may remove any proof. This is the housekeeping path:
-- files orphaned by deleted transactions, and anything that has to be removed
-- on request. Deliberately not extended to branch administrators, who are the
-- people with a motive to make an inconvenient payment record disappear.
create policy "super admin deletes any proof" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'proofs'
    and public.current_user_role() = 'super_admin'
  );

-- ---------------------------------------------------------------------------
-- Removing the deprecated alias
-- ---------------------------------------------------------------------------

drop function if exists public.verify_bain(text);

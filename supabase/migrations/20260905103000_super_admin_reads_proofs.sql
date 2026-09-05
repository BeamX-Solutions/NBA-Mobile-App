-- The super administrator could delete a proof but not see one, and Supabase
-- Storage requires an object to be visible before it can be removed. The
-- delete policy added minutes ago was therefore unusable: every attempt came
-- back 403 with no indication that a missing read was the cause.
--
-- Proofs are bank slips, so this is not a trivial grant. It is consistent with
-- what the role already carries though: a super administrator can read every
-- transaction, every certificate and the audit log. A role that can see the
-- record of a payment but not the evidence behind it cannot investigate a
-- disputed one, and cannot clear a file left behind by a deleted transaction.
--
-- Branch administrators are deliberately not widened. They keep the narrow
-- read they already have, which reaches only proofs attached to a transaction
-- in their own branch.
create policy "super admin reads any proof" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proofs'
    and public.current_user_role() = 'super_admin'
  );

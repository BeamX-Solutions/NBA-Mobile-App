-- A verified proof of payment could still be overwritten by the practitioner.
--
-- The delete policy added in 20260905100000 stops a practitioner removing the
-- proof behind a verified transaction, for a stated reason: a land registry
-- relying on the certificate should not find the payment it rests on has been
-- erased by the person who benefits from erasing it.
--
-- The update policy carried no such guard. It checked the bucket and the
-- leading folder and nothing else, so the same practitioner could upload a
-- blank page over the same path and leave the certificate resting on a file
-- that no longer showed a payment. That is the outcome the delete policy was
-- written to prevent, reached by the other door, and it is the easier door:
-- the client already uploads with upsert, so replacing is the ordinary path
-- and deleting is not a path the app offers at all.
--
-- The transactions row was never the weak point. enforce_transaction_update
-- refuses any edit by the owner once the status leaves awaiting_payment or
-- rejected, so proof_url is frozen at verification. Only the bytes it pointed
-- at were loose.
--
-- The guard is the delete policy's, word for word, so the two cannot drift
-- apart again. pending_verification is included deliberately: once a proof is
-- with the branch it must sit still while it is being looked at, and a
-- rejection is what reopens it for resubmission.

drop policy if exists "owner replaces own proof" on storage.objects;

create policy "owner replaces own unverified proof" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.transactions t
      where t.proof_url = objects.name
        and t.status in ('verified', 'pending_verification')
    )
  )
  with check (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.transactions t
      where t.proof_url = objects.name
        and t.status in ('verified', 'pending_verification')
    )
  );

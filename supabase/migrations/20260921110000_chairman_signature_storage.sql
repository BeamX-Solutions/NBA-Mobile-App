-- Storage for the chairman's signature.
--
-- branches.chairman_signature_url has existed since the initial schema and
-- nothing ever wrote or read it. The certificate PDF prints the chairman's
-- name over a rule and leaves the space above it empty, so every certificate
-- this system has issued is unsigned.
--
-- SPEC.md blocking question 7 asked who uploads the signature and what happens
-- when the chairmanship changes. It was never answered, so this migration
-- answers it in the only way the rest of the model supports, and states the
-- answer here so it is not rediscovered by guesswork.
--
-- WHO UPLOADS. The branch administrator, for their own branch, and the super
-- administrator for any. The alternative, routing it through the platform
-- operator, makes every chairmanship change a support request, and a branch
-- that cannot replace its own chairman's signature on the day the chairman
-- changes will keep issuing certificates over the wrong name rather than wait.
-- The branch already edits chairman_name under the existing branches update
-- policy, and a name without a signature is the same claim made in a thinner
-- form, so splitting custody between the two would protect nothing.
--
-- WHAT A CHAIRMANSHIP CHANGE DOES. Nothing, to certificates already issued.
-- The signature is read at the moment a PDF is generated, so a reissued PDF of
-- an old certificate will carry the current chairman's signature rather than
-- the one in office when it was issued. That is a known limitation and it is
-- acceptable only because the signature is not what makes the certificate
-- good: the RBIN is, and verify_rbin is what a land registry checks. Were the
-- signature ever to become the thing relied on, it would have to be captured
-- onto the certificate row at issuance instead.
--
-- WHY THE BUCKET IS PRIVATE, AND WHY THAT IS WORTH LESS THAN IT LOOKS. Read
-- access is limited to authenticated users, which stops anonymous scraping of
-- every branch chairman's signature from a public URL. It does not stop a
-- practitioner obtaining one, and cannot: the signature is printed on every
-- certificate they download. Anyone who holds a certificate holds the
-- signature. This is the ordinary position for a signature on a document and
-- is precisely why the certificate says, in its own text, that a printed copy
-- proves nothing on its own.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'signatures',
  'signatures',
  false,
  2097152, -- 2MB. A signature is a small transparent PNG; anything larger is a
           -- scan that should have been cropped, and it has to travel inside
           -- the certificate HTML as a data URI.
  array['image/png', 'image/jpeg']
)
on conflict (id) do nothing;

-- Addressed as {branch_id}/signature.{ext}, so the leading folder is the
-- branch and the policies can match on it exactly as the proofs bucket
-- matches on the owner's user id.

create policy "branch admin uploads own signature" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'signatures'
    and (
      public.current_user_role() = 'super_admin'
      or (
        public.current_user_role() = 'branch_admin'
        and (storage.foldername(name))[1] = public.current_user_branch()::text
      )
    )
  );

-- Replacing is the ordinary path, not the exception: a chairmanship changes
-- and the branch uploads over the same path. The client uploads with upsert,
-- so without this a replacement fails and the old chairman's signature stays
-- on every certificate issued afterwards.
create policy "branch admin replaces own signature" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.current_user_role() = 'super_admin'
      or (
        public.current_user_role() = 'branch_admin'
        and (storage.foldername(name))[1] = public.current_user_branch()::text
      )
    )
  )
  with check (
    bucket_id = 'signatures'
    and (
      public.current_user_role() = 'super_admin'
      or (
        public.current_user_role() = 'branch_admin'
        and (storage.foldername(name))[1] = public.current_user_branch()::text
      )
    )
  );

create policy "branch admin removes own signature" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.current_user_role() = 'super_admin'
      or (
        public.current_user_role() = 'branch_admin'
        and (storage.foldername(name))[1] = public.current_user_branch()::text
      )
    )
  );

-- Every authenticated user reads. A practitioner has to fetch the signature of
-- the branch that issued their certificate in order to render the PDF, and
-- restricting it to their own branch would break the moment a practitioner
-- holds a certificate from a branch they have since left. See the note above
-- on why this discloses less than it appears to.
create policy "authenticated users read signatures" on storage.objects
  for select to authenticated
  using (bucket_id = 'signatures');

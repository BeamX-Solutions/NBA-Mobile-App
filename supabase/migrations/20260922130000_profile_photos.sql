-- Profile photos.
--
-- The Edit Profile screen has carried a "Change Photo" button since the
-- designs were implemented, under a note reading "JPG, GIF or PNG. Max size of
-- 2MB." Its handler was `() => undefined`. There was no column to store a
-- photo in, no bucket to put one in, and expo-image-picker was installed and
-- granted a permission string in app.json without ever being imported. The
-- control was drawn because the mockup had one.
--
-- WHY THIS BUCKET IS PUBLIC, WHEN PROOFS AND SIGNATURES ARE NOT.
--
-- A proof of payment carries account numbers and client names, and a
-- chairman's signature is the mark that appears on a certificate. Both are
-- private, and reading one is mediated by a signed URL drawn at the moment it
-- is needed.
--
-- A profile photo is neither. It is a picture somebody chose to put on their
-- own profile, shown beside their name to the administrator of their own
-- branch. The practical difference is that avatars are rendered in lists:
-- signing them would mean a round trip per row on every roster, and the
-- signature would expire while the page sat open. The path is keyed by the
-- account's uuid, so a public object is not enumerable without already knowing
-- the id of the person whose photo it is.
--
-- The write side is not public. Only the owner may put a file in their own
-- folder, which is the same rule the proofs bucket uses.

alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
  'Object path in the avatars bucket, as {user_id}/avatar.{ext}. Null means no photo, and the interface falls back to initials.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2MB, matching the limit the Edit Profile screen has always stated.
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Addressed as {user_id}/avatar.{ext}, so the leading folder is the owner and
-- the policies match on it exactly as the proofs bucket does.

create policy "owner uploads own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Replacing is the ordinary path: somebody changing their photo uploads over
-- the same object. The client uploads with upsert, so without this a second
-- photo would fail and the first would be permanent.
create policy "owner replaces own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owner removes own avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

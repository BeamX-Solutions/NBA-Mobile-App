import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

/**
 * The practitioner's profile photo.
 *
 * The Edit Profile screen has offered a "Change Photo" button since the
 * designs were built, wired to a handler that did nothing. This is what it
 * does now.
 *
 * The bucket is public, unlike proofs and signatures. A photo somebody chose
 * to put on their own profile is not a bank slip, and avatars are rendered in
 * lists: a signed URL would mean a round trip per row and would expire while
 * the page sat open. The object path is keyed by the account's uuid, so it is
 * not enumerable by anyone who does not already know whose photo they are
 * looking for.
 */

/** Matches the bucket's own constraint, and the hint the screen has always shown. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export class AvatarError extends Error {}

/**
 * Asks for a photo, uploads it, and returns the stored object path.
 *
 * Returns null when the picker was dismissed, which is not a failure and
 * should leave the screen exactly as it was.
 */
export async function pickAndUploadAvatar(userId: string): Promise<string | null> {
  // Requested at the point of use rather than at launch. A permission prompt
  // on first open, before anyone has asked for anything, is the kind a person
  // denies out of hand, and a denial is sticky.
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new AvatarError(
      'Photo access was not granted. You can allow it in your device settings.'
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // Square, because every surface that shows an avatar shows it in a circle.
    // Cropping here means the person chooses what is inside the circle rather
    // than discovering that the top of their head was cut off.
    allowsEditing: true,
    aspect: [1, 1],
    // Re-encoded well below the 2MB limit. A modern phone camera produces
    // several megabytes, which would be refused by the bucket after the
    // upload had already spent the person's data.
    quality: 0.7,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];

  // The picker reports the type of what was chosen, not of what it wrote after
  // editing, and re-encoding usually produces JPEG. The extension follows the
  // mime type where one is given, and falls back to jpg rather than to the
  // filename, which for a camera roll item is often a uuid with no extension.
  const mime = asset.mimeType ?? 'image/jpeg';
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/avatar.${extension}`;

  const response = await fetch(asset.uri);
  const body = await response.arrayBuffer();

  if (body.byteLength > MAX_AVATAR_BYTES) {
    throw new AvatarError('That photo is larger than 2MB even after compression.');
  }

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, body, { upsert: true, contentType: mime });

  if (uploadError) {
    throw new AvatarError(`The photo could not be uploaded. ${uploadError.message}`);
  }

  // Written after the upload succeeds, never before: a column pointing at an
  // object that is not there renders as a broken image everywhere at once.
  const { error: linkError } = await supabase
    .from('profiles')
    .update({ avatar_url: path })
    .eq('id', userId);

  if (linkError) {
    throw new AvatarError(`The photo was uploaded but not saved. ${linkError.message}`);
  }

  return path;
}

/**
 * A URL an <Image> can load, or null where there is no photo.
 *
 * The cache buster matters. Replacing a photo writes over the same path, so
 * without it the old image stays on screen until the app is restarted, and the
 * person concludes the upload failed.
 */
export function avatarUrl(path: string | null | undefined, version?: string | null): string | null {
  if (path === null || path === undefined || path === '') return null;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return version ? `${data.publicUrl}?v=${encodeURIComponent(version)}` : data.publicUrl;
}

/** Removes the photo and clears the column, in that order's reverse. */
export async function removeAvatar(userId: string, path: string): Promise<void> {
  // Column first. An orphaned object with no photo shown is recoverable; a
  // column pointing at a deleted object is a broken image on every screen.
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
  if (error) throw new AvatarError(`The photo could not be removed. ${error.message}`);
  await supabase.storage.from('avatars').remove([path]);
}

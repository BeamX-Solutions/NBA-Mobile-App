import { supabase } from '@/lib/supabase';

/**
 * The issuing branch chairman's signature, as a data URI for the certificate.
 *
 * expo-print renders the certificate from an HTML string with no base URL, so
 * it cannot resolve a remote src: the image has to travel inside the markup,
 * the same way the seal does in lib/seal.ts. The difference is that the seal
 * is a fixed asset compiled into the bundle, while this one is per branch and
 * changes when the chairmanship does, so it is fetched at print time.
 *
 * The bucket is private, so a signed URL is drawn first. Sixty seconds is
 * ample: the URL is used immediately, by this function, and never handed to
 * anything that outlives the call.
 */

/** Where a branch's signature lives. The policies match on the leading folder. */
export function signaturePath(branchId: string, extension: string): string {
  return `${branchId}/signature.${extension}`;
}

/**
 * Returns a `data:` URI, or null if there is no signature or it cannot be
 * read.
 *
 * Null rather than throwing, and deliberately so. A missing signature must not
 * stop a certificate being produced: the document's authority rests on the
 * RBIN and the public check, not on the image, and a practitioner who cannot
 * download their certificate because a branch has not uploaded a PNG has been
 * failed by the wrong part of the system. The template falls back to the
 * printed name over a rule, which is what every certificate carried before.
 */
export async function signatureDataUri(path: string | null): Promise<string | null> {
  if (path === null || path.trim() === '') return null;

  try {
    const { data: signed, error } = await supabase.storage
      .from('signatures')
      .createSignedUrl(path, 60);

    if (error || signed === null) return null;

    const response = await fetch(signed.signedUrl);
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Chunked rather than String.fromCharCode(...bytes) in one call: spreading
    // a 2MB image across the argument list overflows the call stack on both
    // engines, and the failure looks like a corrupt image rather than a crash.
    let binary = '';
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }

    const mime = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

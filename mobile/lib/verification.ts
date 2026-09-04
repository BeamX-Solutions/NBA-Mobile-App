/**
 * Public verification of a Certificate of Compliance.
 *
 * SPEC.md question 9: without a way for a third party to confirm a certificate
 * is genuine, the document is trivially forgeable and the product's core value
 * disappears. A land registry or opposing counsel scans the QR code, or types
 * the RBIN into the page, and gets an answer without needing an account.
 */

/**
 * Base URL of the public verification page.
 *
 * Points at the app's own web build for now. When the NBA Remuneration Portal
 * hosts the page instead, change this one constant: the QR codes already
 * printed on issued certificates will keep working only if the path shape
 * stays `/verify/{RBIN}`, so preserve that.
 */
const VERIFICATION_BASE_URL =
  process.env.EXPO_PUBLIC_VERIFICATION_URL ?? 'https://nbalegalfees.org.ng';

/**
 * The URL encoded into a certificate's QR code.
 *
 * The RBIN contains forward slashes (NBA/2026/00042), so it must be percent
 * encoded or the path segments break.
 */
export function verificationUrlFor(rbin: string): string {
  return `${VERIFICATION_BASE_URL}/verify/${encodeURIComponent(rbin)}`;
}

/** Shape returned by the verify_rbin database function. */
export interface VerificationResult {
  found: boolean;
  rbin: string;
  practitioner_name: string;
  scn: string | null;
  document_type: string;
  branch_name: string;
  issued_at: string;
  certificate_number: string;
  revoked: boolean;
  revocation_reason: string | null;
}

/**
 * Product naming and attribution, in one place.
 *
 * These are collected here because the scope of the project is expected to
 * change: it is commissioned by the NBA Anaocha Branch now, with national
 * rollout as the ambition. When that happens the attribution below becomes a
 * one line edit instead of a hunt through screens.
 *
 * On the attribution wording specifically: the app carries the NBA seal
 * legitimately, since a branch is part of the Association. What it should not
 * yet claim is national endorsement, so it is attributed to the branch rather
 * than described as "powered by the Nigerian Bar Association". Widen it once
 * the national body formally adopts it.
 */

/** Display name. Also used for the app store listing. */
export const PRODUCT_NAME = 'NBA Legal Fees';

/** One line description, shown on the splash and login screens. */
export const PRODUCT_TAGLINE = 'Fee computation and compliance for legal practitioners.';

/** Footer attribution. Scope this up when the national body adopts the app. */
export const ATTRIBUTION = 'An initiative of the NBA Anaocha Branch';

/**
 * The instrument the fee scale comes from.
 *
 * SPEC.md section 10: this is NOT an NBA instrument. It is made under section
 * 15(3) of the Legal Practitioners Act by the Legal Practitioners Remuneration
 * Committee, chaired by the Attorney General of the Federation. Describing it
 * as an NBA order on a certificate a land registry may rely on is a defect,
 * not a wording preference.
 */
export const ORDER_FULL_NAME =
  'Legal Practitioners (Remuneration for Business, Legal Services and Representation) Order, 2023';

/** Short form for tight spaces such as the calculator result card. */
export const ORDER_SHORT_NAME = 'Legal Practitioners (Remuneration) Order, 2023';

/**
 * Wording used on the Certificate of Compliance, at the branch's instruction
 * of 4 September 2026.
 *
 * The branch's own certificate recites the "Branch Remuneration Order", and
 * that is the phrasing it wants on the document it issues. It is kept separate
 * from ORDER_FULL_NAME rather than replacing it, because the calculator still
 * cites the statutory instrument: the fee scale genuinely is the Legal
 * Practitioners (Remuneration) Order, made by the Legal Practitioners
 * Remuneration Committee rather than by the Association, and a practitioner
 * checking where a figure comes from should be told the truth.
 *
 * So the certificate recites the branch's own compliance regime, and the
 * calculator cites the instrument the numbers come from. The two are different
 * claims and now have different constants.
 */
export const CERTIFICATE_ORDER_NAME = 'Branch Remuneration Order';

// The public verification URL lives in lib/verification.ts, alongside the
// result type returned by the verify_rbin database function.

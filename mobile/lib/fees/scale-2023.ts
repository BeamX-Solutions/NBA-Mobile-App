import type { FeeScale } from './types';

const NAIRA = 100;
const MILLION = 1_000_000 * NAIRA;

/**
 * Scale 4 of the Legal Practitioners (Remuneration) Order, 2023.
 *
 * Ported from the NBA Remuneration Portal, src/lib/constants.ts, which is the
 * implementation currently in use. The portal expresses each scale as a
 * running total ("₦5,000,000 + 5% of the amount above ₦50M"); here the same
 * arithmetic is expressed as marginal bands, which produces identical results
 * and lets the engine show its working line by line.
 *
 * Equivalence for 4A, as a worked check:
 *   portal:  amount <= 100M  ->  5,000,000 + (amount - 50M) * 0.05
 *   bands:   50M * 10%       =   5,000,000, then (amount - 50M) * 5%
 *
 * Every figure is integer kobo.
 */
export const scale2023: FeeScale = {
  id: 'order-2023-scale-4',
  orderName: 'Legal Practitioners (Remuneration for Business, Legal Services and Representation) Order, 2023',
  effectiveFrom: '2023-05-16',

  bands: {
    // Scale 4A, conveyancing and assignments.
    '4A': [
      { min: 0, max: 50 * MILLION, percentage: 10 },
      { min: 50 * MILLION, max: 100 * MILLION, percentage: 5 },
      { min: 100 * MILLION, max: null, percentage: 3 },
    ],

    // Scale 4B, mortgages.
    '4B': [
      { min: 0, max: 50 * MILLION, percentage: 4 },
      { min: 50 * MILLION, max: 100 * MILLION, percentage: 3 },
      { min: 100 * MILLION, max: null, percentage: 2 },
    ],

    // Scale 4C, leases and tenancies, charged on ANNUAL RENT.
    //
    // SUSPECT: the portal charges 5% both between ₦5M and ₦10M and above
    // ₦10M, which makes the ₦10M boundary arithmetically inert. Confirmed
    // with the client as unverified rather than intentional, so it is
    // reproduced exactly here to keep the app and the portal in agreement,
    // and must be checked against the published Schedule before launch.
    // If the top rate turns out to differ, only this array changes.
    // See DESIGN_REVIEW.md, "Scale 4C boundary".
    '4C': [
      { min: 0, max: 5 * MILLION, percentage: 10 },
      { min: 5 * MILLION, max: 10 * MILLION, percentage: 5 },
      { min: 10 * MILLION, max: null, percentage: 5 },
    ],
  },

  // The rates come from the portal, not from a line by line reading of the
  // published Schedule, and 4C carries a known discrepancy. Until both are
  // verified the UI keeps warning that the figures are provisional.
  isProvisional: true,
};

/**
 * Portion of the professional fee payable to the branch.
 *
 * Set to 2% by the branch on 4 September 2026, down from the 10% placeholder.
 *
 * The basis is unchanged: 2% of the professional fee the calculator computes,
 * not 2% of the consideration. On a ₦3,600,000 assignment that is ₦7,200
 * rather than ₦72,000, so the two readings differ by a factor of ten and the
 * branch should confirm which was meant.
 */
export const BRANCH_SHARE_PERCENTAGE = 2;

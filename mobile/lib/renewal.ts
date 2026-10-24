/**
 * When a practitioner is offered renewal.
 *
 * In the last 7 days of a subscription. Short on purpose: a monthly plan lasts
 * about 30 days, so a longer window would offer renewal from the day it was
 * bought. Before the window, offering Renew Now to somebody who has just paid
 * reads as though the payment did not take. Paying
 * early is still safe, because the server adds the new term after the current
 * expiry, so this decides only what is offered, not what is allowed.
 *
 * Mirrors the practitioner web app's lib/subscriptions/renewal.ts. If one
 * changes, so must the other.
 */

export const RENEWAL_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment renewal is first offered, or null for an unreadable date. */
export function renewalOpensAt(expiresAt: string): Date | null {
  const expiry = new Date(expiresAt).getTime();
  return Number.isNaN(expiry) ? null : new Date(expiry - RENEWAL_WINDOW_DAYS * DAY_MS);
}

export function canRenew(expiresAt: string, now: Date = new Date()): boolean {
  const opens = renewalOpensAt(expiresAt);
  return opens === null || opens.getTime() <= now.getTime();
}

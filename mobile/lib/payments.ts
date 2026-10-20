import type { Transaction } from '@/lib/database.types';
import { palette } from '@/theme/tokens';

/**
 * The two halves of a practitioner's money, as the Payments screen shows them.
 *
 * Pay-in is the client paying the professional fee into the branch account,
 * and the branch verifying it. Payout is the branch sending the practitioner
 * their share. A payout is Confirmed once the branch records the transfer
 * with the bank's receipt: that is the confirmation, decided with the client
 * on 20 October 2026, and there is no step for the practitioner to take.
 *
 * Mirrored in NBA-WEB-APP/lib/payments. If one changes, so must the other.
 */

export interface Tone {
  label: string;
  surface: string;
  color: string;
}

const success = { surface: palette.successSurface, color: palette.success };
const warning = { surface: palette.accentSurface, color: palette.accentText };
const neutral = { surface: palette.neutralSurface, color: palette.neutralText };
const danger = { surface: palette.dangerSurface, color: palette.danger };

export function payInStatus(status: Transaction['status']): Tone {
  switch (status) {
    case 'awaiting_payment':
      return { label: 'Awaiting payment', ...warning };
    case 'pending_verification':
      return { label: 'Being verified', ...neutral };
    case 'verified':
      return { label: 'Received', ...success };
    case 'rejected':
      return { label: 'Rejected', ...danger };
  }
}

/** Null when there is no payout to speak of yet: the pay-in is not verified. */
export function payoutStatus(
  transaction: Pick<Transaction, 'status' | 'remitted_at' | 'due_to_practitioner'>,
): Tone | null {
  if (transaction.status !== 'verified' || transaction.due_to_practitioner <= 0) return null;
  return transaction.remitted_at === null
    ? { label: 'Pending', ...warning }
    : { label: 'Confirmed', ...success };
}

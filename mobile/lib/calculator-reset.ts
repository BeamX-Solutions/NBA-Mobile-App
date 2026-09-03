/**
 * One-shot signal that the calculator should clear itself.
 *
 * Once a calculation has become a transaction it lives in Transactions, with a
 * reference number and a place in the pipeline. Leaving it filled in on the
 * calculator invites the practitioner to generate a second receipt for the
 * same document — which the database would happily accept, drawing another
 * sequence number and leaving the branch with two references for one payment.
 *
 * A module-level flag rather than a context or a param: the tab screen stays
 * mounted while the receipt flow runs above it, so there is no re-mount to
 * hang a reset on, and the calculator has no other reason to know that the
 * receipt screen exists.
 *
 * Consuming it clears it, so the reset happens exactly once. Returning to the
 * calculator a second time leaves whatever the practitioner has since typed
 * alone.
 */
let pending = false;

/** Called when a transaction has actually been created, not when one is attempted. */
export function requestCalculatorReset(): void {
  pending = true;
}

/** Returns whether a reset is owed, and clears the request. */
export function consumeCalculatorReset(): boolean {
  if (!pending) {
    return false;
  }
  pending = false;
  return true;
}

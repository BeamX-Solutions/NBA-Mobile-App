/**
 * Money handling.
 *
 * Every amount in this app is an integer number of kobo. Naira are a display
 * concern only. Floating point never touches a currency value, because
 * 0.1 + 0.2 style drift on a fee a lawyer is about to charge a client is not
 * an acceptable failure mode.
 */

/** One naira in kobo. */
export const KOBO_PER_NAIRA = 100;

export function nairaToKobo(naira: number): number {
  return Math.round(naira * KOBO_PER_NAIRA);
}

export function koboToNaira(kobo: number): number {
  return kobo / KOBO_PER_NAIRA;
}

/**
 * Formats kobo as naira for display, with thousands separators.
 * Kobo are shown only when the amount is not a whole number of naira, which
 * keeps the common case (whole naira fees) uncluttered.
 */
export function formatNaira(kobo: number, options?: { showSymbol?: boolean }): string {
  const showSymbol = options?.showSymbol ?? true;
  const negative = kobo < 0;
  const absolute = Math.abs(kobo);

  const whole = Math.floor(absolute / KOBO_PER_NAIRA);
  const remainder = absolute % KOBO_PER_NAIRA;

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = remainder === 0
    ? grouped
    : `${grouped}.${remainder.toString().padStart(2, '0')}`;

  return `${negative ? '-' : ''}${showSymbol ? '₦' : ''}${body}`;
}

/**
 * Groups a currency field's text as it is typed, so 45000000 reads as
 * 45,000,000 rather than a wall of digits.
 *
 * A fee is charged on a consideration that routinely runs to eight or nine
 * figures, and an unseparated number that long cannot be checked at a glance.
 * Getting it wrong by a factor of ten produces a plausible fee, which is worse
 * than an obviously absurd one.
 *
 * Deliberately permissive rather than validating: this runs on every
 * keystroke, so a partial entry has to survive it. A trailing decimal point is
 * kept, because "1,234." is a moment on the way to "1,234.50" and stripping it
 * would fight the user mid-word.
 *
 * The output is always something parseNairaInput accepts, since that strips
 * the separators back out.
 */
export function groupNairaInput(input: string): string {
  // Digits and dots only. Anything else a keyboard offers is dropped rather
  // than rejected, so pasting "₦45,000,000.00" works.
  const cleaned = input.replace(/[^\d.]/g, '');

  const firstDot = cleaned.indexOf('.');
  const whole = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  // Later dots are discarded rather than treated as separators, and kobo are
  // capped at two places.
  const fraction =
    firstDot === -1 ? null : cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);

  // Leading zeros go, but a lone "0" stays so "0.5" can be typed.
  const significant = whole.replace(/^0+(?=\d)/, '');
  const grouped = significant.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return fraction === null ? grouped : `${grouped}.${fraction}`;
}

/**
 * Parses free text from a currency input into kobo.
 * Accepts grouped digits and an optional decimal part, for example
 * "45,000,000" or "1,200.50". Returns null when the text is not a usable
 * amount, so callers can show a validation message rather than calculating
 * on a silently coerced zero.
 */
export function parseNairaInput(input: string): number | null {
  const cleaned = input.replace(/[\s,₦]/g, '');
  if (cleaned === '') {
    return null;
  }
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned)) {
    return null;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return nairaToKobo(value);
}

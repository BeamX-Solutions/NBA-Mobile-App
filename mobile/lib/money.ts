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

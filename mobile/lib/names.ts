/**
 * Name handling for greetings and salutations.
 *
 * Practitioners register their full name as it appears on the Call to Bar
 * certificate, which usually carries a title ("Barr. Oluwaseun Adebayo").
 * Taking the first word verbatim would greet someone as "Barr.", so
 * recognised honorifics are skipped.
 */
const HONORIFICS = new Set([
  'barr',
  'barrister',
  'mr',
  'mrs',
  'miss',
  'ms',
  'dr',
  'chief',
  'prof',
  'professor',
  'sir',
  'lady',
  'hon',
  'honourable',
  'esq',
  'san',
]);

/** Strips a trailing full stop so "Barr." and "Barr" compare equal. */
function normalise(word: string): string {
  return word.toLowerCase().replace(/\.+$/, '');
}

/**
 * First name suitable for a greeting, or null when there is not one.
 *
 * Returns null rather than a fallback string so the caller decides what to
 * show; a greeting is not the right place to invent a name.
 */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const words = (fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  const name = words.find((word) => !HONORIFICS.has(normalise(word)));
  return name ?? null;
}

/** Time-of-day greeting. Hour is 0 to 23, as from Date.getHours(). */
export function greetingFor(hour: number): string {
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 17) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

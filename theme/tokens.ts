/**
 * Design tokens read off the supplied mockups.
 *
 * The mockups are a single light theme, so this file defines one palette
 * rather than a light and dark pair. If a dark theme is wanted later, add a
 * second palette here and select between them, so screens keep referencing
 * token names instead of raw hex values.
 */

export const palette = {
  /** Buttons, headings, active tab, certificate border. */
  primary: '#0B5D33',
  primaryPressed: '#084526',
  /** Heading text on the splash and section titles, slightly lighter. */
  primaryText: '#0E6B3A',

  /** Active tab pill and the "Awaiting Payment" badge. */
  accent: '#F5C33B',
  accentSurface: '#FDF3D4',
  accentText: '#8A6100',

  background: '#F7F8F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F4F2',
  border: '#E3E6E3',
  borderStrong: '#C9CFCA',

  /** Dimming layer behind modal sheets. */
  scrim: 'rgba(17, 24, 19, 0.45)',

  text: '#1A1A1A',
  textMuted: '#6B7280',
  textInverse: '#FFFFFF',
  textDisabled: '#9CA3AF',

  /** Verified badge. */
  success: '#1B8A4B',
  successSurface: '#E6F4EC',
  /** Pending verification badge. */
  neutralSurface: '#EDEFED',
  neutralText: '#6B7280',
  /** Destructive actions such as Log Out, and validation errors. */
  danger: '#C2371F',
  dangerSurface: '#FBEAE7',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  input: 8,
  button: 10,
  card: 12,
  pill: 999,
} as const;

export const fontSize = {
  caption: 12,
  label: 14,
  body: 15,
  bodyLarge: 16,
  title: 20,
  heading: 24,
  display: 30,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Type families, matched to the NBA Remuneration Portal so the two products
 * read as one system: Playfair Display for headings, Source Sans 3 for body.
 * (The portal also loads Fraunces as a display face, used sparingly on
 * marketing pages that have no counterpart in the app.)
 *
 * Use these rather than fontWeight on text that also sets fontFamily. React
 * Native does not synthesise weights for a custom family: it picks the file
 * whose name it is given, so asking for Source Sans 3 at weight 700 without
 * loading the bold file renders regular. Naming the exact face avoids that.
 */
export const fontFamily = {
  heading: 'PlayfairDisplay_600SemiBold',
  headingBold: 'PlayfairDisplay_700Bold',
  body: 'SourceSans3_400Regular',
  bodyMedium: 'SourceSans3_500Medium',
  bodySemibold: 'SourceSans3_600SemiBold',
  bodyBold: 'SourceSans3_700Bold',
} as const;

/**
 * Transaction status presentation. Keys match the transaction_status enum in
 * the database, so a status coming off the wire maps directly to its badge.
 */
export const statusStyles = {
  awaiting_payment: {
    label: 'Awaiting Payment',
    surface: palette.accentSurface,
    text: palette.accentText,
    accent: palette.accent,
  },
  pending_verification: {
    label: 'Pending Verification',
    surface: palette.neutralSurface,
    text: palette.neutralText,
    accent: palette.borderStrong,
  },
  verified: {
    label: 'Verified',
    surface: palette.successSurface,
    text: palette.success,
    accent: palette.success,
  },
  rejected: {
    label: 'Rejected',
    surface: palette.dangerSurface,
    text: palette.danger,
    accent: palette.danger,
  },
} as const;

export type TransactionStatus = keyof typeof statusStyles;

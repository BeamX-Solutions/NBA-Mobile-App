# Working in mobile/

## The SDK version is pinned deliberately. Do not raise it.

This app targets **Expo SDK 54**. That is a decision, not neglect, and the
newest Expo docs will disagree with this codebase.

Expo Go ships as a single pre-built app containing exactly one SDK, and it lags
the latest release. The authoritative source is
`https://exp.host/--/api/v2/versions/latest`, whose `expoGoSdkVersion` field is
what Expo Go can actually open. Anything newer cannot be opened in Expo Go at
all.

Staying on 54 keeps the scan-the-QR workflow working without an Apple Developer
account, which matters because installing a development build on a physical
iPhone requires the paid membership.

**Read the docs for the SDK this project is on**, at
`https://docs.expo.dev/versions/v54.0.0/`, not the latest. Check
`expoGoSdkVersion` before proposing any SDK change, rather than assuming Expo Go
tracks the newest release.

This pin is temporary in principle: shipping to either store needs a
development build regardless, since Expo Go cannot be submitted. Move to EAS
development builds when device testing needs native modules Expo Go lacks, or
when preparing for release — and change this file at the same time.

## Two traps that compile cleanly and fail on a device

**Icons come from `@expo/vector-icons`, never `expo-symbols`.** expo-symbols
wraps SF Symbols, an Apple technology. On SDK 54 it renders only a `fallback`
prop on Android, so tab icons silently vanish there while still typechecking.

**Money is integer kobo everywhere.** Every money column is `bigint` and every
amount in the app is kobo. Naira exist only at the display layer, in
`lib/money.ts`. Floating point must never touch a currency value.

## Where the boundaries are

Row level security in `supabase/migrations/` is the access control, not this
app. Screens must still scope their own queries: RLS is a ceiling on what a
query *may* return, and for a branch administrator that ceiling is the whole
branch. A personal screen that omits `.eq('user_id', ...)` will render other
people's records.

Administrators do not use this app. They are turned away at the root layout and
work in `web/`, the Next.js branch console.

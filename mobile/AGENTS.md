# Working in mobile/

## Track the latest Expo SDK. Do not pin to an older one.

This app targets **Expo SDK 57**, and it has to keep moving as Expo releases.

Expo Go is a single pre-built app that contains exactly one SDK, and on iOS
**only the latest version can be installed** — there is no way to install an
older Expo Go on a device. So a project pinned to an older SDK does not merely
lag; it becomes unopenable the moment Expo Go updates, with:

> Project is incompatible with this version of Expo Go.
> The installed version of Expo Go is for SDK X. The project you opened uses SDK Y.

This happened here: the project sat on SDK 54 while Expo Go moved to 57, and
the QR workflow stopped working entirely. An earlier version of this file had
the reasoning backwards, claiming the pin protected the Expo Go workflow. It
did the opposite.

Check `https://exp.host/--/api/v2/versions/latest` for the current SDK, and
read the docs for the SDK this project is actually on
(`https://docs.expo.dev/versions/v57.0.0/`), not whatever a search returns.

The alternative to chasing Expo Go is an **EAS development build**, which pins
the runtime to the project rather than the other way round. That is the right
answer before release — Expo Go cannot be submitted to either store — and it
needs a paid Apple Developer membership for physical iPhones. Until then,
upgrading promptly is the cheaper option.

### Upgrading

```sh
npm install expo@^<next>.0.0
npx expo install --fix   # aligns every Expo-managed package
npx expo-doctor          # 21 checks; all should pass
```

Then `npx tsc --noEmit`, `npx jest`, and `npx expo export --platform android`.
Confirm the dev server advertises the right runtime before trusting it:

```sh
curl -s -H 'expo-platform: ios' http://localhost:8081/ | grep -o 'exposdk:[0-9.]*'
```

Two things the 54 to 57 upgrade needed that the tooling did not do for us:
`StyleSheet.absoluteFillObject` was removed from React Native 0.86, and
`expo-modules-core` had to be declared explicitly because npm nested it under
`expo/` where jest-expo's preset could not resolve it.

## Two traps that compile cleanly and fail on a device

**Icons come from `@expo/vector-icons`, never `expo-symbols`.** expo-symbols
wraps SF Symbols, an Apple technology. It renders only a `fallback` prop on
Android, so tab icons silently vanish there while still typechecking.

**Money is integer kobo everywhere.** Every money column is `bigint` and every
amount in the app is kobo. Naira exist only at the display layer, in
`lib/money.ts`. Floating point must never touch a currency value.

## Two traps in React that only fail at runtime

**Every hook goes above every early return.** React identifies a hook by its
position in the call order, so a `useState` below a loading guard exists on
some renders and not others, and the component crashes the moment it stops
loading. This shipped once in `app/certificate/[id].tsx` and stayed invisible
because a broken query kept the screen permanently on the loading path.

**Name the foreign key on every PostgREST embed through `transactions`.** That
table references `profiles` twice, through `user_id` and `verified_by`, so a
bare `profiles(...)` is ambiguous and the whole query is rejected with
PGRST201. Write `profiles!transactions_user_id_fkey(...)`.

## Where the boundaries are

Row level security in `supabase/migrations/` is the access control, not this
app. Screens must still scope their own queries: RLS is a ceiling on what a
query *may* return, and for a branch administrator that ceiling is the whole
branch. A personal screen that omits `.eq('user_id', ...)` will render other
people's records.

Administrators do not use this app at all. They are turned away at the root
layout and work in `web/`, the Next.js branch console.

`EXPO_PUBLIC_*` values are inlined at bundle time, not read at runtime. Metro
must be restarted after changing `.env`, and a store build has them baked in.

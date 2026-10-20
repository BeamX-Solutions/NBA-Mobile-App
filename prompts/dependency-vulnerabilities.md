# Fix the vulnerable dependencies Dependabot reports

## Goal

Dependabot reports 40 alerts on `main` (3 critical, 20 high, 15 moderate, 2 low). Fix the ones that matter, using the smallest safe updates. Record why the rest are left alone.

Branch: `fix/dependency-vulnerabilities`, from `main`. No Expo SDK upgrade. Next.js moves only within 16.x, and only with your approval (decision 1). Lockfiles are committed. Nothing is committed by me; commit messages are at the end.

## How this was investigated

- `npm audit --json` in `mobile/`, `web/` and `supabase/tests/`. This reads the same GitHub advisory database as Dependabot.
- I couldn't read the Dependabot list itself: `gh` is not signed in on this machine (`gh auth login`). The two sources usually agree, but the Dependabot count may differ slightly from the counts here.
- `npm ls <pkg> --all` traced which package pulls in each vulnerable one.
- `npm view` checked whether a patched release exists.
- I searched the console's code for the affected Next.js features.

## Why the totals look worse than they are

npm audit counts 70 entries in `mobile/` and 9 in `web/`. Almost all of them come from about a dozen root packages. A package is listed again for every package that depends on it: one `braces` bug, for example, shows up as roughly 40 Jest and Metro entries.

Many of npm's suggested "fixes" are **downgrades**: `expo@44.0.6`, `react-native@0.72.17`, `eslint-config-next@14.2.35`. Those are what `npm audit fix --force` would install. They would break the project and are not being considered.

`supabase/tests/` has **no findings**.

## Root findings, critical and high

| # | Package | Project | Ships to users? | Do we use the vulnerable part? | Fix |
|---|---|---|---|---|---|
| 1 | **next** 16.3.3 (critical, high, moderates) | Admin console | **Yes**, it is the server | **Critical RCE (remote code execution)** in `next/og` ImageResponse: **not used** (no `next/og` anywhere). **High SSRF (server-side request forgery)** in image optimisation: the `/_next/image` endpoint is live because we use `next/image` for two local logos, but we configure no remote image domains. **Cache poisoning / Draft Mode leaks:** we don't use `use cache`, ISR or Draft Mode. | **16.4.2**, a minor update within 16. `eslint-config-next` moves with it to 16.4.2. **Next.js version: needs your OK.** |
| 2 | **sharp** 0.35.4 (high, librsvg) | Admin console | On the server, when Next.js optimises images (self-hosted) | The flaw needs SVG input, and our images are PNG. | Patch to 0.35.5 |
| 3 | **shell-quote** 1.10.0 (critical) | Mobile app | **No.** It comes in through `react-native` → `react-devtools-core`, which runs only in development. | Not in the app bundle. It runs on a developer's machine, on input we supply. | Patch to 1.12.0 |
| 4 | **@xmldom/xmldom** 0.8.14 / 0.9.11 (many high) | Mobile app | **No.** It is used by Expo config plugins at prebuild time. | It parses our own `Info.plist` on the developer machine. No untrusted XML ever reaches it. | Patch to 0.8.15+ / 0.9.12 |
| 5 | **compression** 1.8.1 (high, DoS) | Mobile app | **No.** It is middleware in the Expo dev server (`@expo/cli`). | Only reachable on the local network while `expo start` is running. | Patch to 1.8.2 |
| 6 | **js-yaml** 3.15.1 (high, CPU DoS) | Mobile app | **No.** It comes from Jest's coverage plugin. | It reads our own config files during tests. | Patch to 3.15.2 |
| 7 | **source-map-js** 1.2.1 (high, DoS) | Mobile app and admin console | **No.** PostCSS uses it at build time. | It reads source maps we generate ourselves. | Patch to 1.2.2 |
| 8 | **brace-expansion** 1.1.18 / 5.0.9 (high, DoS) | Mobile app and admin console | **No.** It comes from minimatch in ESLint, Jest and Expo's fingerprinting. | It expands glob patterns we write ourselves. | Patch to 1.1.21 / 5.0.12 |
| 9 | **braces** 3.0.3, via micromatch (high, DoS) | Mobile app and admin console | **No.** Jest, Metro, ESLint and fast-glob use it. | Same as #8: our own patterns. | **No fixed release exists** (3.0.3 is the latest). |
| 10 | **node-forge** 1.4.0 (high, RSA signature check) | Mobile app | **No.** It is used by `@expo/cli` for code-signing certificates. | We don't sign over-the-air updates (`expo-updates` is not installed). | **No fixed release exists** (1.4.0 is the latest). |
| 11 | **react-native, metro, jest, expo, @expo/cli, jest-expo, react-native-reanimated/worklets, @types/jest** (high) | Mobile app | — | These are not separate bugs. They are flagged only because they depend on #3–#10. | Fixed or not fixed along with #3–#10. npm's "fix" is a downgrade. |

The mobile app bundle shipped to phones contains **none** of the critical or high packages. The only one that ships is a **moderate** issue (#12 below).

## Grouping

### (a) Safe to fix now

1. **Admin console:** `next` and `eslint-config-next` 16.3.3 → 16.4.2. This is a minor release, so no breaking changes are expected. It is listed here only if you approve (decision 1).
2. **Admin console:** `npm audit fix` (never `--force`). This picks up sharp 0.35.5, source-map-js 1.2.2 and brace-expansion within their allowed versions.
3. **Mobile app:** `npm audit fix` (never `--force`). This picks up shell-quote, @xmldom/xmldom, compression, js-yaml, source-map-js, brace-expansion and `@expo/metro-file-map`, all within the versions the Expo SDK 57 packages already allow. After it runs, `npx expo install --check` must report every Expo package as aligned. If `npm audit fix` tries to move any `expo-*` or `react-native*` package to a different SDK line, I stop and report back.

### (b) Needs testing (major upgrades), not part of this change

- **Expo SDK 58** (`expo@58.0.14`, with expo-router 58): fixes #12. It is a full SDK upgrade, which you asked to approve separately. Per `mobile/AGENTS.md`, it will be needed soon anyway, because Expo Go will move to SDK 58.
- **Jest 30 / jest-expo 58:** this would clear the Jest-chain entries, but those are dev-only and the root cause (#9) has no fix even in Jest 30. It belongs with the SDK 58 upgrade.

### (c) Can be ignored, with reasons

- **braces / micromatch (#9):** no patched release exists. The package is used only by build, lint and test tools, on glob patterns we write. Recheck when a fix is published.
- **node-forge (#10):** no patched release exists. It is used only by the Expo CLI on a developer machine, for code signing we don't use.
- **sprintf-js / argparse (moderate):** no patched release exists. Dev-only, via js-yaml 3 in Jest.
- **uuid in xcode (moderate):** a prebuild-time tool. The flaw needs a caller-supplied buffer, which xcode never passes.
- **#12, decode-uri-component via expo-router's query-string (moderate, ships in the app):** a crafted, badly-encoded deep link could make the app hang on the user's own device. There is no server or data impact. It is fixed by SDK 58 (group b). Forcing a newer version now would break query-string 7.

## Decisions for you

1. **Approve Next.js 16.3.3 → 16.4.2 for the admin console?** It is a minor release and closes the critical advisory. You asked to be consulted on any Next.js change.
2. **Where is the admin console hosted?** If it is self-hosted rather than on Vercel, the cache-poisoning advisories apply directly and #1 becomes more urgent.

## Security

- `npm audit fix --force` is never run.
- No major version changes. Lockfiles are regenerated by npm and committed.

## Checks

- **Mobile app:** `npx expo install --check`, `npx expo-doctor`, `npx tsc --noEmit`, `npx jest`, `npx expo export --platform android`.
- **Admin console:** `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- **Both:** `npm audit` afterwards. The only findings left should be the ones listed in (b) and (c).
- **supabase/tests:** untouched.

## Manual test

1. **Admin console:** run `npm run dev` in `web/`. Sign in as an admin. Open the Transactions page, one transaction, and Branch Records. The logo images load and approve/reject work.
2. **Mobile app:** run `npx expo start` and open the app in Expo Go. Sign in, open Calculator → New transaction, and a certificate. Confirm the QR code renders.

## Commit messages (for you to run)

Admin console:
```
Update Next.js to 16.4.2 and patch console dependencies

Closes the critical next/og advisory and the image-optimisation SSRF,
both fixed in 16.4.2, a minor release within 16. eslint-config-next
moves with it. npm audit fix patches sharp, source-map-js and
brace-expansion within their existing ranges.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Mobile app:
```
Patch vulnerable mobile build and dev dependencies

npm audit fix, without --force, within the ranges the Expo SDK 57
packages allow: shell-quote, @xmldom/xmldom, compression, js-yaml,
source-map-js and brace-expansion. None of them is in the app bundle.
Left for the SDK 58 upgrade: expo-router's decode-uri-component. Left
with no fix published: braces and node-forge, both build tools only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

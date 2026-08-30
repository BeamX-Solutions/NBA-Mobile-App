# NBA Fee Calculator

Multi-tenant platform for Nigerian legal practitioners and NBA branches: statutory fee calculation, branch fee receipts, payment verification, BAIN issuance and Certificates of Compliance. The full product definition lives in [SPEC.md](SPEC.md); read its section 0 before building anything beyond Phase 1.

## Status

**Mobile app (`mobile/`)**: builds and bundles for iOS and Android. Typecheck clean, 27 fee engine tests passing.

Every supplied mockup screen is implemented. See the build status table in [DESIGN_REVIEW.md](DESIGN_REVIEW.md) for the screen-by-screen mapping and the deliberate deviations.

- Fee calculation engine, pure and dependency free, with marginal band logic and full boundary tests
- Onboarding slides, shown once on first launch and skippable
- Auth: login, registration with an optional branch code, forgot password, email confirmation
- Four tab shell with per-screen headers: Calculator, Transactions, Certificates, Profile
- Calculator with State Band resolution and a full fee breakdown
- Transaction detail with a progress stepper and proof of payment upload
- Certificates list and certificate detail
- Profile, Edit Profile, subscription plans and payment method
- Design tokens extracted from the supplied mockups

- Receipt and Certificate of Compliance PDFs, generated on device and shared
- BAIN issuance and certificate creation, atomic, in a single database function
- Public certificate verification by BAIN, with a QR code, reachable signed out

Not yet built: Paystack payment. Entitlement must be granted by a server side webhook, never by the client, so the payment screen deliberately does not charge.

## BAIN issuance

Approving a submission calls the `issue_bain(uuid)` database function rather than updating the row from the app.

The three effects have to be atomic. A plain status update could leave a transaction verified with no certificate, or consume a sequence number for a certificate that was never created. The function verifies the transaction, draws the BAIN and certificate numbers from `number_sequences`, and inserts the certificate row inside one transaction, holding a `for update` lock on the transaction so two administrators approving simultaneously cannot both mint a number. It refuses to run twice on the same transaction.

It is `security definer` because it must reach `number_sequences` and `certificates`, neither of which any client role can write. Authorisation is therefore checked in the function body: the caller must be an administrator of the branch that owns the transaction.

Formats follow the mockups: BAIN is national (`NBA/2026/00042`), certificate numbers are a separate sequence (`NBA-CC-2026-0042`).

## Public verification

`/verify/{BAIN}` is outside every auth guard, because the people who most need it (a land registry, opposing counsel) will never have an account. Scanning the QR code on a certificate opens it with the BAIN already filled in.

It reads through `verify_bain(text)`, which is granted to `anon` and returns **only** the practitioner, SCN, document type, issuing branch, issue date and revocation status. It never returns the consideration or the names of the parties: anyone holding a BAIN can call it, so it must establish authenticity without disclosing a client's commercial terms.

Set `EXPO_PUBLIC_VERIFICATION_URL` to the deployed web host. The path shape `/verify/{BAIN}` must not change once certificates carrying QR codes have been issued.

## PDFs

Generated on device with `expo-print` and handed to the share sheet, rather than server side as SPEC.md section 3 assumed, because there is no backend yet.

Worth being clear about what that means: **a device-generated certificate is not an authoritative artefact.** Anyone can produce a PDF that looks like one. That is exactly why the QR code and the public lookup exist. The document asserts nothing on its own; the BAIN is what actually gets checked. The templates in `lib/pdf.ts` can be reused unchanged when generation moves server side and certificates are archived to storage.

**The fee figures are placeholders.** See "Provisional data" below. This is the single most important thing to fix.

**Database**: all five migrations applied to the hosted Supabase project and verified. RLS is enabled on all 11 tables with 29 policies, 13 functions and 20 triggers in place. All 35 pgTAP assertions pass against the live database, covering registration, cross-branch isolation, privilege escalation and the transaction lifecycle.

Migrations, in order:

- `20260813090000_initial_schema.sql` all tables, enums and indexes from SPEC.md section 5
- `20260813090100_functions_and_triggers.sql` registration trigger, privilege protection, transaction lifecycle enforcement, gapless sequence counters, audit logging
- `20260813090200_rls_policies.sql` row level security on every table
- `20260813090300_grants.sql` explicit table privileges for the client roles
- `20260813090400_reference_data.sql` State Band mapping and the active fee scale

Plus `supabase/seed.sql` (dev branch fixture) and `supabase/tests/database/` (pgTAP suites).

Not yet built: the FastAPI backend, receipt and certificate PDF generation, the branch admin verification queue, the public verification page, and the subscription screens.

## Running the mobile app

```sh
cd mobile
cp .env.example .env   # then fill in the two public Supabase values
npm start              # then press a for Android, or scan the QR with Expo Go
npm test               # fee engine tests
npm run typecheck
```

### SDK version

The app targets **Expo SDK 54**, deliberately, not the newer 56 or 57.

Expo Go ships as a single pre-built app containing exactly one SDK, and it lags the latest release. The authoritative source is `https://exp.host/--/api/v2/versions/latest`, whose `expoGoSdkVersion` field currently reads `54.0.0`. Anything newer cannot be opened in Expo Go at all. Check that field before changing SDK version, rather than assuming Expo Go tracks the newest release.

Staying on 54 keeps the scan-the-QR workflow working without an Apple Developer account, which matters because installing a development build on a physical iPhone requires the paid ($99/year) membership.

This is temporary. Shipping to either store requires a development build regardless, since Expo Go cannot be submitted. Move to EAS development builds when device testing needs native modules Expo Go lacks, or when preparing for release.

**Icons use `@expo/vector-icons`, not `expo-symbols`.** expo-symbols wraps SF Symbols, an Apple technology: on SDK 54 it renders only a `fallback` prop on Android, so tab icons silently vanish there while still compiling and typechecking cleanly. `@expo/vector-icons` renders on every platform.

Verified on Node 24.

## Applying the schema

Local development through `supabase start` needs Docker, and Docker Hub is unreachable from the current network: a 13KB `hello-world` pull times out, so the image pull never completes. Use a hosted project instead.

```sh
supabase db push --db-url "<connection string from the dashboard>"
```

Take the connection string from Project Settings, then Database, then Connection string. Newer projects route through the pooler rather than `db.<ref>.supabase.co`, which does not resolve.

Reference data (the State Band mapping and the active fee scale) ships as a migration, so any environment gets it. `supabase/seed.sql` holds only a dev branch fixture, giving you a branch code to register against.

Still outstanding: a **private** storage bucket named `proofs`, with a policy restricting each practitioner to their own `{user_id}/` folder. Proof upload will fail until it exists.

### Running the database tests

`supabase test db` needs the local Docker stack. Where that is unavailable, run the suites directly against a database instead. Each file wraps itself in `begin`/`rollback`, so nothing is persisted:

```sh
supabase db query --file supabase/tests/database/01_registration.sql --db-url "<url>"
```

Note that `db query` cannot execute multiple statements in one call, so a small runner using the `pg` client is the practical route for the full suites. pgTAP must be enabled first:

```sql
create extension if not exists pgtap with schema extensions;
```

Run them before trusting any change to policies or triggers.

## Design decisions worth knowing

**Privileges and policies are two separate gates.** `GRANT` decides whether a role may touch a table at all; RLS decides which rows it sees. Both are declared in this repo rather than inherited from project defaults, so the privilege surface is reviewable in one file and the schema behaves the same on any Postgres.

**Who may act is RLS; what a write may do is triggers.** Policies decide row visibility and who can attempt a write. `before` triggers enforce the rest: clients cannot set their own role, branch, SCN, BAIN, receipt number or verification fields, and transaction status can only move along `awaiting_payment -> pending_verification -> verified/rejected` (with resubmission after rejection). The service role key bypasses RLS but still passes through the triggers' privileged path deliberately.

**Registration is a database trigger.** Signing up through Supabase Auth with `branch_code`, `full_name`, `phone`, `scn`, `practice_state` in the user metadata creates the profile. A valid branch code makes the user a `branch_member` at that branch; an unknown code aborts signup rather than silently registering the user at standard subscription rates. Clients can pre-validate a code with the `validate_branch_code(text)` RPC, which is callable anonymously. A `role` field in signup metadata is ignored.

**Numbering is gapless by construction.** `next_sequence_value(scope)` upserts a per-scope counter row under a row lock, e.g. scope `bain:ANAOCHA:2026`. Concurrent issuance serialises on the lock; a rollback rolls the increment back. It is `security definer` with execute revoked from clients, so only server code (Phases 4 and 6) can draw numbers.

**Money is integer kobo.** Every money column is `bigint`. Formatting to naira happens at the display layer only.

**The audit log cannot be skipped.** Inserts, updates and deletes on branches, subscriptions, transactions and certificates are journalled by a `security definer` trigger into `audit_log`, which only the super admin can read and nobody can write directly.

**Fee scales are versioned.** `fee_scales` plus `fee_scale_bands` snapshot the Remuneration Order; calculations reference the scale they used so amendments never rewrite history. Bands are marginal (income-tax style), which the Phase 2 engine must implement by summing across bands.

## Naming and attribution

`mobile/lib/branding.ts` holds the product name, tagline, branch attribution and the correct citation of the Remuneration Order. They are centralised because the project's scope is expected to widen: it is commissioned by the **NBA Anaocha Branch** now, with national rollout as the ambition.

Two consequences of that scoping, both deliberate:

- The app is attributed to the branch ("An initiative of the NBA Anaocha Branch") rather than described as powered by the national Association. The NBA seal is used legitimately, since a branch is part of the Association, but national endorsement should not be claimed until it is formally given. Widen `ATTRIBUTION` when it is.
- The bundle identifier is `org.nbaanaocha.legalfees`, not `org.nigerianbar.*`, which would imply control of the national body's domain. **Bundle identifiers cannot be changed after an app is first published**, so if national rollout means republishing under an NBA developer account, that will be a new store listing regardless.

Screen headers show the name of the screen. The product name appears only on the splash, login and app icon. Putting the product name in every header is what produced four competing names in the first place.

## Provisional data, do not ship as-is

**Every fee the app currently displays is invented.** `mobile/lib/fees/placeholder-scale.ts` contains a ladder shaped like the real Order so the app can be built and demonstrated, but the rates are not the published Schedule. Only the Band 3 conveyancing ladder has any public grounding, and that is second hand.

Two controls keep this from becoming a liability:

- every result carries `isPlaceholder: true`, and the calculator renders a non-dismissible warning whenever it is set
- the engine throws rather than returning zero when bands are missing, malformed, or leave a gap, so a misconfigured scale fails loudly instead of quietly quoting a wrong number

Replace that one file with the real Schedule and clear the flag. Do not edit the engine.

`seed.sql` maps only Lagos and FCT (Band 3) and the five states the brief names (Band 2) with confidence; every other state defaults to Band 1 pending the client supplying the full Schedule. `mobile/lib/fees/placeholder-scale.ts` mirrors that mapping, and the two must be corrected together.

## Next steps

1. Client answers to SPEC.md section 0, above all the Scale 4 band tables.
2. Phase 2: pure, dependency-free fee calculation engine with unit tests on every band boundary.
3. Decide the subscription platform question (SPEC.md section 2) before any Paystack work.

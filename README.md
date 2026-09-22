# NBA Legal Fees

Multi-tenant platform for Nigerian legal practitioners and NBA branches: statutory fee calculation, branch fee receipts, payment verification, BAIN issuance and Certificates of Compliance.

Commissioned by the **NBA Anaocha Branch**, with national rollout as the ambition. The full product definition is in [SPEC.md](SPEC.md); read its section 0 before building anything new. [DESIGN_REVIEW.md](DESIGN_REVIEW.md) records where the mockups and the brief disagree, and why the fee engine departs from the portal it was ported from.

## Layout

| | |
|---|---|
| [`mobile/`](mobile/) | Expo app for practitioners. Calculate a fee, generate a receipt, upload proof, hold certificates. |
| [`web/`](web/) | Next.js branch console for administrators, plus the public verification page. |
| [`supabase/`](supabase/) | The schema. Migrations, row level security, database functions, pgTAP suites. |

The schema is the only component both clients share, and since RLS is the access control rather than app code, it is also the security model. Treat `supabase/migrations/` as the source of truth for what the system permits.

## Running it

```sh
# Practitioner app
cd mobile && cp .env.example .env   # fill in the two public Supabase values
npm install
npm start                            # then open it in Expo Go, see below
npm test && npm run typecheck

# Branch console
cd web && cp .env.example .env.local # same project, NEXT_PUBLIC_ prefix
npm run dev                          # http://localhost:3000
```

Verified on Node 24.

### Setting up the practitioner app, from a fresh clone

Everything below runs on the computer. The phone only ever scans a QR code.

**Prerequisites.** Node 24 and Git. Nothing else: there is no global Expo CLI to install, because `expo` is a dependency of the project and `npx expo` runs that local copy. (The old global `expo-cli` package is deprecated; installing it causes more problems than it solves.)

```sh
node -v          # expect v24.x
git --version
```

**Clone, install, configure, start.**

```sh
git clone https://github.com/BeamX-Solutions/NBA-Mobile-App.git
cd NBA-Mobile-App/mobile

npm install

cp .env.example .env          # Windows CMD: copy .env.example .env
                              # Windows PowerShell: Copy-Item .env.example .env

npm start
```

Fill in `.env` before that last command. Two values are needed, both from the Supabase dashboard under Settings, then API:

| Variable | Where it comes from |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Project API keys, the `anon` `public` key |

`EXPO_PUBLIC_VERIFICATION_URL` is already correct in `.env.example` and only changes when `web/` is redeployed somewhere new.

These are inlined into the bundle when Metro starts rather than read at runtime, so **a value edited while Metro is running takes effect only after restarting it.**

**What `npm start` prints** is a QR code in the terminal, above a line reading `exp://192.168.x.x:8081`. That is the LAN address of the bundler on this machine.

**Then, on the phone:** install **Expo Go** from the App Store or Google Play, and scan the QR code. On Android, scan from inside Expo Go using its own scanner. On iOS, scan with the system Camera app instead, since Expo Go on iOS has no built-in scanner and the camera hands the `exp://` link across.

#### When the QR code does not connect

The phone and the computer must be on the same network, because that `exp://192.168.x.x` address is a LAN address. Guest, hotel and corporate Wi-Fi routinely isolate clients from one another, which breaks it even when both devices are on the same SSID. In that case:

```sh
npx expo start --tunnel
```

This routes through Expo's relay and works from anywhere, including across mobile data. The first run offers to install `@expo/ngrok`; accept it. Reloads are noticeably slower, so use it only when the LAN route is unavailable.

On Windows, the first `npm start` usually raises a Windows Defender firewall prompt for Node on port 8081. Metro is unreachable from the phone until that is allowed, and if the prompt was dismissed the symptom is a QR code that scans but never loads.

#### Other things worth knowing

**Expo Go tracks one SDK at a time.** This project is on SDK 57. When the published Expo Go moves to SDK 58 the store build will refuse to open the project and say so. The fix is `npx expo install --fix`, not a workaround.

**No development build is needed.** This is a managed project with no `android/` or `ios/` directory, and every native module it uses (`expo-print`, `expo-sharing`, `expo-document-picker`, `expo-image-picker`, `react-native-svg` behind the certificate QR, Reanimated, AsyncStorage, NetInfo) is already bundled into Expo Go. `npm run android` and `npm run ios` are the alternative route and need a local emulator or simulator; Expo Go on a real device needs neither Android Studio nor Xcode.

**While it runs:** `r` reloads, `j` opens the debugger, `w` opens a browser preview, and shaking the device opens the in-app developer menu.

**Sign in as a practitioner.** Administrators are deliberately refused by the mobile app and work in `web/` instead, so an admin account will not get past the login screen. See [Who can do what](#who-can-do-what).

## Who can do what

Four roles, enforced by 29 RLS policies and a set of `before` triggers. RLS decides which rows a client may touch; the triggers decide what a write may do.

| | practitioner (`branch_member`) | `branch_admin` | `super_admin` |
|---|---|---|---|
| Own calculations, transactions, certificates | yes | — | yes |
| Submit a transaction | yes | **refused** | **refused** |
| Read the branch's submissions | — | own branch | all |
| Approve and issue a BAIN | — | own branch, not own submission | all |
| Create a branch | — | — | yes |
| Audit log | — | — | read only |

**Administrator and practitioner are totally separate.** A person who both administers a branch and practises law holds two accounts. This is enforced in the database, not the UI: `create_transaction()` refuses an administrator, and the insert policy on `transactions` admits `branch_member` alone. Administrators are turned away from the mobile app and work in `web/`.

**Separation of duties** is enforced in `issue_bain()`: an administrator cannot approve their own submission. A branch whose only administrator also practises needs a second administrator to process their transactions. That is the intended cost.

**RLS is a ceiling, not a filter.** Policies are OR'd, so a branch administrator is permitted to read every transaction in their branch. Personal screens must still scope their own queries to `auth.uid()` — a screen that omits the owner filter will render other people's records to an administrator.

## BAIN issuance

Approving a submission calls `issue_bain(uuid)` rather than updating the row.

The three effects must be atomic. A plain status update could leave a transaction verified with no certificate, or consume a sequence number for a certificate that was never created. The function verifies the transaction, draws the BAIN and certificate numbers from `number_sequences`, and inserts the certificate inside one transaction, holding a `for update` lock so two administrators approving simultaneously cannot both mint a number. It refuses to run twice.

Formats follow the mockups: BAIN is national (`NBA/2026/00042`), certificate numbers are a separate sequence (`NBA-CC-2026-0042`).

## Public verification

`/verify/{BAIN}` sits outside every auth guard, because the people who most need it — a land registry, opposing counsel — will never have an account. It is server rendered, since it is typically opened by scanning a QR code on whatever connection the registry has.

It reads through `verify_bain(text)`, granted to `anon`, which returns **only** the practitioner, SCN, document type, issuing branch, issue date and revocation status. It never returns the consideration or the names of the parties: anyone holding a BAIN can call it, so it must establish authenticity without disclosing a client's commercial terms.

Lookup is by BAIN only, never by SCN. An SCN is semi-public; accepting one would let anyone enumerate the certificates issued to a practitioner, turning a check on one document into a directory.

The console and this page are deployed at **https://nba-mobile-app.vercel.app**, and `EXPO_PUBLIC_VERIFICATION_URL` in `mobile/.env` points there, so certificate QR codes resolve.

**Neither the host nor the `/verify/{BAIN}` path shape may change once certificates carrying QR codes have been issued.** The QR is printed into the certificate PDF, so a certificate already in a registry's file has to keep resolving. The value is inlined at bundle time, not read at runtime: a running Metro must be restarted after changing it, and a store build has it baked in.

A `vercel.app` subdomain is fine while every certificate is a test one. **Move it to a domain you control before issuing anything real**, because that hostname then has to outlive the deployment platform.

The route is a catch-all, so both the percent-encoded form the QR emits (`/verify/NBA%2F2026%2F00001`) and the literal form (`/verify/NBA/2026/00001`) resolve to the same certificate.

## Revoking a certificate

A certificate issued in error has to be withdrawable, or the branch can only ever add to the register and never correct it. `certificates.revoked_at` and `.revocation_reason` existed from the first migration and `verify_rbin` always reported them, but nothing wrote them until `revoke_certificate(uuid, text)`.

Revocation is a write to the register, and the register carries select policies only, so it arrives the same way issuance does: a `security definer` function that is the only door. A branch administrator may revoke a certificate their own branch issued; a super administrator may revoke any.

**The separation of duties rule from `issue_rbin` is deliberately not repeated.** There the concern is an administrator approving their own submission, which is self-dealing. Revocation withdraws a benefit rather than granting one, and an administrator who realises they approved something in error must be able to undo it at once rather than wait for a colleague.

**A reason is compulsory**, because `verify_rbin` publishes it. A certificate that says only "revoked" invites its holder to argue the withdrawal was an administrative slip.

**Reversal is the super administrator's alone**, through `restore_certificate(uuid)`. The asymmetry is the point: a revocation is a public statement that a document should not be relied on, and a third party may already have acted on it, so the route back runs through someone other than the person who made the mistake.

The RBIN keeps resolving either way. A revoked certificate is reported as revoked with its reason, rather than going blank, because a land registry holding a printed copy has no other way to learn it was withdrawn.

## The chairman's signature

`branches.chairman_signature_url` was also a column nothing wrote or read, so every certificate printed the chairman's name over an empty rule. The `signatures` bucket and the Branch Records upload fill it, and the PDF now prints the image on the signature line.

SPEC.md blocking question 7 asked who holds the signature and what a chairmanship change does. It was never answered, so the migration answers it and says why in full. In short: **the branch administrator uploads it for their own branch**, because routing it through the platform operator makes every chairmanship change a support request, and the branch already edits `chairman_name` under the existing policy. **A chairmanship change does nothing to certificates already issued**, but a PDF regenerated for an old certificate will carry the current signature, because the image is read at print time rather than captured at issuance. That is acceptable only because the signature is not what makes the certificate good, and would have to change if it ever became the thing relied on.

The bucket is private, which stops anonymous scraping and little else: the signature is printed on every certificate the practitioner downloads, so anyone holding a certificate holds the signature. That is the ordinary position for a signature on a document, and is why the certificate states in its own text that a printed copy proves nothing on its own.

## Terms of engagement

Paragraph 4 of the Order requires written terms of engagement to reach the client within 14 days of instructions. `lib/engagement.ts` generates them from a calculation, and the calculator offers the letter beside the receipt.

It is not a retainer agreement and does not try to be one. It states the parties, the work, the basis of charge, the figure, what is excluded and how the resulting certificate can be verified. It exists so that a practitioner who would otherwise issue nothing issues something compliant on the day they take instructions.

The letter calls the figure the **prescribed minimum** in those words, and says the Order's figures are minimums and not fixed prices. A letter presenting the scale figure as "the fee" would misstate the instrument and the practitioner's own position at once, so a test pins that wording.

## Branch activation

`activation_status` existed from the first migration, was displayed in the console, was guarded by `protect_branch_columns`, and was read by nothing. A branch that had never joined behaved exactly like one that had. `expires_at` was in the same position: set on activation, never consulted, with nothing to transition a branch to `expired` when the date passed.

**Activating a branch is what brings it onto the platform.** It is an administrative act by the super administrator, carries no fee and sets no term, and is done one branch at a time from All Branches, because branches join one at a time. Its two consequences:

- `list_branches_for_signup()` returns only active branches, so a branch that has not joined is not offered to a lawyer registering. `handle_new_user` refuses one anyway, because `branch_code` arrives in client-supplied metadata that a crafted payload could name directly.
- `create_transaction` refuses a receipt, beside the existing subscription check.

**Not enforced in `issue_rbin`.** A practitioner who has already paid must receive the certificate they paid for; a branch lapsing between submission and approval is the branch's problem with the Association, not the practitioner's with their client.

**Deactivating gates new business only.** Existing members keep their accounts and every certificate already issued stays valid and verifiable, which is what SPEC.md question 8 settled.

**Expiry is computed, never stored.** `branch_is_active(uuid)` tests the status and the date together, so a branch still marked `active` with a date in the past is not active. Nothing has to run on a schedule to make that true.

## What an administrator can see

Four screens closed gaps where the database held something the console never showed.

**Certificates** is the register. It was possible to count certificates on the dashboard and to fetch one behind a transaction, and nothing else: no way to browse what a branch had issued, no list of revoked ones, and no way to search the certificate number, which is the reference printed largest on the document and the one a land registry quotes. That number is now searchable here and in the transaction queue.

**Audit Log** surfaces `audit_log`, which triggers have populated since the first migration and which only the super administrator may read. Nothing ever read it, so the record the schema calls quasi-legal was write-only in practice. It cannot be edited or deleted from anywhere: the table has no write policy for any client.

**A practitioner record** gathers the profile, the subscription and every transaction and certificate for one person. The roster had no drill-down, so answering "what has this person done" meant searching the queue by name.

**Subscription state** is now visible on the roster and the practitioner record. It was not, and the reasoning recorded on that screen was that entitlement comes from a payment webhook so there would be nothing to act on. That conflated acting with seeing: an inactive subscription is the usual answer when a practitioner reports that a receipt was refused, and the administrator taking that call could see everything except the fact that explains it. A branch administrator now reads their own members' subscriptions and no others; granting one is still impossible from the console.

## Applying the schema

Local development through `supabase start` needs Docker. Where that is unavailable, push to a hosted project:

```sh
supabase db push --db-url "<connection string from the dashboard>"
```

Take the connection string from Project Settings → Database. Newer projects route through the pooler; `db.<ref>.supabase.co` does not resolve.

Reference data (the active fee scale) ships as a migration, so any environment gets it. `supabase/seed.sql` holds only a dev branch fixture.

### Running the database tests

```sh
cd supabase/tests
npm install
npm test            # every suite
npm test 03         # suites whose filename contains "03"
```

The runner reads the connection from the repository root `.env`, so no credentials are passed on a command line. Each suite wraps itself in `begin`/`rollback`, so it is safe against the hosted project and leaves nothing behind.

`supabase test db` is the usual route, but it needs the local Docker stack, and Docker Hub is unreachable from this network. That is precisely why these suites had never once been executed: the only documented way to run them did not work here, so nobody ran them, and they rotted while the schema moved underneath. `01` still referenced a table that had been dropped; `02` still called the reference a BAIN. **Run them before trusting any change to a policy, trigger or security-definer function.**

| Suite | Covers |
|---|---|
| `01_registration.sql` | what `handle_new_user` does with signup metadata, and what it refuses |
| `02_rls_isolation.sql` | cross-branch isolation, privilege escalation, the transaction lifecycle |
| `03_separation_and_issuance.sql` | administrator/practitioner separation, receipt numbering, RBIN issuance, separation of duties |
| `04_proof_storage.sql` | who may upload, read and replace a proof of payment, and that a verified one is frozen |
| `05_certificate_revocation.sql` | who may revoke and reverse, that a reason is compulsory, and that a revocation reaches `verify_rbin` |
| `06_branch_activation.sql` | that an inactive or lapsed branch cannot draw receipts or appear at signup, and who may change that |
| `07_admin_visibility.sql` | that a branch administrator reads their own members' subscriptions and nobody else's |

Suite `03` exists because four defects reached a running system through this layer and every one was found by a person tripping over it. Each of its assertions pins one of them.

## Design decisions worth knowing

**Privileges and policies are two separate gates.** `GRANT` decides whether a role may touch a table at all; RLS decides which rows it sees. Both are declared here rather than inherited from project defaults.

**Registration is a database trigger.** Signing up with `branch_code`, `full_name`, `phone` and `scn` in the user metadata creates the profile. An unknown branch code aborts signup. A `role` field in signup metadata is ignored — no client may ever set its own role, which is why creating a super administrator is a privileged, out-of-band operation.

**Branch affiliation is compulsory.** A lawyer whose branch has not joined cannot register at all. That makes branch onboarding the growth mechanism, which is why the console has an All Branches screen rather than leaving it to SQL.

**Numbering is gapless by construction.** `next_sequence_value(scope)` upserts a per-scope counter under a row lock. Concurrent issuance serialises; a rollback rolls the increment back.

**Money is integer kobo.** Every money column is `bigint`. Naira exist only at the display layer.

**The audit log cannot be skipped.** Writes to branches, subscriptions, transactions and certificates are journalled by a `security definer` trigger into `audit_log`, which only the super admin can read and nobody can write directly.

**Fee scales are versioned.** `fee_scales` plus `fee_scale_bands` snapshot the Remuneration Order; calculations reference the scale they used, so amendments never rewrite history. Bands are marginal, summed across bands.

## Naming and attribution

[`mobile/lib/branding.ts`](mobile/lib/branding.ts) holds the product name, tagline, branch attribution and the correct citation of the Remuneration Order, centralised because the scope is expected to widen.

The app is attributed to the branch ("An initiative of the NBA Anaocha Branch") rather than described as powered by the national Association. The NBA seal is used legitimately, since a branch is part of the Association, but **national endorsement must not be claimed until it is formally given** — including on the public verification page, which a land registry may rely on.

The bundle identifier is `org.nbaanaocha.legalfees`, not `org.nigerianbar.*`. Bundle identifiers cannot be changed after first publication.

## Provisional data, do not ship as-is

**The fee figures are not final.** `scale2023.isProvisional` is still `true` and is carried on every calculation result, but nothing in the interface surfaces it any more: the banners that warned about it on the calculator and the plans screen were removed at the client's request, because they dominated both screens. **Provisional figures are therefore presented unmarked**, which is a deliberate decision of the client's rather than an oversight, and it makes verifying the Schedule more urgent, not less. The engine still throws rather than returning zero when bands are missing, malformed or leave a gap, so a misconfigured scale fails loudly instead of quietly quoting a wrong number.

Two defects found while porting from the portal, both recorded in DESIGN_REVIEW.md: Scale 4B's ₦1,000,000 discontinuity at ₦100M is **corrected** here, and Scale 4C's inert ₦10M boundary is **reproduced** and marked SUSPECT. Check both against the published Schedule before launch.

**A device-generated certificate is not an authoritative artefact.** Anyone can produce a PDF that looks like one. That is exactly why the QR code and the public lookup exist: the document asserts nothing on its own, the BAIN is what gets checked.

## Known blockers

Ordered by what stops real use first.

1. **No practitioner can complete registration.** Email confirmation is on and the project uses Supabase's default SMTP, which is test-grade and rate limits after a couple of sends. Custom SMTP must be configured before onboarding anyone.
2. **The fee schedule is unverified.** See above. This is a client-input task and the single most important thing to resolve.
3. **Paystack is not wired.** Entitlement must be granted by a server-side webhook, never by the client, so the payment screen deliberately does not charge. No subscription can be bought, and `create_transaction()` requires one.
4. **The subscription model is undecided.** SPEC.md section 7 and the mockups disagree by 18x on the yearly price and on the pricing axis. Settle it before building either.
5. **Certificates are not emailed.** The brief asks for it; `certificates.emailed_at` is never set.

## Not built, deliberately

Recorded so the reasoning is not rediscovered:

- **A Year-of-Call fee scale screen.** The admin mockups configure a fee by year of call. That is the Bar Practising Fee, an annual due. This product computes the Remuneration Order, where the fee follows the consideration and document type. They are unrelated, and merging them would corrupt both.
- **Manual practitioner entry by an administrator.** A profile is created by the signup trigger; an administrator creating accounts would bypass registration and put account creation and payment approval in the same hands.
- **Revenue reporting and trend charts beyond verified branch fees.** The branch's share of a fee is an open question, and payment method is not recorded in the schema at all.
- **Admin role management** (Financial Officer, Records Manager, Editor). `user_role` has four values and none of these are among them. Needs a schema decision first.

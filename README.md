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
npm start                            # press a for Android, or scan the QR with Expo Go
npm test && npm run typecheck

# Branch console
cd web && cp .env.example .env.local # same project, NEXT_PUBLIC_ prefix
npm run dev                          # http://localhost:3000
```

Verified on Node 24.

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

Set `EXPO_PUBLIC_VERIFICATION_URL` in `mobile/.env` to wherever `web/` is deployed. **The path shape `/verify/{BAIN}` must not change once certificates carrying QR codes have been issued**, and neither must the host: the QR is printed into the certificate PDF, so a certificate in a registry's file must keep resolving.

## Applying the schema

Local development through `supabase start` needs Docker. Where that is unavailable, push to a hosted project:

```sh
supabase db push --db-url "<connection string from the dashboard>"
```

Take the connection string from Project Settings → Database. Newer projects route through the pooler; `db.<ref>.supabase.co` does not resolve.

Reference data (the active fee scale) ships as a migration, so any environment gets it. `supabase/seed.sql` holds only a dev branch fixture.

### Running the database tests

`supabase test db` needs the local Docker stack. Otherwise run the suites directly; each wraps itself in `begin`/`rollback`, so nothing persists:

```sh
supabase db query --file supabase/tests/database/01_registration.sql --db-url "<url>"
```

`db query` cannot execute multiple statements in one call, so a small runner using the `pg` client is the practical route for the full suites. pgTAP must be enabled first:

```sql
create extension if not exists pgtap with schema extensions;
```

Run them before trusting any change to policies or triggers.

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

**The fee figures are not final.** `scale2023.isProvisional` is still `true`, so the calculator renders a non-dismissible warning on every result. The engine throws rather than returning zero when bands are missing, malformed or leave a gap, so a misconfigured scale fails loudly instead of quietly quoting a wrong number.

Two defects found while porting from the portal, both recorded in DESIGN_REVIEW.md: Scale 4B's ₦1,000,000 discontinuity at ₦100M is **corrected** here, and Scale 4C's inert ₦10M boundary is **reproduced** and marked SUSPECT. Check both against the published Schedule before launch.

**A device-generated certificate is not an authoritative artefact.** Anyone can produce a PDF that looks like one. That is exactly why the QR code and the public lookup exist: the document asserts nothing on its own, the BAIN is what gets checked.

## Known blockers

Ordered by what stops real use first.

1. **No practitioner can complete registration.** Email confirmation is on and the project uses Supabase's default SMTP, which is test-grade and rate limits after a couple of sends. Custom SMTP must be configured before onboarding anyone.
2. **The fee schedule is unverified.** See above. This is a client-input task and the single most important thing to resolve.
3. **Paystack is not wired.** Entitlement must be granted by a server-side webhook, never by the client, so the payment screen deliberately does not charge. No subscription can be bought, and `create_transaction()` requires one.
4. **The subscription model is undecided.** SPEC.md section 7 and the mockups disagree by 18x on the yearly price and on the pricing axis. Settle it before building either.
5. **Certificates are not emailed.** The brief asks for it; `certificates.emailed_at` is never set.
6. **The chairman's signature is not printed.** `chairman_signature_url` is never read; the certificate prints the name only.

## Not built, deliberately

Recorded so the reasoning is not rediscovered:

- **A Year-of-Call fee scale screen.** The admin mockups configure a fee by year of call. That is the Bar Practising Fee, an annual due. This product computes the Remuneration Order, where the fee follows the consideration and document type. They are unrelated, and merging them would corrupt both.
- **Manual practitioner entry by an administrator.** A profile is created by the signup trigger; an administrator creating accounts would bypass registration and put account creation and payment approval in the same hands.
- **Revenue reporting and trend charts beyond verified branch fees.** The branch's share of a fee is an open question, and payment method is not recorded in the schema at all.
- **Admin role management** (Financial Officer, Records Manager, Editor). `user_role` has four values and none of these are among them. Needs a schema decision first.

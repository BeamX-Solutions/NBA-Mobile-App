# NBA Fee Calculator: Technical Spec

Derived from the client brief `NBA_FEE_CALCULATOR_APP.docx`. This document translates that brief into something buildable and flags what is missing.

## 0. Blocking questions

Do not start Phase 2 until these are answered by the client. Items 1, 5 and 8 make the product impossible to build correctly, not just harder.

1. **The Scale of Fees itself is not in the brief.** The entire app is a calculator and the calculation rules are absent. See section 11 for what has been established about the Order from public sources and what still has to come from the client.
2. **Activation fee contradiction.** Section 2.0 states ₦300,000 in the activation paragraph and ₦500,000 in the discount paragraph. One number is wrong.
3. **BAIN format.** Is it branch scoped or national? Proposed default if unanswered: `NBA/{BRANCH_CODE}/{YEAR}/{6-digit sequence}`. Sequence must be gapless per branch per year, which has implications for how it is generated.
4. **Certificate number format.** Separate sequence from BAIN, or the same value? Assume separate unless told otherwise.
5. **How is the amount payable to the branch derived from the remuneration?** The receipt shows "Total amount payable to the NBA Branch" but the brief never says what portion of the calculated professional fee that is. A percentage? A separate scale? Without this the receipt cannot be generated.
6. **Individual users have no branch.** Individual subscribers get the calculator and receipt generation, but a receipt requires a branch account name, account number and bank. Whose account appears on an individual user's receipt? Either individual users must still select a branch, or receipts are branch-only and individuals get calculation exports instead.
7. **Chairman signature.** Uploaded per branch as an image by whom, and re-uploaded when the chairmanship changes? Certificates carry legal weight, so signature custody matters.
8. **Does a lapsed subscription revoke access to already-issued certificates?** Recommendation: no. Issued certificates stay downloadable forever. Only new issuance is gated.
9. **Verification of authenticity.** The brief has no mechanism for a third party (land registry, buyer's counsel) to confirm a Certificate of Compliance is genuine. Strongly recommend adding a public lookup by BAIN plus a QR code on the certificate. Without it the certificate is trivially forgeable and the product's core value is undermined.

## 1. What this is

A multi-tenant subscription platform for Nigerian legal practitioners and NBA branches. It calculates statutory remuneration for title documents, collects branch fees, verifies payment, issues Bar Association Identification Numbers, and generates Certificates of Compliance.

This is not a single-user local app. It has money, roles, tenancy, document generation and audit requirements.

## 2. Platform decision

Split the surfaces by who uses them:

| Surface | Users | Build |
|---|---|---|
| Mobile app | Lawyers | Expo, React Native |
| Web portal | Branch admins, super admin | Extend the existing NBA Remuneration Portal |
| Public verification page | Anyone | Single web route, no auth |

Rationale: lawyers calculate fees and photograph payment slips on their phones. Branch admins verify batches of payments, which is desktop work. Building an admin experience into a mobile app would waste weeks and produce something worse.

### The app store billing problem

Read this before writing any payment code.

Apple requires digital subscriptions sold inside an iOS app to use In-App Purchase, at 15 to 30 percent commission. Google Play has an equivalent requirement. Routing subscription payments through Paystack inside the app will get the app rejected.

Options:

- **Recommended for v1:** Sell subscriptions on the web only. The mobile app checks entitlement and, if unsubscribed, shows a message directing the user to the portal, with no link and no purchase button. This is the "reader app" pattern and it is compliant if done exactly this way.
- Ship Android first via Play Billing and defer iOS.
- Ship as a PWA and skip the stores entirely. Given the existing portal already exists, this is a serious option and cuts the most schedule risk.

Decide this before Phase 3, because it determines the entire subscription architecture.

## 3. Stack

| Layer | Choice |
|---|---|
| Mobile | Expo, React Native, TypeScript, Expo Router, NativeWind |
| Auth, database, storage | Supabase with row level security |
| Application backend | FastAPI on Render |
| PDF generation | WeasyPrint or Playwright, server side |
| Payments | Paystack, web checkout, webhook confirmed |
| Email | Resend |
| Errors | Sentry |

Nothing here is new to the team. Same shape as the NBA Anaocha portal.

## 4. Roles

| Role | Can |
|---|---|
| `individual` | Calculate fees, generate receipts if subscribed |
| `branch_member` | The above, plus submit proof of payment and receive BAIN and certificates |
| `branch_admin` | Verify or reject proofs, view branch transactions, manage branch profile and bank details |
| `super_admin` | Activate branches, issue branch codes, view all, manage fee scale versions |

## 5. Data model

Postgres via Supabase. Every table gets `created_at`, `updated_at`. Row level security on all of them, scoped by `branch_id` or `user_id`.

### `branches`
`id`, `name`, `branch_code` (unique), `activation_status` (`inactive`, `active`, `expired`), `activated_at`, `expires_at`, `account_name`, `account_number`, `bank_name`, `logo_url`, `chairman_name`, `chairman_signature_url`

### `profiles`
`id` (matches auth user), `full_name`, `email`, `phone`, `scn` (Supreme Court Number, unique), `branch_id` (nullable), `role`

### `fee_scales`
Versioned so historical calculations stay reproducible when the Order is amended.
`id`, `order_name`, `effective_from`, `effective_to` (nullable), `is_active`

### `fee_scale_bands`
`id`, `fee_scale_id`, `scale_number` (1 to 5), `state_band` (1, 2 or 3), `document_type`, `min_consideration`, `max_consideration` (nullable for the top band), `percentage` (nullable), `flat_amount` (nullable), `branch_share_percentage`

Bands are **marginal**, not flat. The rate for a band applies only to the portion of the consideration falling inside that band, the way income tax works. See section 11.

### `state_bands`
`state` (all 36 plus FCT), `band` (1, 2 or 3). Seeded from the Schedule to the Order. A practitioner's applicable band depends on where they practise or where the transaction is performed, so `profiles` needs a `practice_state` and the calculator takes a state as input.

### `subscriptions`
`id`, `user_id`, `plan` (`weekly`, `monthly`, `quarterly`, `yearly`), `rate_type` (`standard`, `branch_discounted`), `amount`, `starts_at`, `expires_at`, `status` (`active`, `expired`, `cancelled`), `paystack_reference`

### `calculations`
`id`, `user_id`, `fee_scale_id`, `document_type`, `consideration`, `professional_fee`, `branch_fee`, `total`, `breakdown` (jsonb), `created_at`

Free tier. No subscription required.

### `transactions`
`id`, `user_id`, `branch_id`, `calculation_id`, `parties`, `document_type`, `consideration`, `amount_payable`, `receipt_number` (unique), `proof_url`, `status` (`awaiting_payment`, `pending_verification`, `verified`, `rejected`), `rejection_reason`, `verified_by`, `verified_at`, `bain` (unique, nullable), `bain_issued_at`

### `certificates`
`id`, `transaction_id` (unique), `certificate_number` (unique), `issued_at`, `pdf_url`, `emailed_at`, `revoked_at`, `revocation_reason`

### `audit_log`
`id`, `actor_id`, `action`, `entity_type`, `entity_id`, `before` (jsonb), `after` (jsonb), `ip`, `created_at`

Every verification, rejection, BAIN issuance and certificate generation writes here. These are quasi-legal records and the log is not optional.

## 6. Core flows

### Fee calculation
User selects document type, enters consideration, gets a breakdown: professional fee, branch fee, total. Calculation snapshots the `fee_scale_id` used. Free, works without a subscription, and should work offline with a cached scale.

### Receipt
Subscribed user converts a calculation into a transaction. Server generates a sequential `receipt_number` and a PDF carrying the NBA logo, practitioner name, amount payable, branch account name, account number, bank name and reference. Client pays by bank transfer outside the app.

### Proof upload
Lawyer submits practitioner name, SCN, parties, document type, consideration, and a file (PDF, JPG, PNG, maximum 10MB). Status moves to `pending_verification`. Files go to a private Supabase bucket, never a public URL.

### Verification
Branch admin reviews on the web portal, approves or rejects with a reason. On approval the server issues the BAIN inside a database transaction so the sequence cannot gap or collide under concurrency, then generates the Certificate of Compliance PDF and emails it.

### Certificate
Contains practitioner name, SCN, BAIN, parties, document type, consideration, certificate number, date of issue, chairman signature image, and a QR code linking to the public verification page. Downloadable from the app permanently.

### Public verification
`/verify/{bain}` returns issued or not found, with practitioner name, document type, issue date and status. No consideration amount, no party names. It confirms authenticity without leaking client information.

## 7. Subscription pricing

| Plan | Standard | Branch discounted |
|---|---|---|
| Weekly | ₦7,000 | ₦5,000 |
| Monthly | ₦20,000 | ₦16,000 |
| Quarterly | ₦50,000 | ₦43,000 |
| Yearly | ₦180,000 | ₦162,000 |

Branch activation: see blocking question 2. Discounted rate applies automatically when the user registered with a valid branch code and that branch's activation is currently `active`. If a branch activation lapses, existing subscriptions run to their expiry at the rate already paid, then renew at standard rates.

## 8. Build order

**Phase 0.** Get answers to section 0. Nothing below is safe to build without items 1, 5 and 8.

**Phase 1.** Supabase schema, migrations, row level security policies, auth, registration with and without a branch code. Verify RLS with tests that attempt cross-branch reads and expect failure.

**Phase 2.** Fee calculation engine as a pure, dependency-free module with full unit tests over every band boundary. This is the heart of the product and a wrong number here is a professional liability for the lawyer using it. Test the edges of every band explicitly.

**Phase 3.** Subscriptions and Paystack, webhook driven, idempotent. Entitlement checks on the server, never trusted from the client.

**Phase 4.** Receipt generation, sequential numbering, PDF output.

**Phase 5.** Proof upload with private storage, and the admin verification queue on the web portal.

**Phase 6.** BAIN issuance under transaction locking, certificate generation, email delivery.

**Phase 7.** Public verification page and QR codes.

**Phase 8.** Mobile polish, offline calculator, store submission.

## 9. Conventions

- TypeScript strict, no `any`
- Money as integer kobo in the database, formatted for display only. Never floats for currency.
- All timestamps `timestamptz`, UTC
- Fee logic pure and isolated from database and UI
- Entitlement and role checks server side only
- Every state change on a transaction or certificate writes to `audit_log`
- No em dashes in code, comments, UI copy or documentation

## 10. What the Remuneration Order actually says

Established from public sources. This changes the data model in ways the brief does not anticipate.

**Correct citation.** The instrument is the Legal Practitioners (Remuneration for Business, Legal Services and Representation) Order, 2023, made under section 15(3) of the Legal Practitioners Act by the Legal Practitioners Remuneration Committee, chaired by the Attorney General of the Federation. It commenced 16 May 2023 and replaced the 1991 Order. It is commonly called the NBA Remuneration Order but it is not an NBA instrument. Use the correct title in UI copy and certificates.

**Five scales, not one.** Scale 1 consultations and legal opinions, Scale 2 incorporation and business name registration, Scale 3 litigation, Scale 4 property transactions including mortgages, Scale 5 everything else. Title documents fall under Scale 4. The app could later cover the others without schema changes.

**Three State Bands.** Fees vary by state, not just document type. Band 3 is Lagos and the FCT. Band 2 covers a group including Akwa Ibom, Bayelsa, Benue, Cross River and Delta. Band 1 is the remainder. The brief does not mention bands at all. Without a state input the calculator will return the wrong figure for most of the country.

**Rates are marginal and tiered.** In conveyancing and assignment, the reported structure for the top band is a minimum of 10 percent on the first N50m, then 5 percent on the portion between N50m and N100m, and so on. This is not a flat percentage lookup. The engine must sum across bands rather than pick one.

**Fees are minimums and are stated as non-negotiable.** A practitioner intending to charge below scale must apply to the Bar Remuneration Committee. The app should label its output as the prescribed minimum, never as "the fee", or it will mislead users.

**Terms of engagement within 14 days.** The Order requires written terms of engagement to be issued to the client within 14 days of instructions. Generating that letter from the calculation is an obvious and cheap feature addition.

### Still required from the client

The full Schedule is published by the NBA as scanned images and a non machine-readable PDF, so the complete band tables could not be extracted programmatically. We need, for Scale 4 at minimum:

- Every consideration band with its rate, for all three State Bands
- Which document types are covered and whether each has its own sub-scale (assignment, mortgage, lease, sublease, deed of gift, power of attorney)
- Whether the assignee's and assignor's practitioners are charged differently
- The mapping of all 36 states plus FCT to bands
- Whether VAT at 7.5 percent is added to the displayed figure

The branch portion is separate from all of this. Branch-level deed registration and payment protocols are set by branch resolution, not by the Order, which is why question 5 above can only be answered by the branch.

## 11. Definition of done for v1

A lawyer in the Anaocha branch calculates a fee on their phone, generates a receipt, pays, uploads the slip, and receives a Certificate of Compliance by email the same day. A third party scans the QR code and confirms it is real.

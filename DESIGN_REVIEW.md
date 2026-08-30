# Design review: mockups against SPEC.md

Review of the mockup screens supplied on 13 and 14 August 2026. The designs are strong and several details are better than the brief. This document records where they and the spec disagree, because those gaps decide schema and store-compliance work and are cheaper to settle now than after the app is built.

Nothing here blocks starting the UI. Items 1, 2 and 5 do block shipping.

## Build status against the mockups

Every supplied screen is now implemented, including the subscription flow, which was previously held back pending item 1.

| Mockup | Screen | Deviation |
|---|---|---|
| Splash | Expo splash config plus brand lockup on Login | none |
| Login | `app/(auth)/login.tsx` | none |
| Registration | `app/(auth)/register.tsx` | password fields added, since the mockup's "Proceed" implies a second step that was never supplied |
| Forgot Password | `app/(auth)/forgot-password.tsx` | none |
| Fee Calculator | `app/(tabs)/index.tsx` | citation corrected, see item 5 |
| Transactions | `app/(tabs)/transactions.tsx` | none |
| Upload Proof | `app/transaction/[id].tsx` | 10MB limit, not 5MB |
| My Certificates | `app/(tabs)/certificates.tsx` | thumbnails omitted until certificate PDFs exist to render |
| Certificate of Compliance | `app/certificate/[id].tsx` | recital reworded, see item 5 |
| Profile | `app/(tabs)/profile.tsx` | none |
| Edit Profile | `app/profile/edit.tsx` | Branch Affiliation is read-only, see item 3 |
| Action Successful | `app/result.tsx` | generalised so any flow can land on it |
| Choose Your Plan | `app/subscription/plans.tsx` | provisional-pricing banner added, see item 1 |
| Payment Method | `app/subscription/payment.tsx` | "Pay Now" is not wired to Paystack, see item 2 |

Design tokens extracted from the mockups live in `mobile/theme/tokens.ts`.

## What the designs got right, and the spec should adopt

**State of Transaction is a first-class input.** The calculator screen asks for state before consideration. SPEC.md section 10 established that fees vary across three State Bands and that the brief omitted this entirely. The designs already reflect it. Good.

**"PRESCRIBED MINIMUM FEE" as the result label.** The Order sets minimums, not fixed prices. Labelling the output this way is exactly right and avoids misleading practitioners.

**Certificate number is separate from BAIN.** The certificate detail shows BAIN `NBA/2024/09842` alongside certificate number `NBA-CC-2023-8942`. That answers blocking question 4: they are separate sequences. The schema already assumes this.

**BAIN looks national, not branch scoped.** All three certificates use `NBA/{YEAR}/{5 digits}` with no branch segment, while branch is carried separately as "Lagos Branch (001)". That is a provisional answer to blocking question 3 and contradicts the `NBA/{BRANCH_CODE}/{YEAR}/{sequence}` default proposed in the spec. Worth confirming with the client, because a national sequence must serialise across every branch at once rather than per branch.

## Fee scales: ported from the portal, with two defects found

The fee engine was rebuilt from `nba-remuneration-portal/src/lib/constants.ts` on 14 August 2026, on the client's instruction that the portal is the source of truth. Three structural corrections followed.

**There is no State Band.** An earlier reading of secondary sources (recorded in SPEC.md section 10) concluded that fees vary across three bands of states. The portal has no state dimension at all. The state input has been removed from the calculator, `state_bands` dropped, and `fee_scale_bands.state_band` replaced by `sub_scale`. `profiles.practice_state` is retained, because it is useful for branch administration, but it no longer affects any fee.

**Scale 4 is three sub-scales with different bases**, not one table:

| Sub-scale | Applies to | Charged on | Rates |
|---|---|---|---|
| 4A Conveyancing | Assignment, conveyance, gift, contract of sale, surrender, exchange | Consideration, market value, or higher of two values | 10% to ₦50M, 5% to ₦100M, 3% above |
| 4B Mortgages | Mortgage deed, release/discharge | Principal or original loan | 4% to ₦50M, 3% to ₦100M, 2% above |
| 4C Leases | Tenancy, lease, sub-lease | **Annual rental value** | 10% to ₦5M, 5% to ₦10M, 5% above |

The basis matters as much as the rate. A tenancy charged on the total value of a five year term instead of one year's rent overstates the fee fivefold, so the amount field is relabelled per document type.

**Irrevocable Power of Attorney is not a Scale 4 instrument.** It is discretionary under paragraph 2 of the Order. The engine throws rather than returning zero, and the calculator explains that the fee is agreed with the client.

### Defect 1: Scale 4B jumps by ₦1,000,000 at ₦100M

The portal computes mortgage fees above ₦100M as `4_500_000 + (amount - 100_000_000) * 0.02`. The running total implied by its own bands is ₦2,000,000 (₦50M at 4%) plus ₦1,500,000 (₦50M at 3%), which is **₦3,500,000**, not ₦4,500,000.

The consequence is a discontinuity: a ₦100,000,000 mortgage attracts ₦3,500,000, and a ₦100,000,001 mortgage attracts ₦4,500,000. One extra naira of loan adds a million naira of fee. Scale 4A passes the same continuity check with a gap of ₦0.03, which is rounding, so 4A is right and 4B is a transcription error rather than a step in the Order.

**This app implements ₦3,500,000, the arithmetically continuous figure.** Reproducing a bug that overcharges every large mortgage would not be fidelity to the source. A regression test pins the boundary.

**The portal should be corrected**, or the two products will quote different fees for the same mortgage. This has been live, so any mortgage above ₦100M already quoted through the portal was overcharged by ₦1,000,000.

### Defect 2: the Scale 4C ₦10M boundary is inert

The portal charges 5% both between ₦5M and ₦10M and above ₦10M, so the ₦10M boundary changes nothing. Unlike defect 1 this is not provably wrong: it is consistent with itself and the running totals line up, so the Order may genuinely say this and list the ₦10M row only to state the ₦750,000 subtotal.

The client confirmed it is unverified rather than intentional. It is therefore **reproduced exactly** so the two products agree, marked SUSPECT in `lib/fees/scale-2023.ts`, and pinned by a test that documents rather than endorses it. Check it against the published Schedule before launch; if the top rate differs, only the band array changes.

### Still provisional

`scale2023.isProvisional` remains `true`, so the calculator keeps warning users. It should be cleared only once the Schedule has been read line by line, both defects resolved, and the branch share (SPEC.md question 5) answered. VAT is chargeable on top of these figures and disbursements are separate; both are stated in the calculator's footnote but neither is computed.

## Brief compared against the build, 16 August 2026

Verified against the code, not recalled.

### In the brief, not implemented

| Brief | Status |
|---|---|
| §7 Certificate emailed automatically to the practitioner | **Absent.** No email code anywhere. `certificates.emailed_at` is never set. |
| §7 Signature of the Branch Chairman on the CoC | **Absent.** The chairman's name prints; `chairman_signature_url` is never read and nothing uploads one. |
| §2 Subscription required for receipts | **Cannot be satisfied.** Plans and Payment screens exist, but Paystack is not integrated and no `subscriptions` row is ever written, so nobody can subscribe. With the gate enabled this blocks receipts entirely in production. |
| §1B Branch Registration with a unique Branch Code | **Absent.** No flow for a branch to subscribe or be issued a code. ANAOCHA was inserted directly. No super admin surface. |
| §2.0 Branch activation fee and expiry | **Absent.** `activation_status` and `expires_at` exist; nothing sets or enforces them. |
| §2.0 Discounted rates applied automatically | Rate tables exist in `lib/plans.ts`, but no subscription is created, so the discount never applies. |
| Digital record management for branches | Partial. Branches get the verification queue only: no history, reporting or export. |

### Implemented, not in the brief

Public verification page and QR code (without which a certificate is trivially forgeable, and the brief offers no answer) · onboarding · Notification, Security and Help screens · offline indicator · half rate for the opposing practitioner · twelve document types across three sub-scales with distinct bases · audit log · separation of duties on approval · transaction search, filter and pagination · Edit Profile and branch affiliation request · receipt and certificate PDF generation · rejection with reason and resubmission.

### Contradictions inside the brief

- **Activation fee** stated as ₦300,000 and ₦500,000 two paragraphs apart. **Client decision: ₦300,000.**
- **"NBA Remuneration Order, 2023"** is the wrong citation throughout. The instrument is made by the Legal Practitioners Remuneration Committee, not the NBA. Corrected in the app.
- **Individual pricing** (₦7,000 to ₦180,000) contradicts the mockups (₦10,000 and ₦25,000 tiers). Still unresolved; `lib/plans.ts` carries the mockup figures marked provisional.

### Registration: branch is now compulsory

Client decision, 16 August 2026. This **supersedes §1A Individual Registration** and the individual tier in §2A. Every practitioner selects a branch from a dropdown; practice state is derived from `branches.state` rather than chosen.

Consequences worth holding on to:

- A lawyer whose branch has not joined **cannot register at all**. That is the accepted cost of the decision, and it makes branch onboarding a launch blocker rather than a later task.
- The `individual` role remains in the enum for existing rows but is never assigned.
- Branch options are served by `list_branches_for_signup()`, not by widening the policy on `branches`. The screen is unauthenticated, and branch rows carry account numbers that anonymous callers must not read.

## Material conflicts

### 1. Subscription model is completely different from the spec

| | SPEC.md section 7 | Mockups |
|---|---|---|
| Axis | Duration: weekly, monthly, quarterly, yearly | Feature tier: Basic, Standard, Premium |
| Yearly price | ₦180,000 standard, ₦162,000 branch discounted | ₦10,000 Standard, ₦25,000 Premium |
| Second axis | Branch discount applied automatically | None |
| Free tier | Calculations always free, no subscription | "Basic: limited calculations" |

These are not reconcilable by tweaking numbers. The yearly figure differs by 18x, the pricing axis is different, and the branch discount that the whole branch-code registration flow exists to deliver is absent from the plan screen. The mockups also add Team access and API access, which appear nowhere in the brief.

The `subscriptions` table encodes the spec's model: `plan` is an enum of the four durations and `rate_type` is `standard` or `branch_discounted`. If the mockups win, that schema changes.

**This needs a client decision before Phase 3.** My recommendation is that the spec's model is the one the brief actually describes, and the mockup pricing looks like placeholder content rather than a considered pricing change. Confirm before building either.

### 2. In-app card payment will get the iOS build rejected

The Payment Method screen offers "Pay Now ₦10,000" by card through Paystack, inside the app. SPEC.md section 2 flags precisely this: Apple requires digital subscriptions sold inside an iOS app to use In-App Purchase, and routing a subscription through Paystack in-app is a rejection. Bank transfer and USSD for a *subscription* have the same problem.

This does not affect Android as sharply and does not affect a PWA at all. The screen is fine to build for web or PWA delivery. It cannot ship as-is to the App Store.

The platform decision in SPEC.md section 2 has to be made before this screen is wired to anything.

### 3. Users can change their own branch

Edit Profile exposes Branch Affiliation as a free dropdown. The database deliberately forbids this: `protect_profile_columns` raises 42501 if a non-admin changes `branch_id`, `role` or `scn`.

Branch affiliation determines the discounted subscription rate and which branch admin verifies your payments and issues your BAIN. Self-service switching is an integrity hole: a practitioner could move to whichever branch is cheapest or least strict, mid-transaction.

Note the same screen correctly locks SCN with "SCN cannot be changed once verified". Branch deserves the same treatment, or an explicit admin-approved transfer flow.

Practice State on that screen is genuinely user editable and the schema already allows it.

### 4. Document types in the mockups exceed the schema

The transactions list shows Tenancy Agreement and Legal Consultation. The `document_type` enum currently covers Scale 4 property instruments only: assignment, conveyance, mortgage, lease, sublease, deed_of_gift, power_of_attorney.

- Tenancy Agreement is probably `lease` under a friendlier label. Needs a display-name mapping rather than a new type.
- Legal Consultation is Scale 1, not Scale 4, and the card shows "Hourly Rate" with no consideration value at all. The `transactions.consideration` column is `not null`. Supporting consultations means either making consideration nullable or modelling hourly items separately.

Scale 1 is out of scope for v1 per SPEC.md section 10. Either drop consultations from the mockups or widen v1 scope deliberately.

### 5. The instrument is cited incorrectly, including on the certificate

The calculator result card reads "Per NBA Remuneration Order 2023" and the certificate body certifies compliance with "the standard fee guidelines of the Nigerian Bar Association".

SPEC.md section 10 established that the instrument is the **Legal Practitioners (Remuneration for Business, Legal Services and Representation) Order, 2023**, made under section 15(3) of the Legal Practitioners Act by the Legal Practitioners Remuneration Committee, chaired by the Attorney General of the Federation. It is not an NBA instrument.

On a certificate that a land registry or opposing counsel may rely on, attributing the fee scale to the wrong body is a real defect and not a copy nitpick. Correct the wording on both screens.

### 6. No verification affordance anywhere

None of the certificate screens carry a QR code or a verification URL. SPEC.md blocking question 9 and section 6 call for a public lookup by BAIN plus a QR code, without which the certificate is trivially forgeable and the product's core value is undermined. The certificate detail screen has room for it beside the chairman signature.

## Minor discrepancies

- **Upload size limit.** Mockup says max 5MB, spec says 10MB. Trivial, pick one. Scanned bank slips from older phones can exceed 5MB, so 10MB is the safer number.
- **Registration branch code.** The Individual tab shows no branch code field. The branch-code entry that drives `branch_member` role assignment presumably lives on the Branch tab, which was not supplied. Needed before registration can be built fully.
- **"Request Archive"** on the certificates screen is a feature that appears nowhere in the brief. Confirm whether it is real or placeholder.
- **Certificate consideration is displayed.** That is fine on the owner's private certificate. Only the public verification page must omit consideration and party names.

## Design tokens observed

Extracted for the theme file so the app matches the mockups.

| Token | Value | Used for |
|---|---|---|
| Primary green | approx `#0B5D33` | Buttons, headings, active tab, certificate border |
| Accent amber | approx `#F5C33B` | Active tab pill, "Awaiting Payment" badge |
| Page background | approx `#F7F8F7` | All screens |
| Surface | `#FFFFFF` | Cards |
| Border | approx `#E3E6E3` | Card and input outlines |
| Body text | near `#1A1A1A` | Labels and values |
| Muted text | approx `#6B7280` | Helper text, captions |
| Radius | 8px inputs, 12px cards, 10px buttons | |
| Status colours | grey pending, amber awaiting payment, green verified | Transaction badges |

Tab bar is four items: Calculator, Transactions, Certificates, Profile. Active tab uses an amber pill on the Transactions and Certificates screens but plain green on the Calculator screen. Pick one and apply consistently.

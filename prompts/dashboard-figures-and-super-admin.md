# Dashboard figures, and a second super administrator

## Goal

1. Make **Uzoma Charles Dioha** (`legalpracticeonline@gmail.com`) a full super administrator.
2. Add subscription, revenue and money-held figures to the console Overview, plus a branch-by-branch table for the super administrator.

Branch: `feat/dashboard-figures`, from `main` (9aec00c). Two migrations, one console page, one new test suite. No new dependencies. Nothing committed by me.

## What I found

- **The account:** Uzoma Charles Dioha, approved member of NBA Anaocha Branch and its chairman, with SCN-097248. He has 6 transactions:
  - 4 verified, but his share of the fee has not yet been recorded as paid out;
  - 2 awaiting payment.

  He has one active subscription, recorded at ₦0 until October 2027. He signed in today.
- **Subscriptions:** there are 2 rows, both entered by hand. **Neither has a Paystack reference**, so no subscription money has actually come through the system yet.
- **Money held for practitioners:** verified transactions not yet recorded as paid out total ₦40,327,000.
- **The dashboard** (`web/app/(console)/dashboard/page.tsx`) runs seven queries in the browser and adds up verified branch fees there. "Active Practitioners" counts `branch_member` only. Since 17 October that misses administrators, who practise too.
- **Who can read what:** a branch admin can already read their branch's profiles, transactions and subscriptions; a super admin can read everything.

## Part 1: promote him

Done by migration, because the console deliberately offers no route to `super_admin`. In one transaction:

- Check that exactly one profile matches `legalpracticeonline@gmail.com` and that it is currently `branch_member`. Otherwise the migration stops and changes nothing.
- Set `role = 'super_admin'`, `branch_id = null` and `practice_state = null`, the same treatment the first super admin got in `20260922120000`.

What changes for him (you chose this):
- He is signed out of the mobile and practitioner apps and can no longer invoice.
- He signs in to the console instead and sees every branch.

What stays the same:
- His 6 transactions and 4 certificates stay valid, and public verification still works.
- Anaocha's two admins can still record paying out his share on the 4 verified ones.
- His 2 invoices awaiting payment can no longer be taken further. Anaocha may want to cancel those.
- The chairman's name and signature on the branch record are separate data and are not touched.
- His ₦0 subscription row stays as history.

## Part 2: dashboard figures

### A database function

Migration `dashboard_summary()`. A SQL function that runs with the caller's own permissions (`security invoker`), so the existing permission rules decide what it counts: one branch for a branch admin, everything for the super admin. It returns one JSON object:

| Figure | Definition |
|---|---|
| `subscribers` | Distinct practitioners with an `active` subscription whose `expires_at` is in the future |
| `practitioners` | Approved `branch_member` **and** `branch_admin` profiles. This also fixes the existing tile. |
| `expiring_30d` | Subscribers whose subscription ends within 30 days |
| `revenue_total`, `revenue_month` | Sum of `amount` for subscriptions **with a Paystack reference**, all time and this calendar month. Rows entered by hand are excluded, so the figure is ₦0 until Paystack is live. |
| `revenue_by_plan` | The same, split by monthly, quarterly and yearly |
| `held_for_practitioners` | Sum of `due_to_practitioner` where `status = 'verified'` and `remitted_at` is null |
| `branches[]` | Per branch: name, practitioners, subscribers, pending verifications, branch fees verified, held for practitioners. For a branch admin it contains just their own branch. |

Who may run it: `authenticated` only, not anon.

### The page

- **New tiles:** Subscribed Practitioners ("2 of 9"), Subscription Revenue (with this month's figure underneath), and Held for Practitioners.
- **All branch admins** see these tiles, for their own branch, revenue included, as you chose.
- **Revenue note:** below the revenue figure, a short line says it counts only subscriptions paid through Paystack, so ₦0 is not mistaken for a bug.
- **Super admin only:** a "By Branch" table below the chart, one row per branch.
- The existing tiles, chart and Recent Activity stay as they are. "Active Practitioners" now includes administrators.

## Security

- The function adds no permissions, because it runs with the caller's own rights.
- **New test suite 15:**
  - A branch admin's summary covers only their branch: counts, revenue and `branches[]` all checked against a second branch.
  - A member gets only their own subscription and transactions counted.
  - Anyone not signed in is refused.
  - A subscription without a Paystack reference is not counted as revenue.
- **Promotion migration:** a dry run first, checking that he ends up `super_admin` with no branch and that the first super admin is untouched.

## Checks

- Every pgTAP suite runs in a rolled-back dry run against the hosted database, with both migrations applied.
- `web/`: `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- Applying the migrations to the hosted database waits for your go-ahead, as before.

## Manual test

1. Sign in to the console as the existing super admin. The Overview shows the new tiles and the By Branch table with both branches.
2. Sign in as an Anaocha admin. You see only Anaocha's figures and no By Branch table.
3. Sign in as `legalpracticeonline@gmail.com`:
   - in the console, you see the platform view (Administrators, All Branches);
   - in the mobile or practitioner app, you are refused with the super administrator message.

## Not included

- "New signups this month" was in my first list but not among your picks. It's easy to add to the same function if you want it.
- Real revenue depends on Paystack, which is still blocked on the live key.

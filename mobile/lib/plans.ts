/**
 * Subscription plans.
 *
 * Prices are the client's, set 10 October 2026: Monthly ₦30,000, Quarterly
 * ₦85,000, Yearly ₦300,000. They replace placeholders of ₦1,500, ₦4,000 and
 * ₦14,000 that were never charged.
 *
 * Two earlier decisions are settled and are reflected here.
 *
 * Every practitioner pays for their own subscription. A branch no longer
 * subscribes on behalf of its members, so there is no branch-discounted rate
 * and no second price for the same plan. `rateType` stays on the row because
 * the database column is not null, but every plan is `standard` now, and the
 * branch-discounted value survives only for subscriptions already sold at it.
 *
 * Pricing is by duration rather than by feature tier. The Basic, Standard and
 * Premium tiers from the mockups are withdrawn: the schema has always modelled
 * durations, and a tier model would need a migration as well as a rewrite.
 *
 * These amounts are only what the app displays. When payment is wired, the
 * price charged must come from the server, never from this file, or a client
 * could choose what it pays.
 */

import type { SubscriptionPlan, SubscriptionRateType } from './database.types';

export interface PlanOption {
  id: string;
  name: string;
  /** Price in kobo. */
  amount: number;
  /** Roughly what the plan costs per month, for comparing durations. */
  perMonthHint: string;
  /** Maps to the subscriptions.plan enum. */
  plan: SubscriptionPlan;
  rateType: SubscriptionRateType;
  highlighted?: boolean;
}

/**
 * What a subscription buys, which is the same whichever duration is chosen.
 * Calculating a fee is free and always will be; a subscription is what turns a
 * calculation into an invoice, and a verified payment into a certificate.
 */
export const subscriptionIncludes: readonly string[] = [
  'Unlimited fee calculations, which are free in any case',
  'Payment invoices to issue to your client',
  'Terms of engagement letters for your client',
  'Branch verification of your payment',
  'Certificate of Compliance, with a publicly verifiable reference',
];

/**
 * The durations offered for sale.
 *
 * Weekly is withdrawn: a week is too short a term to be worth renewing and it
 * undercut the monthly rate per month. The value stays in the
 * subscription_plan enum and in the label map on the profile screen, because
 * subscriptions already sold as weekly still have to be displayed.
 */
export const planOptions: readonly PlanOption[] = [
  {
    id: 'monthly',
    name: 'Monthly',
    amount: 30_000 * 100,
    perMonthHint: '₦30,000 a month',
    plan: 'monthly',
    rateType: 'standard',
  },
  {
    id: 'quarterly',
    name: 'Quarterly',
    amount: 85_000 * 100,
    perMonthHint: 'about ₦28,333 a month',
    plan: 'quarterly',
    rateType: 'standard',
    highlighted: true,
  },
  {
    id: 'yearly',
    name: 'Yearly',
    amount: 300_000 * 100,
    perMonthHint: '₦25,000 a month',
    plan: 'yearly',
    rateType: 'standard',
  },
];

export function findPlan(id: string): PlanOption | undefined {
  return planOptions.find((plan) => plan.id === id);
}

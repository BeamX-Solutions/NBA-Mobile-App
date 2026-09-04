/**
 * Subscription plans.
 *
 * PLACEHOLDER PRICING, set 4 September 2026 pending the real figures.
 *
 * Two decisions are settled and are reflected here.
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
 * The amounts below are deliberately low placeholders. They are not the
 * client's figures and must not be charged.
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
 * calculation into a receipt, and a verified payment into a certificate.
 */
export const subscriptionIncludes: readonly string[] = [
  'Unlimited fee calculations, which are free in any case',
  'Payment receipts to issue to your client',
  'Branch verification of your payment',
  'Certificate of Compliance, with a publicly verifiable reference',
];

export const planOptions: readonly PlanOption[] = [
  {
    id: 'weekly',
    name: 'Weekly',
    amount: 500 * 100,
    perMonthHint: 'about ₦2,000 a month',
    plan: 'weekly',
    rateType: 'standard',
  },
  {
    id: 'monthly',
    name: 'Monthly',
    amount: 1_500 * 100,
    perMonthHint: '₦1,500 a month',
    plan: 'monthly',
    rateType: 'standard',
  },
  {
    id: 'quarterly',
    name: 'Quarterly',
    amount: 4_000 * 100,
    perMonthHint: 'about ₦1,333 a month',
    plan: 'quarterly',
    rateType: 'standard',
    highlighted: true,
  },
  {
    id: 'yearly',
    name: 'Yearly',
    amount: 14_000 * 100,
    perMonthHint: 'about ₦1,167 a month',
    plan: 'yearly',
    rateType: 'standard',
  },
];

export function findPlan(id: string): PlanOption | undefined {
  return planOptions.find((plan) => plan.id === id);
}

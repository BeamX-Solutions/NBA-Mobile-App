/**
 * Subscription plans.
 *
 * PLACEHOLDER PRICING. These figures come from the mockups and are treated as
 * provisional, because they conflict with the brief in a way nobody has yet
 * resolved (DESIGN_REVIEW.md item 1):
 *
 *   mockups  Basic free, Standard ₦10,000/yr, Premium ₦25,000/yr
 *   brief    weekly ₦7,000 through yearly ₦180,000, with a branch discount
 *
 * The two differ by 18x on a different pricing axis, and the branch discount
 * that the whole branch-code registration flow exists to deliver is absent
 * from the mockups entirely.
 *
 * The `plan` and `rateType` fields below map onto the subscriptions table,
 * whose enums follow the brief's duration model. When the real model is
 * settled, change this file. If it turns out to be tier-based, the enum in
 * the database changes too and that needs a migration.
 */

import type { SubscriptionPlan, SubscriptionRateType } from './database.types';

export interface PlanOption {
  id: string;
  name: string;
  /** Price in kobo. Zero for the free tier. */
  amount: number;
  /** Maps to the subscriptions.plan enum. */
  plan: SubscriptionPlan;
  rateType: SubscriptionRateType;
  features: { label: string; included: boolean }[];
  highlighted?: boolean;
}

export const planOptions: readonly PlanOption[] = [
  {
    id: 'basic',
    name: 'Basic',
    amount: 0,
    plan: 'yearly',
    rateType: 'standard',
    features: [
      { label: 'Limited calculations', included: true },
      { label: 'No certificates', included: false },
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    amount: 10_000 * 100,
    plan: 'yearly',
    rateType: 'standard',
    highlighted: true,
    features: [
      { label: 'Unlimited calculations', included: true },
      { label: 'Digital Certificates', included: true },
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    amount: 25_000 * 100,
    plan: 'yearly',
    rateType: 'standard',
    features: [
      { label: 'Unlimited calculations', included: true },
      { label: 'Digital Certificates', included: true },
      { label: 'Team access', included: true },
      { label: 'Priority support', included: true },
      { label: 'API access', included: true },
    ],
  },
];

export function findPlan(id: string): PlanOption | undefined {
  return planOptions.find((plan) => plan.id === id);
}

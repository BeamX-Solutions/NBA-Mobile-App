import type { DocumentType as EngineDocumentType } from '@/lib/fees';

/**
 * Database types, hand written to match the migrations in supabase/migrations.
 *
 * These are generated-shaped rather than generated, because the schema is not
 * yet pushed to a project we can run `supabase gen types` against. Once it is,
 * replace this file with generated output so it cannot drift from the schema.
 */

export type UserRole = 'individual' | 'branch_member' | 'branch_admin' | 'super_admin';

export type BranchActivationStatus = 'inactive' | 'active' | 'expired';

export type SubscriptionPlan = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type SubscriptionRateType = 'standard' | 'branch_discounted';

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';

export type TransactionStatus =
  | 'awaiting_payment'
  | 'pending_verification'
  | 'verified'
  | 'rejected';

/**
 * Mirrors the document_type enum in the database.
 *
 * Kept identical to DocumentType in lib/fees/types.ts. They are declared
 * separately because one describes the database and the other the engine, but
 * a divergence is a bug: the compile-time check at the bottom of this file
 * fails the build if they drift apart.
 */
export type DocumentTypeValue =
  | 'deed_of_assignment'
  | 'deed_of_conveyance'
  | 'deed_of_gift'
  | 'contract_of_sale'
  | 'deed_of_surrender'
  | 'deed_of_exchange'
  | 'mortgage_deed'
  | 'deed_of_release'
  | 'tenancy_agreement'
  | 'deed_of_lease'
  | 'deed_of_sub_lease'
  | 'power_of_attorney';

export interface Branch {
  id: string;
  name: string;
  branch_code: string;
  activation_status: BranchActivationStatus;
  activated_at: string | null;
  expires_at: string | null;
  account_name: string | null;
  account_number: string | null;
  bank_name: string | null;
  logo_url: string | null;
  chairman_name: string | null;
  chairman_signature_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  scn: string | null;
  branch_id: string | null;
  practice_state: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: SubscriptionPlan;
  rate_type: SubscriptionRateType;
  amount: number;
  starts_at: string;
  expires_at: string;
  status: SubscriptionStatus;
  paystack_reference: string | null;
  created_at: string;
  updated_at: string;
}

export interface Calculation {
  id: string;
  user_id: string;
  fee_scale_id: string;
  document_type: DocumentTypeValue;
  consideration: number;
  professional_fee: number;
  branch_fee: number;
  total: number;
  breakdown: unknown;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  branch_id: string;
  calculation_id: string | null;
  parties: string;
  document_type: DocumentTypeValue;
  consideration: number;
  amount_payable: number;
  receipt_number: string | null;
  proof_url: string | null;
  status: TransactionStatus;
  rejection_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  rbin: string | null;
  rbin_issued_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Certificate {
  id: string;
  transaction_id: string;
  certificate_number: string;
  issued_at: string;
  pdf_url: string | null;
  emailed_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Compile-time guarantee that the database enum and the engine's document
 * types stay identical. If either list gains or loses a member without the
 * other, this fails to compile rather than failing silently at runtime with a
 * document type the calculator cannot price.
 */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _documentTypesMatch: AssertEqual<DocumentTypeValue, EngineDocumentType> = true;
void _documentTypesMatch;

/** Signup metadata consumed by the handle_new_user trigger. */
export interface SignupMetadata extends Record<string, unknown> {
  full_name: string;
  phone?: string;
  scn?: string;
  branch_code?: string;
  practice_state?: string;
}

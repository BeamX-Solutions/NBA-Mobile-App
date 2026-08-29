/**
 * Types for the fee calculation engine.
 *
 * Ported from the NBA Remuneration Portal (src/lib/constants.ts), which is the
 * reference implementation for these scales. Two consequences of that, both
 * deliberate:
 *
 * 1. There is no State Band. An earlier reading of secondary sources suggested
 *    fees vary across three bands of states; the portal has no such dimension,
 *    and it is the implementation actually in use. State is no longer an input.
 *
 * 2. Scale 4 is three sub-scales, not one table. Conveyancing, mortgages and
 *    leases have different rates AND different bases, so the document type
 *    selects both.
 */

/** Which sub-scale of Scale 4 a document falls under. */
export type ScaleCode = '4A' | '4B' | '4C' | 'discretionary';

/**
 * What amount the fee is calculated on. This differs per document type, and
 * getting it wrong produces a plausible but incorrect fee, so it is modelled
 * explicitly rather than left as "the consideration".
 */
export type FeeBasis =
  | 'consideration'
  | 'market_value'
  | 'purchase_price'
  | 'higher_property_value'
  | 'unexpired_interest_value'
  | 'principal_loan'
  | 'original_loan'
  | 'annual_rent'
  | 'discretionary';

/** Document types covered, matching the portal's DOC_TYPE_LABELS. */
export type DocumentType =
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

export const documentTypeLabels: Record<DocumentType, string> = {
  deed_of_assignment: 'Deed of Assignment',
  deed_of_conveyance: 'Deed of Conveyance',
  deed_of_gift: 'Deed of Gift',
  contract_of_sale: 'Contract of Sale',
  deed_of_surrender: 'Deed of Surrender',
  deed_of_exchange: 'Deed of Exchange',
  mortgage_deed: 'Mortgage Deed',
  deed_of_release: 'Deed of Release / Discharge of Mortgage',
  tenancy_agreement: 'Tenancy Agreement',
  deed_of_lease: 'Deed of Lease',
  deed_of_sub_lease: 'Deed of Sub-Lease',
  power_of_attorney: 'Irrevocable Power of Attorney',
};

interface DocumentTypeMeta {
  scale: ScaleCode;
  basis: FeeBasis;
  /** Label for the amount input, so the user enters the right figure. */
  basisLabel: string;
  /** Who pays the full scale fee, and who pays half. */
  fullRateParty: string;
  halfRateParty: string | null;
}

/**
 * Per document type: which sub-scale applies, what the fee is computed on, and
 * which side pays full rate.
 *
 * The basis matters as much as the rate. A tenancy is charged on ANNUAL RENT,
 * not on the total value of the lease, so entering a five year rent roll where
 * an annual figure is expected overstates the fee fivefold.
 */
export const documentTypeMeta: Record<DocumentType, DocumentTypeMeta> = {
  deed_of_assignment: {
    scale: '4A',
    basis: 'consideration',
    basisLabel: 'Consideration / purchase price',
    fullRateParty: "Assignee's practitioner",
    halfRateParty: "Assignor's practitioner",
  },
  deed_of_conveyance: {
    scale: '4A',
    basis: 'consideration',
    basisLabel: 'Consideration / purchase price',
    fullRateParty: "Purchaser's practitioner",
    halfRateParty: "Vendor's practitioner",
  },
  deed_of_gift: {
    scale: '4A',
    basis: 'market_value',
    basisLabel: 'Market value of the property',
    fullRateParty: "Donee's practitioner",
    halfRateParty: "Donor's practitioner",
  },
  contract_of_sale: {
    scale: '4A',
    basis: 'purchase_price',
    basisLabel: 'Purchase price',
    fullRateParty: "Purchaser's practitioner",
    halfRateParty: "Vendor's practitioner",
  },
  deed_of_surrender: {
    scale: '4A',
    basis: 'unexpired_interest_value',
    basisLabel: 'Value of the unexpired lease interest',
    fullRateParty: 'Practitioner assessing the surrendered interest',
    halfRateParty: null,
  },
  deed_of_exchange: {
    scale: '4A',
    basis: 'higher_property_value',
    basisLabel: 'Higher of the two property values',
    fullRateParty: "Each party's practitioner, charged separately",
    halfRateParty: null,
  },
  mortgage_deed: {
    scale: '4B',
    basis: 'principal_loan',
    basisLabel: 'Principal loan amount',
    fullRateParty: "Mortgagee's practitioner",
    halfRateParty: "Mortgagor's practitioner",
  },
  deed_of_release: {
    scale: '4B',
    basis: 'original_loan',
    basisLabel: 'Original loan amount being discharged',
    fullRateParty: "Mortgagee's practitioner",
    halfRateParty: "Mortgagor's practitioner",
  },
  tenancy_agreement: {
    scale: '4C',
    basis: 'annual_rent',
    basisLabel: 'Annual rental value',
    fullRateParty: "Landlord's practitioner",
    halfRateParty: "Tenant's practitioner",
  },
  deed_of_lease: {
    scale: '4C',
    basis: 'annual_rent',
    basisLabel: 'Annual rental value',
    fullRateParty: "Lessor's practitioner",
    halfRateParty: "Lessee's practitioner",
  },
  deed_of_sub_lease: {
    scale: '4C',
    basis: 'annual_rent',
    basisLabel: 'Annual rental value',
    fullRateParty: "Sub-Lessor's practitioner",
    halfRateParty: "Sub-Lessee's practitioner",
  },
  power_of_attorney: {
    scale: 'discretionary',
    basis: 'discretionary',
    basisLabel: 'Not applicable',
    fullRateParty: 'Agreed with the client',
    halfRateParty: null,
  },
};

/**
 * One band of a sub-scale. Bands are MARGINAL: the rate applies only to the
 * portion of the amount inside the band, the way income tax works.
 *
 * All money values are integer kobo.
 */
export interface FeeScaleBand {
  /** Inclusive lower bound of the band, in kobo. */
  min: number;
  /** Exclusive upper bound in kobo, or null for the open ended top band. */
  max: number | null;
  /** Percentage applied to the portion inside this band, for example 10. */
  percentage: number;
}

export interface FeeScale {
  id: string;
  orderName: string;
  effectiveFrom: string;
  /** Bands per sub-scale. Power of Attorney has none: it is discretionary. */
  bands: Record<'4A' | '4B' | '4C', FeeScaleBand[]>;
  /**
   * True when the figures are not the published Schedule. These rates come
   * from the portal rather than a machine readable copy of the Order, so this
   * stays true until the Schedule itself has been checked line by line.
   */
  isProvisional: boolean;
}

/** One line of the calculation, so the user can see how the total was reached. */
export interface FeeBreakdownLine {
  /** Human readable band description, for example "First ₦50,000,000 at 10%". */
  description: string;
  /** Portion of the amount charged in this band, in kobo. */
  portion: number;
  percentage: number;
  /** Amount contributed by this band, in kobo. */
  amount: number;
}

export interface FeeCalculationInput {
  documentType: DocumentType;
  /** The amount the fee is computed on, in kobo. See documentTypeMeta.basis. */
  amount: number;
}

export interface FeeCalculationResult {
  input: FeeCalculationInput;
  scale: ScaleCode;
  basis: FeeBasis;
  feeScaleId: string;
  /** Prescribed minimum for the practitioner on the full rate side, in kobo. */
  professionalFee: number;
  /**
   * Half the scale fee, for the practitioner acting for the other party.
   * Null where the document type has no half rate counterpart.
   */
  halfRateFee: number | null;
  /** Amount payable to the NBA branch, in kobo. */
  branchFee: number;
  /** professionalFee plus branchFee, in kobo. */
  total: number;
  breakdown: FeeBreakdownLine[];
  isProvisional: boolean;
}

/**
 * Thrown when the engine cannot produce a trustworthy number.
 *
 * The engine must never quietly return zero: a wrong fee is a professional
 * liability for the practitioner relying on it. Power of Attorney throws by
 * design, because it is not a Scale 4 instrument and has no computable fee.
 */
export class FeeCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeCalculationError';
  }
}

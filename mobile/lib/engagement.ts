import { ORDER_FULL_NAME } from '@/lib/branding';
import { documentTypeLabels, documentTypeMeta, type FeeCalculationResult } from '@/lib/fees';
import { formatNaira } from '@/lib/money';

/**
 * Terms of engagement, generated from a calculation.
 *
 * Paragraph 4 of the Legal Practitioners (Remuneration for Business, Legal
 * Services and Representation) Order, 2023 requires a legal practitioner to
 * issue written terms of engagement to the client within 14 days of taking
 * instructions. SPEC.md section 10 noted that the app already holds everything
 * such a letter needs, and called generating it "an obvious and cheap feature
 * addition". This is that.
 *
 * What this is NOT: it is not a retainer agreement, and it does not attempt to
 * be one. It states the parties, the work, the basis of charge, the figure and
 * what is excluded from it. A practitioner remains free to issue their own
 * fuller terms; this exists so that a practitioner who would otherwise issue
 * nothing at all issues something compliant on the day they take instructions.
 *
 * The fee shown is the prescribed minimum, and the letter says so in those
 * words. A letter that presented the scale figure as "the fee" would misstate
 * the Order, which sets a floor rather than a price, and would also misstate
 * the practitioner's own position: they may charge above it freely, and below
 * it only on application to the Bar Remuneration Committee.
 */

export interface EngagementFacts {
  practitionerName: string;
  scn: string | null;
  clientName: string;
  matter: string;
  result: FeeCalculationResult;
  /** When instructions were taken. The 14 day clock runs from this. */
  instructedOn: Date;
}

export interface EngagementTerm {
  heading: string;
  body: string;
}

/** The deadline the Order sets for issuing these terms. */
export function termsDueBy(instructedOn: Date): Date {
  const due = new Date(instructedOn);
  due.setDate(due.getDate() + 14);
  return due;
}

/**
 * The body of the letter, as headed paragraphs.
 *
 * Assembled here rather than inside the PDF template for the same reason the
 * certificate's particulars are: the figures a client is quoted must not be
 * able to drift from the figures the calculator produced, and keeping one
 * source makes that a matter of construction rather than of vigilance.
 */
export function engagementTerms(facts: EngagementFacts): EngagementTerm[] {
  const { result } = facts;
  const meta = documentTypeMeta[result.input.documentType];
  const terms: EngagementTerm[] = [];

  terms.push({
    heading: 'The instruction',
    body:
      `You have instructed me in connection with ${facts.matter}. The work is the preparation ` +
      `of a ${documentTypeLabels[result.input.documentType]}, which falls under Scale ` +
      `${result.scale} of the ${ORDER_FULL_NAME}.`,
  });

  terms.push({
    heading: 'Basis of charge',
    body:
      `The fee for this class of work is fixed by the Order and is calculated on ` +
      `${meta.basisLabel.toLowerCase()}, which in this matter is ` +
      `${formatNaira(result.input.amount)}. The rates are applied in bands rather than as a ` +
      'single percentage, so each portion of the value is charged at its own rate.',
  });

  const breakdown = result.breakdown
    .map((line) => `${line.description}: ${formatNaira(line.amount)}`)
    .join('; ');

  terms.push({
    heading: 'The fee',
    body:
      `${formatNaira(result.professionalFee)}, being the prescribed minimum professional fee. ` +
      `This is made up as follows. ${breakdown}. The figures prescribed by the Order are ` +
      'minimums and not fixed prices: a practitioner may agree a higher fee, and may charge ' +
      'below the scale only on application to the Bar Remuneration Committee.',
  });

  if (result.halfRateFee !== null && meta.halfRateParty !== null) {
    terms.push({
      heading: 'The other party',
      body:
        `Where ${meta.halfRateParty.toLowerCase()} is separately represented, that practitioner ` +
        `is entitled under the Order to half the scale fee, being ` +
        `${formatNaira(result.halfRateFee)}. That sum is not payable to me and is stated here ` +
        'only so that the total cost of the transaction is clear to you.',
    });
  }

  terms.push({
    heading: 'Branch fee and registration',
    body:
      `A fee of ${formatNaira(result.branchFee)} is payable to the Nigerian Bar Association ` +
      'branch in respect of the registration of this document and the issue of a Certificate ' +
      `of Compliance. Taken with the professional fee, the total is ${formatNaira(result.total)}.`,
  });

  terms.push({
    heading: 'What is not included',
    body:
      'Value Added Tax is chargeable on the professional fee at the prevailing rate and is not ' +
      'included in the figures above. Disbursements are also excluded and are payable in ' +
      'addition: these commonly include stamp duty, registration fees, search fees and the ' +
      "cost of obtaining the Governor's Consent where it is required.",
  });

  terms.push({
    heading: 'Verification',
    body:
      'On completion, and once the branch fee has been paid and verified, a Certificate of ' +
      'Compliance will be issued carrying a unique reference. That reference can be checked ' +
      'independently by any third party, including a land registry, to confirm the document ' +
      'was prepared by a legal practitioner in good standing.',
  });

  return terms;
}

/** The closing statement, which is what makes the letter answer the Order. */
export const ENGAGEMENT_CLOSING =
  'These terms are issued to you in writing in compliance with the requirement that a legal ' +
  'practitioner deliver written terms of engagement to the client within fourteen days of ' +
  'accepting instructions. Please retain this letter. If anything in it does not reflect your ' +
  'understanding of what you have instructed me to do, tell me before the work proceeds.';

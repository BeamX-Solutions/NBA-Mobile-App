import { BRANCH_SHARE_PERCENTAGE } from './scale-2023';
import {
  documentTypeLabels,
  documentTypeMeta,
  FeeCalculationError,
  type FeeBreakdownLine,
  type FeeCalculationInput,
  type FeeCalculationResult,
  type FeeScale,
  type FeeScaleBand,
} from './types';

/**
 * Formats kobo as naira for a breakdown line, without decimals.
 *
 * Kept local rather than imported from lib/money so the engine stays free of
 * UI concerns and can be unit tested with no React Native in the way.
 */
function formatBound(kobo: number): string {
  return `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;
}

function describeBand(band: FeeScaleBand, isFirst: boolean): string {
  if (isFirst) {
    return band.max === null
      ? `All of the amount at ${band.percentage}%`
      : `First ${formatBound(band.max)} at ${band.percentage}%`;
  }
  if (band.max === null) {
    return `Above ${formatBound(band.min)} at ${band.percentage}%`;
  }
  return `${formatBound(band.min)} to ${formatBound(band.max)} at ${band.percentage}%`;
}

/**
 * Calculates the prescribed minimum fee for a document.
 *
 * Bands are marginal: each rate applies only to the portion of the amount
 * that falls inside its band, so the result is the sum across bands rather
 * than a single percentage of the whole. This matters at the boundaries. A
 * ₦60,000,000 conveyance is not 5% of ₦60M; it is 10% of the first ₦50M plus
 * 5% of the remaining ₦10M.
 *
 * Rounding is applied once, to the final total, rather than per band. Rounding
 * each band and summing would let a rounding error accumulate with the number
 * of bands crossed, so two amounts either side of a boundary could differ by
 * more than the boundary itself justifies.
 *
 * @param scale  The scale to apply. Pass the snapshot stored with a saved
 *               calculation to reproduce it exactly after the Order changes.
 * @param input  Document type and the amount, in kobo. Which amount that is
 *               depends on the document type; see documentTypeMeta.basis.
 */
export function calculateFee(scale: FeeScale, input: FeeCalculationInput): FeeCalculationResult {
  const meta = documentTypeMeta[input.documentType];
  if (meta === undefined) {
    throw new FeeCalculationError(`Unknown document type: ${input.documentType}`);
  }

  // Power of Attorney is not a Scale 4 instrument. It is charged under
  // paragraph 2 of the Order by agreement, so there is no figure to compute.
  // Throwing is deliberate: returning zero would read as "this is free".
  if (meta.scale === 'discretionary') {
    throw new FeeCalculationError(
      `${documentTypeLabels[input.documentType]} is not covered by Scale 4. The fee is agreed with the client under paragraph 2 of the Order, having regard to complexity, time and value.`
    );
  }

  if (!Number.isFinite(input.amount)) {
    throw new FeeCalculationError('The amount must be a number.');
  }
  if (input.amount < 0) {
    throw new FeeCalculationError('The amount cannot be negative.');
  }
  if (!Number.isInteger(input.amount)) {
    throw new FeeCalculationError('The amount must be a whole number of kobo.');
  }

  const bands = scale.bands[meta.scale];
  if (bands === undefined || bands.length === 0) {
    throw new FeeCalculationError(
      `No bands are configured for Scale ${meta.scale}. The fee cannot be calculated.`
    );
  }

  const breakdown: FeeBreakdownLine[] = [];
  let feeInKobo = 0;

  bands.forEach((band, index) => {
    if (input.amount <= band.min) {
      return;
    }
    const upper = band.max === null ? input.amount : Math.min(input.amount, band.max);
    const portion = upper - band.min;
    if (portion <= 0) {
      return;
    }
    const amount = (portion * band.percentage) / 100;
    feeInKobo += amount;
    breakdown.push({
      description: describeBand(band, index === 0),
      portion,
      percentage: band.percentage,
      amount: Math.round(amount),
    });
  });

  // An amount of zero produces no bands and therefore no fee. That is a real
  // answer, not a failure, so it is returned rather than thrown.
  const professionalFee = Math.round(feeInKobo);
  const branchFee = Math.round((professionalFee * BRANCH_SHARE_PERCENTAGE) / 100);

  return {
    input,
    scale: meta.scale,
    basis: meta.basis,
    feeScaleId: scale.id,
    professionalFee,
    // The practitioner for the other party is entitled to half the scale fee.
    halfRateFee: meta.halfRateParty === null ? null : Math.round(professionalFee / 2),
    branchFee,
    total: professionalFee + branchFee,
    breakdown,
    isProvisional: scale.isProvisional,
  };
}

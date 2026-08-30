import { calculateFee } from './calculate';
import { scale2023 } from './scale-2023';
import { documentTypeLabels, documentTypeMeta, FeeCalculationError } from './types';
import type { DocumentType } from './types';

const NAIRA = 100;

function feeFor(documentType: DocumentType, naira: number): number {
  return calculateFee(scale2023, { documentType, amount: naira * NAIRA }).professionalFee;
}

/**
 * The portal's formulas, transcribed verbatim from
 * nba-remuneration-portal/src/lib/constants.ts, in naira.
 *
 * These are the oracle for the whole engine. The engine expresses the scales
 * as marginal bands and the portal expresses them as running totals; if the
 * two ever disagree, one of them has a bug. Checking against an independently
 * written formula catches errors that testing the implementation against
 * itself never would.
 */
const portal = {
  conveyancing: (amount: number): number => {
    if (!amount || amount <= 0) return 0;
    if (amount < 50_000_000) return amount * 0.1;
    if (amount <= 100_000_000) return 5_000_000 + (amount - 50_000_000) * 0.05;
    return 7_500_000 + (amount - 100_000_000) * 0.03;
  },
  mortgage: (amount: number): number => {
    if (!amount || amount <= 0) return 0;
    if (amount < 50_000_000) return amount * 0.04;
    if (amount <= 100_000_000) return 2_000_000 + (amount - 50_000_000) * 0.03;
    // The portal has 4_500_000 here. That is a bug: it makes the fee jump by
    // ₦1,000,000 the moment the loan passes ₦100M, so a ₦100,000,000 mortgage
    // costs ₦3,500,000 and a ₦100,000,001 one costs ₦4,500,000.
    //
    // The band arithmetic gives the correct running total: ₦50M at 4% is
    // ₦2,000,000, plus ₦50M at 3% is ₦1,500,000, so the base above ₦100M is
    // ₦3,500,000. Scale 4A passes the same continuity check with a jump of
    // ₦0.03, which is rounding, so 4A is right and 4B is a transcription
    // error rather than a deliberate step in the Order.
    //
    // Corrected here rather than reproduced. Matching a bug that overcharges
    // clients on every large mortgage is not fidelity to the source.
    // See DESIGN_REVIEW.md, "Scale 4B discontinuity".
    return 3_500_000 + (amount - 100_000_000) * 0.02;
  },
  tenancy: (annualRent: number): number => {
    if (!annualRent || annualRent <= 0) return 0;
    if (annualRent < 5_000_000) return annualRent * 0.1;
    if (annualRent <= 10_000_000) return 500_000 + (annualRent - 5_000_000) * 0.05;
    return 750_000 + (annualRent - 10_000_000) * 0.05;
  },
};

describe('Scale 4A, conveyancing and assignments', () => {
  it.each([
    ['zero', 0, 0],
    ['well below the first boundary', 1_000_000, 100_000],
    ['just below ₦50M', 49_999_999, 4_999_999.9],
    ['exactly ₦50M', 50_000_000, 5_000_000],
    ['just above ₦50M', 50_000_001, 5_000_000.05],
    ['midway through the second band', 75_000_000, 6_250_000],
    ['exactly ₦100M', 100_000_000, 7_500_000],
    ['just above ₦100M', 100_000_001, 7_500_000.03],
    ['well above ₦100M', 250_000_000, 12_000_000],
  ])('%s: ₦%d gives ₦%d', (_label, amount, expected) => {
    expect(feeFor('deed_of_assignment', amount)).toBe(Math.round(expected * NAIRA));
  });

  it('agrees with the portal formula across the range', () => {
    for (const amount of [
      0, 1, 100_000, 49_999_999, 50_000_000, 50_000_001, 75_000_000, 99_999_999, 100_000_000,
      100_000_001, 500_000_000, 1_000_000_000,
    ]) {
      expect(feeFor('deed_of_assignment', amount)).toBe(Math.round(portal.conveyancing(amount) * NAIRA));
    }
  });

  it('applies to every 4A document type identically', () => {
    const types: DocumentType[] = [
      'deed_of_assignment',
      'deed_of_conveyance',
      'deed_of_gift',
      'contract_of_sale',
      'deed_of_surrender',
      'deed_of_exchange',
    ];
    for (const type of types) {
      expect(feeFor(type, 60_000_000)).toBe(Math.round(portal.conveyancing(60_000_000) * NAIRA));
    }
  });
});

describe('Scale 4B, mortgages', () => {
  it.each([
    ['zero', 0, 0],
    ['below ₦50M', 10_000_000, 400_000],
    ['exactly ₦50M', 50_000_000, 2_000_000],
    ['just above ₦50M', 50_000_001, 2_000_000.03],
    ['exactly ₦100M', 100_000_000, 3_500_000],
    ['above ₦100M', 200_000_000, 5_500_000],
  ])('%s: ₦%d gives ₦%d', (_label, amount, expected) => {
    expect(feeFor('mortgage_deed', amount)).toBe(Math.round(expected * NAIRA));
  });

  it('agrees with the portal formula across the range', () => {
    for (const amount of [
      0, 1, 49_999_999, 50_000_000, 50_000_001, 100_000_000, 100_000_001, 750_000_000,
    ]) {
      expect(feeFor('mortgage_deed', amount)).toBe(Math.round(portal.mortgage(amount) * NAIRA));
    }
  });

  it('charges a mortgage less than a conveyance of the same value', () => {
    expect(feeFor('mortgage_deed', 80_000_000)).toBeLessThan(feeFor('deed_of_assignment', 80_000_000));
  });

  it('does not jump by ₦1,000,000 at the ₦100M boundary, as the portal does', () => {
    // Regression guard for the portal bug described in the oracle above. A
    // fee that leaps by a million naira for one extra naira of loan is not a
    // scale, it is a cliff, and it would overcharge every mortgage above
    // ₦100M by exactly that amount.
    const at = feeFor('mortgage_deed', 100_000_000);
    const above = feeFor('mortgage_deed', 100_000_001);
    expect(at).toBe(3_500_000 * NAIRA);
    expect(above - at).toBeLessThanOrEqual(10 * NAIRA);
  });
});

describe('Scale 4C, leases and tenancies', () => {
  it.each([
    ['zero', 0, 0],
    ['below ₦5M', 1_200_000, 120_000],
    ['exactly ₦5M', 5_000_000, 500_000],
    ['just above ₦5M', 5_000_001, 500_000.05],
    ['exactly ₦10M', 10_000_000, 750_000],
    ['above ₦10M', 20_000_000, 1_250_000],
  ])('%s: annual rent ₦%d gives ₦%d', (_label, amount, expected) => {
    expect(feeFor('tenancy_agreement', amount)).toBe(Math.round(expected * NAIRA));
  });

  it('agrees with the portal formula across the range', () => {
    for (const amount of [0, 1, 4_999_999, 5_000_000, 5_000_001, 10_000_000, 10_000_001, 50_000_000]) {
      expect(feeFor('tenancy_agreement', amount)).toBe(Math.round(portal.tenancy(amount) * NAIRA));
    }
  });

  it('SUSPECT: the ₦10M boundary is inert because both bands charge 5%', () => {
    // Documents the known discrepancy rather than asserting it is correct.
    // If the published Schedule gives a different top rate, this test fails
    // and points at the band table, which is exactly the intended signal.
    // See DESIGN_REVIEW.md, "Scale 4C boundary".
    const justBelow = feeFor('tenancy_agreement', 9_999_999);
    const justAbove = feeFor('tenancy_agreement', 10_000_001);
    expect(justAbove - justBelow).toBe(Math.round(2 * 0.05 * NAIRA));
  });

  it('is charged on annual rent, so the basis is labelled accordingly', () => {
    expect(documentTypeMeta.tenancy_agreement.basis).toBe('annual_rent');
    expect(documentTypeMeta.deed_of_lease.basis).toBe('annual_rent');
    expect(documentTypeMeta.deed_of_sub_lease.basis).toBe('annual_rent');
  });
});

describe('marginal banding', () => {
  it('sums across bands rather than applying one rate to the whole amount', () => {
    // The whole point of marginal bands: 5% of ₦60M would be ₦3,000,000.
    expect(feeFor('deed_of_assignment', 60_000_000)).toBe(5_500_000 * NAIRA);
  });

  it('is continuous at every boundary, with no jump in the fee', () => {
    for (const boundary of [50_000_000, 100_000_000]) {
      const below = feeFor('deed_of_assignment', boundary - 1);
      const at = feeFor('deed_of_assignment', boundary);
      const above = feeFor('deed_of_assignment', boundary + 1);
      expect(at - below).toBeLessThanOrEqual(10 * NAIRA);
      expect(above - at).toBeLessThanOrEqual(10 * NAIRA);
    }
  });

  it('increases monotonically', () => {
    let previous = -1;
    for (let amount = 0; amount <= 200_000_000; amount += 2_500_000) {
      const fee = feeFor('deed_of_assignment', amount);
      expect(fee).toBeGreaterThanOrEqual(previous);
      previous = fee;
    }
  });

  it('shows its working, one line per band crossed', () => {
    const result = calculateFee(scale2023, {
      documentType: 'deed_of_assignment',
      amount: 150_000_000 * NAIRA,
    });
    expect(result.breakdown).toHaveLength(3);
    expect(result.breakdown[0].amount).toBe(5_000_000 * NAIRA);
    expect(result.breakdown[1].amount).toBe(2_500_000 * NAIRA);
    expect(result.breakdown[2].amount).toBe(1_500_000 * NAIRA);
    expect(result.breakdown.reduce((sum, line) => sum + line.amount, 0)).toBe(
      result.professionalFee
    );
  });
});

describe('half rate for the other party', () => {
  it('is half the scale fee where a counterpart exists', () => {
    const result = calculateFee(scale2023, {
      documentType: 'deed_of_assignment',
      amount: 60_000_000 * NAIRA,
    });
    expect(result.halfRateFee).toBe(Math.round(result.professionalFee / 2));
  });

  it('is null where the document type has no counterpart', () => {
    const exchange = calculateFee(scale2023, {
      documentType: 'deed_of_exchange',
      amount: 10_000_000 * NAIRA,
    });
    expect(exchange.halfRateFee).toBeNull();
  });
});

describe('Power of Attorney', () => {
  it('refuses to calculate, because it is not a Scale 4 instrument', () => {
    expect(() =>
      calculateFee(scale2023, { documentType: 'power_of_attorney', amount: 10_000_000 * NAIRA })
    ).toThrow(FeeCalculationError);
  });

  it('explains that the fee is agreed under paragraph 2', () => {
    expect(() =>
      calculateFee(scale2023, { documentType: 'power_of_attorney', amount: 0 })
    ).toThrow(/paragraph 2/);
  });
});

describe('input validation', () => {
  it.each([
    ['a negative amount', -1],
    ['a fractional kobo amount', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('refuses %s rather than guessing', (_label, amount) => {
    expect(() => calculateFee(scale2023, { documentType: 'deed_of_assignment', amount })).toThrow(
      FeeCalculationError
    );
  });

  it('refuses an unconfigured scale rather than returning zero', () => {
    const empty = { ...scale2023, bands: { ...scale2023.bands, '4A': [] } };
    expect(() =>
      calculateFee(empty, { documentType: 'deed_of_assignment', amount: 1_000_000 * NAIRA })
    ).toThrow(FeeCalculationError);
  });

  it('treats zero as a real answer, not an error', () => {
    const result = calculateFee(scale2023, { documentType: 'deed_of_assignment', amount: 0 });
    expect(result.professionalFee).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });
});

describe('result metadata', () => {
  it('flags the figures as provisional until the Schedule is verified', () => {
    const result = calculateFee(scale2023, {
      documentType: 'deed_of_assignment',
      amount: 1_000_000 * NAIRA,
    });
    expect(result.isProvisional).toBe(true);
  });

  it('snapshots the scale used, so a stored calculation stays reproducible', () => {
    const result = calculateFee(scale2023, {
      documentType: 'deed_of_assignment',
      amount: 1_000_000 * NAIRA,
    });
    expect(result.feeScaleId).toBe(scale2023.id);
    expect(result.scale).toBe('4A');
  });

  it('has a label and metadata for every document type', () => {
    for (const type of Object.keys(documentTypeLabels) as DocumentType[]) {
      expect(documentTypeLabels[type]).toBeTruthy();
      expect(documentTypeMeta[type]).toBeDefined();
      expect(documentTypeMeta[type].basisLabel).toBeTruthy();
    }
  });
});

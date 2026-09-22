import { engagementTerms, termsDueBy, type EngagementFacts } from '@/lib/engagement';
import { calculateFee, scale2023, type DocumentType } from '@/lib/fees';
import { formatNaira } from '@/lib/money';

const NAIRA = 100;
const MILLION = 1_000_000 * NAIRA;

function factsFor(documentType: DocumentType, amount: number): EngagementFacts {
  return {
    practitionerName: 'Adaeze Okonkwo',
    scn: 'SCN/2015/041287',
    clientName: 'Chinedu Obi',
    matter: 'the purchase of the property at 12 Ziks Avenue, Awka',
    result: calculateFee(scale2023, { documentType, amount }),
    instructedOn: new Date('2026-09-21T09:00:00Z'),
  };
}

function bodyOf(facts: EngagementFacts, heading: string): string {
  const term = engagementTerms(facts).find((t) => t.heading === heading);
  if (term === undefined) throw new Error(`No term headed "${heading}"`);
  return term.body;
}

describe('termsDueBy', () => {
  /**
   * The Order gives fourteen days from instructions. The letter prints this
   * date, so a practitioner may rely on it to know whether they are late.
   */
  it('is fourteen days after instructions', () => {
    expect(termsDueBy(new Date('2026-09-01T00:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-09-15'
    );
  });

  it('rolls over a month boundary', () => {
    expect(termsDueBy(new Date('2026-09-21T00:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-10-05'
    );
  });

  it('rolls over a year boundary', () => {
    expect(termsDueBy(new Date('2026-12-26T00:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2027-01-09'
    );
  });

  it('does not mutate the date it is given', () => {
    const instructed = new Date('2026-09-21T00:00:00Z');
    termsDueBy(instructed);
    expect(instructed.toISOString().slice(0, 10)).toBe('2026-09-21');
  });
});

describe('engagementTerms', () => {
  /**
   * The single most important line in the letter. The Order sets minimums, and
   * a letter that presented the figure as "the fee" would misstate both the
   * instrument and the practitioner's own freedom to charge above it.
   */
  it('calls the figure a prescribed minimum, not a price', () => {
    const body = bodyOf(factsFor('deed_of_assignment', 60 * MILLION), 'The fee');
    expect(body).toContain('prescribed minimum');
    expect(body).toContain('minimums and not fixed prices');
  });

  it('quotes the fee the engine calculated, not a recomputed one', () => {
    const facts = factsFor('deed_of_assignment', 60 * MILLION);
    expect(bodyOf(facts, 'The fee')).toContain(formatNaira(facts.result.professionalFee));
  });

  it('reproduces every band of the breakdown', () => {
    const facts = factsFor('deed_of_assignment', 60 * MILLION);
    const body = bodyOf(facts, 'The fee');
    expect(facts.result.breakdown.length).toBeGreaterThan(1);
    for (const line of facts.result.breakdown) {
      expect(body).toContain(formatNaira(line.amount));
    }
  });

  /**
   * The basis differs per document type and is the thing most easily got
   * wrong: a tenancy charged on the whole term rather than one year's rent
   * overstates the fee several times over, so the letter has to say which
   * figure it used.
   */
  it('states the amount the fee was charged on', () => {
    const facts = factsFor('deed_of_lease', 4 * MILLION);
    expect(bodyOf(facts, 'Basis of charge')).toContain(formatNaira(4 * MILLION));
  });

  it('names the other party practitioner where the document has a half rate', () => {
    const facts = factsFor('deed_of_assignment', 60 * MILLION);
    expect(facts.result.halfRateFee).not.toBeNull();
    expect(bodyOf(facts, 'The other party')).toContain(
      formatNaira(facts.result.halfRateFee as number)
    );
  });

  it('omits the other party term where there is no half rate', () => {
    const facts = factsFor('mortgage_deed', 60 * MILLION);
    const headings = engagementTerms(facts).map((t) => t.heading);
    if (facts.result.halfRateFee === null) {
      expect(headings).not.toContain('The other party');
    }
  });

  it('states the branch fee and the total', () => {
    const facts = factsFor('deed_of_assignment', 60 * MILLION);
    const body = bodyOf(facts, 'Branch fee and registration');
    expect(body).toContain(formatNaira(facts.result.branchFee));
    expect(body).toContain(formatNaira(facts.result.total));
  });

  /**
   * VAT and disbursements are excluded from every figure in this letter, and a
   * client who discovered that only on the invoice would have been misled by
   * the document that was supposed to prevent exactly that.
   */
  it('excludes VAT and disbursements in terms', () => {
    const body = bodyOf(factsFor('deed_of_assignment', 60 * MILLION), 'What is not included');
    expect(body).toContain('Value Added Tax');
    expect(body).toContain('stamp duty');
  });

  it('carries the client instruction through to the letter', () => {
    const facts = factsFor('deed_of_assignment', 60 * MILLION);
    expect(bodyOf(facts, 'The instruction')).toContain(facts.matter);
  });
});

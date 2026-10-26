import fs from 'node:fs';
import path from 'node:path';

import { calculateFee, scale2023 } from '@/lib/fees';
import {
  certificateHtmlForPreview,
  engagementLetterHtmlForPreview,
  invoiceHtmlForPreview,
  type CertificateData,
  type InvoiceData,
} from '@/lib/pdf';

/**
 * Page setup for the three documents.
 *
 * The certificate was exporting as US Letter, 612 by 792 points, rather than
 * A4 at 595 by 842. Letter is proportionally wider and shorter, so the
 * document looked right on a phone, where it is scaled to fit the screen, and
 * visibly wrong the moment it was downloaded and opened at full size.
 *
 * The cause was that no template declared a page size. Passing width and
 * height to printToFileAsync is not enough on its own; the renderer falls back
 * to its own default unless the stylesheet says otherwise. Confirmed by
 * rendering the certificate with and without the declaration: 612 by 792
 * without it, 595 by 842 with it.
 *
 * These assertions are cheap and guard the thing that actually broke. The page
 * count of the letter is not asserted here, because it depends on how much
 * text the renderer fits rather than on anything in this file; RENDER_OUT
 * below is how that was measured, and how to measure it again.
 */

const OUT = process.env.RENDER_OUT ?? '';

function facts() {
  return calculateFee(scale2023, {
    documentType: 'deed_of_assignment',
    amount: 60 * 1_000_000 * 100,
  });
}

function letterHtml(): string {
  return engagementLetterHtmlForPreview({
    facts: {
      practitionerName: 'Adaeze Okonkwo',
      scn: 'SCN/2015/041287',
      clientName: 'Chinedu Obi',
      matter: 'the purchase of the property at 12 Ziks Avenue, Awka, Anambra State',
      result: facts(),
      instructedOn: new Date('2026-09-23T09:00:00Z'),
    },
  });
}

function invoiceHtml(overrides: Partial<InvoiceData> = {}): string {
  const result = facts();
  return invoiceHtmlForPreview({
    invoiceNumber: 'TXN-00007-DOA',
    issuedAt: new Date('2026-09-23T09:00:00Z').toISOString(),
    practitionerName: 'Adaeze Okonkwo',
    scn: 'SCN/2015/041287',
    parties: 'Chinedu Obi to Ngozi Eze',
    propertyDescription: 'Plot 14, Block C, Ikota Layout, Lekki, Lagos',
    documentType: 'deed_of_assignment',
    amountPayable: result.professionalFee,
    branchFee: result.branchFee,
    branchName: 'NBA Anaocha Branch',
    accountName: 'NBA Anaocha Branch',
    accountNumber: '0123456789',
    bankName: 'Zenith Bank',
    ...overrides,
  });
}

function certificateHtml(overrides: Partial<CertificateData> = {}): Promise<string> {
  return certificateHtmlForPreview({
    certificateNumber: 'NBA/AN/CC/2026/00007',
    rbin: 'NBA/ANAOCHA/0007/2026',
    issuedAt: new Date('2026-09-23T09:00:00Z').toISOString(),
    practitionerName: 'Adaeze Okonkwo',
    scn: 'SCN/2015/041287',
    parties: 'Chinedu Obi to Ngozi Eze',
    propertyDescription: 'Plot 14, Block C, Ikota Layout, Lekki, Lagos',
    documentType: 'deed_of_assignment',
    consideration: 60 * 1_000_000 * 100,
    branchName: 'NBA Anaocha Branch',
    chairmanName: 'Barr. Emeka Nwosu',
    chairmanSignature: null,
    revoked: false,
    ...overrides,
  });
}

/** The longest certificate the database allows, and revoked: what has to fit one page. */
function longestCertificateHtml(): Promise<string> {
  return certificateHtml({
    parties: 'Chinedu Okafor, Ngozi Okafor and Emeka Okafor (as joint assignors) to Adeola Properties and Investments Limited (as assignee)'.padEnd(160, '.'),
    propertyDescription: 'All that piece of land known as Plot 14, Block C, Ikota Layout, Lekki, Lagos State, measuring approximately 600 square metres. '.repeat(4).slice(0, 500),
    revoked: true,
  });
}

describe('invoice particulars', () => {
  it('prints the description of property right after the parties', () => {
    const html = invoiceHtml();
    const parties = html.indexOf('>Parties<');
    const property = html.indexOf('>Description of Property<');
    expect(parties).toBeGreaterThan(-1);
    expect(property).toBeGreaterThan(parties);
    expect(property).toBeLessThan(html.indexOf('>Document Type<'));
  });

  it('leaves the row out on an invoice drawn before the field existed', () => {
    expect(invoiceHtml({ propertyDescription: null })).not.toContain('Description of Property');
  });

  it('escapes the description', () => {
    expect(invoiceHtml({ propertyDescription: '<b>Plot 14</b>' })).toContain('&lt;b&gt;Plot 14&lt;/b&gt;');
  });
});

describe('certificate particulars', () => {
  it('numbers the description of property after the parties', async () => {
    const html = await certificateHtml();
    expect(html).toMatch(/>4\.<\/td>\s*<td class="k">PARTIES TO THE DOCUMENT</);
    expect(html).toMatch(/>5\.<\/td>\s*<td class="k">DESCRIPTION OF PROPERTY</);
    expect(html).toMatch(/>7\.<\/td>\s*<td class="k">CONSIDERATION</);
  });

  it('keeps the six particulars on a certificate drawn before the field existed', async () => {
    const html = await certificateHtml({ propertyDescription: null });
    expect(html).not.toContain('DESCRIPTION OF PROPERTY');
    expect(html).toMatch(/>6\.<\/td>\s*<td class="k">CONSIDERATION</);
  });

  it('escapes the description', async () => {
    expect(await certificateHtml({ propertyDescription: '<b>Plot 14</b>' })).toContain('&lt;b&gt;Plot 14&lt;/b&gt;');
  });
});

describe('page setup', () => {
  it('the invoice declares A4', () => {
    expect(invoiceHtml()).toContain('size: A4 portrait');
  });

  it('the terms of engagement declare A4', () => {
    expect(letterHtml()).toContain('size: A4 portrait');
  });

  it('the certificate declares A4', async () => {
    expect(await certificateHtml()).toContain('size: A4 portrait');
  });

  /**
   * A page size passed only to printToFileAsync is the arrangement that failed.
   * If a template ever declares a size in JavaScript alone again, the renderer
   * will quietly go back to Letter.
   */
  it('no template relies on the print call alone for its page size', async () => {
    for (const html of [invoiceHtml(), letterHtml(), await certificateHtml()]) {
      expect(html).toMatch(/@page\s*\{[^}]*size:\s*A4/);
    }
  });
});

describe('rendering, when asked', () => {
  /**
   * Writes the three documents as HTML so they can be printed and measured.
   * Skipped unless RENDER_OUT names a directory, because it produces files
   * rather than asserting anything:
   *
   *   RENDER_OUT=/some/dir npx jest pdf-layout
   *   msedge --headless --print-to-pdf=out.pdf file:///some/dir/letter.html
   */
  it('writes the documents to RENDER_OUT', async () => {
    if (OUT === '') return;
    fs.writeFileSync(path.join(OUT, 'invoice.html'), invoiceHtml(), 'utf8');
    fs.writeFileSync(path.join(OUT, 'letter.html'), letterHtml(), 'utf8');
    fs.writeFileSync(path.join(OUT, 'certificate.html'), await certificateHtml(), 'utf8');
    fs.writeFileSync(path.join(OUT, 'certificate-longest.html'), await longestCertificateHtml(), 'utf8');
    expect(fs.existsSync(path.join(OUT, 'letter.html'))).toBe(true);
  });
});

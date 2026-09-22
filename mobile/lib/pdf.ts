import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { ATTRIBUTION, CERTIFICATE_ORDER_NAME, ORDER_FULL_NAME, PRODUCT_NAME } from '@/lib/branding';
import {
  CERTIFICATE_NOTE,
  CERTIFICATE_RECITAL,
  certificateParticulars,
} from '@/lib/certificate';
import {
  ENGAGEMENT_CLOSING,
  engagementTerms,
  termsDueBy,
  type EngagementFacts,
} from '@/lib/engagement';
import { documentTypeLabels, type DocumentType } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { qrSvg } from '@/lib/qr';
import { SEAL, SEAL_WATERMARK } from '@/lib/seal';
import { verificationUrlFor } from '@/lib/verification';

/**
 * PDF generation for invoices and Certificates of Compliance.
 *
 * Rendered on the device with expo-print rather than server side. SPEC.md
 * section 3 assumed a FastAPI service with WeasyPrint; there is no backend
 * yet, and on-device printing produces the same document without one.
 *
 * The trade-off worth knowing: a device-generated certificate is not an
 * authoritative artefact. Anyone can produce a PDF that looks like this. That
 * is precisely why the QR code and the public verification page exist: the
 * document asserts nothing on its own, and the RBIN is what a land registry
 * actually checks. When certificates move server side and are archived to
 * storage, these templates can be reused verbatim.
 */

/** Escapes text interpolated into the HTML templates. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Shared page styling.
 *
 * Fonts are named rather than embedded: the print renderer falls back to a
 * system serif if Playfair is unavailable, which is acceptable on a document
 * whose authority comes from the RBIN rather than its typeface.
 */
const baseStyles = `
  /* The page size has to be declared here, not only passed to
     printToFileAsync. Without it the renderer falls back to its own default,
     which is US Letter at 612 by 792 points. Letter is proportionally wider
     and shorter than A4's 595 by 842, so the document came out too wide and
     not tall enough: it looked right on a phone, where it is scaled to fit,
     and wrong the moment it was opened at full size on a desktop. These
     documents are filed with Nigerian land registries, where A4 is the paper. */
  @page { size: A4 portrait; margin: 40px; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Source Sans 3', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #1A1A1A;
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
  }
  h1, h2, h3 { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; margin: 0; }
  .muted { color: #6B7280; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 7px 0; border-bottom: 1px solid #E3E6E3; }
  .row:last-child { border-bottom: 0; }
  .label { color: #6B7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .value { text-align: right; }
  .footnote { color: #6B7280; font-size: 10px; line-height: 1.5; margin-top: 22px; }
`;

export interface InvoiceData {
  invoiceNumber: string;
  issuedAt: string;
  practitionerName: string;
  scn: string | null;
  parties: string;
  documentType: DocumentType;
  consideration: number;
  amountPayable: number;
  branchName: string;
  accountName: string | null;
  accountNumber: string | null;
  bankName: string | null;
}

function invoiceHtml(data: InvoiceData): string {
  const bankDetailsMissing =
    data.accountName === null || data.accountNumber === null || data.bankName === null;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><style>${baseStyles}
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0B5D33; padding-bottom: 14px; }
  .title { color: #0B5D33; font-size: 22px; }
  .pay { background: #F2F4F2; border-left: 4px solid #0B5D33; padding: 16px; margin: 22px 0; }
  .amount { font-family: 'Playfair Display', Georgia, serif; font-size: 30px; color: #0B5D33; }
  .warn { background: #FDF6E3; border: 1px solid #F5C33B; padding: 12px; margin-top: 16px; font-size: 11px; }
</style></head>
<body>
  <div class="head">
    <div>
      <h1 class="title">Branch Fee Invoice</h1>
      <div class="muted">${escapeHtml(data.branchName)}</div>
    </div>
    <div style="text-align:right">
      <div class="label">Reference</div>
      <div><strong>${escapeHtml(data.invoiceNumber)}</strong></div>
      <div class="muted">${escapeHtml(formatDate(data.issuedAt))}</div>
    </div>
  </div>

  <!--
    This is the branch invoicing its own member for the branch fee, which is
    what the "Pay to" block and the payment reference below are for.

    An earlier version of this comment claimed the document was issued to the
    practitioner's client, and hid the branch's share on that basis, while the
    same page printed the branch's bank account and told the practitioner to
    upload their own payment slip. Both could not be true, and the second was
    what the document actually did.

    The professional fee the practitioner charges their client is a separate
    matter and belongs on the terms of engagement letter, not here.
  -->

  <h3 style="margin-bottom:6px">Transaction</h3>
  <div class="row"><span class="label">Practitioner</span><span class="value">${escapeHtml(data.practitionerName)}</span></div>
  <div class="row"><span class="label">Supreme Court Number</span><span class="value">${escapeHtml(data.scn ?? 'Not recorded')}</span></div>
  <div class="row"><span class="label">Parties</span><span class="value">${escapeHtml(data.parties)}</span></div>
  <div class="row"><span class="label">Document Type</span><span class="value">${escapeHtml(documentTypeLabels[data.documentType])}</span></div>
  <div class="row"><span class="label">Consideration</span><span class="value">${escapeHtml(formatNaira(data.consideration))}</span></div>

  <h3 style="margin:22px 0 6px">Pay to</h3>
  ${
    bankDetailsMissing
      ? `<div class="warn"><strong>This branch has not published its bank details.</strong>
           Contact the branch secretariat before paying. Do not pay into any account not confirmed by your branch.</div>`
      : `<div class="row"><span class="label">Account Name</span><span class="value">${escapeHtml(data.accountName ?? '')}</span></div>
         <div class="row"><span class="label">Account Number</span><span class="value">${escapeHtml(data.accountNumber ?? '')}</span></div>
         <div class="row"><span class="label">Bank</span><span class="value">${escapeHtml(data.bankName ?? '')}</span></div>
         <div class="row"><span class="label">Payment Reference</span><span class="value">${escapeHtml(data.invoiceNumber)}</span></div>`
  }

  <div class="warn">
    Quote the payment reference on your transfer. Upload the payment slip in ${escapeHtml(PRODUCT_NAME)}
    so your branch can verify it and issue your Certificate of Compliance.
  </div>

  <div class="footnote">
    Fees are computed under the ${escapeHtml(ORDER_FULL_NAME)}. The figures shown are prescribed
    minimums, exclusive of VAT and of disbursements such as stamp duties, registration fees and
    Governor's Consent. ${escapeHtml(ATTRIBUTION)}.
  </div>
</body></html>`;
}

export interface CertificateData {
  certificateNumber: string;
  rbin: string;
  issuedAt: string;
  practitionerName: string;
  scn: string | null;
  parties: string;
  documentType: DocumentType;
  consideration: number;
  branchName: string;
  chairmanName: string | null;
  /**
   * The chairman's signature as a `data:` URI, from lib/signature.ts, or null
   * where the branch has not uploaded one. Null prints the name over the rule
   * alone, which is what every certificate carried before this existed.
   */
  chairmanSignature?: string | null;
  revoked: boolean;
}

/**
 * The Certificate of Compliance, following the branch's own design: a gold
 * double frame on cream, the Association and branch named above the title, a
 * recital, six numbered particulars on dotted leaders, and the Chairman's
 * block against the date and certificate number.
 *
 * The QR sits at the foot rather than beside the seal in the branch's artwork.
 * It is the only part of the document that proves anything: a printed
 * certificate can be reproduced by anyone, so the code, and the reference it
 * carries, is what a land registry actually checks.
 */
/**
 * Corner flourish for the certificate border.
 *
 * Drawn rather than sliced from the branch's artwork, whose engraved corners
 * are part of a single raster frame that cannot be tiled to an arbitrary page
 * size. Four copies are rotated into position, so one path serves all corners.
 */
function cornerSvg(rotation: number): string {
  return `<svg class="corner" style="transform:rotate(${rotation}deg)" width="58" height="58"
    viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" fill="none"
    stroke="#a8842a" stroke-width="1.4" stroke-linecap="round">
    <path d="M4 4h18M4 4v18" stroke-width="2.4" />
    <path d="M9 9c14 0 26 2 34 6" />
    <path d="M9 9c0 14 2 26 6 34" />
    <path d="M14 14c0 9 1 17 4 24" opacity="0.65" />
    <path d="M14 14c9 0 17 1 24 4" opacity="0.65" />
    <circle cx="30" cy="12" r="2.1" fill="#a8842a" stroke="none" />
    <circle cx="12" cy="30" r="2.1" fill="#a8842a" stroke="none" />
    <circle cx="20" cy="20" r="1.4" fill="#a8842a" stroke="none" />
  </svg>`;
}

export async function certificateHtml(data: CertificateData): Promise<string> {
  const verifyUrl = verificationUrlFor(data.rbin);
  const qr = await qrSvg(verifyUrl, 84);
  const branchLabel = data.branchName.replace(/^NBA\s+/i, '').replace(/\s+Branch$/i, '');

  // Both this document and the detail screen read their fields from the same
  // place, so the two can never state different particulars.
  const particulars = certificateParticulars(data);

  const rows = particulars
    .map(
      ({ label, value }, i) => `
      <tr>
        <td class="n">${i + 1}.</td>
        <td class="k">${escapeHtml(label)}</td>
        <td class="c">:</td>
        <td class="v">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><style>
  /* A4, declared rather than assumed. See the note in baseStyles: without
     this the renderer defaults to US Letter and the gold frame is drawn
     against the wrong proportions, which is most visible on the certificate
     because its border runs to the edge of the page. Margin stays at zero
     because the frame is the margin. */
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 14px;
    background: #b8912f;
    font-family: Georgia, 'Times New Roman', serif;
    color: #14301f;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Two rules and an inset panel stand in for the engraved border of the
     branch's artwork, which is a raster ornament we do not hold. */
  .outer { border: 2px solid #7d5f14; padding: 5px; background: #d8b455; }
  .inner { border: 1px solid #7d5f14; padding: 0; background: #fbf7ef; }
  .sheet { border: 1px solid #cbb98c; margin: 7px; padding: 26px 30px 20px; }

  .crest { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .crest .seal { width: 62px; height: 62px; }

  /* The sheet is the positioning context, so the watermark and corners sit
     inside the ruled frame rather than over it. */
  .sheet { position: relative; }
  .watermark {
    position: absolute; top: 52%; left: 50%; width: 290px; height: 290px;
    transform: translate(-50%, -50%); z-index: 0;
  }
  .corner { position: absolute; z-index: 1; }
  .corner:nth-of-type(1) { top: 3px; left: 3px; }
  .corner:nth-of-type(2) { top: 3px; right: 3px; }
  .corner:nth-of-type(3) { bottom: 3px; right: 3px; }
  .corner:nth-of-type(4) { bottom: 3px; left: 3px; }

  /* Content sits above the decoration. Without this the watermark, being
     later in the stacking context, would print over the particulars. */
  .crest, .rule, .kind, .lead, .recital, table.p, .note, .foot, .revoked {
    position: relative; z-index: 2;
  }
  .titles { text-align: center; flex: 1; }
  .assoc {
    font-size: 27px; font-weight: bold; letter-spacing: 0.5px; line-height: 1.05;
    color: #123d24; margin: 0;
  }
  .branch {
    font-size: 14px; letter-spacing: 5px; color: #123d24; margin: 5px 0 0; font-weight: bold;
  }

  .rule { display: flex; align-items: center; gap: 8px; margin: 13px 0; }
  .rule::before, .rule::after {
    content: ''; flex: 1; height: 1px; background: #b99b45;
  }
  .rule span { color: #b99b45; font-size: 10px; letter-spacing: 3px; }

  .kind {
    text-align: center; font-size: 33px; font-weight: bold; line-height: 1.05;
    color: #123d24; margin: 0; letter-spacing: 0.5px;
  }

  .lead { text-align: center; font-style: italic; font-size: 14px; margin: 14px 0 9px; color: #14301f; }
  .recital {
    text-align: center; font-size: 12.5px; line-height: 1.75; margin: 0 14px;
    color: #14301f;
  }

  table.p { width: 100%; border-collapse: collapse; margin: 20px 0 0; font-size: 11.5px; }
  table.p td { padding: 7px 0 3px; vertical-align: top; }
  td.n { width: 20px; font-weight: bold; }
  td.k { width: 185px; font-weight: bold; letter-spacing: 0.4px; }
  td.c { width: 12px; }
  /* The dotted leader sits under the value, matching the ruled lines the
     branch's artwork prints the particulars onto. */
  td.v { border-bottom: 1px dotted #9d8b5f; font-weight: bold; }

  .note {
    text-align: center; font-style: italic; font-size: 10.5px; line-height: 1.6;
    margin: 18px 20px 0; color: #40503f;
  }

  .foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; margin: 18px 0 0; }
  .foot .col { font-size: 10px; line-height: 1.55; }
  .foot .lbl { font-weight: bold; }
  .verify { text-align: center; }
  .verify .cap { font-size: 7.5px; letter-spacing: 0.4px; color: #4c5a4b; margin-top: 2px; max-width: 118px; }
  .sig { text-align: center; font-size: 10px; line-height: 1.5; min-width: 190px; }
  /* The signature sits ON the rule rather than above it, which is how a
     signature meets a signature line. A fixed height reserves the same space
     whether or not an image is present, so a branch with no signature
     uploaded gets the identical layout with an empty gap rather than a
     signature block that jumps up the page. */
  .sig .ink { display: block; height: 34px; width: auto; max-width: 180px; margin: 0 auto -6px; object-fit: contain; }
  .sig .name { font-weight: bold; border-top: 1px solid #14301f; padding-top: 4px; }

  .revoked {
    background: #8d2318; color: #fff; text-align: center; letter-spacing: 5px;
    font-weight: bold; padding: 6px; margin: 0 0 12px; font-size: 13px;
  }
</style></head>
<body>
  <div class="outer"><div class="inner"><div class="sheet">
    <img class="watermark" src="${SEAL_WATERMARK}" alt="" />
    ${cornerSvg(0)}${cornerSvg(90)}${cornerSvg(180)}${cornerSvg(270)}

    ${data.revoked ? '<div class="revoked">REVOKED</div>' : ''}

    <div class="crest">
      <img class="seal" src="${SEAL}" alt="" />
      <div class="titles">
        <p class="assoc">NIGERIAN BAR ASSOCIATION</p>
        <p class="branch">${escapeHtml(data.branchName.replace(/^NBA\s+/i, '').toUpperCase())}</p>
      </div>
      <img class="seal" src="${SEAL}" alt="" />
    </div>

    <div class="rule"><span>&#10022;</span></div>
    <p class="kind">CERTIFICATE OF<br />COMPLIANCE</p>
    <div class="rule"><span>&#10022;</span></div>

    <p class="lead">THIS IS TO CERTIFY THAT</p>
    <p class="recital">
      ${escapeHtml(CERTIFICATE_RECITAL)}
    </p>

    <table class="p">${rows}</table>

    <p class="note">
      ${escapeHtml(CERTIFICATE_NOTE)} It can be checked independently: scan the code below, or
      enter the RBIN at ${escapeHtml(verifyUrl.split('/verify/')[0])}. A printed copy proves
      nothing on its own.
    </p>

    <div class="foot">
      <div class="col">
        <div class="lbl">Date of Issue:</div>
        <div>${escapeHtml(formatDate(data.issuedAt))}</div>
        <div class="lbl" style="margin-top:7px">Certificate No.:</div>
        <div>${escapeHtml(data.certificateNumber)}</div>
      </div>

      <div class="verify">
        ${qr}
        <div class="cap">Scan to verify this certificate</div>
      </div>

      <div class="sig">
        ${
          data.chairmanSignature != null
            ? `<img class="ink" src="${data.chairmanSignature}" alt="" />`
            : '<div class="ink"></div>'
        }
        <div class="name">${escapeHtml(data.chairmanName ?? 'The Chairman')}</div>
        <div>CHAIRMAN</div>
        <div>${escapeHtml(data.branchName.toUpperCase())}</div>
      </div>
    </div>
  </div></div></div>
</body></html>`;
}

/**
 * Renders HTML to a PDF and hands it to the share sheet.
 *
 * Sharing rather than saving to disk: on both platforms the share sheet is
 * how a user gets a file into email, WhatsApp or their own files app, and it
 * needs no storage permission.
 */
/**
 * A4 in points, which is what expo-print measures in.
 *
 * Passing this explicitly matters. Without width and height, expo-print
 * defaults to US Letter at 612 by 792, and these documents are filed with
 * Nigerian land registries where A4 is the paper. A Letter-sized PDF printed
 * on A4 does not simply sit in a wider margin: the printer scales it, so the
 * frame no longer meets the edge it was drawn against and the whole document
 * shifts off centre.
 */
const A4 = { width: 595, height: 842 };

async function printAndShare(html: string, dialogTitle: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html, base64: false, ...A4 });

  if (!(await Sharing.isAvailableAsync())) {
    // Nothing further can be done with the file on this device, but the PDF
    // does exist, so report the path rather than failing silently.
    throw new Error(`Sharing is not available on this device. The PDF was saved to ${uri}`);
  }

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle,
    UTI: 'com.adobe.pdf',
  });
}

/**
 * Terms of engagement.
 *
 * A letter rather than a form, because that is what it has to be: the Order
 * requires written terms delivered to the client, and a client receiving a
 * table of figures with no addressee and no sender has not been given terms of
 * engagement, whatever the figures say.
 *
 * Deliberately plain beside the certificate. The certificate is a document
 * asserting something to a third party and is dressed accordingly; this is
 * correspondence between a practitioner and their own client, and a gold frame
 * on it would be a costume.
 */
export interface EngagementLetterData {
  facts: EngagementFacts;
  /** Optional, printed under the signature block where the practitioner has one. */
  firmName?: string | null;
}

function engagementLetterHtml(data: EngagementLetterData): string {
  const { facts } = data;
  const terms = engagementTerms(facts);
  const due = termsDueBy(facts.instructedOn);

  const paragraphs = terms
    .map(
      (term) => `
      <div class="term">
        <div class="tHead">${escapeHtml(term.heading)}</div>
        <div>${escapeHtml(term.body)}</div>
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><style>${baseStyles}
  /* Sized to hold one page.

     The Order requires terms of engagement, not a brochure, and a client who
     is handed two sheets reads the first. Everything here is tightened to fit
     a single A4: the type is a point smaller than the invoice's, the leading
     is closer, and the gaps between paragraphs are the smallest that still
     separate them. The content was cut to match rather than the layout alone,
     because squeezing seven long paragraphs onto a page produces something
     nobody reads either. */
  @page { size: A4 portrait; margin: 34px 40px; }
  body { font-size: 11.5px; line-height: 1.45; }
  .head { border-bottom: 2px solid #0B5D33; padding-bottom: 8px; margin-bottom: 12px; }
  .kind { color: #0B5D33; font-size: 18px; }
  .meta { margin-top: 2px; font-size: 10px; color: #6B7280; }
  .to { margin: 12px 0 10px; }
  .to .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: #6B7280; }
  .to .who { font-weight: bold; font-size: 13px; }
  .row { padding: 4px 0; }
  .term { margin-top: 9px; }
  .tHead {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px;
    color: #0B5D33; font-weight: bold; margin-bottom: 1px;
  }
  .due { background: #F2F4F2; border-left: 3px solid #0B5D33; padding: 8px 10px; margin-top: 12px; font-size: 10.5px; }
  .close { margin-top: 10px; font-size: 10.5px; }
  .sign { margin-top: 16px; }
  .sign .rule { border-top: 1px solid #1A1A1A; width: 230px; padding-top: 4px; margin-top: 30px; }
  .footnote { margin-top: 12px; font-size: 9px; }
</style></head>
<body>
  <div class="head">
    <h1 class="kind">Terms of Engagement</h1>
    <div class="meta">
      Issued under the ${escapeHtml(ORDER_FULL_NAME)}
    </div>
  </div>

  <div class="to">
    <div class="lbl">To</div>
    <div class="who">${escapeHtml(facts.clientName)}</div>
  </div>

  <div class="row">
    <span class="label">Instructions accepted</span>
    <span class="value">${escapeHtml(formatDate(facts.instructedOn.toISOString()))}</span>
  </div>
  <div class="row">
    <span class="label">Legal practitioner</span>
    <span class="value">${escapeHtml(facts.practitionerName)}</span>
  </div>
  <div class="row">
    <span class="label">Supreme Court Number</span>
    <span class="value">${escapeHtml(facts.scn ?? 'Not recorded')}</span>
  </div>

  ${paragraphs}

  <div class="due">
    The Order requires written terms of engagement to reach the client within fourteen days of
    instructions being accepted. On the date above, that period ends on
    <strong>${escapeHtml(formatDate(due.toISOString()))}</strong>.
  </div>

  <p class="close">${escapeHtml(ENGAGEMENT_CLOSING)}</p>

  <div class="sign">
    <div class="rule">
      ${escapeHtml(facts.practitionerName)}<br />
      <span class="muted">Legal Practitioner${
        facts.scn !== null ? ` &middot; SCN ${escapeHtml(facts.scn)}` : ''
      }</span>
      ${data.firmName != null ? `<br /><span class="muted">${escapeHtml(data.firmName)}</span>` : ''}
    </div>
  </div>

  <p class="footnote">
    Prepared with ${escapeHtml(PRODUCT_NAME)}. ${escapeHtml(ATTRIBUTION)}. The figures stated are
    the minimums prescribed by the Order and are exclusive of Value Added Tax and of
    disbursements.
  </p>
</body></html>`;
}

export async function shareInvoicePdf(data: InvoiceData): Promise<void> {
  await printAndShare(invoiceHtml(data), 'Share branch fee invoice');
}

export async function shareEngagementLetterPdf(data: EngagementLetterData): Promise<void> {
  await printAndShare(engagementLetterHtml(data), 'Share terms of engagement');
}

export async function shareCertificatePdf(data: CertificateData): Promise<void> {
  await printAndShare(await certificateHtml(data), 'Share Certificate of Compliance');
}

/** Exported for the preview and agreement checks in scratchpad. */
export const certificateHtmlForPreview = certificateHtml;

/**
 * Exported so the page count can be checked by rendering, rather than
 * estimated. The letter has to hold one page, and the only honest way to know
 * is to print it.
 */
export const engagementLetterHtmlForPreview = engagementLetterHtml;
export const invoiceHtmlForPreview = invoiceHtml;

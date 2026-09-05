import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { ATTRIBUTION, CERTIFICATE_ORDER_NAME, ORDER_FULL_NAME, PRODUCT_NAME } from '@/lib/branding';
import { documentTypeLabels, type DocumentType } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { qrSvg } from '@/lib/qr';
import { SEAL, SEAL_WATERMARK } from '@/lib/seal';
import { verificationUrlFor } from '@/lib/verification';

/**
 * PDF generation for receipts and Certificates of Compliance.
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
  @page { margin: 40px; }
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

export interface ReceiptData {
  receiptNumber: string;
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

function receiptHtml(data: ReceiptData): string {
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
      <h1 class="title">Payment Receipt</h1>
      <div class="muted">${escapeHtml(data.branchName)}</div>
    </div>
    <div style="text-align:right">
      <div class="label">Reference</div>
      <div><strong>${escapeHtml(data.receiptNumber)}</strong></div>
      <div class="muted">${escapeHtml(formatDate(data.issuedAt))}</div>
    </div>
  </div>

  <!--
    The branch's share is deliberately absent. This document is issued to the
    client, and what the practitioner separately owes their branch is not the
    client's business. The figure is still computed and stored, and the branch
    sees it in the console when verifying the payment.
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
         <div class="row"><span class="label">Payment Reference</span><span class="value">${escapeHtml(data.receiptNumber)}</span></div>`
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

  const particulars: [string, string][] = [
    ['NAME OF LAWYER', data.practitionerName],
    ['RBIN', data.rbin],
    ['SUPREME COURT NUMBER', data.scn ?? 'Not recorded'],
    ['PARTIES TO THE DOCUMENT', data.parties],
    ['TYPE OF DOCUMENT', documentTypeLabels[data.documentType]],
    ['CONSIDERATION', formatNaira(data.consideration)],
  ];

  const rows = particulars
    .map(
      ([label, value], i) => `
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
  @page { margin: 0; }
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
      The undersigned Legal Practitioner whose particulars appear below has duly prepared the title
      document as described herein in accordance with the Rules of Professional Conduct, the Legal
      Practitioners Act and the ${escapeHtml(CERTIFICATE_ORDER_NAME)}.
    </p>

    <table class="p">${rows}</table>

    <p class="note">
      This Certificate is issued as evidence of compliance with the ${escapeHtml(CERTIFICATE_ORDER_NAME)} and for record purposes. It can be checked
      independently: scan the code below, or enter the RBIN at ${escapeHtml(verifyUrl.split('/verify/')[0])}.
      A printed copy proves nothing on its own.
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

export async function shareReceiptPdf(data: ReceiptData): Promise<void> {
  await printAndShare(receiptHtml(data), 'Share payment receipt');
}

export async function shareCertificatePdf(data: CertificateData): Promise<void> {
  await printAndShare(await certificateHtml(data), 'Share Certificate of Compliance');
}

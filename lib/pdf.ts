import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { ATTRIBUTION, ORDER_FULL_NAME, PRODUCT_NAME } from '@/lib/branding';
import { documentTypeLabels, type DocumentType } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { qrSvg } from '@/lib/qr';
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
 * document asserts nothing on its own, and the BAIN is what a land registry
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
 * whose authority comes from the BAIN rather than its typeface.
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

  <div class="pay">
    <div class="label">Total amount payable to the NBA Branch</div>
    <div class="amount">${escapeHtml(formatNaira(data.amountPayable))}</div>
  </div>

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
  bain: string;
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

async function certificateHtml(data: CertificateData): Promise<string> {
  const verifyUrl = verificationUrlFor(data.bain);
  const qr = await qrSvg(verifyUrl, 130);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><style>${baseStyles}
  .frame { border: 3px double #0B5D33; padding: 30px; position: relative; }
  .org { font-size: 24px; color: #0B5D33; text-align: center; letter-spacing: 0.5px; }
  .kind { text-align: center; letter-spacing: 3px; font-size: 13px; margin-top: 4px; }
  .recital { font-style: italic; text-align: center; margin: 22px 40px; color: #333; }
  .sign { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 34px; }
  .signLine { border-top: 1px solid #1A1A1A; padding-top: 5px; min-width: 210px; text-align: center; font-size: 11px; }
  .revoked { color: #C2371F; border: 2px solid #C2371F; padding: 8px; text-align: center; letter-spacing: 2px; margin-bottom: 16px; }
</style></head>
<body>
  <div class="frame">
    ${data.revoked ? '<div class="revoked">REVOKED</div>' : ''}
    <div class="org">NIGERIAN BAR ASSOCIATION</div>
    <div class="kind">CERTIFICATE OF COMPLIANCE</div>

    <div class="recital">
      This is to certify that the legal instrument described below has been prepared in accordance
      with the fees prescribed by the ${escapeHtml(ORDER_FULL_NAME)}.
    </div>

    <div class="row"><span class="label">Name of Practitioner</span><span class="value">${escapeHtml(data.practitionerName)}</span></div>
    <div class="row"><span class="label">Supreme Court Number</span><span class="value">${escapeHtml(data.scn ?? 'Not recorded')}</span></div>
    <div class="row"><span class="label">Branch / BAIN</span><span class="value">${escapeHtml(data.branchName)} &middot; ${escapeHtml(data.bain)}</span></div>
    <div class="row"><span class="label">Document Type</span><span class="value">${escapeHtml(documentTypeLabels[data.documentType])}</span></div>
    <div class="row"><span class="label">Parties</span><span class="value">${escapeHtml(data.parties)}</span></div>
    <div class="row"><span class="label">Consideration Value</span><span class="value">${escapeHtml(formatNaira(data.consideration))}</span></div>
    <div class="row"><span class="label">Date of Issue</span><span class="value">${escapeHtml(formatDate(data.issuedAt))}</span></div>

    <div class="sign">
      <div>
        <div class="label">Certificate Number</div>
        <div><strong>${escapeHtml(data.certificateNumber)}</strong></div>
        <div style="margin-top:14px">${qr}</div>
        <div class="muted" style="font-size:9px;max-width:150px">
          Scan to verify, or enter the BAIN at ${escapeHtml(verifyUrl)}
        </div>
      </div>
      <div class="signLine">
        ${escapeHtml(data.chairmanName ?? 'Hon. Chairman')}<br />
        <span class="muted">Chairman, ${escapeHtml(data.branchName)}</span>
      </div>
    </div>
  </div>

  <div class="footnote">
    This certificate confirms compliance with the prescribed fee scale. Its authenticity can be
    checked independently using the BAIN above; a printed copy proves nothing on its own.
    ${escapeHtml(ATTRIBUTION)}.
  </div>
</body></html>`;
}

/**
 * Renders HTML to a PDF and hands it to the share sheet.
 *
 * Sharing rather than saving to disk: on both platforms the share sheet is
 * how a user gets a file into email, WhatsApp or their own files app, and it
 * needs no storage permission.
 */
async function printAndShare(html: string, dialogTitle: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html, base64: false });

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

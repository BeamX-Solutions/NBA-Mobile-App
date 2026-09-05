import { CERTIFICATE_ORDER_NAME } from '@/lib/branding';
import { documentTypeLabels, type DocumentType } from '@/lib/fees';
import { formatNaira } from '@/lib/money';

/**
 * What a Certificate of Compliance states.
 *
 * The certificate exists in two places: the PDF a practitioner downloads and
 * files, and the screen where they check it before sending it on. Those are
 * laid out differently on purpose, because an A4 document and a phone screen
 * want different things.
 *
 * What must never differ is the content. A screen showing a different RBIN, a
 * different consideration, or the particulars in a different order from the
 * document a land registry holds is the failure worth engineering against, so
 * both renderers read the fields from here rather than each assembling their
 * own list.
 *
 * The order matches the branch's own certificate, which numbers its
 * particulars one to six.
 */

export interface CertificateFacts {
  practitionerName: string;
  rbin: string;
  scn: string | null;
  parties: string;
  documentType: DocumentType;
  consideration: number;
}

export interface Particular {
  label: string;
  value: string;
}

export function certificateParticulars(facts: CertificateFacts): Particular[] {
  return [
    { label: 'NAME OF LAWYER', value: facts.practitionerName },
    { label: 'RBIN', value: facts.rbin },
    // The branch's certificate carries a Bar Identification Number here. The
    // system does not hold one, so the Supreme Court Number stands in its
    // place: it is the identifier we do have, and it is on the brief's own
    // list of what a certificate must show.
    { label: 'SUPREME COURT NUMBER', value: facts.scn ?? 'Not recorded' },
    { label: 'PARTIES TO THE DOCUMENT', value: facts.parties },
    { label: 'TYPE OF DOCUMENT', value: documentTypeLabels[facts.documentType] },
    { label: 'CONSIDERATION', value: formatNaira(facts.consideration) },
  ];
}

/** The recital, in the branch's own wording. */
export const CERTIFICATE_RECITAL =
  'The undersigned Legal Practitioner whose particulars appear below has duly prepared the ' +
  'title document as described herein in accordance with the Rules of Professional Conduct, ' +
  `the Legal Practitioners Act and the ${CERTIFICATE_ORDER_NAME}.`;

/** The closing note, immediately above the signature block. */
export const CERTIFICATE_NOTE =
  `This Certificate is issued as evidence of compliance with the ${CERTIFICATE_ORDER_NAME} ` +
  'and for record purposes.';

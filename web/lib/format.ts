/**
 * Display formatting for the admin console.
 *
 * Money is an integer number of kobo everywhere in this system. Naira are a
 * display concern only, and floating point never touches a currency value.
 *
 * These mirror mobile/lib/money.ts deliberately rather than importing it: the
 * two apps are separate packages today. The fee *engine* is not duplicated —
 * the console never calculates a fee, it only displays figures a practitioner
 * already committed to. If these ever need to diverge, that is a bug.
 */

export const KOBO_PER_NAIRA = 100;

export function formatNaira(kobo: number, options?: { showSymbol?: boolean }): string {
  const showSymbol = options?.showSymbol ?? true;
  const negative = kobo < 0;
  const absolute = Math.abs(kobo);

  const whole = Math.floor(absolute / KOBO_PER_NAIRA);
  const remainder = absolute % KOBO_PER_NAIRA;

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = remainder === 0 ? grouped : `${grouped}.${remainder.toString().padStart(2, "0")}`;

  return `${negative ? "-" : ""}${showSymbol ? "₦" : ""}${body}`;
}

/** Mirrors mobile/lib/fees/types.ts. Both read the same document_type enum. */
export const documentTypeLabels: Record<string, string> = {
  deed_of_assignment: "Deed of Assignment",
  deed_of_conveyance: "Deed of Conveyance",
  deed_of_gift: "Deed of Gift",
  contract_of_sale: "Contract of Sale",
  deed_of_surrender: "Deed of Surrender",
  deed_of_exchange: "Deed of Exchange",
  mortgage_deed: "Mortgage Deed",
  deed_of_release: "Deed of Release / Discharge of Mortgage",
  tenancy_agreement: "Tenancy Agreement",
  deed_of_lease: "Deed of Lease",
  deed_of_sub_lease: "Deed of Sub-Lease",
  power_of_attorney: "Irrevocable Power of Attorney",
};

export function documentLabel(type: string): string {
  return documentTypeLabels[type] ?? type;
}

export type TransactionStatus =
  | "awaiting_payment"
  | "pending_verification"
  | "verified"
  | "rejected";

/**
 * Status presentation. Tailwind classes rather than the mobile palette object,
 * but the same four states and the same wording, so an administrator and a
 * practitioner describe a transaction identically.
 */
export const statusStyles: Record<TransactionStatus, { label: string; className: string }> = {
  awaiting_payment: {
    label: "Awaiting Payment",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  pending_verification: {
    label: "Pending Verification",
    className: "bg-slate-100 text-slate-700 ring-slate-300",
  },
  verified: {
    label: "Verified",
    className: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-50 text-red-800 ring-red-200",
  },
};

export function formatDate(value: string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

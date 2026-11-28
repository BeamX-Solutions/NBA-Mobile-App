/**
 * Transactions as a spreadsheet, for a chosen period.
 *
 * Branches asked (28 November 2026) to download their transactions between two
 * dates, onto a phone as readily as a computer. The file is CSV, which Excel,
 * Google Sheets and Numbers all open, written for someone reading it rather
 * than a program: naira rather than kobo, Lagos dates, statuses in words. A
 * byte order mark makes Excel read it as UTF-8, so ₦ and accented names survive.
 *
 * Rows are whatever RLS lets the caller see: a branch administrator gets their
 * branch, a super administrator every branch, which is why Branch is a column.
 */

import { documentLabel, statusStyles, type TransactionStatus } from "./format.ts";

export const EXPORT_COLUMNS =
  "id, invoice_number, rbin, document_type, parties, property_description, consideration, amount_payable, branch_fee, due_to_practitioner, remitted_at, status, created_at, verified_at, branches!transactions_branch_id_fkey(name), profiles!transactions_user_id_fkey(full_name, scn), certificates(certificate_number, issued_at, revoked_at, revocation_reason)";

export interface ExportRow {
  id: string;
  invoice_number: string | null;
  rbin: string | null;
  document_type: string;
  parties: string;
  property_description: string | null;
  consideration: number;
  amount_payable: number;
  branch_fee: number;
  due_to_practitioner: number;
  remitted_at: string | null;
  status: TransactionStatus;
  created_at: string;
  verified_at: string | null;
  branches: { name: string } | null;
  profiles: { full_name: string; scn: string | null } | null;
  certificates: {
    certificate_number: string;
    issued_at: string;
    revoked_at: string | null;
    revocation_reason: string | null;
  } | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The instants bounding two calendar days in Lagos, inclusive of both: from
 * midnight starting `from` to midnight ending `to`. Lagos keeps UTC+1 all year,
 * so the offset is fixed. Null when either date is malformed or `to` precedes
 * `from`.
 */
export function lagosRange(from: string, to: string): { start: string; end: string } | null {
  if (!DATE.test(from) || !DATE.test(to) || to < from) return null;
  const start = new Date(`${from}T00:00:00+01:00`);
  const end = new Date(`${to}T00:00:00+01:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** A kobo amount as naira with two decimals and no separators, so spreadsheets sum it. */
export function nairaCell(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const abs = Math.abs(Math.round(kobo));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** An instant as Lagos local time, e.g. 2026-11-27 16:30, or empty. */
export function lagosCell(value: string | null): string {
  if (value === null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const lagos = new Date(date.getTime() + 60 * 60 * 1000);
  return lagos.toISOString().slice(0, 16).replace("T", " ");
}

const HEADER = [
  "Invoice",
  "Branch",
  "Practitioner",
  "SCN",
  "Document",
  "Parties",
  "Description of property",
  "Consideration (₦)",
  "Client pays (₦)",
  "Branch fee (₦)",
  "Due to practitioner (₦)",
  "Status",
  "Submitted",
  "Verified",
  "Sent to practitioner",
  "RBIN",
  "Certificate",
  "Certificate issued",
  "Revoked",
  "Revocation reason",
];

/**
 * Quoted, with inner quotes doubled, so a comma in a party's name cannot shift
 * a column. A leading = + - or @ is prefixed with an apostrophe so a
 * spreadsheet shows the text instead of running it as a formula.
 */
function cell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildTransactionsCsv(rows: readonly ExportRow[]): string {
  const lines = [
    HEADER.map(cell).join(","),
    ...rows.map((r) =>
      [
        r.invoice_number ?? "",
        r.branches?.name ?? "",
        r.profiles?.full_name ?? "",
        r.profiles?.scn ?? "",
        documentLabel(r.document_type),
        r.parties,
        r.property_description ?? "",
        nairaCell(r.consideration),
        nairaCell(r.amount_payable),
        nairaCell(r.branch_fee),
        nairaCell(r.due_to_practitioner),
        statusStyles[r.status]?.label ?? r.status,
        lagosCell(r.created_at),
        lagosCell(r.verified_at),
        lagosCell(r.remitted_at),
        r.rbin ?? "",
        r.certificates?.certificate_number ?? "",
        lagosCell(r.certificates?.issued_at ?? null),
        lagosCell(r.certificates?.revoked_at ?? null),
        r.certificates?.revocation_reason ?? "",
      ]
        .map(cell)
        .join(","),
    ),
  ];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function exportFilename(from: string, to: string): string {
  return from === to ? `nba-transactions-${from}.csv` : `nba-transactions-${from}-to-${to}.csv`;
}

/** The minimal query surface used, so this module needs no Supabase import and stays testable. */
interface PagedQuery {
  select(columns: string): {
    gte(column: string, value: string): {
      lt(column: string, value: string): {
        order(column: string, options: { ascending: boolean }): {
          range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
}

const PAGE = 1000;

/**
 * Every transaction submitted in the period, oldest first. Paged, because the
 * API returns at most 1,000 rows a request and a year's export can exceed it.
 */
export async function fetchTransactionsForExport(
  from: (table: "transactions") => PagedQuery,
  range: { start: string; end: string },
): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await from("transactions")
      .select(EXPORT_COLUMNS)
      .gte("created_at", range.start)
      .lt("created_at", range.end)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as ExportRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

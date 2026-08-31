"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth";
import {
  documentLabel,
  formatDate,
  formatNaira,
  statusStyles,
  type TransactionStatus,
} from "@/lib/format";
import { supabase } from "@/lib/supabase";

interface QueueRow {
  id: string;
  receipt_number: string | null;
  document_type: string;
  parties: string;
  consideration: number;
  amount_payable: number;
  status: TransactionStatus;
  bain: string | null;
  proof_url: string | null;
  created_at: string;
  profiles: { full_name: string; scn: string | null } | null;
}

const FILTERS: { value: TransactionStatus | "all"; label: string }[] = [
  { value: "pending_verification", label: "Awaiting Review" },
  { value: "awaiting_payment", label: "Awaiting Payment" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export default function QueuePage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TransactionStatus | "all">("pending_verification");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setRows(null);
    setError(null);

    // No owner filter here, deliberately, and this is the one screen where
    // that is correct: an administrator's job is the whole branch. RLS already
    // limits the rows to their own branch, so this cannot reach another
    // branch's submissions.
    // The embed must name the foreign key. transactions references profiles
    // twice — user_id for the submitting practitioner and verified_by for the
    // administrator who approved it — so an unqualified profiles(...) is
    // ambiguous and PostgREST refuses it with PGRST201 rather than guessing.
    let query = supabase
      .from("transactions")
      .select(
        "id, receipt_number, document_type, parties, consideration, amount_payable, status, bain, proof_url, created_at, profiles!transactions_user_id_fkey(full_name, scn)",
      )
      .order("created_at", { ascending: false });

    if (filter !== "all") query = query.eq("status", filter);

    const { data, error: loadError } = await query;
    if (loadError) {
      // The underlying message is shown, not swallowed. A generic "could not
      // be loaded" turned a one-line schema error into a debugging session.
      setError(`The queue could not be loaded. ${loadError.message}`);
      return;
    }
    setRows(data as unknown as QueueRow[]);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (rows === null) return [];
    const term = search.trim().toLowerCase();
    if (term === "") return rows;
    return rows.filter(
      (r) =>
        (r.receipt_number ?? "").toLowerCase().includes(term) ||
        (r.bain ?? "").toLowerCase().includes(term) ||
        r.parties.toLowerCase().includes(term) ||
        documentLabel(r.document_type).toLowerCase().includes(term) ||
        (r.profiles?.full_name ?? "").toLowerCase().includes(term),
    );
  }, [rows, search]);

  const awaitingCount = useMemo(
    () => (rows ?? []).filter((r) => r.status === "pending_verification").length,
    [rows],
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-bold text-ink"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            Verification Queue
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Review proof of payment, then issue a BAIN and Certificate of Compliance.
            {filter === "pending_verification" && rows !== null
              ? ` ${awaitingCount} awaiting review.`
              : ""}
          </p>
        </div>

        <input
          type="search"
          placeholder="Search reference, BAIN, parties or practitioner"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-[var(--radius-input)] border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-hairline">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition " +
              (filter === f.value
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-muted hover:text-ink")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {error !== null ? (
        <div className="mt-8 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-800">{error}</p>
          <button
            onClick={load}
            className="mt-3 rounded-[var(--radius-input)] border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800"
          >
            Try again
          </button>
        </div>
      ) : rows === null ? (
        <p className="mt-8 text-sm text-ink-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-card)] border border-hairline bg-surface p-12 text-center">
          <p className="font-medium text-ink">Nothing here</p>
          <p className="mt-1 text-sm text-ink-muted">
            {search.trim() !== ""
              ? "No submission matches that search."
              : filter === "pending_verification"
                ? "No submissions are waiting for review."
                : "No transactions with this status."}
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Reference</th>
                <th className="px-4 py-3 font-semibold">Practitioner</th>
                <th className="px-4 py-3 font-semibold">Document</th>
                <th className="px-4 py-3 text-right font-semibold">Consideration</th>
                <th className="px-4 py-3 text-right font-semibold">Branch Fee</th>
                <th className="px-4 py-3 font-semibold">Submitted</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-hairline last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <span className="tabular font-medium text-ink">
                      {row.receipt_number ?? "—"}
                    </span>
                    {row.bain !== null ? (
                      <span className="tabular mt-0.5 block text-xs text-brand-600">{row.bain}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-ink">{row.profiles?.full_name ?? "Unknown"}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {row.profiles?.scn ?? "No SCN"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-ink">{documentLabel(row.document_type)}</span>
                    <span className="mt-0.5 block max-w-[18rem] truncate text-xs text-ink-muted">
                      {row.parties}
                    </span>
                  </td>
                  <td className="tabular px-4 py-3 text-right text-ink">
                    {formatNaira(row.consideration)}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-medium text-ink">
                    {formatNaira(row.amount_payable)}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{formatDate(row.created_at)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset " +
                        statusStyles[row.status].className
                      }
                    >
                      {statusStyles[row.status].label}
                    </span>
                    {row.status === "pending_verification" && row.proof_url === null ? (
                      <span className="mt-1 block text-xs text-amber-700">No proof attached</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/review/${row.id}`}
                      className="rounded-[var(--radius-input)] border border-hairline px-3 py-1.5 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
                    >
                      {row.status === "pending_verification" ? "Review" : "View"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-ink-muted">
        Showing submissions for your branch only. Signed in as {profile?.email}.
      </p>
    </>
  );
}

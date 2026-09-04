"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { StatCard } from "@/components/ui";
import { documentLabel, formatDate, formatNaira, type TransactionStatus } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * Reports.
 *
 * The designs paired this route with revenue trend charts, a payment-method
 * breakdown and a national heat map. Those are not built, and the reason is
 * not effort.
 *
 * The branch's share of a fee is still an open question (SPEC.md question 5),
 * so a revenue total would present an unanswered commercial decision as a
 * settled figure. Payment method is not recorded anywhere in the schema, so a
 * breakdown of it could only be invented. And a monthly trend drawn through a
 * handful of transactions is a shape fitted to noise, which reads as insight
 * and is not.
 *
 * What is here instead is the part of the design that was always real: the
 * export. Every figure is summed from verified submissions this branch holds,
 * and the CSV contains the rows behind it, so the number can be checked rather
 * than trusted.
 */

interface Row {
  id: string;
  receipt_number: string | null;
  rbin: string | null;
  document_type: string;
  parties: string;
  consideration: number;
  amount_payable: number;
  status: TransactionStatus;
  created_at: string;
  verified_at: string | null;
  profiles: { full_name: string; scn: string | null } | null;
}

type Period = "30" | "90" | "365" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "all", label: "All time" },
];

export default function ReportsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("90");

  const load = useCallback(async () => {
    setError(null);
    const { data, error: loadError } = await supabase
      .from("transactions")
      .select(
        "id, receipt_number, rbin, document_type, parties, consideration, amount_payable, status, created_at, verified_at, profiles!transactions_user_id_fkey(full_name, scn)",
      )
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(`The report could not be loaded. ${loadError.message}`);
      return;
    }
    setRows(data as unknown as Row[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const inPeriod = useMemo(() => {
    const list = rows ?? [];
    if (period === "all") return list;
    const cutoff = Date.now() - Number(period) * 24 * 60 * 60 * 1000;
    return list.filter((r) => new Date(r.created_at).getTime() >= cutoff);
  }, [rows, period]);

  const verified = useMemo(() => inPeriod.filter((r) => r.status === "verified"), [inPeriod]);

  const totals = useMemo(
    () => ({
      fees: verified.reduce((sum, r) => sum + r.amount_payable, 0),
      certificates: verified.length,
      submissions: inPeriod.length,
      pending: inPeriod.filter((r) => r.status === "pending_verification").length,
    }),
    [verified, inPeriod],
  );

  const byDocument = useMemo(() => {
    const map = new Map<string, { count: number; fees: number }>();
    for (const r of verified) {
      const key = r.document_type;
      const current = map.get(key) ?? { count: 0, fees: 0 };
      map.set(key, { count: current.count + 1, fees: current.fees + r.amount_payable });
    }
    return [...map.entries()].sort((a, b) => b[1].fees - a[1].fees);
  }, [verified]);

  function exportCsv() {
    const header = [
      "Receipt",
      "RBIN",
      "Practitioner",
      "SCN",
      "Document",
      "Parties",
      "Consideration (kobo)",
      "Branch fee (kobo)",
      "Status",
      "Submitted",
      "Verified",
    ];
    // Values are quoted and internal quotes doubled: a party name containing a
    // comma would otherwise shift every later column in the row.
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = [
      header.map(escape).join(","),
      ...inPeriod.map((r) =>
        [
          r.receipt_number ?? "",
          r.rbin ?? "",
          r.profiles?.full_name ?? "",
          r.profiles?.scn ?? "",
          documentLabel(r.document_type),
          r.parties,
          String(r.consideration),
          String(r.amount_payable),
          r.status,
          r.created_at,
          r.verified_at ?? "",
        ]
          .map(escape)
          .join(","),
      ),
    ];

    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nba-branch-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-bold text-ink"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            Reports
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Branch fee activity, summed from verified submissions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="rounded-[var(--radius-input)] border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            onClick={exportCsv}
            disabled={rows === null || inPeriod.length === 0}
            className="rounded-[var(--radius-input)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            Export as CSV
          </button>
        </div>
      </div>

      {error !== null ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
          <button
            onClick={load}
            className="mt-3 rounded-[var(--radius-input)] border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800"
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Branch fees verified"
          value={rows === null ? null : formatNaira(totals.fees)}
          note={`${totals.certificates} verified submissions`}
          icon="money"
          tone="brand"
        />
        <StatCard
          label="Certificates issued"
          value={rows === null ? null : String(totals.certificates)}
          note="In this period"
          icon="certificate"
          tone="success"
        />
        <StatCard
          label="Submissions"
          value={rows === null ? null : String(totals.submissions)}
          note="All statuses"
          icon="transactions"
          tone="neutral"
        />
        <StatCard
          label="Awaiting review"
          value={rows === null ? null : String(totals.pending)}
          note={totals.pending > 0 ? "Action required" : "Nothing waiting"}
          icon="clock"
          tone={totals.pending > 0 ? "accent" : "neutral"}
        />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">Verified fees by document type</h2>
        {rows === null ? (
          <p className="mt-3 text-sm text-ink-muted">Loading…</p>
        ) : byDocument.length === 0 ? (
          <div className="mt-3 rounded-[var(--radius-card)] border border-hairline bg-surface p-10 text-center">
            <p className="font-medium text-ink">Nothing verified in this period</p>
            <p className="mt-1 text-sm text-ink-muted">
              Figures appear once submissions have been approved.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Document type</th>
                  <th className="px-4 py-3 text-right font-semibold">Certificates</th>
                  <th className="px-4 py-3 text-right font-semibold">Branch fees</th>
                  <th className="px-4 py-3 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {byDocument.map(([type, value]) => {
                  const share = totals.fees === 0 ? 0 : (value.fees / totals.fees) * 100;
                  return (
                    <tr key={type} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-3 text-ink">{documentLabel(type)}</td>
                      <td className="tabular px-4 py-3 text-right text-ink">{value.count}</td>
                      <td className="tabular px-4 py-3 text-right font-medium text-ink">
                        {formatNaira(value.fees)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-canvas">
                            <span
                              className="block h-full rounded-full bg-brand-600"
                              style={{ width: `${share.toFixed(1)}%` }}
                            />
                          </span>
                          <span className="tabular w-12 text-right text-xs text-ink-muted">
                            {share.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">Recently verified</h2>
        {verified.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Nothing verified in this period.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">RBIN</th>
                  <th className="px-4 py-3 font-semibold">Practitioner</th>
                  <th className="px-4 py-3 font-semibold">Document</th>
                  <th className="px-4 py-3 text-right font-semibold">Branch fee</th>
                  <th className="px-4 py-3 font-semibold">Verified</th>
                </tr>
              </thead>
              <tbody>
                {verified.slice(0, 10).map((r) => (
                  <tr key={r.id} className="border-b border-hairline last:border-0">
                    <td className="tabular px-4 py-3 font-medium text-brand-700">{r.rbin ?? "—"}</td>
                    <td className="px-4 py-3 text-ink">{r.profiles?.full_name ?? "Unknown"}</td>
                    <td className="px-4 py-3 text-ink">{documentLabel(r.document_type)}</td>
                    <td className="tabular px-4 py-3 text-right text-ink">
                      {formatNaira(r.amount_payable)}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{formatDate(r.verified_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 max-w-3xl text-xs leading-relaxed text-ink-muted">
        Revenue totals, payment-method breakdowns and trend charts from the designs are not shown.
        The branch&rsquo;s share of a fee is an open question, payment method is not recorded in the
        schema, and a trend drawn through a handful of transactions would be a shape fitted to
        noise. The CSV contains the rows behind every figure above, so each can be checked.
      </p>
    </>
  );
}

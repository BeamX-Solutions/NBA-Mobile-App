"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import {
  documentLabel,
  formatDate,
  formatNaira,
  statusStyles,
  type TransactionStatus,
} from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * Branch overview.
 *
 * Every figure here is counted from rows this branch actually holds. The
 * mockup's revenue tiles are deliberately absent: the branch's share of a fee
 * is still an open question (SPEC.md question 5), and reporting a revenue
 * total would present an unanswered commercial decision as settled fact.
 *
 * "Branch fees verified" is the one money figure that is safe to show. It is
 * the sum of what practitioners were asked to pay their branch on submissions
 * an administrator has actually verified — a number the system knows, rather
 * than one it infers.
 *
 * There is no trend chart. With a handful of transactions a monthly series
 * would be a shape drawn through noise, which reads as insight and is not.
 */

interface RecentRow {
  id: string;
  receipt_number: string | null;
  document_type: string;
  status: TransactionStatus;
  amount_payable: number;
  created_at: string;
  profiles: { full_name: string } | null;
}

interface Stats {
  pending: number;
  verified: number;
  certificates: number;
  practitioners: number;
  feesVerified: number;
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);

    const countOf = (status: TransactionStatus) =>
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("status", status);

    const [pending, verified, certificates, practitioners, verifiedRows, recentRows] =
      await Promise.all([
        countOf("pending_verification"),
        countOf("verified"),
        supabase.from("certificates").select("id", { count: "exact", head: true }),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "branch_member"),
        supabase.from("transactions").select("amount_payable").eq("status", "verified"),
        supabase
          .from("transactions")
          .select(
            "id, receipt_number, document_type, status, amount_payable, created_at, profiles!transactions_user_id_fkey(full_name)",
          )
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

    const firstError =
      pending.error ??
      verified.error ??
      certificates.error ??
      practitioners.error ??
      verifiedRows.error ??
      recentRows.error;

    if (firstError) {
      setError(`The overview could not be loaded. ${firstError.message}`);
      return;
    }

    setStats({
      pending: pending.count ?? 0,
      verified: verified.count ?? 0,
      certificates: certificates.count ?? 0,
      practitioners: practitioners.count ?? 0,
      feesVerified: ((verifiedRows.data ?? []) as { amount_payable: number }[]).reduce(
        (total, row) => total + row.amount_payable,
        0,
      ),
    });
    setRecent((recentRows.data ?? []) as unknown as RecentRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
      >
        Overview
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Counted from this branch&rsquo;s records. Signed in as {profile?.email}.
      </p>

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
        <Stat
          label="Awaiting review"
          value={stats === null ? null : String(stats.pending)}
          note={
            stats !== null && stats.pending > 0 ? "Action required" : "Nothing waiting"
          }
          emphasis={stats !== null && stats.pending > 0}
          href="/queue"
        />
        <Stat
          label="Certificates issued"
          value={stats === null ? null : String(stats.certificates)}
          note="By this branch, all time"
        />
        <Stat
          label="Practitioners"
          value={stats === null ? null : String(stats.practitioners)}
          note="Registered to this branch"
          href="/practitioners"
        />
        <Stat
          label="Branch fees verified"
          value={stats === null ? null : formatNaira(stats.feesVerified)}
          note={`Across ${stats?.verified ?? 0} verified submissions`}
        />
      </div>

      <section className="mt-8">
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-semibold text-ink">Recent activity</h2>
          <Link href="/queue" className="text-sm font-medium text-brand-700 hover:underline">
            View all
          </Link>
        </div>

        {recent.length === 0 ? (
          <div className="mt-3 rounded-[var(--radius-card)] border border-hairline bg-surface p-10 text-center">
            <p className="font-medium text-ink">No activity yet</p>
            <p className="mt-1 text-sm text-ink-muted">
              Submissions appear here once practitioners in this branch generate receipts.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Reference</th>
                  <th className="px-4 py-3 font-semibold">Practitioner</th>
                  <th className="px-4 py-3 font-semibold">Document</th>
                  <th className="px-4 py-3 text-right font-semibold">Branch fee</th>
                  <th className="px-4 py-3 font-semibold">Submitted</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id} className="border-b border-hairline last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3">
                      <Link
                        href={`/review/${row.id}`}
                        className="tabular font-medium text-brand-700 hover:underline"
                      >
                        {row.receipt_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink">{row.profiles?.full_name ?? "Unknown"}</td>
                    <td className="px-4 py-3 text-ink">{documentLabel(row.document_type)}</td>
                    <td className="tabular px-4 py-3 text-right text-ink">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  note,
  emphasis,
  href,
}: {
  label: string;
  value: string | null;
  note: string;
  emphasis?: boolean;
  href?: string;
}) {
  const body = (
    <div
      className={
        "h-full rounded-[var(--radius-card)] border bg-surface p-5 transition " +
        (emphasis ? "border-accent-400" : "border-hairline") +
        (href !== undefined ? " hover:border-brand-500" : "")
      }
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="tabular mt-2 text-3xl font-bold text-ink">{value ?? "—"}</p>
      <p className="mt-1 text-sm text-ink-muted">{note}</p>
    </div>
  );
  return href !== undefined ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

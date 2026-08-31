"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TrendChart, type TrendPoint } from "@/components/trend-chart";
import { DotBadge, StatCard } from "@/components/ui";
import { documentLabel, formatNaira, statusStyles, type TransactionStatus } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * Overview, following the supplied design: four metric tiles across the top,
 * then the monthly trend beside a Recent Activity card.
 *
 * Every figure is counted from rows this branch holds. The design's "Total
 * Revenue ₦12.4M, +14.2% from last month" is shown as branch fees actually
 * verified, because that is the number the system knows: the sum of what
 * practitioners were asked to pay their branch on submissions an administrator
 * approved. The month-on-month comparison is computed from the same rows
 * rather than asserted, and is hidden until there is a previous month to
 * compare against.
 */

interface RecentRow {
  id: string;
  document_type: string;
  status: TransactionStatus;
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

const MONTHS = 6;

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [delta, setDelta] = useState<number | null>(null);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);

    const countOf = (status: TransactionStatus) =>
      supabase.from("transactions").select("id", { count: "exact", head: true }).eq("status", status);

    const [pending, verified, certificates, practitioners, verifiedRows, recentRows] =
      await Promise.all([
        countOf("pending_verification"),
        countOf("verified"),
        supabase.from("certificates").select("id", { count: "exact", head: true }),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "branch_member"),
        supabase
          .from("transactions")
          .select("amount_payable, verified_at")
          .eq("status", "verified"),
        supabase
          .from("transactions")
          .select(
            "id, document_type, status, created_at, profiles!transactions_user_id_fkey(full_name)",
          )
          .order("created_at", { ascending: false })
          .limit(5),
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

    const rows = (verifiedRows.data ?? []) as { amount_payable: number; verified_at: string | null }[];

    setStats({
      pending: pending.count ?? 0,
      verified: verified.count ?? 0,
      certificates: certificates.count ?? 0,
      practitioners: practitioners.count ?? 0,
      feesVerified: rows.reduce((total, r) => total + r.amount_payable, 0),
    });

    // Bucket verified fees into the last six months, including empty ones so a
    // quiet month reads as a trough rather than disappearing from the axis.
    const now = new Date();
    const buckets: TrendPoint[] = [];
    for (let i = MONTHS - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        date,
        label: date.toLocaleDateString("en-NG", { month: "short" }),
        value: 0,
      });
    }
    for (const row of rows) {
      if (row.verified_at === null) continue;
      const when = new Date(row.verified_at);
      const bucket = buckets.find(
        (b) => b.date.getFullYear() === when.getFullYear() && b.date.getMonth() === when.getMonth(),
      );
      if (bucket) bucket.value += row.amount_payable;
    }
    setTrend(buckets);

    const current = buckets[buckets.length - 1]?.value ?? 0;
    const previous = buckets[buckets.length - 2]?.value ?? 0;
    setDelta(previous > 0 ? ((current - previous) / previous) * 100 : null);

    setRecent((recentRows.data ?? []) as unknown as RecentRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const trendNote = useMemo(() => {
    if (delta === null) return `Across ${stats?.verified ?? 0} verified submissions`;
    const sign = delta >= 0 ? "+" : "";
    return `${sign}${delta.toFixed(1)}% from last month`;
  }, [delta, stats?.verified]);

  return (
    <>
      <h1
        className="text-4xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
      >
        Overview
      </h1>
      <p className="mt-2 text-ink-muted">Track branch metrics and recent transactions.</p>

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

      <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Branch Fees Verified"
          value={stats === null ? null : formatNaira(stats.feesVerified)}
          note={trendNote}
          icon="money"
          tone="brand"
        />
        <StatCard
          label="Pending Verifications"
          value={stats === null ? null : String(stats.pending)}
          note={stats !== null && stats.pending > 0 ? "Action required" : "Nothing waiting"}
          icon="clock"
          tone={stats !== null && stats.pending > 0 ? "accent" : "neutral"}
        />
        <StatCard
          label="Active Practitioners"
          value={stats === null ? null : String(stats.practitioners)}
          note="Registered to this branch"
          icon="people"
          tone="neutral"
        />
        <StatCard
          label="Certificates Issued"
          value={stats === null ? null : String(stats.certificates)}
          note="All time"
          icon="certificate"
          tone="neutral"
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.9fr_1fr]">
        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface">
          <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
            <h2 className="text-lg font-bold text-ink">Monthly Branch Fees</h2>
            <span className="text-sm text-ink-muted">Last {MONTHS} months</span>
          </div>
          <div className="px-4 py-5">
            <TrendChart points={trend} />
          </div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface">
          <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
            <h2 className="text-lg font-bold text-ink">Recent Activity</h2>
            <Link href="/queue" className="text-sm font-medium text-brand-700 hover:underline">
              View All
            </Link>
          </div>

          {recent.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-ink-muted">
              Submissions appear here once practitioners generate receipts.
            </p>
          ) : (
            <ul>
              {recent.map((row) => (
                <li key={row.id} className="border-b border-hairline last:border-0">
                  <Link
                    href="/queue"
                    className="flex items-center justify-between gap-3 px-6 py-3.5 transition hover:bg-canvas"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        {row.profiles?.full_name ?? "Unknown"}
                      </span>
                      <span className="block truncate text-sm text-ink-muted">
                        {documentLabel(row.document_type)}
                      </span>
                    </span>
                    <DotBadge
                      label={statusStyles[row.status].label}
                      tone={
                        row.status === "verified"
                          ? "success"
                          : row.status === "rejected"
                            ? "danger"
                            : row.status === "awaiting_payment"
                              ? "warning"
                              : "neutral"
                      }
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

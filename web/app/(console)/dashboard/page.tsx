"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";

import { TrendChart, type TrendPoint } from "@/components/trend-chart";
import { DotBadge, StatCard } from "@/components/ui";
import { isSuperAdmin, useAuth } from "@/lib/auth";
import { documentLabel, formatNaira, statusStyles, type TransactionStatus } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

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
 *
 * A super administrator reads the same tiles across every branch, so they
 * are worded that way, at the client's request, and get a fifth: every
 * practitioner who has registered, against those whose branch has approved
 * them. The gap between the two is the membership queue across the country.
 *
 * The second row comes from dashboard_summary(), which counts in the database
 * with the caller's own rights: subscribers, subscription revenue, and money
 * the branch holds for practitioners. Branch administrators see their own
 * branch's figures, revenue included, at the client's request. A super
 * administrator also gets a row per branch.
 *
 * Revenue counts Paystack payments only. Subscriptions entered by hand before
 * Paystack existed carry amounts nobody paid, so until it is live the figure
 * is zero, and the tile says why.
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
  registrations: number;
  feesVerified: number;
}

interface BranchFigures {
  id: string;
  name: string;
  branch_code: string;
  active: boolean;
  practitioners: number;
  subscribers: number;
  revenue_total: number;
  pending: number;
  fees_verified: number;
  held_for_practitioners: number;
}

/** dashboard_summary(), as the database returns it. Money is kobo. */
interface Summary {
  practitioners: number;
  subscribers: number;
  expiring_30d: number;
  revenue_total: number;
  revenue_month: number;
  revenue_by_plan: Record<string, number>;
  held_for_practitioners: number;
  branches: BranchFigures[];
}

const PLAN_ORDER = ["weekly", "monthly", "quarterly", "yearly"];

/** A branch is worth a row if it is active or anything has happened in it. */
function hasActivity(b: BranchFigures): boolean {
  return (
    b.active ||
    b.practitioners > 0 ||
    b.subscribers > 0 ||
    b.pending > 0 ||
    b.fees_verified > 0 ||
    b.held_for_practitioners > 0
  );
}

const MONTHS = 6;

export default function DashboardPage() {
  const { profile } = useAuth();
  const platform = isSuperAdmin(profile);
  const fetchOverview = useCallback(async () => {
    const countOf = (status: TransactionStatus) =>
      supabase.from("transactions").select("id", { count: "exact", head: true }).eq("status", status);

    const [pending, verified, certificates, summary, registrations, verifiedRows, recentRows] =
      await Promise.all([
        countOf("pending_verification"),
        countOf("verified"),
        // Revoked certificates are excluded. The tile says how many
        // certificates this branch stands behind, and one it has publicly
        // withdrawn is not among them.
        supabase
          .from("certificates")
          .select("id", { count: "exact", head: true })
          .is("revoked_at", null),
        // Active practitioners, subscribers, revenue and money held. Active
        // means the branch has approved them, and administrators count,
        // because they practise too.
        supabase.rpc("dashboard_summary"),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .in("role", ["branch_member", "branch_admin"]),
        supabase
          .from("transactions")
          .select("branch_fee, verified_at")
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
      summary.error ??
      registrations.error ??
      verifiedRows.error ??
      recentRows.error;
    if (firstError) throw new Error(`The overview could not be loaded. ${firstError.message}`);

    const rows = (verifiedRows.data ?? []) as { branch_fee: number; verified_at: string | null }[];

    const stats: Stats = {
      pending: pending.count ?? 0,
      verified: verified.count ?? 0,
      certificates: certificates.count ?? 0,
      registrations: registrations.count ?? 0,
      // The branch fee only: the rest of what the client paid is the
      // practitioner's, held by the branch until it is sent on.
      feesVerified: rows.reduce((total, r) => total + r.branch_fee, 0),
    };

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
      if (bucket) bucket.value += row.branch_fee;
    }
    const current = buckets[buckets.length - 1]?.value ?? 0;
    const previous = buckets[buckets.length - 2]?.value ?? 0;

    return {
      stats,
      trend: buckets,
      delta: previous > 0 ? ((current - previous) / previous) * 100 : null,
      recent: (recentRows.data ?? []) as unknown as RecentRow[],
      summary: summary.data as Summary,
    };
  }, []);

  const { data, error, reload: load } = useAsyncData(fetchOverview);
  const stats = data?.stats ?? null;
  const trend = useMemo(() => data?.trend ?? [], [data]);
  const delta = data?.delta ?? null;
  const recent = useMemo(() => data?.recent ?? [], [data]);
  const summary = data?.summary ?? null;

  const branchRows = useMemo(
    () => (summary?.branches ?? []).filter(hasActivity),
    [summary],
  );
  const quietBranches = (summary?.branches.length ?? 0) - branchRows.length;

  const planNote = useMemo(() => {
    if (summary === null) return undefined;
    const parts = PLAN_ORDER.filter((plan) => (summary.revenue_by_plan[plan] ?? 0) > 0).map(
      (plan) =>
        `${plan[0].toUpperCase()}${plan.slice(1)} ${formatNaira(summary.revenue_by_plan[plan])}`,
    );
    return parts.length === 0 ? "Paystack payments only" : parts.join(" · ");
  }, [summary]);

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
        Dashboard
      </h1>
      <p className="mt-2 text-ink-muted">
        {platform
          ? "Figures across every branch, and recent transactions."
          : "Your branch's figures and recent transactions."}
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

      <div
        className={
          "mt-8 grid gap-5 sm:grid-cols-2 " + (platform ? "xl:grid-cols-5" : "xl:grid-cols-4")
        }
      >
        <StatCard
          label={platform ? "All Branch Fees Verified" : "Branch Fees Verified"}
          value={stats === null ? null : formatNaira(stats.feesVerified)}
          note={trendNote}
          icon="money"
          tone="brand"
          href={platform ? "/reports" : "/transactions?filter=verified"}
        />
        <StatCard
          label={platform ? "All Pending Verification" : "Pending Verifications"}
          value={stats === null ? null : String(stats.pending)}
          note={stats !== null && stats.pending > 0 ? "Action required" : "Nothing waiting"}
          icon="clock"
          tone={stats !== null && stats.pending > 0 ? "accent" : "neutral"}
          href={platform ? "/all-branches" : "/transactions?filter=pending_verification"}
        />
        <StatCard
          label={platform ? "All Active Practitioners" : "Active Practitioners"}
          value={summary === null ? null : String(summary.practitioners)}
          note={platform ? "Approved by their branch" : "Approved members of this branch"}
          icon="people"
          tone="neutral"
          href={platform ? "/all-branches" : "/practitioners"}
        />
        {platform ? (
          <StatCard
            label="Registration from All Branches"
            value={stats === null ? null : String(stats.registrations)}
            note={
              stats === null || summary === null || stats.registrations === summary.practitioners
                ? "Every signup, approved or not"
                : `${stats.registrations - summary.practitioners} awaiting or refused approval`
            }
            icon="people"
            tone="neutral"
            href="/all-branches"
          />
        ) : null}
        <StatCard
          label="Certificates Issued"
          value={stats === null ? null : String(stats.certificates)}
          note="All time"
          icon="certificate"
          tone="neutral"
          href="/certificates"
        />
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label={platform ? "All Subscribed Practitioners" : "Subscribed Practitioners"}
          value={
            summary === null ? null : `${summary.subscribers} of ${summary.practitioners}`
          }
          note={
            summary === null
              ? undefined
              : summary.expiring_30d > 0
                ? `${summary.expiring_30d} ending within 30 days`
                : "None ending within 30 days"
          }
          icon="people"
          tone={summary !== null && summary.expiring_30d > 0 ? "accent" : "neutral"}
          href={platform ? "/all-branches" : "/practitioners"}
        />
        <StatCard
          label={platform ? "All Subscription Revenue" : "Subscription Revenue"}
          value={summary === null ? null : formatNaira(summary.revenue_total)}
          note={
            summary === null
              ? undefined
              : `${formatNaira(summary.revenue_month)} this month · ${planNote}`
          }
          icon="money"
          tone="success"
        />
        <StatCard
          label={platform ? "All Held for Practitioners" : "Held for Practitioners"}
          value={summary === null ? null : formatNaira(summary.held_for_practitioners)}
          note="Verified, not yet sent on"
          icon="clock"
          tone={summary !== null && summary.held_for_practitioners > 0 ? "accent" : "neutral"}
          href={platform ? "/all-branches" : "/transactions?filter=to_remit"}
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
            <Link href="/transactions" className="text-sm font-medium text-brand-700 hover:underline">
              View All
            </Link>
          </div>

          {recent.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-ink-muted">
              Submissions appear here once practitioners generate invoices.
            </p>
          ) : (
            <ul>
              {recent.map((row) => (
                <li key={row.id} className="border-b border-hairline last:border-0">
                  <Link
                    href="/transactions"
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

      {platform && summary !== null ? (
        <section className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface">
          <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
            <h2 className="text-lg font-bold text-ink">By Branch</h2>
            <span className="text-sm text-ink-muted">Active branches and any with activity</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Branch</th>
                  <th className="px-4 py-3 text-right font-semibold">Practitioners</th>
                  <th className="px-4 py-3 text-right font-semibold">Subscribed</th>
                  <th className="px-4 py-3 text-right font-semibold">Subscription Revenue</th>
                  <th className="px-4 py-3 text-right font-semibold">Pending</th>
                  <th className="px-4 py-3 text-right font-semibold">Branch Fees Verified</th>
                  <th className="px-4 py-3 text-right font-semibold">Held for Practitioners</th>
                </tr>
              </thead>
              <tbody>
                {branchRows.map((b) => (
                  <tr key={b.id} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{b.name}</p>
                      <p className="tabular text-xs text-ink-muted">
                        {b.branch_code}
                        {b.active ? "" : " · Not active"}
                      </p>
                    </td>
                    <td className="tabular px-4 py-3 text-right text-ink">{b.practitioners}</td>
                    <td className="tabular px-4 py-3 text-right text-ink">{b.subscribers}</td>
                    <td className="tabular px-4 py-3 text-right text-ink">
                      {formatNaira(b.revenue_total)}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-ink">{b.pending}</td>
                    <td className="tabular px-4 py-3 text-right text-ink">
                      {formatNaira(b.fees_verified)}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-ink">
                      {formatNaira(b.held_for_practitioners)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {quietBranches > 0 ? (
            <p className="border-t border-hairline px-6 py-3 text-sm text-ink-muted">
              {quietBranches} other branches in the directory are not active and have no activity.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

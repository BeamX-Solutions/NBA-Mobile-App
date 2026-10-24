"use client";

import { Suspense, useCallback, useState } from "react";

import { BranchFilter, useBranchOptions, useBranchParam } from "@/components/branch-filter";
import { PlatformOnly } from "@/components/role-guard";
import { Pagination } from "@/components/ui";
import { formatDate, formatNaira } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * Who paid for a subscription. The super administrator's alone.
 *
 * Every subscription is paid into one central account, whatever the branch,
 * so the money and the list of who paid it are the platform's business and
 * not a branch's (20261024100000). The Dashboard gives the total; this gives
 * the people behind it.
 *
 * Paid checkouts only. A checkout that was started and never paid, or that
 * failed, is not money received, and listing it here would read as revenue.
 * Each row is one Paystack payment, so a practitioner who renewed appears once
 * per payment.
 *
 * Read only. RLS admits the super administrator to every subscription_payments
 * row and nobody else to anybody else's; PlatformOnly only stops the screen
 * rendering for a role it was not designed for.
 */

interface PaymentRow {
  reference: string;
  plan: string;
  amount: number;
  paid_at: string | null;
  profiles: {
    full_name: string;
    scn: string | null;
    branches: { name: string } | null;
  } | null;
  subscriptions: { expires_at: string } | null;
}

const PAGE_SIZE = 25;

const planLabels: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export default function SubscriptionsPage() {
  return (
    <PlatformOnly>
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <SubscriptionsView />
      </Suspense>
    </PlatformOnly>
  );
}

function SubscriptionsView() {
  const branchOptions = useBranchOptions();
  const branch = useBranchParam();
  const branchName = branchOptions.find((b) => b.id === branch)?.name ?? null;
  const [page, setPage] = useState(1);
  const [lastBranch, setLastBranch] = useState(branch);

  // A new filter starts from its first page.
  if (branch !== lastBranch) {
    setLastBranch(branch);
    setPage(1);
  }

  const fetchPayments = useCallback(async () => {
    // !inner so that filtering on the practitioner's branch drops the payment
    // rather than returning it with the profile blanked out.
    const select =
      "reference, plan, amount, paid_at, profiles!inner(full_name, scn, branch_id, branches(name)), subscriptions(expires_at)";

    let rowsQuery = supabase
      .from("subscription_payments")
      .select(select, { count: "exact" })
      .eq("status", "paid")
      .order("paid_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    // The total is over every paid row the filter admits, not just this page.
    let totalQuery = supabase
      .from("subscription_payments")
      .select("amount, profiles!inner(branch_id)")
      .eq("status", "paid");

    if (branch !== null) {
      rowsQuery = rowsQuery.eq("profiles.branch_id", branch);
      totalQuery = totalQuery.eq("profiles.branch_id", branch);
    }

    const [rows, totals] = await Promise.all([rowsQuery, totalQuery]);
    const firstError = rows.error ?? totals.error;
    if (firstError) throw new Error(`Subscriptions could not be loaded. ${firstError.message}`);

    return {
      rows: (rows.data ?? []) as unknown as PaymentRow[],
      count: rows.count ?? 0,
      total: ((totals.data ?? []) as { amount: number }[]).reduce((sum, r) => sum + Number(r.amount), 0),
      payments: totals.data?.length ?? 0,
    };
  }, [branch, page]);

  const { data, error, loading, reload } = useAsyncData(fetchPayments);
  const rows = data?.rows ?? [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-4xl font-bold text-ink"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            Subscriptions
          </h1>
          <p className="mt-2 max-w-2xl text-ink-muted">
            {branch !== null
              ? `Subscription payments from practitioners in ${branchName ?? "this branch"}.`
              : "Every subscription payment received through Paystack, from every branch."}
          </p>
        </div>
        <BranchFilter options={branchOptions} />
      </div>

      {error !== null ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
          <button
            onClick={reload}
            className="mt-3 rounded-[var(--radius-input)] border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800"
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="mt-6 rounded-[var(--radius-card)] bg-gradient-to-br from-brand-800 to-brand-600 px-6 py-5 text-white sm:max-w-md">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/70">
          Subscription Revenue
        </p>
        <p
          className="tabular mt-2 text-3xl font-bold"
          style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
        >
          {loading && data === null ? "—" : formatNaira(data?.total ?? 0)}
        </p>
        <p className="mt-1.5 text-sm text-white/75">
          {data === null
            ? " "
            : data.payments === 0
              ? "No payments yet"
              : `From ${data.payments} ${data.payments === 1 ? "payment" : "payments"}${branch !== null ? ` at ${branchName ?? "this branch"}` : ""}`}
        </p>
      </div>

      <section className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="text-lg font-bold text-ink">Payments</h2>
          <span className="text-sm text-ink-muted">Most recent first</span>
        </div>

        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-ink-muted">
            {loading && data === null
              ? "Loading…"
              : "No subscription payments yet. They appear here once Paystack confirms them."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Date Paid</th>
                    <th className="px-4 py-3 font-semibold">Practitioner</th>
                    <th className="px-4 py-3 font-semibold">Branch</th>
                    <th className="px-4 py-3 font-semibold">Plan</th>
                    <th className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Paystack Reference</th>
                    <th className="px-4 py-3 font-semibold">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.reference} className="border-b border-hairline last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-ink">{formatDate(r.paid_at)}</td>
                      <td className="px-4 py-3">
                        <p className="whitespace-nowrap font-medium text-ink">
                          {r.profiles?.full_name ?? "Unknown"}
                        </p>
                        <p className="tabular whitespace-nowrap text-xs text-ink-muted">
                          {r.profiles?.scn ?? "No SCN"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink">
                        {r.profiles?.branches?.name ?? "No branch"}
                      </td>
                      <td className="px-4 py-3 text-ink">{planLabels[r.plan] ?? r.plan}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">
                        {formatNaira(Number(r.amount))}
                      </td>
                      <td className="tabular px-4 py-3 text-xs text-ink-muted">{r.reference}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink">
                        {formatDate(r.subscriptions?.expires_at ?? null)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data?.count ?? 0} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}

"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { BranchFilter, useBranchOptions, useBranchParam } from "@/components/branch-filter";
import { DotBadge } from "@/components/ui";
import { isSuperAdmin, useAuth } from "@/lib/auth";
import { formatDate, formatNaira } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * Payables: the practitioners a branch owes, and what it has already paid.
 *
 * The client pays the whole professional fee into the branch account and the
 * branch keeps 2%. The rest is the practitioner's, held by the branch until it
 * is sent on. This is where it is sent on.
 *
 * One row per practitioner, not per invoice, decided with the client on 20
 * October 2026: a branch pays a practitioner everything it owes them in one
 * transfer. Recording it takes the bank's receipt, and the receipt is the
 * confirmation. The practitioner sees the payment as Confirmed, with the
 * receipt, in their own app, and "Held for Practitioners" falls by the amount.
 *
 * The invoices a payment covers are the ones on screen when the dialog opened,
 * passed to record_payout by id. If another payment is verified meanwhile it
 * stays owed rather than being marked paid with money that was never sent.
 *
 * A super administrator sees every branch, filterable, and records nothing:
 * the money is the branch's to send, and record_payout refuses them.
 */

const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
/** Paid rows shown at a time; Load more adds another page. */
const PAID_PAGE = 25;
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

interface OwedRow {
  id: string;
  user_id: string;
  branch_id: string;
  invoice_number: string | null;
  due_to_practitioner: number;
  verified_at: string | null;
  profiles: {
    full_name: string;
    scn: string | null;
    bank_account_name: string | null;
    bank_account_number: string | null;
    bank_name: string | null;
  } | null;
  branches: { name: string } | null;
}

/** Everything one practitioner is owed, at one branch. */
interface Payable {
  key: string;
  userId: string;
  branchId: string;
  branchName: string;
  name: string;
  scn: string | null;
  accountName: string | null;
  accountNumber: string | null;
  bankName: string | null;
  invoices: OwedRow[];
  total: number;
  oldest: string | null;
}

interface PaidRow {
  id: string;
  branchName: string;
  name: string;
  scn: string | null;
  amount: number;
  paidTo: string;
  reference: string | null;
  invoices: string[];
  recordedAt: string;
  /** Null for transfers recorded before receipts were required. */
  receiptPath: string | null;
}

interface PayoutRecord {
  id: string;
  amount: number;
  paid_to: string;
  reference: string | null;
  receipt_path: string;
  recorded_at: string;
  profiles: { full_name: string; scn: string | null } | null;
  branches: { name: string } | null;
  transactions: { invoice_number: string | null }[];
}

interface LegacyRemittance {
  id: string;
  invoice_number: string | null;
  due_to_practitioner: number;
  remitted_at: string;
  remitted_to: string | null;
  remittance_reference: string | null;
  profiles: { full_name: string; scn: string | null } | null;
  branches: { name: string } | null;
}

function groupOwed(rows: OwedRow[]): Payable[] {
  const groups = new Map<string, Payable>();
  for (const row of rows) {
    const key = `${row.branch_id}:${row.user_id}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        key,
        userId: row.user_id,
        branchId: row.branch_id,
        branchName: row.branches?.name ?? "",
        name: row.profiles?.full_name ?? "Unknown",
        scn: row.profiles?.scn ?? null,
        accountName: row.profiles?.bank_account_name ?? null,
        accountNumber: row.profiles?.bank_account_number ?? null,
        bankName: row.profiles?.bank_name ?? null,
        invoices: [],
        total: 0,
        oldest: row.verified_at,
      };
      groups.set(key, group);
    }
    group.invoices.push(row);
    group.total += row.due_to_practitioner;
  }
  // Longest waiting first: the rows are fetched oldest verification first, so
  // each group's first invoice is its oldest, and Map keeps insertion order.
  return [...groups.values()];
}

export default function PayablesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
      <PayablesView />
    </Suspense>
  );
}

function PayablesView() {
  const { profile } = useAuth();
  const platform = isSuperAdmin(profile);
  const branchOptions = useBranchOptions();
  const requestedBranch = useBranchParam();
  const branch = platform ? requestedBranch : null;
  const [paying, setPaying] = useState<Payable | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [paidShown, setPaidShown] = useState(PAID_PAGE);

  const fetchPayables = useCallback(async () => {
    let owedQuery = supabase
      .from("transactions")
      .select(
        "id, user_id, branch_id, invoice_number, due_to_practitioner, verified_at, profiles!transactions_user_id_fkey(full_name, scn, bank_account_name, bank_account_number, bank_name), branches(name)",
      )
      .eq("status", "verified")
      .is("remitted_at", null)
      .gt("due_to_practitioner", 0)
      .order("verified_at", { ascending: true });

    let paidQuery = supabase
      .from("payouts")
      .select(
        "id, amount, paid_to, reference, receipt_path, recorded_at, profiles!payouts_user_id_fkey(full_name, scn), branches(name), transactions(invoice_number)",
      )
      .order("recorded_at", { ascending: false })
      .limit(paidShown + 1);

    // Transfers recorded one invoice at a time, before payouts and receipts.
    // Still money sent, so still listed, without a receipt to show.
    let legacyQuery = supabase
      .from("transactions")
      .select(
        "id, invoice_number, due_to_practitioner, remitted_at, remitted_to, remittance_reference, profiles!transactions_user_id_fkey(full_name, scn), branches(name)",
      )
      .not("remitted_at", "is", null)
      .is("payout_id", null)
      .order("remitted_at", { ascending: false })
      .limit(paidShown + 1);

    // The Paid figure counts every payment, not just the rows on screen, so
    // it does not change as Load more is pressed. Amounts only: cheap.
    let paidTotalQuery = supabase.from("payouts").select("amount");
    let legacyTotalQuery = supabase
      .from("transactions")
      .select("due_to_practitioner")
      .not("remitted_at", "is", null)
      .is("payout_id", null);

    if (branch !== null) {
      owedQuery = owedQuery.eq("branch_id", branch);
      paidQuery = paidQuery.eq("branch_id", branch);
      legacyQuery = legacyQuery.eq("branch_id", branch);
      paidTotalQuery = paidTotalQuery.eq("branch_id", branch);
      legacyTotalQuery = legacyTotalQuery.eq("branch_id", branch);
    }

    const [owed, paid, legacy, paidTotals, legacyTotals] = await Promise.all([
      owedQuery,
      paidQuery,
      legacyQuery,
      paidTotalQuery,
      legacyTotalQuery,
    ]);
    const firstError =
      owed.error ?? paid.error ?? legacy.error ?? paidTotals.error ?? legacyTotals.error;
    if (firstError) throw new Error(`Payables could not be loaded. ${firstError.message}`);

    const paidRows: PaidRow[] = [
      ...((paid.data ?? []) as unknown as PayoutRecord[]).map((p) => ({
        id: p.id,
        branchName: p.branches?.name ?? "",
        name: p.profiles?.full_name ?? "Unknown",
        scn: p.profiles?.scn ?? null,
        amount: p.amount,
        paidTo: p.paid_to,
        reference: p.reference,
        invoices: p.transactions.map((t) => t.invoice_number ?? "—"),
        recordedAt: p.recorded_at,
        receiptPath: p.receipt_path,
      })),
      ...((legacy.data ?? []) as unknown as LegacyRemittance[]).map((t) => ({
        id: t.id,
        branchName: t.branches?.name ?? "",
        name: t.profiles?.full_name ?? "Unknown",
        scn: t.profiles?.scn ?? null,
        amount: t.due_to_practitioner,
        paidTo: t.remitted_to ?? "",
        reference: t.remittance_reference,
        invoices: [t.invoice_number ?? "—"],
        recordedAt: t.remitted_at,
        receiptPath: null,
      })),
    ].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

    const payoutAmounts = (paidTotals.data ?? []) as { amount: number }[];
    const legacyAmounts = (legacyTotals.data ?? []) as { due_to_practitioner: number }[];

    return {
      payables: groupOwed((owed.data ?? []) as unknown as OwedRow[]),
      // Each source was asked for one more row than is shown, so a longer
      // merged list means there is more to load.
      paid: paidRows.slice(0, paidShown),
      morePaid: paidRows.length > paidShown,
      paidTotal:
        payoutAmounts.reduce((sum, r) => sum + r.amount, 0) +
        legacyAmounts.reduce((sum, r) => sum + r.due_to_practitioner, 0),
      paidCount: payoutAmounts.length + legacyAmounts.length,
    };
  }, [branch, paidShown]);

  const { data, error, loading, reload } = useAsyncData(fetchPayables);
  const payables = useMemo(() => data?.payables ?? [], [data]);
  const paid = useMemo(() => data?.paid ?? [], [data]);
  const paidTotal = data?.paidTotal ?? 0;
  const paidCount = data?.paidCount ?? 0;
  const owedTotal = payables.reduce((sum, p) => sum + p.total, 0);
  const invoiceCount = payables.reduce((sum, p) => sum + p.invoices.length, 0);

  async function openReceipt(path: string) {
    setReceiptError(null);
    // Signed, and short lived: the bucket is private because a transfer
    // receipt carries account numbers.
    const { data: signed, error: signError } = await supabase.storage
      .from("payout-receipts")
      .createSignedUrl(path, 600);
    if (signError || signed === null) {
      setReceiptError(`The receipt could not be opened. ${signError?.message ?? ""}`.trim());
      return;
    }
    window.open(signed.signedUrl, "_blank", "noopener");
  }

  const branchName = branchOptions.find((b) => b.id === branch)?.name ?? null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-4xl font-bold text-ink"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            Payables
          </h1>
          <p className="mt-2 max-w-2xl text-ink-muted">
            {platform
              ? branch !== null
                ? `What ${branchName ?? "this branch"} owes practitioners, and what it has paid them.`
                : "What each branch owes practitioners, and what it has paid them."
              : "Practitioners whose clients' payments you have verified. Transfer their share, then record it here with the bank's receipt."}
          </p>
        </div>
        {platform ? <BranchFilter options={branchOptions} /> : null}
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

      {receiptError !== null ? (
        <p
          role="alert"
          className="mt-6 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          {receiptError}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-card)] bg-gradient-to-br from-brand-800 to-brand-600 px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/70">
            Held for Practitioners
          </p>
          <p
            className="tabular mt-2 text-3xl font-bold"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            {loading && data === null ? "—" : formatNaira(owedTotal)}
          </p>
          <p className="mt-1.5 text-sm text-white/75">
            {payables.length === 0
              ? "Nobody is waiting to be paid"
              : `${payables.length} ${payables.length === 1 ? "practitioner" : "practitioners"} · ${invoiceCount} ${invoiceCount === 1 ? "invoice" : "invoices"}`}
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Paid to Practitioners
          </p>
          <p
            className="tabular mt-2 text-3xl font-bold text-ink"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            {loading && data === null ? "—" : formatNaira(paidTotal)}
          </p>
          <p className="mt-1.5 text-sm text-ink-muted">
            {paidCount === 0
              ? "No payments recorded yet"
              : `Across ${paidCount} ${paidCount === 1 ? "payment" : "payments"}`}
          </p>
        </div>
      </div>

      <section className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="text-lg font-bold text-ink">To Pay</h2>
          <span className="text-sm text-ink-muted">Longest waiting first</span>
        </div>

        {loading && data === null ? (
          <p className="px-6 py-10 text-center text-sm text-ink-muted">Loading…</p>
        ) : payables.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-ink-muted">
            Nothing is owed. Practitioners appear here once their client&rsquo;s payment is verified.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Practitioner</th>
                  {platform ? <th className="px-4 py-3 font-semibold">Branch</th> : null}
                  <th className="px-4 py-3 font-semibold">Bank</th>
                  <th className="px-4 py-3 font-semibold">Account Number</th>
                  <th className="px-4 py-3 text-right font-semibold">Invoices</th>
                  <th className="px-4 py-3 text-right font-semibold">Owed</th>
                  <th className="px-4 py-3 font-semibold">Payout</th>
                  {platform ? null : <th className="px-4 py-3 text-right font-semibold">Action</th>}
                </tr>
              </thead>
              <tbody>
                {payables.map((p) => (
                  <tr key={p.key} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-3">
                      <p className="whitespace-nowrap font-medium text-ink">{p.name}</p>
                      <p className="tabular whitespace-nowrap text-xs text-ink-muted">{p.scn ?? "No SCN"}</p>
                    </td>
                    {platform ? <td className="whitespace-nowrap px-4 py-3 text-ink">{p.branchName}</td> : null}
                    {p.accountNumber === null ? (
                      <td colSpan={2} className="whitespace-nowrap px-4 py-3">
                        <p className="font-medium text-amber-800">No bank details</p>
                        <p className="text-xs text-ink-muted">They add them under Edit Profile</p>
                      </td>
                    ) : (
                      <>
                        <td className="whitespace-nowrap px-4 py-3 text-ink">{p.bankName}</td>
                        <td className="px-4 py-3">
                          <p className="tabular whitespace-nowrap text-ink">{p.accountNumber}</p>
                          <p className="whitespace-nowrap text-xs text-ink-muted">{p.accountName}</p>
                        </td>
                      </>
                    )}
                    <td className="tabular whitespace-nowrap px-4 py-3 text-right text-ink">
                      {p.invoices.length}
                      <p className="text-xs text-ink-muted">since {formatDate(p.oldest)}</p>
                    </td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">
                      {formatNaira(p.total)}
                    </td>
                    <td className="px-4 py-3">
                      <DotBadge label="Pending" tone="warning" />
                    </td>
                    {platform ? null : (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setPaying(p)}
                          disabled={p.accountNumber === null}
                          className="whitespace-nowrap rounded-[var(--radius-input)] bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Record payment
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="text-lg font-bold text-ink">Paid</h2>
          <span className="text-sm text-ink-muted">Most recent first</span>
        </div>

        {paid.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-ink-muted">
            {loading && data === null ? "Loading…" : "No payments to practitioners recorded yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Practitioner</th>
                  {platform ? <th className="px-4 py-3 font-semibold">Branch</th> : null}
                  <th className="px-4 py-3 font-semibold">Paid To</th>
                  <th className="px-4 py-3 font-semibold">Invoices</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Payout</th>
                  <th className="px-4 py-3 text-right font-semibold">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {paid.map((p) => (
                  <tr key={p.id} className="border-b border-hairline last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-ink">{formatDate(p.recordedAt)}</td>
                    <td className="px-4 py-3">
                      <p className="whitespace-nowrap font-medium text-ink">{p.name}</p>
                      <p className="tabular whitespace-nowrap text-xs text-ink-muted">{p.scn ?? "No SCN"}</p>
                    </td>
                    {platform ? <td className="whitespace-nowrap px-4 py-3 text-ink">{p.branchName}</td> : null}
                    <td className="px-4 py-3">
                      <p className="text-ink">{p.paidTo}</p>
                      {p.reference !== null ? (
                        <p className="tabular text-xs text-ink-muted">Ref {p.reference}</p>
                      ) : null}
                    </td>
                    <td className="tabular px-4 py-3 text-ink-muted">{p.invoices.join(", ")}</td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">
                      {formatNaira(p.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <DotBadge label="Confirmed" tone="success" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.receiptPath !== null ? (
                        <button
                          type="button"
                          onClick={() => openReceipt(p.receiptPath as string)}
                          className="text-sm font-medium text-brand-700 hover:underline"
                        >
                          View receipt
                        </button>
                      ) : (
                        <span className="text-xs text-ink-muted">Recorded before receipts</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data?.morePaid ? (
          <div className="border-t border-hairline px-6 py-4 text-center">
            <button
              type="button"
              onClick={() => setPaidShown((n) => n + PAID_PAGE)}
              disabled={loading}
              className="rounded-[var(--radius-input)] border border-hairline px-4 py-2 text-sm font-semibold text-ink transition hover:bg-canvas disabled:opacity-50"
            >
              {loading ? "Loading…" : "Load more payments"}
            </button>
          </div>
        ) : null}
      </section>

      {paying !== null && profile?.branch_id ? (
        <PayDialog
          payable={paying}
          branchId={profile.branch_id}
          onCancel={() => setPaying(null)}
          onDone={async () => {
            setPaying(null);
            await reload();
          }}
        />
      ) : null}

      {!platform ? (
        <p className="mt-6 text-sm text-ink-muted">
          Each invoice is also on{" "}
          <Link href="/transactions?filter=to_remit" className="font-medium text-brand-700 hover:underline">
            Transactions
          </Link>
          , under To Pay Practitioner.
        </p>
      ) : null}
    </>
  );
}

/**
 * Record one transfer, with its receipt.
 *
 * The dialog is the confirmation: it says what will happen and what will not
 * before the button that does it, so there is no second "are you sure".
 */
function PayDialog({
  payable,
  branchId,
  onCancel,
  onDone,
}: {
  payable: Payable;
  branchId: string;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  function choose(next: File | undefined) {
    setProblem(null);
    if (next === undefined) {
      setFile(null);
      return;
    }
    if (!RECEIPT_TYPES.includes(next.type)) {
      setProblem("The receipt must be a PDF, JPEG or PNG.");
      setFile(null);
      return;
    }
    if (next.size > MAX_RECEIPT_BYTES) {
      setProblem("The receipt must be 10MB or smaller.");
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function submit() {
    if (file === null) {
      setProblem("Attach the bank's transfer receipt.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      // {branch}/{practitioner}/{random}: the branch folder is what the storage
      // policy checks, and a fresh name per upload means a retry never
      // overwrites a receipt another payment already points at.
      const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
      const path = `${branchId}/${payable.userId}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("payout-receipts")
        .upload(path, file, { contentType: file.type });
      if (uploadError) {
        setProblem(`The receipt could not be uploaded. ${uploadError.message}`);
        return;
      }

      const { error: recordError } = await supabase.rpc("record_payout", {
        p_practitioner_id: payable.userId,
        p_transaction_ids: payable.invoices.map((i) => i.id),
        p_receipt_path: path,
        p_reference: reference.trim() || null,
      });
      if (recordError) {
        // Nothing points at the file yet, so the branch may remove it. If this
        // fails too, an unattached file is left, which harms nothing.
        await supabase.storage.from("payout-receipts").remove([path]);
        setProblem(`The payment could not be recorded. ${recordError.message}`);
        return;
      }

      await onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Record payment to ${payable.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-hairline bg-surface p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold text-ink">Record payment to {payable.name}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Transfer {formatNaira(payable.total)} at the bank first, then attach the receipt. This
          records the transfer; it does not send any money. {payable.name} will see it as
          Confirmed, with the receipt, and it cannot be undone.
        </p>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-[var(--radius-input)] bg-canvas px-4 py-3 text-sm">
          <dt className="text-ink-muted">Amount</dt>
          <dd className="tabular font-semibold text-ink">{formatNaira(payable.total)}</dd>
          <dt className="text-ink-muted">Account name</dt>
          <dd className="text-ink">{payable.accountName}</dd>
          <dt className="text-ink-muted">Account number</dt>
          <dd className="tabular text-ink">{payable.accountNumber}</dd>
          <dt className="text-ink-muted">Bank</dt>
          <dd className="text-ink">{payable.bankName}</dd>
          <dt className="text-ink-muted">SCN</dt>
          <dd className="tabular text-ink">{payable.scn ?? "—"}</dd>
        </dl>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Covers {payable.invoices.length} {payable.invoices.length === 1 ? "invoice" : "invoices"}
        </p>
        <ul className="mt-2 divide-y divide-hairline rounded-[var(--radius-input)] border border-hairline text-sm">
          {payable.invoices.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="tabular text-ink">{i.invoice_number ?? "—"}</span>
              <span className="text-xs text-ink-muted">verified {formatDate(i.verified_at)}</span>
              <span className="tabular text-ink">{formatNaira(i.due_to_practitioner)}</span>
            </li>
          ))}
        </ul>

        <label htmlFor="payout-receipt" className="mt-4 block text-sm font-medium text-ink">
          Transfer receipt <span className="text-ink-muted">(PDF, JPEG or PNG, up to 10MB)</span>
        </label>
        <input
          id="payout-receipt"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => choose(e.target.files?.[0])}
          className="mt-2 block w-full text-sm text-ink file:mr-3 file:rounded-[var(--radius-input)] file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700"
        />

        <label htmlFor="payout-ref" className="mt-4 block text-sm font-medium text-ink">
          Transfer reference (optional)
        </label>
        <input
          id="payout-ref"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="e.g. the session ID on the receipt"
          className="mt-2 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />

        {problem !== null ? (
          <p
            role="alert"
            className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
          >
            {problem}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[var(--radius-input)] px-4 py-2 text-sm font-medium text-ink-muted transition hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || file === null}
            className="rounded-[var(--radius-input)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Recording…" : `Record ${formatNaira(payable.total)} as paid`}
          </button>
        </div>
      </div>
    </div>
  );
}

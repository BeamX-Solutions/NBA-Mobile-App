"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import { Avatar, DotBadge, Pagination, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  documentLabel,
  formatDate,
  formatDateTime,
  formatNaira,
  statusStyles,
  type TransactionStatus,
} from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * Transaction verification.
 *
 * Laid out as in the supplied design: the counts across the top, the branch's
 * submissions as a table, and the review itself in a panel that slides in
 * beside it rather than on its own page. Keeping the queue visible while
 * reviewing is the point — an administrator working through a morning's
 * submissions never loses their place, and the proof sits next to the figures
 * it is meant to evidence.
 */

interface Row {
  id: string;
  user_id: string;
  receipt_number: string | null;
  document_type: string;
  parties: string;
  consideration: number;
  amount_payable: number;
  status: TransactionStatus;
  bain: string | null;
  proof_url: string | null;
  rejection_reason: string | null;
  created_at: string;
  verified_at: string | null;
  profiles: { full_name: string; scn: string | null; email: string } | null;
}

const FILTERS: { value: TransactionStatus | "all"; label: string }[] = [
  { value: "pending_verification", label: "Awaiting Review" },
  { value: "awaiting_payment", label: "Awaiting Payment" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const PAGE_SIZE = 10;

const SELECT =
  "id, user_id, receipt_number, document_type, parties, consideration, amount_payable, status, bain, proof_url, rejection_reason, created_at, verified_at, profiles!transactions_user_id_fkey(full_name, scn, email)";

export default function TransactionsPage() {
  const { profile } = useAuth();
  const [all, setAll] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TransactionStatus | "all">("pending_verification");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setError(null);
    // No owner filter, and this is the one screen where that is right: an
    // administrator's job is the whole branch. RLS already limits the rows to
    // their own branch, so this cannot reach another branch's submissions.
    const { data, error: loadError } = await supabase
      .from("transactions")
      .select(SELECT)
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(`The queue could not be loaded. ${loadError.message}`);
      return;
    }
    setAll(data as unknown as Row[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [filter, search]);

  const counts = useMemo(() => {
    const rows = all ?? [];
    return {
      pending: rows.filter((r) => r.status === "pending_verification").length,
      verified: rows.filter((r) => r.status === "verified").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
    };
  }, [all]);

  const filtered = useMemo(() => {
    const rows = all ?? [];
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (term === "") return true;
      return (
        (r.receipt_number ?? "").toLowerCase().includes(term) ||
        (r.bain ?? "").toLowerCase().includes(term) ||
        r.parties.toLowerCase().includes(term) ||
        documentLabel(r.document_type).toLowerCase().includes(term) ||
        (r.profiles?.full_name ?? "").toLowerCase().includes(term) ||
        (r.profiles?.scn ?? "").toLowerCase().includes(term)
      );
    });
  }, [all, filter, search]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-bold text-ink"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            Transaction Verification
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Review and approve practitioner fee payments securely.
          </p>
        </div>

        <div className="relative w-full max-w-sm">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
            <Icon name="search" size={18} />
          </span>
          <input
            type="search"
            placeholder="Search transactions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[var(--radius-input)] border border-hairline bg-surface py-2 pl-10 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Pending Verification"
          value={all === null ? null : String(counts.pending)}
          note={counts.pending > 0 ? "Action required" : "Nothing waiting"}
          icon="clock"
          tone={counts.pending > 0 ? "accent" : "neutral"}
        />
        <StatCard
          label="Verified"
          value={all === null ? null : String(counts.verified)}
          note="Certificates issued"
          icon="certificate"
          tone="success"
        />
        <StatCard
          label="Rejected"
          value={all === null ? null : String(counts.rejected)}
          note="Returned for correction"
          icon="transactions"
          tone={counts.rejected > 0 ? "danger" : "neutral"}
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
        <div className="mt-6 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-800">{error}</p>
          <button
            onClick={load}
            className="mt-3 rounded-[var(--radius-input)] border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800"
          >
            Try again
          </button>
        </div>
      ) : all === null ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-12 text-center">
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
        <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Practitioner</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount (₦)</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Document</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => {
                  const awaiting = row.status === "pending_verification";
                  return (
                    <tr
                      key={row.id}
                      className={
                        "border-b border-hairline last:border-0 " +
                        (selected?.id === row.id
                          ? "bg-brand-50"
                          : awaiting
                            ? "bg-accent-50/60 hover:bg-accent-50"
                            : "hover:bg-canvas")
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={row.profiles?.full_name ?? "?"}
                            size="sm"
                            tone={awaiting ? "accent" : "brand"}
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {row.profiles?.full_name ?? "Unknown"}
                            </p>
                            <p className="tabular truncate text-xs text-ink-muted">
                              {row.receipt_number ?? "No reference"}
                              {row.profiles?.scn ? ` · ${row.profiles.scn}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="tabular px-4 py-3 text-right font-medium text-ink">
                        {formatNaira(row.amount_payable, { showSymbol: false })}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{formatDate(row.created_at)}</td>
                      <td className="px-4 py-3">
                        <p className="text-ink">{documentLabel(row.document_type)}</p>
                        <p className="max-w-[16rem] truncate text-xs text-ink-muted">
                          {row.parties}
                        </p>
                      </td>
                      <td className="px-4 py-3">
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
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setSelected(row)}
                          className={
                            "rounded-[var(--radius-input)] px-3 py-1.5 text-sm font-medium transition " +
                            (awaiting
                              ? "bg-brand-600 text-white hover:bg-brand-700"
                              : "border border-hairline text-ink-muted hover:bg-canvas hover:text-ink")
                          }
                        >
                          {awaiting ? "Verify" : "View"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
        </div>
      )}

      <p className="mt-4 text-xs text-ink-muted">
        Showing submissions for your branch only. Signed in as {profile?.email}.
      </p>

      {selected !== null ? (
        <VerifyPanel
          row={selected}
          isOwnSubmission={selected.user_id === profile?.id}
          onClose={() => setSelected(null)}
          onDone={async () => {
            await load();
            setSelected(null);
          }}
        />
      ) : null}
    </>
  );
}

/** The slide-over from the design: details, proof, remarks, reject / approve. */
function VerifyPanel({
  row,
  isOwnSubmission,
  onClose,
  onDone,
}: {
  row: Row;
  isOwnSubmission: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofPending, setProofPending] = useState(row.proof_url !== null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ bain: string; certificate_number: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (row.proof_url === null) {
      setProofUrl(null);
      setProofPending(false);
      return;
    }
    setProofPending(true);
    // Signed URL rather than a stored public link: the proofs bucket is
    // private, and a bank slip should not be readable by anyone who guesses a
    // path. Ten minutes is long enough to review, short enough that a copied
    // link is not a lasting leak.
    supabase.storage
      .from("proofs")
      .createSignedUrl(row.proof_url, 60 * 10)
      .then(({ data }) => {
        if (cancelled) return;
        setProofUrl(data?.signedUrl ?? null);
        setProofPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row.proof_url, row.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      // Approval goes through issue_bain, never a plain status update.
      // Verifying, drawing the BAIN and creating the certificate must happen
      // together or not at all: a direct update could leave a transaction
      // verified with no certificate, or burn a sequence number on a
      // certificate that was never created. The function does all three in one
      // database transaction under a row lock, so two administrators approving
      // at the same moment cannot both mint a number.
      const { data, error: rpcError } = await supabase.rpc("issue_bain", {
        p_transaction_id: row.id,
      });
      if (rpcError) {
        setError(`The BAIN could not be issued: ${rpcError.message}. Nothing has been changed.`);
        return;
      }
      setIssued(((data ?? []) as { bain: string; certificate_number: string }[])[0] ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (reason.trim() === "") {
      // Required, not optional as the mockup's "Admin Remarks (Optional)"
      // suggested: the database refuses a rejection with no reason, and the
      // practitioner needs to know what to correct before resubmitting.
      setError("A reason is required, so the practitioner can correct it and resubmit.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from("transactions")
        .update({ status: "rejected", rejection_reason: reason.trim() })
        .eq("id", row.id);
      if (updateError) {
        setError(
          "The decision could not be saved. You may not have permission, or it may already have been reviewed.",
        );
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const decidable = row.status === "pending_verification" && issued === null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        aria-label="Close"
        onClick={onClose}
        className="flex-1 bg-black/25 backdrop-blur-[1px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Verify transaction"
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-hairline bg-surface shadow-xl"
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-hairline bg-surface px-5 py-4">
          <h2 className="font-semibold text-ink">Verify Transaction</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-[var(--radius-input)] p-1.5 text-ink-muted transition hover:bg-canvas hover:text-ink"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="flex-1 px-5 py-5">
          <div className="flex items-center gap-3">
            <Avatar name={row.profiles?.full_name ?? "?"} />
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">
                {row.profiles?.full_name ?? "Unknown"}
              </p>
              <p className="truncate text-sm text-ink-muted">
                {row.profiles?.scn ?? "No SCN"}
                {row.profiles?.email ? ` · ${row.profiles.email}` : ""}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-4 rounded-[var(--radius-card)] bg-canvas p-4">
            <Cell label="Amount payable" value={formatNaira(row.amount_payable)} strong />
            <Cell label="Document" value={documentLabel(row.document_type)} />
            <Cell label="Consideration" value={formatNaira(row.consideration)} />
            <Cell label="Reference" value={row.receipt_number ?? "None"} />
            <Cell label="Submitted" value={formatDateTime(row.created_at)} />
            <Cell label="Status" value={statusStyles[row.status].label} />
            {row.bain !== null ? <Cell label="BAIN" value={row.bain} strong /> : null}
            {row.verified_at !== null ? (
              <Cell label="Verified" value={formatDateTime(row.verified_at)} />
            ) : null}
          </dl>

          <p className="mt-3 text-sm text-ink-muted">
            <span className="font-medium text-ink">Parties.</span> {row.parties}
          </p>

          {row.rejection_reason !== null ? (
            <p className="mt-3 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
              Previously rejected: {row.rejection_reason}
            </p>
          ) : null}

          <h3 className="mt-6 text-sm font-semibold text-ink">Uploaded proof of payment</h3>
          {row.proof_url === null ? (
            <p className="mt-2 rounded-[var(--radius-input)] bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
              No proof of payment has been uploaded. There is nothing to verify against.
            </p>
          ) : proofPending ? (
            <p className="mt-2 text-sm text-ink-muted">Preparing document…</p>
          ) : proofUrl === null ? (
            <p className="mt-2 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
              The document could not be opened.
            </p>
          ) : (
            <>
              <iframe
                src={proofUrl}
                title="Proof of payment"
                className="mt-2 h-80 w-full rounded-[var(--radius-input)] border border-hairline bg-canvas"
              />
              <a
                href={proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline"
              >
                Open in a new tab
              </a>
            </>
          )}
          <p className="mt-2 text-xs text-ink-muted">
            Check that the amount transferred matches the amount payable exactly.
          </p>

          {issued !== null ? (
            <div className="mt-5 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-4">
              <p className="font-semibold text-emerald-900">Certificate issued</p>
              <p className="tabular mt-1 text-sm text-emerald-800">
                BAIN {issued.bain} · Certificate {issued.certificate_number}
              </p>
              <Link
                href={`/verify/${issued.bain.split("/").map(encodeURIComponent).join("/")}`}
                className="mt-2 inline-block text-sm font-medium text-emerald-900 underline"
              >
                Check it on the public page
              </Link>
            </div>
          ) : null}

          {decidable ? (
            <div className="mt-5">
              <label htmlFor="reason" className="text-sm font-semibold text-ink">
                Reason for rejection
              </label>
              <p className="mt-1 text-xs text-ink-muted">
                Required to reject. Shown to the practitioner so they can correct and resubmit.
              </p>
              <textarea
                id="reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. the amount transferred does not match the branch fee"
                className="mt-2 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>
          ) : null}

          {isOwnSubmission ? (
            <p className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
              This is your own submission. Another administrator must review it: approving your own
              payment would mean no second pair of eyes on a document a land registry may rely on.
            </p>
          ) : null}

          {error !== null ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
            >
              {error}
            </p>
          ) : null}
        </div>

        {decidable ? (
          <footer className="sticky bottom-0 grid grid-cols-2 gap-3 border-t border-hairline bg-surface px-5 py-4">
            <button
              onClick={reject}
              disabled={busy}
              className="rounded-[var(--radius-input)] border border-red-300 px-4 py-2.5 font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={approve}
              disabled={busy || isOwnSubmission}
              className="rounded-[var(--radius-input)] bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? "Working…" : "Approve"}
            </button>
          </footer>
        ) : (
          <footer className="sticky bottom-0 border-t border-hairline bg-surface px-5 py-4">
            <button
              onClick={issued !== null ? onDone : onClose}
              className="w-full rounded-[var(--radius-input)] border border-hairline px-4 py-2.5 font-semibold text-ink transition hover:bg-canvas"
            >
              Close
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={"mt-0.5 text-sm text-ink " + (strong ? "tabular font-bold" : "")}>{value}</dd>
    </div>
  );
}

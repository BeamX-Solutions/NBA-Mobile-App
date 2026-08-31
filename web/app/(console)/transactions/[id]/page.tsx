"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import {
  documentLabel,
  formatDateTime,
  formatNaira,
  statusStyles,
  type TransactionStatus,
} from "@/lib/format";
import { supabase } from "@/lib/supabase";

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

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();

  const [row, setRow] = useState<Row | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ bain: string; certificate_number: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    // Named foreign key: transactions references profiles through both user_id
    // and verified_by, so an unqualified embed is rejected as ambiguous.
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, user_id, receipt_number, document_type, parties, consideration, amount_payable, status, bain, proof_url, rejection_reason, created_at, verified_at, profiles!transactions_user_id_fkey(full_name, scn, email)",
      )
      .eq("id", id)
      .single();

    if (error || data === null) {
      setLoadError(`This submission could not be loaded. ${error?.message ?? ""}`.trim());
      setLoading(false);
      return;
    }

    const record = data as unknown as Row;
    setRow(record);

    // Signed URL rather than a stored public link: the proofs bucket is
    // private, and a bank slip should not be readable by anyone who guesses a
    // path. Ten minutes is long enough to review and short enough that a
    // copied link is not a lasting leak.
    if (record.proof_url !== null) {
      const { data: signed } = await supabase.storage
        .from("proofs")
        .createSignedUrl(record.proof_url, 60 * 10);
      setProofUrl(signed?.signedUrl ?? null);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve() {
    if (row === null) return;
    setBusy(true);
    setActionError(null);
    try {
      // Approval goes through issue_bain, never a plain status update.
      // Verifying, drawing the BAIN and creating the certificate must happen
      // together or not at all: a direct update could leave a transaction
      // verified with no certificate, or burn a sequence number on a
      // certificate that was never created. The function does all three in one
      // database transaction under a row lock, so two administrators approving
      // at the same moment cannot both mint a number.
      const { data, error } = await supabase.rpc("issue_bain", { p_transaction_id: row.id });

      if (error) {
        setActionError(`The BAIN could not be issued: ${error.message}. Nothing has been changed.`);
        return;
      }

      const result = ((data ?? []) as { bain: string; certificate_number: string }[])[0] ?? null;
      setIssued(result);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (row === null) return;
    if (reason.trim() === "") {
      setActionError("A reason is required, so the practitioner can correct it and resubmit.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const { error } = await supabase
        .from("transactions")
        .update({ status: "rejected", rejection_reason: reason.trim() })
        .eq("id", row.id);

      if (error) {
        setActionError(
          "The decision could not be saved. You may not have permission, or it may already have been reviewed.",
        );
        return;
      }
      router.replace("/transactions");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading submission…</p>;

  if (loadError !== null || row === null) {
    return (
      <div className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-800">{loadError ?? "Not found."}</p>
        <Link href="/transactions" className="mt-3 inline-block text-sm font-medium text-brand-700">
          Back to the queue
        </Link>
      </div>
    );
  }

  const decidable = row.status === "pending_verification";
  const ownSubmission = row.user_id === profile?.id;

  return (
    <>
      <Link href="/transactions" className="text-sm font-medium text-brand-700 hover:underline">
        ← Verification Queue
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1
          className="tabular text-2xl font-bold text-ink"
          style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
        >
          {row.receipt_number ?? "Submission"}
        </h1>
        <span
          className={
            "inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset " +
            statusStyles[row.status].className
          }
        >
          {statusStyles[row.status].label}
        </span>
      </div>

      {issued !== null ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-semibold text-emerald-900">Certificate issued</p>
          <p className="tabular mt-1 text-sm text-emerald-800">
            BAIN {issued.bain} · Certificate {issued.certificate_number}
          </p>
        </div>
      ) : null}

      {/* The two-column layout is the reason this console is on the web at all:
          the proof of payment has to be readable beside the figures it is
          meant to evidence, not scrolled past on a phone. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Submission
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Field label="Practitioner" value={row.profiles?.full_name ?? "Unknown"} />
            <Field label="SCN" value={row.profiles?.scn ?? "Not recorded"} />
            <Field label="Email" value={row.profiles?.email ?? "—"} />
            <Field label="Document" value={documentLabel(row.document_type)} />
            <Field label="Parties" value={row.parties} />
            <Field label="Consideration" value={formatNaira(row.consideration)} tabular />
            <Field label="Branch fee payable" value={formatNaira(row.amount_payable)} tabular />
            <Field label="Submitted" value={formatDateTime(row.created_at)} />
            {row.bain !== null ? <Field label="BAIN" value={row.bain} tabular /> : null}
            {row.verified_at !== null ? (
              <Field label="Verified" value={formatDateTime(row.verified_at)} />
            ) : null}
            {row.rejection_reason !== null ? (
              <Field label="Rejection reason" value={row.rejection_reason} />
            ) : null}
          </dl>
        </section>

        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Proof of payment
          </h2>

          {row.proof_url === null ? (
            <p className="mt-4 rounded-[var(--radius-input)] bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
              No proof of payment has been uploaded. There is nothing to verify against.
            </p>
          ) : proofUrl === null ? (
            <p className="mt-4 text-sm text-ink-muted">Preparing document…</p>
          ) : (
            <>
              <iframe
                src={proofUrl}
                title="Proof of payment"
                className="mt-4 h-[32rem] w-full rounded-[var(--radius-input)] border border-hairline bg-canvas"
              />
              <a
                href={proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline"
              >
                Open in a new tab
              </a>
            </>
          )}
        </section>
      </div>

      {decidable ? (
        <section className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Decision</h2>

          {ownSubmission ? (
            <p className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
              This is your own submission. Another administrator must review it. Approving your own
              payment would mean no second pair of eyes on a document a land registry may rely on.
            </p>
          ) : null}

          {actionError !== null ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
            >
              {actionError}
            </p>
          ) : null}

          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-ink">Approve</p>
              <p className="mt-1 text-sm text-ink-muted">
                Issues a BAIN and creates the Certificate of Compliance. This cannot be undone.
              </p>
              <button
                onClick={approve}
                disabled={busy || ownSubmission}
                className="mt-3 rounded-[var(--radius-input)] bg-brand-600 px-4 py-2 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "Working…" : "Approve and issue BAIN"}
              </button>
            </div>

            <div>
              <label htmlFor="reason" className="text-sm font-medium text-ink">
                Reject
              </label>
              <p className="mt-1 text-sm text-ink-muted">
                The reason is shown to the practitioner so they can correct and resubmit.
              </p>
              <textarea
                id="reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. the amount transferred does not match the branch fee"
                className="mt-2 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <button
                onClick={reject}
                disabled={busy}
                className="mt-2 rounded-[var(--radius-input)] border border-red-300 px-4 py-2 font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
              >
                Reject submission
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

function Field({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={"text-ink " + (tabular ? "tabular font-medium" : "")}>{value}</dd>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { ConfirmButton } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import {
  documentLabel,
  formatDateTime,
  formatNaira,
  statusStyles,
  type TransactionStatus,
} from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

interface Row {
  id: string;
  user_id: string;
  invoice_number: string | null;
  document_type: string;
  parties: string;
  consideration: number;
  amount_payable: number;
  status: TransactionStatus;
  rbin: string | null;
  proof_url: string | null;
  rejection_reason: string | null;
  created_at: string;
  verified_at: string | null;
  profiles: { full_name: string; scn: string | null; email: string } | null;
}

interface Certificate {
  id: string;
  certificate_number: string;
  issued_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();

  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ rbin: string; certificate_number: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const fetchRecord = useCallback(async () => {
    // Named foreign key: transactions references profiles through both user_id
    // and verified_by, so an unqualified embed is rejected as ambiguous.
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id, user_id, invoice_number, document_type, parties, consideration, amount_payable, status, rbin, proof_url, rejection_reason, created_at, verified_at, profiles!transactions_user_id_fkey(full_name, scn, email)",
      )
      .eq("id", id)
      .single();

    if (error || data === null) {
      throw new Error(`This submission could not be loaded. ${error?.message ?? ""}`.trim());
    }

    const record = data as unknown as Row;

    // Fetched separately rather than embedded, because a certificate exists
    // only once the submission has been approved and an embed would have to be
    // treated as optional anyway. maybeSingle, not single: no row is the normal
    // state for everything still in the queue, and is not an error.
    const { data: cert } = await supabase
      .from("certificates")
      .select("id, certificate_number, issued_at, revoked_at, revocation_reason")
      .eq("transaction_id", record.id)
      .maybeSingle();

    // Signed URL rather than a stored public link: the proofs bucket is
    // private, and a bank slip should not be readable by anyone who guesses a
    // path. Ten minutes is long enough to review and short enough that a
    // copied link is not a lasting leak.
    let signedUrl: string | null = null;
    if (record.proof_url !== null) {
      const { data: signed } = await supabase.storage
        .from("proofs")
        .createSignedUrl(record.proof_url, 60 * 10);
      signedUrl = signed?.signedUrl ?? null;
    }

    return {
      row: record,
      certificate: (cert as Certificate | null) ?? null,
      proofUrl: signedUrl,
    };
  }, [id]);

  const { data, error: loadError, loading, reload: load } = useAsyncData(fetchRecord);
  const row = data?.row ?? null;
  const certificate = data?.certificate ?? null;
  const proofUrl = data?.proofUrl ?? null;

  async function approve() {
    if (row === null) return;
    setBusy(true);
    setActionError(null);
    try {
      // Approval goes through issue_rbin, never a plain status update.
      // Verifying, drawing the RBIN and creating the certificate must happen
      // together or not at all: a direct update could leave a transaction
      // verified with no certificate, or burn a sequence number on a
      // certificate that was never created. The function does all three in one
      // database transaction under a row lock, so two administrators approving
      // at the same moment cannot both mint a number.
      const { data, error } = await supabase.rpc("issue_rbin", { p_transaction_id: row.id });

      if (error) {
        setActionError(`The RBIN could not be issued: ${error.message}. Nothing has been changed.`);
        return;
      }

      const result = ((data ?? []) as { rbin: string; certificate_number: string }[])[0] ?? null;
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

  async function revoke() {
    if (certificate === null) return;
    if (revokeReason.trim() === "") {
      setRevokeError("A reason is required. It is published to anyone who verifies the RBIN.");
      return;
    }
    setBusy(true);
    setRevokeError(null);
    try {
      // Through the function, never a direct update: certificates carries
      // select policies only, so the register cannot be edited by a client.
      const { error } = await supabase.rpc("revoke_certificate", {
        p_certificate_id: certificate.id,
        p_reason: revokeReason.trim(),
      });

      if (error) {
        setRevokeError(`The certificate could not be revoked: ${error.message}`);
        return;
      }
      setRevokeReason("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (certificate === null) return;
    setBusy(true);
    setRevokeError(null);
    try {
      const { error } = await supabase.rpc("restore_certificate", {
        p_certificate_id: certificate.id,
      });
      if (error) {
        setRevokeError(`The revocation could not be reversed: ${error.message}`);
        return;
      }
      await load();
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
          {row.invoice_number ?? "Submission"}
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
            RBIN {issued.rbin} · Certificate {issued.certificate_number}
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
            {row.rbin !== null ? <Field label="RBIN" value={row.rbin} tabular /> : null}
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
                Issues a RBIN and creates the Certificate of Compliance. This cannot be undone.
              </p>
              <ConfirmButton
                label="Approve and issue RBIN"
                busy={busy}
                disabled={busy || ownSubmission}
                title="Approve this submission?"
                body={`This issues the RBIN and creates the Certificate of Compliance for ${row.profiles?.full_name ?? "this practitioner"}, in one step. The reference becomes publicly verifiable immediately and the number cannot be reissued. Approving cannot be undone: a certificate issued in error has to be revoked, which is a public statement that it should not be relied on.`}
                confirmLabel="Approve and issue"
                onConfirm={approve}
                className="mt-3 rounded-[var(--radius-input)] bg-brand-600 px-4 py-2 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              />
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
              <ConfirmButton
                label="Reject submission"
                busy={busy}
                disabled={busy}
                tone="danger"
                title="Reject this submission?"
                body="The practitioner is told it was rejected and shown the reason you have given, so they can correct it and submit again. Their payment is not refunded by this, and nothing about the transaction is deleted."
                confirmLabel="Reject submission"
                onConfirm={reject}
                className="mt-2 rounded-[var(--radius-input)] border border-red-300 px-4 py-2 font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* Revocation is the only way to withdraw a certificate once it is
          issued. It lives here rather than on a screen of its own because the
          question "should this be withdrawn" is answered by looking at the
          proof above it, which is the same evidence the approval rested on. */}
      {certificate !== null ? (
        <section className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Certificate
          </h2>

          <dl className="mt-4 space-y-3 text-sm">
            <Field label="Certificate number" value={certificate.certificate_number} tabular />
            <Field label="Issued" value={formatDateTime(certificate.issued_at)} />
          </dl>

          {revokeError !== null ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
            >
              {revokeError}
            </p>
          ) : null}

          {certificate.revoked_at !== null ? (
            <>
              <div className="mt-4 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-4">
                <p className="font-semibold text-red-900">
                  Revoked on {formatDateTime(certificate.revoked_at)}
                </p>
                <p className="mt-1 text-sm text-red-800">
                  {certificate.revocation_reason ?? "No reason was recorded."}
                </p>
                <p className="mt-2 text-sm text-red-800">
                  Anyone verifying this RBIN is now told the certificate has been revoked, and is
                  shown that reason.
                </p>
              </div>

              {/* Reversal is the super administrator's alone, and the function
                  enforces that. Hiding the control from everyone else keeps the
                  console from offering an action it knows will be refused. */}
              {profile?.role === "super_admin" ? (
                <ConfirmButton
                  label="Reverse this revocation"
                  busy={busy}
                  disabled={busy}
                  title="Reverse this revocation?"
                  body="The certificate goes back to reading as genuine, and the reason recorded for withdrawing it is cleared. Anyone who checked the reference while it was revoked was told it should not be relied on, and this does not reach them."
                  confirmLabel="Reverse revocation"
                  onConfirm={restore}
                  className="mt-3 rounded-[var(--radius-input)] border border-hairline px-4 py-2 text-sm font-semibold text-ink transition hover:bg-canvas disabled:opacity-50"
                />
              ) : (
                <p className="mt-3 text-sm text-ink-muted">
                  Reversing a revocation requires a super administrator.
                </p>
              )}
            </>
          ) : (
            <div className="mt-4">
              <p className="text-sm font-medium text-ink">Revoke this certificate</p>
              <p className="mt-1 text-sm text-ink-muted">
                Use this where a certificate was issued in error, or where the payment behind it
                turned out not to be good. The RBIN keeps resolving: the public check starts
                reporting it as revoked, with the reason given below, rather than going blank. A
                land registry holding a printed copy has no other way to learn it was withdrawn.
              </p>

              <label htmlFor="revoke-reason" className="mt-4 block text-sm font-medium text-ink">
                Reason
              </label>
              <p className="mt-1 text-sm text-ink-muted">
                Published to anyone who verifies this certificate, so write it for them.
              </p>
              <textarea
                id="revoke-reason"
                rows={2}
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. issued against a payment that was later reversed"
                className="mt-2 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />

              {/* This one was already two steps, written inline before there
                  was anything to share. It uses the same dialog as the rest so
                  that a confirmation looks like a confirmation wherever it
                  appears, rather than one screen having its own idea. */}
              <div className="mt-3">
                <ConfirmButton
                  label="Revoke certificate"
                  busy={busy}
                  disabled={busy}
                  tone="danger"
                  title="Revoke this certificate?"
                  body="Anyone checking this RBIN will be told the certificate has been revoked, and shown the reason you have written. It is a public statement about a document somebody may already have relied on. Only a super administrator can reverse it, so you will not be able to undo this yourself."
                  confirmLabel="Revoke certificate"
                  onConfirm={revoke}
                  className="rounded-[var(--radius-input)] border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                />
              </div>
            </div>
          )}
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

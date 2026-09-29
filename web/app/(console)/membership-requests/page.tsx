"use client";

import { useCallback, useState } from "react";

import { ConfirmButton } from "@/components/confirm";
import { Avatar } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * Membership Requests: the people who have signed up to this branch and are
 * waiting to be accepted as members.
 *
 * Branch decision, 29 September 2026. A branch code is not a secret, so a
 * signup proves only that somebody knew one. Until an administrator here
 * approves them, the app shows them nothing but a waiting screen and the
 * database refuses them an invoice.
 *
 * Rejected requests are listed too, below the pending ones, because the
 * member is told the reason and may resubmit, and an administrator asked
 * "why was I turned down" needs to see what they said.
 *
 * Decisions go through review_membership, never a direct update: the
 * membership columns are the branch's to set, and the function also refuses
 * a decision on your own account or on somebody from another branch.
 */

interface Request {
  id: string;
  full_name: string;
  email: string;
  scn: string | null;
  phone: string | null;
  membership_status: "pending" | "rejected";
  membership_rejection_reason: string | null;
  membership_reviewed_at: string | null;
  created_at: string;
}

export default function MembershipRequestsPage() {
  const fetchRequests = useCallback(async () => {
    // RLS limits this to the administrator's own branch. Members only: an
    // administrator of the branch is exempt from approval and never waits.
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, full_name, email, scn, phone, membership_status, membership_rejection_reason, membership_reviewed_at, created_at",
      )
      .eq("role", "branch_member")
      .in("membership_status", ["pending", "rejected"])
      .order("created_at", { ascending: true });

    if (error) throw new Error(`The requests could not be loaded. ${error.message}`);
    return data as Request[];
  }, []);

  const { data, error, reload } = useAsyncData(fetchRequests);
  const pending = (data ?? []).filter((r) => r.membership_status === "pending");
  const rejected = (data ?? []).filter((r) => r.membership_status === "rejected");

  return (
    <>
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
      >
        Membership Requests
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        People who have registered with your branch. Check each one is a member before approving:
        until you do, they cannot use the app.
      </p>

      {error !== null ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-800">{error}</p>
          <button
            onClick={reload}
            className="mt-3 rounded-[var(--radius-input)] border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800"
          >
            Try again
          </button>
        </div>
      ) : data === null ? (
        <p className="mt-6 text-sm text-ink-muted">Loading requests…</p>
      ) : (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Awaiting your decision ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <p className="mt-3 rounded-[var(--radius-card)] border border-hairline bg-surface p-6 text-center text-sm text-ink-muted">
              Nobody is waiting. New registrations appear here.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {pending.map((r) => (
                <PendingCard key={r.id} request={r} onDecided={reload} />
              ))}
            </div>
          )}

          {rejected.length > 0 ? (
            <>
              <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-muted">
                Rejected, not yet resubmitted ({rejected.length})
              </h2>
              <div className="mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">SCN</th>
                      <th className="px-4 py-3 font-semibold">Reason given</th>
                      <th className="px-4 py-3 font-semibold">Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejected.map((r) => (
                      <tr key={r.id} className="border-b border-hairline last:border-0 align-top">
                        <td className="px-4 py-3 text-ink">
                          {r.full_name}
                          <p className="text-xs text-ink-muted">{r.email}</p>
                        </td>
                        <td className="tabular px-4 py-3 text-ink">{r.scn ?? "—"}</td>
                        <td className="px-4 py-3 text-ink">{r.membership_rejection_reason ?? "—"}</td>
                        <td className="px-4 py-3 text-ink-muted">
                          {formatDateTime(r.membership_reviewed_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

function PendingCard({ request, onDecided }: { request: Request; onDecided: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    if (!approve && reason.trim() === "") {
      setActionError("A reason is required, so they know what to correct.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const { error } = await supabase.rpc("review_membership", {
        p_profile_id: request.id,
        p_approve: approve,
        p_reason: approve ? null : reason.trim(),
      });
      if (error) {
        setActionError(`The decision could not be saved: ${error.message}`);
        return;
      }
      onDecided();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
      <div className="flex flex-wrap items-start gap-4">
        <Avatar name={request.full_name} />
        <dl className="grid flex-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Name" value={request.full_name} />
          <Detail label="Supreme Court Number" value={request.scn ?? "Not given"} />
          <Detail label="Email" value={request.email} />
          <Detail label="Phone" value={request.phone ?? "Not given"} />
          <Detail label="Registered" value={formatDateTime(request.created_at)} />
        </dl>
      </div>

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
          <ConfirmButton
            label="Approve member"
            busy={busy}
            disabled={busy}
            title={`Approve ${request.full_name}?`}
            body={`${request.full_name} (SCN ${request.scn ?? "not given"}) becomes a member of your branch and can use the app straight away: generate invoices that name your branch's account, and receive certificates in its name. Check the SCN against your roll first. An approval cannot be taken back here.`}
            confirmLabel="Approve"
            onConfirm={() => decide(true)}
            className="rounded-[var(--radius-input)] bg-brand-600 px-4 py-2 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          />
        </div>

        <div>
          <label htmlFor={`reason-${request.id}`} className="text-sm font-medium text-ink">
            Reject
          </label>
          <p className="mt-1 text-sm text-ink-muted">
            They are shown the reason and can correct their details and resubmit.
          </p>
          <textarea
            id={`reason-${request.id}`}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. the SCN does not match our roll"
            className="mt-2 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <ConfirmButton
            label="Reject request"
            busy={busy}
            disabled={busy}
            tone="danger"
            title={`Reject ${request.full_name}?`}
            body="They will see the reason you have given, and can correct their details and send the request back to you. Nothing about their account is deleted."
            confirmLabel="Reject"
            onConfirm={() => decide(false)}
            className="mt-2 rounded-[var(--radius-input)] border border-red-300 px-4 py-2 font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
          />
        </div>
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

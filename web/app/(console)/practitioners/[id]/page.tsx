"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback } from "react";

import { DotBadge } from "@/components/ui";
import {
  documentLabel,
  formatDate,
  formatDateTime,
  formatNaira,
  statusStyles,
  type TransactionStatus,
} from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * One practitioner, and everything the branch holds about them.
 *
 * The roster had no drill-down at all, so answering "what has this person
 * actually done" meant searching the transaction queue by their name and
 * reading the certificate register separately. Both are here, against the
 * profile and the subscription that decides whether they can submit anything
 * at all.
 *
 * Nothing on this page is editable. A profile is created by the signup
 * trigger, roles are guarded by protect_profile_columns, and a subscription
 * comes from a payment webhook, so every field shown is something an
 * administrator may need to read and none is something they may set.
 *
 * Scoping is RLS throughout. A branch administrator reaching the id of a
 * practitioner in another branch gets no profile row and sees the not-found
 * state, which is the same thing the database would tell them.
 */

interface Profile {
  id: string;
  full_name: string;
  email: string;
  scn: string | null;
  phone: string | null;
  role: string;
  practice_state: string | null;
  created_at: string;
  branches: { name: string; branch_code: string } | null;
}

interface Subscription {
  id: string;
  plan: string;
  rate_type: string;
  amount: number;
  status: string;
  starts_at: string;
  expires_at: string;
}

interface Txn {
  id: string;
  invoice_number: string | null;
  document_type: string;
  parties: string;
  amount_payable: number;
  status: TransactionStatus;
  rbin: string | null;
  created_at: string;
  certificates: { certificate_number: string; revoked_at: string | null } | null;
}

export default function PractitionerPage() {
  const { id } = useParams<{ id: string }>();

  const fetchRecord = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("profiles")
      .select(
        "id, full_name, email, scn, phone, role, practice_state, created_at, branches(name, branch_code)",
      )
      .eq("id", id)
      .maybeSingle();

    if (loadError !== null) throw new Error(loadError.message);
    if (data === null) {
      throw new Error("This practitioner could not be found, or belongs to another branch.");
    }

    const [subResult, txnResult] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("id, plan, rate_type, amount, status, starts_at, expires_at")
        .eq("user_id", id)
        .order("expires_at", { ascending: false }),
      supabase
        .from("transactions")
        .select(
          "id, invoice_number, document_type, parties, amount_payable, status, rbin, created_at, certificates(certificate_number, revoked_at)",
        )
        .eq("user_id", id)
        .order("created_at", { ascending: false }),
    ]);

    return {
      profile: data as unknown as Profile,
      subs: (subResult.data ?? []) as Subscription[],
      txns: (txnResult.data ?? []) as unknown as Txn[],
    };
  }, [id]);

  const { data, error, loading } = useAsyncData(fetchRecord);
  const profile = data?.profile ?? null;
  const subs = data?.subs ?? [];
  const txns = data?.txns ?? [];

  if (loading) return <p className="text-sm text-ink-muted">Loading practitioner…</p>;

  if (error !== null || profile === null) {
    return (
      <div className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-800">{error ?? "Not found."}</p>
        <Link href="/practitioners" className="mt-3 inline-block text-sm font-medium text-brand-700">
          Back to the roster
        </Link>
      </div>
    );
  }

  const current = subs[0];
  const entitled =
    current !== undefined &&
    current.status === "active" &&
    new Date(current.expires_at) > new Date();

  return (
    <>
      <Link href="/practitioners" className="text-sm font-medium text-brand-700 hover:underline">
        ← Practitioners
      </Link>

      <h1
        className="mt-3 text-2xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
      >
        {profile.full_name || profile.email}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {profile.branches?.name ?? "No branch"} · joined {formatDate(profile.created_at)}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Profile</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Field label="Email" value={profile.email} />
            <Field label="Phone" value={profile.phone ?? "Not recorded"} />
            <Field label="SCN" value={profile.scn ?? "Not recorded"} tabular />
            <Field
              label="Role"
              value={
                profile.role === "branch_member"
                  ? "Practitioner"
                  : profile.role === "branch_admin"
                    ? "Administrator"
                    : profile.role === "super_admin"
                      ? "Super Administrator"
                      : profile.role
              }
            />
            <Field label="Branch" value={profile.branches?.branch_code ?? "None"} tabular />
          </dl>
        </section>

        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Subscription
          </h2>

          {profile.role !== "branch_member" ? (
            <p className="mt-4 text-sm text-ink-muted">
              Administrators cannot submit transactions, so a subscription would buy them nothing.
            </p>
          ) : current === undefined ? (
            <p className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
              No subscription has ever been recorded. This practitioner cannot generate an invoice.
            </p>
          ) : (
            <>
              <div className="mt-4">
                <DotBadge
                  label={entitled ? "Active" : current.status === "active" ? "Expired" : "Inactive"}
                  tone={entitled ? "success" : "danger"}
                />
              </div>
              <dl className="mt-4 space-y-3 text-sm">
                <Field label="Plan" value={`${current.plan} (${current.rate_type})`} />
                <Field label="Amount" value={formatNaira(current.amount)} tabular />
                <Field label="Started" value={formatDate(current.starts_at)} />
                <Field label="Expires" value={formatDate(current.expires_at)} />
              </dl>
              {!entitled ? (
                <p className="mt-4 text-sm text-ink-muted">
                  This is why their invoices are being refused. Entitlement comes from a payment,
                  not from this console, so there is nothing to change here.
                </p>
              ) : null}
              {subs.length > 1 ? (
                <p className="mt-4 text-xs text-ink-muted">
                  {subs.length - 1} earlier {subs.length === 2 ? "subscription" : "subscriptions"} on
                  record.
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Transactions ({txns.length})
        </h2>

        {txns.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">Nothing submitted yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-hairline text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Invoice</th>
                  <th className="py-2 pr-4 font-semibold">Document</th>
                  <th className="py-2 pr-4 text-right font-semibold">Branch fee</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                  <th className="py-2 pr-4 font-semibold">Certificate</th>
                  <th className="py-2 text-right font-semibold">Record</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-b border-hairline last:border-0 align-top">
                    <td className="tabular py-3 pr-4 text-ink">
                      {t.invoice_number ?? "Not drawn"}
                      <p className="text-xs text-ink-muted">{formatDateTime(t.created_at)}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-ink">{documentLabel(t.document_type)}</p>
                      <p className="max-w-[16rem] truncate text-xs text-ink-muted">{t.parties}</p>
                    </td>
                    <td className="tabular py-3 pr-4 text-right text-ink">
                      {formatNaira(t.amount_payable)}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset " +
                          statusStyles[t.status].className
                        }
                      >
                        {statusStyles[t.status].label}
                      </span>
                    </td>
                    <td className="tabular py-3 pr-4 text-xs">
                      {t.certificates === null ? (
                        <span className="text-ink-muted">None</span>
                      ) : (
                        <>
                          <span className="text-ink">{t.certificates.certificate_number}</span>
                          {t.certificates.revoked_at !== null ? (
                            <p className="font-medium text-red-700">Revoked</p>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <Link
                        href={`/transactions/${t.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        Open
                      </Link>
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

function Field({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={"text-ink " + (tabular ? "tabular font-medium" : "")}>{value}</dd>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { DotBadge, Pagination } from "@/components/ui";
import { documentLabel, formatDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * The certificate register.
 *
 * Until this screen existed certificates were only ever counted, on the
 * dashboard, or fetched one at a time behind a transaction. There was no way
 * to browse what the branch had issued, no way to see which certificates had
 * been revoked, and no way to look one up by the number printed on it.
 *
 * That last point is the reason this is not merely a convenience. When a land
 * registry telephones to query a document, the reference they read out is
 * whatever is in front of them, and the certificate number sits at the foot of
 * the page in larger type than the RBIN. The queue searches receipt number,
 * RBIN, parties, document type, name and SCN, and did not search the
 * certificate number at all, so the one reference a caller was most likely to
 * quote was the one nobody could look up.
 *
 * Revocation still lives on the transaction record rather than here. The
 * question "should this be withdrawn" is answered by looking at the proof of
 * payment the approval rested on, so the row links through to that page rather
 * than offering a revoke button next to a line of text.
 *
 * Scoping is left to RLS. A branch administrator is admitted to certificates
 * of transactions in their own branch and a super administrator to all of
 * them, so the same query serves both and neither can widen it from here.
 */

interface CertificateRow {
  id: string;
  certificate_number: string;
  issued_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
  transactions: {
    id: string;
    rbin: string | null;
    document_type: string;
    parties: string;
    branch_id: string;
    profiles: { full_name: string; scn: string | null } | null;
  } | null;
}

type StatusFilter = "all" | "valid" | "revoked";

const PAGE_SIZE = 12;

export default function CertificatesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  // Fetches and returns; it sets no state of its own. See lib/use-async-data.
  const fetchRows = useCallback(async () => {
    // profiles is reached through transactions, which references it twice
    // (user_id and verified_by), so the foreign key is named or the whole
    // query is rejected as ambiguous.
    const { data, error: loadError } = await supabase
      .from("certificates")
      .select(
        "id, certificate_number, issued_at, revoked_at, revocation_reason, " +
          "transactions!inner(id, rbin, document_type, parties, branch_id, " +
          "profiles!transactions_user_id_fkey(full_name, scn))",
      )
      .order("issued_at", { ascending: false });

    if (loadError) throw new Error(`The register could not be loaded. ${loadError.message}`);
    return data as unknown as CertificateRow[];
  }, []);

  const { data: rows, error } = useAsyncData(fetchRows);

  // Paging resets where the filter changes, done in the handlers rather than
  // in an effect watching them. An effect would be a second render pass to
  // correct state the first pass already knew was wrong.
  function changeSearch(next: string) {
    setSearch(next);
    setPage(1);
  }

  function changeStatus(next: StatusFilter) {
    setStatus(next);
    setPage(1);
  }

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const term = search.trim().toLowerCase();
    return list.filter((row) => {
      if (status === "valid" && row.revoked_at !== null) return false;
      if (status === "revoked" && row.revoked_at === null) return false;
      if (term === "") return true;
      return (
        row.certificate_number.toLowerCase().includes(term) ||
        (row.transactions?.rbin ?? "").toLowerCase().includes(term) ||
        (row.transactions?.parties ?? "").toLowerCase().includes(term) ||
        (row.transactions?.profiles?.full_name ?? "").toLowerCase().includes(term) ||
        (row.transactions?.profiles?.scn ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, search, status]);

  const counts = useMemo(() => {
    const list = rows ?? [];
    return {
      all: list.length,
      valid: list.filter((r) => r.revoked_at === null).length,
      revoked: list.filter((r) => r.revoked_at !== null).length,
    };
  }, [rows]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <div>
        <h1
          className="text-3xl font-bold text-ink"
          style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
        >
          Certificates
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every Certificate of Compliance issued, and whether it still stands.
        </p>
      </div>

      <div className="mt-6 grid gap-4 rounded-[var(--radius-card)] border border-hairline bg-surface p-4 md:grid-cols-[2fr_1fr]">
        <label className="block">
          <span className="block text-sm font-medium text-ink">Search the register</span>
          <input
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            placeholder="Certificate number, RBIN, practitioner, SCN or parties"
            className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-ink">Status</span>
          <select
            value={status}
            onChange={(e) => changeStatus(e.target.value as StatusFilter)}
            className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="all">All ({counts.all})</option>
            <option value="valid">Valid ({counts.valid})</option>
            <option value="revoked">Revoked ({counts.revoked})</option>
          </select>
        </label>
      </div>

      {error !== null ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="mt-6 text-sm text-ink-muted">Loading the register…</p>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-12 text-center">
          <p className="font-medium text-ink">Nothing to show</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            {counts.all === 0
              ? "No certificate has been issued yet. One is created when a submission is approved."
              : "No certificate matches that search."}
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Certificate</th>
                  <th className="px-4 py-3 font-semibold">Practitioner</th>
                  <th className="px-4 py-3 font-semibold">Document</th>
                  <th className="px-4 py-3 font-semibold">Issued</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Record</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => {
                  const txn = row.transactions;
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-hairline last:border-0 align-top hover:bg-canvas"
                    >
                      <td className="px-4 py-3">
                        <p className="tabular font-medium text-ink">{row.certificate_number}</p>
                        <p className="tabular text-xs text-ink-muted">
                          {txn?.rbin ?? "No RBIN"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-ink">{txn?.profiles?.full_name ?? "Unknown"}</p>
                        <p className="tabular text-xs text-ink-muted">
                          {txn?.profiles?.scn ?? "No SCN"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-ink">{documentLabel(txn?.document_type ?? "")}</p>
                        <p className="max-w-[18rem] truncate text-xs text-ink-muted">
                          {txn?.parties ?? ""}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{formatDate(row.issued_at)}</td>
                      <td className="px-4 py-3">
                        <DotBadge
                          label={row.revoked_at === null ? "Valid" : "Revoked"}
                          tone={row.revoked_at === null ? "success" : "danger"}
                        />
                        {row.revoked_at !== null ? (
                          <p className="mt-1 max-w-[16rem] text-xs text-red-800">
                            {row.revocation_reason ?? "No reason recorded."}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {txn !== null ? (
                          <Link
                            href={`/transactions/${txn.id}`}
                            className="text-sm font-medium text-brand-700 hover:underline"
                          >
                            Open
                          </Link>
                        ) : null}
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

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-muted">
        A certificate is revoked from its transaction record, not from this list. Withdrawing one is
        a public statement about a document somebody may already have relied on, and it should be
        made while looking at the proof of payment the approval rested on.
      </p>
    </>
  );
}

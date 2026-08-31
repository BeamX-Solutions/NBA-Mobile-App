"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";

/**
 * The branch roster.
 *
 * Read only, and deliberately so. The mockup paired this with a "New
 * Practitioner Entry" form, which cannot be built as drawn: a profile is
 * created by the handle_new_user trigger when someone signs up, so an
 * administrator creating accounts by hand would bypass registration entirely.
 * It would also place account creation and payment approval in the same pair
 * of hands, which is the thing separation of duties exists to prevent.
 *
 * The subscription tier column from the mockup (Premium / Standard /
 * Corporate) is absent too. The schema records a duration and a rate type —
 * weekly through yearly, standard or branch discounted — and the tiered
 * pricing in the mockups is an unresolved commercial question. Showing tiers
 * that do not exist would make that decision look made.
 */

interface Practitioner {
  id: string;
  full_name: string;
  email: string;
  scn: string | null;
  phone: string | null;
  role: string;
  created_at: string;
}

export default function PractitionersPage() {
  const [rows, setRows] = useState<Practitioner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError(null);
    // RLS limits this to the administrator's own branch: the policy on
    // profiles admits member rows only where branch_id matches theirs.
    const { data, error: loadError } = await supabase
      .from("profiles")
      .select("id, full_name, email, scn, phone, role, created_at")
      .order("full_name", { ascending: true });

    if (loadError) {
      setError(`The roster could not be loaded. ${loadError.message}`);
      return;
    }
    setRows(data as Practitioner[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (rows === null) return [];
    const term = search.trim().toLowerCase();
    if (term === "") return rows;
    return rows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(term) ||
        r.email.toLowerCase().includes(term) ||
        (r.scn ?? "").toLowerCase().includes(term),
    );
  }, [rows, search]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-bold text-ink"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            Practitioners
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Everyone registered to this branch. Practitioners join by signing up in the mobile app
            with the branch code.
          </p>
        </div>

        <input
          type="search"
          placeholder="Search name, SCN or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-[var(--radius-input)] border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </div>

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
      ) : rows === null ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-12 text-center">
          <p className="font-medium text-ink">
            {search.trim() !== "" ? "No match" : "No practitioners yet"}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {search.trim() !== ""
              ? "Nobody in this branch matches that search."
              : "Practitioners appear here once they register against this branch's code."}
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-surface">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">SCN</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Registered</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-hairline last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3 font-medium text-ink">{row.full_name || "Not set"}</td>
                  <td className="tabular px-4 py-3 text-ink">{row.scn ?? "Not recorded"}</td>
                  <td className="px-4 py-3">
                    <span className="block text-ink">{row.email}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {row.phone ?? "No phone"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset " +
                        (row.role === "branch_member"
                          ? "bg-slate-100 text-slate-700 ring-slate-300"
                          : "bg-brand-50 text-brand-700 ring-brand-100")
                      }
                    >
                      {row.role === "branch_member"
                        ? "Practitioner"
                        : row.role === "branch_admin"
                          ? "Administrator"
                          : row.role === "super_admin"
                            ? "Super Administrator"
                            : row.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {new Date(row.created_at).toLocaleDateString("en-NG", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-muted">
        Subscription state is not shown here. A subscription is granted by a server-side payment
        webhook, never by an administrator, so there is nothing on this screen to act on.
      </p>
    </>
  );
}

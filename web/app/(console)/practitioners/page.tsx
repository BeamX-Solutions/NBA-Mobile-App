"use client";

import { useCallback, useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import Link from "next/link";

import { Avatar, DotBadge, Pagination } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * Practitioners Management, following the supplied design: a filter bar above
 * a table of name and contact, SCN, enrolment year, status and a row menu.
 *
 * Two columns from the mockup are deliberately absent.
 *
 * The Subscription Plan column showed Premium, Standard and Corporate. The
 * schema records a duration and a rate type — weekly through yearly, standard
 * or branch discounted — and the tiered pricing in the mockups is an
 * unresolved commercial question (DESIGN_REVIEW.md, conflict 1). Rendering
 * tiers that do not exist would make that decision look settled.
 *
 * The mockup's companion "New Practitioner Entry" form is not built. A profile
 * is created by the handle_new_user trigger at signup, so an administrator
 * creating accounts by hand would bypass registration entirely, and assigning
 * an initial subscription would contradict entitlement coming only from a
 * server side payment webhook.
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

interface SubscriptionRow {
  user_id: string;
  plan: string;
  status: string;
  expires_at: string;
}

/**
 * A subscription counts only while it is both marked active and unexpired,
 * which is exactly the test create_transaction applies. Reading the status
 * column alone would show a practitioner as subscribed on the very screen an
 * administrator opens to find out why their receipt was refused.
 */
function subBadge(sub: SubscriptionRow | undefined): {
  label: string;
  tone: "success" | "warning" | "danger";
} {
  if (sub === undefined) return { label: "None", tone: "danger" };
  if (sub.status !== "active") return { label: "Inactive", tone: "danger" };
  if (new Date(sub.expires_at) <= new Date()) return { label: "Expired", tone: "warning" };
  return { label: "Active", tone: "success" };
}

const PAGE_SIZE = 10;

export default function PractitionersPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const fetchRoster = useCallback(async () => {
    // RLS limits this to the administrator's own branch: the policy on
    // profiles admits member rows only where branch_id matches theirs.
    const { data, error: loadError } = await supabase
      .from("profiles")
      .select("id, full_name, email, scn, phone, role, created_at")
      .order("full_name", { ascending: true });

    if (loadError) throw new Error(`The roster could not be loaded. ${loadError.message}`);

    // Separate query rather than an embed: subscriptions has no foreign key
    // relationship PostgREST can follow from profiles, and a branch
    // administrator is admitted to their own members' rows by the policy added
    // in 20260922110000. Failure here is not fatal to the roster, so the error
    // is swallowed: the column simply reads "Unknown".
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("user_id, plan, status, expires_at")
      .order("expires_at", { ascending: false });

    return {
      people: data as Practitioner[],
      subscriptions: (subs ?? []) as SubscriptionRow[],
    };
  }, []);

  const { data, error, reload: load } = useAsyncData(fetchRoster);
  const rows = data?.people ?? null;
  const subscriptions = data?.subscriptions ?? null;

  // Paging resets in the handlers rather than in an effect watching the
  // filters: an effect would be a second render pass correcting state the
  // first pass already knew was wrong.
  function changeSearch(next: string) {
    setSearch(next);
    setPage(1);
  }

  function changeRole(next: string) {
    setRoleFilter(next);
    setPage(1);
  }

  // The query is ordered by expiry descending, so the first row seen for a
  // user is their furthest-reaching subscription. A practitioner who renewed
  // has more than one, and the current one is what matters.
  const subByUser = useMemo(() => {
    const map = new Map<string, SubscriptionRow>();
    for (const sub of subscriptions ?? []) {
      if (!map.has(sub.user_id)) map.set(sub.user_id, sub);
    }
    return map;
  }, [subscriptions]);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const term = search.trim().toLowerCase();
    return list.filter((r) => {
      if (roleFilter !== "all" && r.role !== roleFilter) return false;
      if (term === "") return true;
      return (
        r.full_name.toLowerCase().includes(term) ||
        r.email.toLowerCase().includes(term) ||
        (r.scn ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, search, roleFilter]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
      >
        Practitioners Management
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Legal practitioners registered to this branch. Practitioners join by signing up in the
        mobile app with the branch code.
      </p>

      <div className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <label className="block">
            <span className="block text-sm font-medium text-ink">Search practitioners</span>
            <span className="relative mt-1 block">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                <Icon name="search" size={18} />
              </span>
              <input
                type="search"
                placeholder="Search by name, SCN, or email"
                value={search}
                onChange={(e) => changeSearch(e.target.value)}
                className="w-full rounded-[var(--radius-input)] border border-hairline py-2 pl-10 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </span>
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-ink">Role</span>
            <select
              value={roleFilter}
              onChange={(e) => changeRole(e.target.value)}
              className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="all">All roles</option>
              <option value="branch_member">Practitioners</option>
              <option value="branch_admin">Administrators</option>
            </select>
          </label>
        </div>
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
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-12 text-center">
          <p className="font-medium text-ink">
            {search.trim() !== "" || roleFilter !== "all" ? "No match" : "No practitioners yet"}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {search.trim() !== "" || roleFilter !== "all"
              ? "Nobody in this branch matches those filters."
              : "Practitioners appear here once they register against this branch's code."}
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name &amp; Contact</th>
                  <th className="px-4 py-3 font-semibold">SCN</th>
                  <th className="px-4 py-3 font-semibold">Registered</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Subscription</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Record</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <tr key={row.id} className="border-b border-hairline last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          name={row.full_name || row.email}
                          size="sm"
                          tone={row.role === "branch_member" ? "muted" : "brand"}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">
                            {row.full_name || "Not set"}
                          </p>
                          <p className="truncate text-xs text-ink-muted">{row.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="tabular px-4 py-3 text-ink">{row.scn ?? "Not recorded"}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {new Date(row.created_at).toLocaleDateString("en-NG", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {row.role === "branch_member"
                        ? "Practitioner"
                        : row.role === "branch_admin"
                          ? "Administrator"
                          : row.role === "super_admin"
                            ? "Super Administrator"
                            : row.role}
                    </td>
                    <td className="px-4 py-3">
                      {subscriptions === null ? (
                        <span className="text-xs text-ink-muted">Unknown</span>
                      ) : row.role === "branch_member" ? (
                        <>
                          <DotBadge {...subBadge(subByUser.get(row.id))} />
                          {subByUser.get(row.id) !== undefined ? (
                            <p className="mt-1 text-xs text-ink-muted">
                              {subByUser.get(row.id)!.plan} to{" "}
                              {formatDate(subByUser.get(row.id)!.expires_at)}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        // Administrators cannot submit transactions at all, so
                        // a subscription would buy them nothing and its absence
                        // means nothing.
                        <span className="text-xs text-ink-muted">Not applicable</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <DotBadge
                        label={row.scn ? "Registered" : "Incomplete"}
                        tone={row.scn ? "success" : "warning"}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/practitioners/${row.id}`}
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
          <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
        </div>
      )}

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-muted">
        Subscription state is shown but cannot be changed here. Entitlement is granted by a
        server-side payment webhook and never by an administrator, so there is nothing on this
        screen to act on. It is shown because it is the usual answer when a practitioner reports
        that a receipt was refused.
      </p>
    </>
  );
}

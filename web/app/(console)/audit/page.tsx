"use client";

import { useCallback, useMemo, useState } from "react";

import { Pagination } from "@/components/ui";
import { isSuperAdmin, useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * The audit log.
 *
 * Triggers have journalled every write to branches, subscriptions,
 * transactions and certificates since the first migration, and the policy has
 * always admitted the super administrator to read it. Nothing ever did. The
 * record the README calls quasi-legal was, in practice, write only: it existed
 * to be produced if anyone ever asked, and there was no way to produce it.
 *
 * Read only, and it could not be otherwise. audit_log has no insert, update or
 * delete policy for any client, and rows arrive through a security definer
 * trigger, so there is nothing here to edit and nothing to delete. That is the
 * point of the table.
 *
 * The before and after payloads are whole row snapshots, which is far too much
 * to tabulate. Each row shows what changed, and the raw JSON is behind a
 * disclosure for the case where somebody genuinely needs to see the field that
 * moved.
 */

interface AuditRow {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

interface ActorRow {
  id: string;
  full_name: string;
  email: string;
}

const PAGE_SIZE = 25;

/**
 * Fields that moved between the two snapshots.
 *
 * updated_at is dropped: a trigger sets it on every write, so it changes in
 * every update row and naming it tells the reader nothing they did not already
 * know from the fact that a row exists.
 */
function changedFields(row: AuditRow): string[] {
  if (row.before === null || row.after === null) return [];
  const keys = new Set([...Object.keys(row.before), ...Object.keys(row.after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (key === "updated_at") continue;
    if (JSON.stringify(row.before[key]) !== JSON.stringify(row.after[key])) changed.push(key);
  }
  return changed.sort();
}

export default function AuditPage() {
  const { profile, ready } = useAuth();
  const [entity, setEntity] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const allowed = isSuperAdmin(profile);

  const fetchLog = useCallback(async () => {
    if (!allowed) return { rows: [] as AuditRow[], actors: new Map<string, ActorRow>() };

    // Bounded deliberately. The log grows without limit and nothing prunes it,
    // so an unbounded select would eventually try to render the entire history
    // of the system into one page.
    const { data, error: loadError } = await supabase
      .from("audit_log")
      .select("id, actor_id, action, entity_type, entity_id, before, after, ip, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (loadError) throw new Error(`The audit log could not be read. ${loadError.message}`);
    const log = data as AuditRow[];

    // Actors are resolved separately: actor_id has no foreign key to profiles
    // that PostgREST can follow, and it is null for anything the service role
    // did.
    const ids = [...new Set(log.map((r) => r.actor_id).filter((v): v is string => v !== null))];
    if (ids.length === 0) return { rows: log, actors: new Map<string, ActorRow>() };

    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);

    return {
      rows: log,
      actors: new Map(((people ?? []) as ActorRow[]).map((p) => [p.id, p])),
    };
  }, [allowed]);

  const { data, error } = useAsyncData(fetchLog);
  const rows = data?.rows ?? null;
  const actors = useMemo(() => data?.actors ?? new Map<string, ActorRow>(), [data]);

  // Paging resets in the handlers, not in an effect watching the filters.
  function changeSearch(next: string) {
    setSearch(next);
    setPage(1);
  }

  function changeEntity(next: string) {
    setEntity(next);
    setPage(1);
  }

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const term = search.trim().toLowerCase();
    return list.filter((r) => {
      if (entity !== "all" && r.entity_type !== entity) return false;
      if (term === "") return true;
      const actor = r.actor_id === null ? "" : (actors.get(r.actor_id)?.full_name ?? "");
      return (
        r.action.toLowerCase().includes(term) ||
        r.entity_id.toLowerCase().includes(term) ||
        actor.toLowerCase().includes(term)
      );
    });
  }, [rows, entity, search, actors]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (ready && !allowed) {
    return (
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-12 text-center">
        <p className="font-medium text-ink">Super administrators only</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          The policy on the audit log admits nobody else, so this screen is not shown to branch
          administrators rather than letting every query come back empty.
        </p>
      </div>
    );
  }

  return (
    <>
      <div>
        <h1
          className="text-3xl font-bold text-ink"
          style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
        >
          Audit Log
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every change to a branch, subscription, transaction or certificate, as recorded by the
          database itself.
        </p>
      </div>

      <div className="mt-6 grid gap-4 rounded-[var(--radius-card)] border border-hairline bg-surface p-4 md:grid-cols-[2fr_1fr]">
        <label className="block">
          <span className="block text-sm font-medium text-ink">Search</span>
          <input
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            placeholder="Action, record id, or who did it"
            className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-ink">Record type</span>
          <select
            value={entity}
            onChange={(e) => changeEntity(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="all">All</option>
            <option value="transactions">Transactions</option>
            <option value="certificates">Certificates</option>
            <option value="subscriptions">Subscriptions</option>
            <option value="branches">Branches</option>
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
        <p className="mt-6 text-sm text-ink-muted">Reading the log…</p>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-12 text-center">
          <p className="font-medium text-ink">Nothing recorded</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            No entry matches. The log records writes only, so a system nobody has used yet has an
            empty one.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Who</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Record</th>
                  <th className="px-4 py-3 font-semibold">Changed</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => {
                  const actor = row.actor_id === null ? null : actors.get(row.actor_id);
                  const changed = changedFields(row);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-hairline last:border-0 align-top hover:bg-canvas"
                    >
                      <td className="px-4 py-3 text-ink-muted">
                        {formatDateTime(row.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {actor !== undefined && actor !== null ? (
                          <>
                            <p className="text-ink">{actor.full_name}</p>
                            <p className="truncate text-xs text-ink-muted">{actor.email}</p>
                          </>
                        ) : (
                          // Null actor_id means auth.uid() was null: the write
                          // came from the service role or a database trigger
                          // rather than from a signed-in person.
                          <span className="text-xs text-ink-muted">System</span>
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-ink">{row.action}</td>
                      <td className="tabular px-4 py-3 text-xs text-ink-muted">
                        <span className="break-all">{row.entity_id}</span>
                      </td>
                      <td className="px-4 py-3">
                        {changed.length === 0 ? (
                          <span className="text-xs text-ink-muted">
                            {row.before === null ? "Created" : "Deleted"}
                          </span>
                        ) : (
                          <span className="text-xs text-ink">{changed.join(", ")}</span>
                        )}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-brand-700">
                            Snapshot
                          </summary>
                          <pre className="mt-2 max-h-60 max-w-[28rem] overflow-auto rounded-[var(--radius-input)] bg-canvas p-2 text-[11px] leading-relaxed text-ink-muted">
                            {JSON.stringify({ before: row.before, after: row.after }, null, 2)}
                          </pre>
                        </details>
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
        Entries cannot be edited or removed from here, or from anywhere else. The table has no write
        policy for any client and rows arrive through a trigger that runs as the database owner.
        Showing the most recent 1,000 entries.
      </p>
    </>
  );
}

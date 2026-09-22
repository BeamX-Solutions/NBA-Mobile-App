"use client";

import { useCallback, useMemo, useState } from "react";

import { ConfirmButton } from "@/components/confirm";
import { Avatar, DotBadge } from "@/components/ui";
import { PlatformOnly } from "@/components/role-guard";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * Administrators, by branch.
 *
 * This is what makes a super administrator a manager of administrators rather
 * than an administrator with more permissions. Until now appointing one meant
 * connecting to the database by hand: protect_profile_columns raises 42501
 * when a role changes, and nothing offered the privileged path, so the single
 * operation the role exists to perform was the one with no interface.
 *
 * Grouped by branch rather than listed as people, because the question being
 * answered is almost always about a branch: who runs Awka, and which branches
 * have nobody.
 *
 * Only between practitioner and administrator, in either direction. Promotion
 * to super administrator is deliberately absent: an interface that can mint
 * platform administrators is an interface that can be used to mint one, so
 * that stays a deliberate operation performed elsewhere.
 */

interface Person {
  id: string;
  full_name: string;
  email: string;
  scn: string | null;
  role: string;
  branch_id: string | null;
}

interface Branch {
  id: string;
  name: string;
  branch_code: string;
  activation_status: string;
}

function isLive(branch: Branch): boolean {
  return branch.activation_status === "active";
}

export default function AdministratorsPage() {
  return (
    <PlatformOnly>
      <Administrators />
    </PlatformOnly>
  );
}

function Administrators() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchAll = useCallback(async () => {
    const [branchResult, peopleResult] = await Promise.all([
      supabase
        .from("branches")
        .select("id, name, branch_code, activation_status")
        .order("name", { ascending: true }),
      supabase
        .from("profiles")
        .select("id, full_name, email, scn, role, branch_id")
        .in("role", ["branch_member", "branch_admin"])
        .order("full_name", { ascending: true }),
    ]);

    if (branchResult.error) {
      throw new Error(`The branch list could not be loaded. ${branchResult.error.message}`);
    }
    if (peopleResult.error) {
      throw new Error(`The people could not be loaded. ${peopleResult.error.message}`);
    }

    return {
      branches: branchResult.data as Branch[],
      people: peopleResult.data as Person[],
    };
  }, []);

  const { data, error: loadError, reload } = useAsyncData(fetchAll);
  const branches = useMemo(() => data?.branches ?? [], [data]);
  const people = useMemo(() => data?.people ?? [], [data]);

  const byBranch = useMemo(() => {
    const map = new Map<string, { admins: Person[]; members: Person[] }>();
    for (const b of branches) map.set(b.id, { admins: [], members: [] });
    for (const p of people) {
      if (p.branch_id === null) continue;
      const entry = map.get(p.branch_id);
      if (entry === undefined) continue;
      if (p.role === "branch_admin") entry.admins.push(p);
      else entry.members.push(p);
    }
    return map;
  }, [branches, people]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === "") return branches;
    return branches.filter(
      (b) =>
        b.name.toLowerCase().includes(term) ||
        b.branch_code.toLowerCase().includes(term) ||
        (byBranch.get(b.id)?.admins ?? []).some((a) =>
          a.full_name.toLowerCase().includes(term),
        ),
    );
  }, [branches, search, byBranch]);

  async function setRole(person: Person, role: "branch_admin" | "branch_member") {
    setBusy(person.id);
    setError(null);
    setNote(null);
    try {
      // Through the function, never a direct update. protect_profile_columns
      // guards the role column, and the function is where the rules live:
      // no self-change, no touching a super administrator, and no promoting
      // somebody who belongs to no branch.
      const { error: rpcError } = await supabase.rpc("set_user_role", {
        p_user_id: person.id,
        p_role: role,
      });

      if (rpcError) {
        setError(`${person.full_name} was not changed. ${rpcError.message}`);
        return;
      }
      setNote(
        role === "branch_admin"
          ? `${person.full_name} is now an administrator.`
          : `${person.full_name} is no longer an administrator.`,
      );
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div>
        <h1
          className="text-3xl font-bold text-ink"
          style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
        >
          Administrators
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Who runs each branch, and appointing them.
        </p>
      </div>

      <div className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
        <label className="block">
          <span className="block text-sm font-medium text-ink">Search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Branch name, code, or an administrator's name"
            className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </label>
      </div>

      {loadError !== null || error !== null ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          {error ?? loadError}
        </p>
      ) : null}

      {note !== null ? (
        <p className="mt-4 rounded-[var(--radius-input)] bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          {note}
        </p>
      ) : null}

      {data === null ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="mt-6 space-y-4">
          {visible.map((branch) => {
            const entry = byBranch.get(branch.id) ?? { admins: [], members: [] };
            return (
              <section
                key={branch.id}
                className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-ink">{branch.name}</h2>
                    <p className="tabular text-xs text-ink-muted">{branch.branch_code}</p>
                  </div>
                  <DotBadge
                    label={isLive(branch) ? "Active" : "Not active"}
                    tone={isLive(branch) ? "success" : "warning"}
                  />
                </div>

                {entry.admins.length === 0 ? (
                  <p className="mt-4 text-sm text-ink-muted">No administrator yet.</p>
                ) : (
                  <>
                    <ul className="mt-4 divide-y divide-hairline">
                      {entry.admins.map((person) => (
                        <li key={person.id} className="flex items-center gap-3 py-3">
                          <Avatar name={person.full_name || person.email} size="sm" tone="brand" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-ink">{person.full_name}</p>
                            <p className="truncate text-xs text-ink-muted">{person.email}</p>
                          </div>
                          <ConfirmButton
                            label="Remove"
                            busy={busy === person.id}
                            disabled={busy !== null}
                            tone="danger"
                            title={`Remove ${person.full_name} as an administrator?`}
                            body={`They keep their account and become an ordinary practitioner of ${branch.name} again. They will no longer be able to verify payments or issue certificates for it. Certificates they have already issued are unaffected.`}
                            confirmLabel="Remove administrator"
                            onConfirm={() => setRole(person, "branch_member")}
                            className="rounded-[var(--radius-input)] border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">
                    Appoint from this branch&rsquo;s practitioners ({entry.members.length})
                  </summary>
                  {entry.members.length === 0 ? (
                    <p className="mt-3 text-sm text-ink-muted">
                      Nobody has registered to this branch yet.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-hairline">
                      {entry.members.map((person) => (
                        <li key={person.id} className="flex items-center gap-3 py-3">
                          <Avatar name={person.full_name || person.email} size="sm" tone="muted" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-ink">{person.full_name}</p>
                            <p className="tabular truncate text-xs text-ink-muted">
                              {person.scn ?? "No SCN"}
                            </p>
                          </div>
                          <ConfirmButton
                            label="Make administrator"
                            busy={busy === person.id}
                            disabled={busy !== null}
                            title={`Make ${person.full_name} an administrator of ${branch.name}?`}
                            body="They will be able to verify payments and issue Certificates of Compliance for this branch, which are documents a land registry may rely on. They keep their practitioner account, but an administrator cannot submit transactions, so they will need a second account for their own work."
                            confirmLabel="Appoint administrator"
                            onConfirm={() => setRole(person, "branch_admin")}
                            className="rounded-[var(--radius-input)] bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-muted">
        A person keeps their practitioner account when appointed. An administrator cannot submit
        transactions, so somebody who both administers a branch and practises law needs a second
        account for their own work; that separation is enforced in the database rather than here.
        Promotion to super administrator is not offered on this screen.
      </p>
    </>
  );
}

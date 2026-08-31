"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import { Avatar, DotBadge, Pagination } from "@/components/ui";
import { isSuperAdmin, useAuth } from "@/lib/auth";
import { states } from "@/lib/states";
import { supabase } from "@/lib/supabase";

/**
 * All Branches, following the supplied super-admin design: the branch
 * directory with its primary administrator, practitioner count and status,
 * behind search and filters, with Add Branch alongside.
 *
 * This is the launch blocker the designs were right about. Branch affiliation
 * is compulsory at signup, so a practitioner whose branch has not joined
 * cannot register at all — which makes creating a branch the growth mechanism
 * for the whole product. Until now it meant running SQL by hand.
 *
 * Only a super administrator sees this. That is not a UI preference: the
 * insert policy on branches admits super_admin alone, so a branch
 * administrator reaching this route would have the form refused by the
 * database. The route is hidden from them rather than left to fail.
 *
 * Revenue per branch, in the design's table, is not shown. RLS scopes
 * transactions to a branch for its administrators and to everything for a
 * super admin, so the figure is readable — but the branch's share of a fee is
 * still an open question, and a revenue column would present that unanswered
 * decision as settled. Practitioner counts are real and shown.
 */

interface BranchRow {
  id: string;
  name: string;
  branch_code: string;
  state: string;
  activation_status: string;
  created_at: string;
}

interface AdminRow {
  id: string;
  full_name: string;
  email: string;
  branch_id: string | null;
  role: string;
}

const PAGE_SIZE = 10;

export default function BranchesPage() {
  const { profile, ready } = useAuth();
  const [branches, setBranches] = useState<BranchRow[] | null>(null);
  const [people, setPeople] = useState<AdminRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const allowed = isSuperAdmin(profile);

  const load = useCallback(async () => {
    if (!allowed) return;
    setError(null);
    const [branchResult, peopleResult] = await Promise.all([
      supabase
        .from("branches")
        .select("id, name, branch_code, state, activation_status, created_at")
        .order("name", { ascending: true }),
      supabase.from("profiles").select("id, full_name, email, branch_id, role"),
    ]);

    if (branchResult.error) {
      setError(`The branch directory could not be loaded. ${branchResult.error.message}`);
      return;
    }
    setBranches(branchResult.data as BranchRow[]);
    setPeople((peopleResult.data ?? []) as AdminRow[]);
  }, [allowed]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, stateFilter, statusFilter]);

  const byBranch = useMemo(() => {
    const map = new Map<string, { admins: AdminRow[]; practitioners: number }>();
    for (const person of people) {
      if (person.branch_id === null) continue;
      const entry = map.get(person.branch_id) ?? { admins: [], practitioners: 0 };
      if (person.role === "branch_admin" || person.role === "super_admin") entry.admins.push(person);
      if (person.role === "branch_member") entry.practitioners += 1;
      map.set(person.branch_id, entry);
    }
    return map;
  }, [people]);

  const filtered = useMemo(() => {
    const list = branches ?? [];
    const term = search.trim().toLowerCase();
    return list.filter((b) => {
      if (stateFilter !== "all" && b.state !== stateFilter) return false;
      if (statusFilter !== "all" && b.activation_status !== statusFilter) return false;
      if (term === "") return true;
      return (
        b.name.toLowerCase().includes(term) ||
        b.branch_code.toLowerCase().includes(term) ||
        b.state.toLowerCase().includes(term)
      );
    });
  }, [branches, search, stateFilter, statusFilter]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (ready && !allowed) {
    return (
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-12 text-center">
        <p className="font-medium text-ink">Super administrators only</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          Creating a branch is reserved to a super administrator. The database admits nobody else,
          so this screen is not shown to branch administrators rather than letting the form fail on
          save.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold text-ink"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            All Branches
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Oversee every NBA branch on the platform and onboard new ones.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 rounded-[var(--radius-input)] bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700"
        >
          <Icon name="plus" size={18} />
          Add Branch
        </button>
      </div>

      <div className="mt-6 grid gap-4 rounded-[var(--radius-card)] border border-hairline bg-surface p-4 md:grid-cols-[2fr_1fr_1fr]">
        <label className="block">
          <span className="block text-sm font-medium text-ink">Search branches</span>
          <span className="relative mt-1 block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
              <Icon name="search" size={18} />
            </span>
            <input
              type="search"
              placeholder="Name, code or state"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-[var(--radius-input)] border border-hairline py-2 pl-10 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </span>
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-ink">State</span>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="all">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-ink">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="expired">Expired</option>
          </select>
        </label>
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
      ) : branches === null ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-12 text-center">
          <p className="font-medium text-ink">No branches match</p>
          <p className="mt-1 text-sm text-ink-muted">Adjust the filters, or add a branch.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-hairline bg-canvas text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Branch Name</th>
                  <th className="px-4 py-3 font-semibold">Primary Admin</th>
                  <th className="px-4 py-3 text-right font-semibold">Practitioners</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((branch) => {
                  const entry = byBranch.get(branch.id);
                  const admin = entry?.admins[0] ?? null;
                  return (
                    <tr key={branch.id} className="border-b border-hairline last:border-0 hover:bg-canvas">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={branch.name} size="sm" tone="brand" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">{branch.name}</p>
                            <p className="tabular truncate text-xs text-ink-muted">
                              {branch.branch_code} · {branch.state}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {admin === null ? (
                          <span className="text-ink-muted">Pending assignment</span>
                        ) : (
                          <>
                            <p className="text-ink">{admin.full_name}</p>
                            <p className="truncate text-xs text-ink-muted">{admin.email}</p>
                          </>
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-ink">
                        {entry?.practitioners ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        <DotBadge
                          label={
                            branch.activation_status.charAt(0).toUpperCase() +
                            branch.activation_status.slice(1)
                          }
                          tone={
                            branch.activation_status === "active"
                              ? "success"
                              : branch.activation_status === "expired"
                                ? "danger"
                                : "warning"
                          }
                        />
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
        Revenue per branch is not shown. The branch&rsquo;s share of a fee is an open question, so a
        revenue column would present an unanswered decision as a settled figure.
      </p>

      {adding ? (
        <AddBranchPanel
          onClose={() => setAdding(false)}
          onCreated={async () => {
            await load();
            setAdding(false);
          }}
        />
      ) : null}
    </>
  );
}

function AddBranchPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [chairman, setChairman] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // branch_code is the string a practitioner types at signup, and the
    // database requires it uppercase and non-empty. Normalising here means a
    // lowercase entry succeeds instead of failing a check constraint.
    const normalisedCode = code.trim().toUpperCase();
    if (name.trim() === "" || normalisedCode === "" || state === "") {
      setError("Branch name, code and state are all required.");
      return;
    }
    if (!/^[A-Z0-9-]+$/.test(normalisedCode)) {
      setError("The branch code may contain only letters, numbers and hyphens.");
      return;
    }

    setBusy(true);
    const { error: insertError } = await supabase.from("branches").insert({
      name: name.trim(),
      branch_code: normalisedCode,
      state,
      bank_name: bankName.trim() || null,
      account_name: accountName.trim() || null,
      account_number: accountNumber.trim() || null,
      chairman_name: chairman.trim() || null,
    });
    setBusy(false);

    if (insertError) {
      setError(
        insertError.code === "23505"
          ? `The code ${normalisedCode} is already in use by another branch.`
          : `The branch could not be created. ${insertError.message}`,
      );
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button aria-label="Close" onClick={onClose} className="flex-1 bg-black/25" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Add branch"
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-hairline bg-surface shadow-xl"
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-hairline bg-surface px-5 py-4">
          <h2 className="font-semibold text-ink">Add Branch</h2>
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

        <form onSubmit={submit} className="flex-1 px-5 py-5">
          <p className="text-sm text-ink-muted">
            The branch code is what practitioners type when they register. Until a branch exists
            here, nobody from it can create an account at all.
          </p>

          <Field label="Branch name" value={name} onChange={setName} placeholder="NBA Awka Branch" />
          <Field
            label="Branch code"
            value={code}
            onChange={setCode}
            placeholder="AWKA"
            hint="Uppercase letters, numbers and hyphens. Practitioners type this at signup."
            tabular
          />

          <label className="mt-4 block">
            <span className="block text-sm font-medium text-ink">State</span>
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline bg-white px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">Select a state</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-muted">
              A practitioner&rsquo;s practice state is taken from their branch, so this is what their
              profile will record.
            </span>
          </label>

          <h3 className="mt-8 border-t border-hairline pt-5 text-sm font-semibold text-ink">
            Remittance details
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            Printed on every receipt this branch issues. These can be filled in later, but no
            practitioner can pay their branch fee until they are set.
          </p>
          <Field label="Bank name" value={bankName} onChange={setBankName} />
          <Field label="Account name" value={accountName} onChange={setAccountName} />
          <Field
            label="Account number"
            value={accountNumber}
            onChange={setAccountNumber}
            inputMode="numeric"
            tabular
          />
          <Field
            label="Branch chairman"
            value={chairman}
            onChange={setChairman}
            hint="Printed on every Certificate of Compliance this branch issues."
          />

          <p className="mt-6 rounded-[var(--radius-input)] bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-muted">
            The branch is created inactive. Activation and its fee are a commercial decision made
            outside this console, and the database will not let a branch activate itself.
          </p>

          {error !== null ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
            >
              {error}
            </p>
          ) : null}
        </form>

        <footer className="sticky bottom-0 grid grid-cols-2 gap-3 border-t border-hairline bg-surface px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-[var(--radius-input)] border border-hairline px-4 py-2.5 font-semibold text-ink transition hover:bg-canvas"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-[var(--radius-input)] bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create branch"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  inputMode,
  tabular,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  inputMode?: "numeric";
  tabular?: boolean;
}) {
  return (
    <label className="mt-4 block">
      <span className="block text-sm font-medium text-ink">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className={
          "mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 " +
          (tabular ? "tabular" : "")
        }
      />
      {hint !== undefined ? <span className="mt-1 block text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}

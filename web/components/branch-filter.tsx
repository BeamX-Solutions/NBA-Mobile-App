"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * One branch filter for a super administrator's screen, held in the URL as
 * ?branch=<id>.
 *
 * In the URL rather than in state so that every figure on the page reads the
 * same answer, a reload keeps it, and a filtered view can be sent to somebody.
 * The page passes the id to its queries; this only chooses it.
 *
 * Every branch in the directory is offered, active ones first. The directory
 * lists every branch in the country, most of them not yet on the platform, and
 * hiding those would make "why is Awka not here" a question with no answer on
 * screen.
 *
 * Narrowing only. RLS still decides what a filtered query returns, so a value
 * typed into the URL by hand shows nothing it would not have shown anyway.
 */

export interface BranchOption {
  id: string;
  name: string;
  branch_code: string;
  activation_status: string;
}

export function useBranchParam(): string | null {
  const value = useSearchParams().get("branch");
  // A uuid or nothing. Anything else would reach PostgREST as a filter value
  // and come back as an error rather than an empty page.
  return value !== null && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

export function useBranchOptions(): BranchOption[] {
  const fetchBranches = useCallback(async () => {
    const { data, error } = await supabase
      .from("branches")
      .select("id, name, branch_code, activation_status")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as BranchOption[];
  }, []);
  return useAsyncData(fetchBranches).data ?? [];
}

export function BranchFilter({ options }: { options: BranchOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = useBranchParam() ?? "";

  const active = options.filter((b) => b.activation_status === "active");
  const others = options.filter((b) => b.activation_status !== "active");

  function choose(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id === "") next.delete("branch");
    else next.set("branch", id);
    const query = next.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium text-ink-muted">Branch</span>
      <select
        value={current}
        onChange={(e) => choose(e.target.value)}
        className="min-w-[14rem] rounded-[var(--radius-input)] border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      >
        <option value="">All branches</option>
        {active.length > 0 ? (
          <optgroup label="Active">
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {others.length > 0 ? (
          <optgroup label="Not active">
            {others.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}

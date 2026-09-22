"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { isSuperAdmin, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * What needs attention.
 *
 * The bell used to be a link to the verification queue with a red dot on it.
 * For a branch administrator that was a third route to a screen already in the
 * nav and already carrying its own count; for a super administrator it pointed
 * at a screen they cannot open at all.
 *
 * This is the same idea done honestly. Every line is counted from rows that
 * already exist, so there is no notifications table, no read state to keep and
 * nothing to go stale: what it shows is true at the moment it is opened rather
 * than whenever an event happened to be written. The cost is that it cannot
 * tell you something changed while you were not looking, which is the thing a
 * stored notification would buy and nothing here yet needs.
 *
 * Each line links to the thing itself rather than to a list of notifications
 * about the thing.
 */

interface Item {
  label: string;
  href: string;
  count: number;
}

export function AttentionBell() {
  const { profile } = useAuth();
  const platform = isSuperAdmin(profile);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchItems = useCallback(async (): Promise<Item[]> => {
    if (profile === null) return [];

    if (platform) {
      const [branches, people] = await Promise.all([
        supabase.from("branches").select("id, activation_status"),
        supabase.from("profiles").select("branch_id, role").in("role", ["branch_admin"]),
      ]);

      const administered = new Set(
        (people.data ?? [])
          .map((p) => (p as { branch_id: string | null }).branch_id)
          .filter((v): v is string => v !== null),
      );
      const active = (branches.data ?? []).filter(
        (b) => (b as { activation_status: string }).activation_status === "active",
      );
      const withoutAdmin = active.filter(
        (b) => !administered.has((b as { id: string }).id),
      ).length;

      return [
        {
          label: withoutAdmin === 1 ? "Active branch with no administrator" : "Active branches with no administrator",
          href: "/administrators",
          count: withoutAdmin,
        },
      ].filter((i) => i.count > 0);
    }

    // A branch administrator. Both counts are scoped by RLS to their branch.
    const [pending, rejected] = await Promise.all([
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_verification"),
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("status", "rejected"),
    ]);

    return [
      {
        label: (pending.count ?? 0) === 1 ? "Submission awaiting review" : "Submissions awaiting review",
        href: "/transactions",
        count: pending.count ?? 0,
      },
      {
        // Rejected and not resubmitted. Worth surfacing because nothing else
        // chases it: the practitioner was told to correct something and may
        // simply not have.
        label: (rejected.count ?? 0) === 1 ? "Rejected submission not resubmitted" : "Rejected submissions not resubmitted",
        href: "/transactions?q=",
        count: rejected.count ?? 0,
      },
    ].filter((i) => i.count > 0);
  }, [profile, platform]);

  const { data } = useAsyncData(fetchItems);
  const items = data ?? [];
  const total = items.reduce((sum, i) => sum + i.count, 0);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          total === 0 ? "Nothing needs attention" : `${total} things need attention`
        }
        aria-expanded={open}
        className="relative rounded-[var(--radius-input)] p-2 text-ink-muted transition hover:bg-canvas hover:text-ink"
      >
        <Icon name="bell" />
        {total > 0 ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-[var(--radius-card)] border border-hairline bg-surface p-2 shadow-lg">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Needs attention
          </p>

          {items.length === 0 ? (
            <p className="px-3 pb-3 pt-1 text-sm text-ink-muted">
              Nothing waiting. This is counted when you open it, so it is current.
            </p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-input)] px-3 py-2 text-sm text-ink transition hover:bg-canvas"
                  >
                    <span>{item.label}</span>
                    <span className="tabular rounded-full bg-accent-400 px-2 py-0.5 text-xs font-bold text-brand-900">
                      {item.count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

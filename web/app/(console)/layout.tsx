"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Icon, type IconName } from "@/components/icons";
import { isAdmin, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Console shell.
 *
 * Follows the supplied admin designs: a fixed left rail carrying the branch
 * identity, the primary action and the navigation, with Help and Sign out
 * pinned to the bottom; a slim top bar with search and account; and the amber
 * active state on the current section.
 *
 * The rail collapses to a top sheet under lg. An administrator works at a desk
 * and this is not a phone surface — administrators are turned away from the
 * mobile app entirely — but a branch secretary on a small laptop should still
 * be able to reach every screen.
 *
 * The guard here is navigation, not security. RLS decides what an
 * administrator can read: a practitioner who typed /queue would get an empty
 * list, because the policy on transactions admits branch rows only to
 * branch_admin.
 */

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/practitioners", label: "Practitioners", icon: "practitioners" },
  { href: "/queue", label: "Transactions", icon: "transactions" },
  { href: "/branch", label: "Branch Records", icon: "branch" },
  { href: "/reports", label: "Reports", icon: "reports" },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { profile, session, ready, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [branchName, setBranchName] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (session === null || !isAdmin(profile)) router.replace("/login");
  }, [ready, session, profile, router]);

  const loadChrome = useCallback(async () => {
    if (!profile?.branch_id) return;
    const [branch, pending] = await Promise.all([
      supabase.from("branches").select("name").eq("id", profile.branch_id).single(),
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_verification"),
    ]);
    setBranchName((branch.data as { name: string } | null)?.name ?? null);
    setPendingCount(pending.count ?? 0);
  }, [profile?.branch_id]);

  useEffect(() => {
    loadChrome();
  }, [loadChrome, pathname]);

  // Close the small-screen menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (!ready || session === null || !isAdmin(profile)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-ink-muted">Loading…</p>
      </div>
    );
  }

  const initials = (profile?.full_name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  const rail = (
    <div className="flex h-full flex-col">
      <div className="border-b border-hairline px-6 py-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-brand-600 text-sm font-bold text-white">
            NBA
          </span>
          <div className="min-w-0">
            <p
              className="truncate font-bold text-brand-600"
              style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
            >
              {branchName ?? "Branch Console"}
            </p>
            <p className="truncate text-xs text-ink-muted">
              {profile?.role === "super_admin" ? "Super Administrator" : "NBA Administrator"}
            </p>
          </div>
        </div>
      </div>

      {/*
        The designs place a green primary action here labelled "New Entry",
        which opened a form for an administrator to register a practitioner by
        hand. That form is not built: a profile is created by the
        handle_new_user trigger at signup, so creating accounts here would
        bypass registration and put account creation and payment approval in
        the same hands.

        The slot keeps the same prominence and gives it to the action an
        administrator actually opens this console to perform, carrying the
        count of work waiting so the rail answers "is there anything for me"
        before any screen is read.
      */}
      <div className="px-4 pt-5">
        <Link
          href="/queue"
          className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-input)] bg-brand-600 px-4 py-3 font-semibold text-white transition hover:bg-brand-700"
        >
          <Icon name="clock" size={18} />
          Review Queue
          {pendingCount !== null && pendingCount > 0 ? (
            <span className="tabular ml-1 rounded-full bg-accent-400 px-2 py-0.5 text-xs font-bold text-brand-900">
              {pendingCount}
            </span>
          ) : null}
        </Link>
      </div>

      <nav className="mt-5 flex-1 space-y-1 px-4">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                "flex items-center gap-3 rounded-[var(--radius-input)] px-4 py-3 text-sm font-semibold transition " +
                (active
                  ? "bg-accent-400 text-brand-900"
                  : "text-ink-muted hover:bg-canvas hover:text-ink")
              }
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-hairline px-4 py-4">
        <Link
          href="/verify"
          className="flex items-center gap-3 rounded-[var(--radius-input)] px-4 py-3 text-sm font-semibold text-ink-muted transition hover:bg-canvas hover:text-ink"
        >
          <Icon name="help" />
          Public verification
        </Link>
        <button
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
          className="flex w-full items-center gap-3 rounded-[var(--radius-input)] px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50"
        >
          <Icon name="logout" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Fixed rail on desktop, matching the designs. */}
      <aside className="hidden w-[280px] shrink-0 border-r border-hairline bg-surface lg:block">
        <div className="sticky top-0 h-screen">{rail}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-hairline bg-surface">
          <div className="flex items-center gap-4 px-4 py-3 sm:px-6">
            <button
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label="Menu"
              className="rounded-[var(--radius-input)] border border-hairline p-2 text-ink-muted lg:hidden"
            >
              <Icon name="dashboard" />
            </button>

            <div className="relative hidden max-w-md flex-1 sm:block">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                <Icon name="search" size={18} />
              </span>
              <input
                type="search"
                placeholder="Search records…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const value = (e.target as HTMLInputElement).value.trim();
                    if (value !== "") router.push(`/queue?q=${encodeURIComponent(value)}`);
                  }
                }}
                className="w-full rounded-[var(--radius-input)] border border-hairline bg-canvas py-2 pl-10 pr-3 text-sm outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <p
              className="hidden flex-1 text-center font-bold text-brand-600 xl:block"
              style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
            >
              NBA Admin Portal
            </p>

            <div className="ml-auto flex items-center gap-3 xl:ml-0">
              <Link
                href="/verify"
                className="hidden text-sm font-medium text-ink-muted transition hover:text-ink sm:block"
              >
                Support
              </Link>

              <Link
                href="/queue"
                aria-label={`${pendingCount ?? 0} submissions awaiting review`}
                className="relative rounded-[var(--radius-input)] p-2 text-ink-muted transition hover:bg-canvas hover:text-ink"
              >
                <Icon name="bell" />
                {pendingCount !== null && pendingCount > 0 ? (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
                ) : null}
              </Link>

              <Link
                href="/branch"
                aria-label="Branch settings"
                className="rounded-[var(--radius-input)] p-2 text-ink-muted transition hover:bg-canvas hover:text-ink"
              >
                <Icon name="settings" />
              </Link>

              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold text-ink">{profile?.full_name}</p>
                <p className="text-xs text-ink-muted">{profile?.email}</p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                {initials || "NB"}
              </span>
            </div>
          </div>

          {menuOpen ? (
            <div className="border-t border-hairline lg:hidden">{rail}</div>
          ) : null}
        </header>

        <main className="flex-1 px-4 py-8 sm:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>

        <footer className="border-t border-hairline px-6 py-4 text-center text-xs text-ink-muted">
          An initiative of the NBA Anaocha Branch
        </footer>
      </div>
    </div>
  );
}

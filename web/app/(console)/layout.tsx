"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AttentionBell } from "@/components/attention";
import { Icon, type IconName } from "@/components/icons";
import { isAdmin, isSuperAdmin, useAuth } from "@/lib/auth";
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
 * administrator can read: a practitioner who typed /transactions would get an
 * empty list, because the policy on transactions admits branch rows only to
 * branch_admin.
 *
 * Routes are named after the nav label they sit under, kebab-cased. That rule
 * exists because the first pass had /queue labelled "Transactions", and
 * /branch and /branches — one character apart — meaning "this branch" and
 * "every branch".
 */

type NavItem = { href: string; label: string; icon: IconName };

/*
  Two consoles, not one console with extra buttons.

  A branch administrator runs a branch: they review submissions, keep the
  branch's own record straight and answer for its practitioners. A super
  administrator oversees the platform and the people who administer it, and
  has no branch of their own to run.

  The two things they deliberately do NOT share are the verification queue and
  Branch Records. Approving a payment is branch work carrying a separation of
  duties rule, and issue_rbin now refuses a super administrator outright; the
  branch's bank details and chairman belong to the branch. Both were reachable
  before only because the platform account happened to be attached to a
  branch, which it no longer is.
*/
const BRANCH_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/practitioners", label: "Practitioners", icon: "practitioners" },
  { href: "/transactions", label: "Transactions", icon: "transactions" },
  { href: "/certificates", label: "Certificates", icon: "certificate" },
  { href: "/branch-records", label: "Branch Records", icon: "branch" },
  { href: "/reports", label: "Reports", icon: "reports" },
];

const PLATFORM_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/all-branches", label: "Branches", icon: "branch" },
  { href: "/administrators", label: "Administrators", icon: "practitioners" },
  { href: "/certificates", label: "Certificates", icon: "certificate" },
  { href: "/reports", label: "Reports", icon: "reports" },
  { href: "/audit", label: "Audit Log", icon: "reports" },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { profile, session, ready, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [branchName, setBranchName] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (session === null || !isAdmin(profile)) router.replace("/login");
  }, [ready, session, profile, router]);

  const branchId = profile?.branch_id ?? null;

  useEffect(() => {
    if (branchId === null) return;

    let alive = true;
    Promise.all([
      supabase.from("branches").select("name").eq("id", branchId).single(),
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_verification"),
    ]).then(([branch, pending]) => {
      if (!alive) return;
      setBranchName((branch.data as { name: string } | null)?.name ?? null);
      setPendingCount(pending.count ?? 0);
    });

    return () => {
      alive = false;
    };
    // pathname is a dependency on purpose: the pending count is the badge in
    // the chrome, and it has to be right again after an administrator approves
    // something and navigates away from the queue.
  }, [branchId, pathname]);

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
        <Image
          src="/nba-logo.png"
          alt=""
          width={48}
          height={48}
          priority
          className="h-12 w-12 rounded-full"
        />
        <p
          className="mt-3 truncate text-lg font-bold text-brand-600"
          style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
        >
          {branchName ?? "Branch Console"}
        </p>
        <p className="truncate text-xs text-ink-muted">
          {profile?.role === "super_admin" ? "Super Administrator" : "NBA Administrator"}
        </p>
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
      {/* The queue is branch work, so the rail's primary action is only a
          primary action for a branch administrator. A super administrator has
          no queue of their own and issue_rbin would refuse them anyway. */}
      <div className={"px-4 pt-5 " + (isSuperAdmin(profile) ? "hidden" : "")}>
        <Link
          href="/transactions"
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
        {/*
          All Branches appears only for a super administrator. The insert
          policy on branches admits nobody else, so showing it to a branch
          administrator would offer a form the database refuses.
        */}
        {(isSuperAdmin(profile) ? PLATFORM_NAV : BRANCH_NAV).map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              // Closed here rather than in an effect watching the pathname.
              // The menu is closed because somebody chose to go somewhere,
              // which is a thing that happens in a handler, not a fact about
              // the route that has to be synchronised afterwards.
              onClick={() => setMenuOpen(false)}
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
          href="/help"
          className="flex items-center gap-3 rounded-[var(--radius-input)] px-4 py-3 text-sm font-semibold text-ink-muted transition hover:bg-canvas hover:text-ink"
        >
          <Icon name="help" />
          Help
        </Link>
        {/* Two steps. Signing out is one click away from a screen somebody
            may have been working in for an hour, and an administrator part way
            through a review loses their place with no warning and no undo. */}
        {confirmingSignOut ? (
          <div className="rounded-[var(--radius-input)] bg-red-50 p-3 ring-1 ring-red-200">
            <p className="text-sm font-medium text-red-900">Sign out of the console?</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={async () => {
                  await signOut();
                  router.replace("/login");
                }}
                className="rounded-[var(--radius-input)] bg-red-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-800"
              >
                Sign out
              </button>
              <button
                onClick={() => setConfirmingSignOut(false)}
                className="rounded-[var(--radius-input)] px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingSignOut(true)}
            className="flex w-full items-center gap-3 rounded-[var(--radius-input)] px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50"
          >
            <Icon name="logout" />
            Logout
          </button>
        )}
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
                    if (value !== "") router.push(`/transactions?q=${encodeURIComponent(value)}`);
                  }
                }}
                className="w-full rounded-[var(--radius-input)] border border-hairline bg-canvas py-2 pl-10 pr-3 text-sm outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <div className="ml-auto flex items-center gap-3">
              <Link
                href="/help"
                className="hidden text-sm font-medium text-ink-muted transition hover:text-ink sm:block"
              >
                Help
              </Link>

              <AttentionBell />

              <Link
                href="/settings"
                aria-label="Your account settings"
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

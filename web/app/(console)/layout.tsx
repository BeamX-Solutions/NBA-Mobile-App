"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { isAdmin, useAuth } from "@/lib/auth";

const NAV = [
  { href: "/queue", label: "Verification Queue" },
  { href: "/branch", label: "Branch" },
];

/**
 * Shell for every signed-in console screen, and the navigation guard.
 *
 * The guard is navigation, not security. RLS decides what an administrator can
 * actually read: a practitioner who reached /queue by typing the URL would get
 * an empty list rather than someone else's submissions, because the policy on
 * transactions admits branch rows only to branch_admin.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { profile, session, ready, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready) return;
    if (session === null || !isAdmin(profile)) router.replace("/login");
  }, [ready, session, profile, router]);

  if (!ready || session === null || !isAdmin(profile)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-ink-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <Link href="/queue" className="shrink-0">
            <span
              className="text-lg font-bold text-brand-600"
              style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
            >
              NBA Legal Fees
            </span>
            <span className="ml-2 text-sm text-ink-muted">Branch Console</span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "rounded-[var(--radius-input)] px-3 py-1.5 text-sm font-medium transition " +
                    (active
                      ? "bg-brand-50 text-brand-700"
                      : "text-ink-muted hover:bg-canvas hover:text-ink")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-ink">{profile?.full_name}</p>
              <p className="text-xs text-ink-muted">
                {profile?.role === "super_admin" ? "Super Administrator" : "Branch Administrator"}
              </p>
            </div>
            <button
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
              className="rounded-[var(--radius-input)] border border-hairline px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-canvas hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>

      <footer className="border-t border-hairline px-6 py-4 text-center text-xs text-ink-muted">
        An initiative of the NBA Anaocha Branch
      </footer>
    </div>
  );
}

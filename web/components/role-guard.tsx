"use client";

import Link from "next/link";

import { isSuperAdmin, useAuth } from "@/lib/auth";

/**
 * Refuses a screen to the role it does not belong to.
 *
 * Navigation already shows each role only its own screens, but a link that is
 * not rendered is not a control: the routes are still there to be typed, kept
 * in a bookmark, or arrived at from a browser's history. This is the second
 * half of that, and it says which half is which.
 *
 * It is not the security boundary and does not pretend to be. RLS decides what
 * any account can actually read or write, and issue_rbin refuses a super
 * administrator in the database rather than here. What this prevents is a
 * screen rendering a shape it was never designed for: BranchOnly exists mostly
 * because a super administrator has no branch at all now, so a branch-scoped
 * page would either query for null or show whichever branch happened to be
 * attached, which is the bug that started this.
 */

export function BranchOnly({ children }: { children: React.ReactNode }) {
  const { profile, ready } = useAuth();

  if (ready && isSuperAdmin(profile)) {
    return (
      <Refusal
        title="This belongs to a branch"
        body="A super administrator oversees the platform and the people who administer it, and has no branch of their own. Reviewing submissions and keeping a branch's record are the branch administrator's work, and doing both would put the work and the oversight of it in the same hands."
        href="/all-branches"
        label="Go to Branches"
      />
    );
  }

  return <>{children}</>;
}

export function PlatformOnly({ children }: { children: React.ReactNode }) {
  const { profile, ready } = useAuth();

  if (ready && !isSuperAdmin(profile)) {
    return (
      <Refusal
        title="Super administrators only"
        body="This screen manages the platform rather than a branch. The database admits nobody else to it, so it is refused here rather than shown empty."
        href="/dashboard"
        label="Go to Dashboard"
      />
    );
  }

  return <>{children}</>;
}

function Refusal({
  title,
  body,
  href,
  label,
}: {
  title: string;
  body: string;
  href: string;
  label: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">{body}</p>
      <Link
        href={href}
        className="mt-4 inline-block rounded-[var(--radius-input)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        {label}
      </Link>
    </div>
  );
}

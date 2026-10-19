import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import { formatNaira } from "@/lib/format";

/**
 * The Dashboard's figures, laid out to fit one screen.
 *
 * Money first, on a green band, because the three naira figures are what an
 * administrator is answerable for: fees the branch has verified, what
 * subscriptions have brought in, and what the branch is holding that belongs
 * to practitioners. Below it, four compact cards for the work and the people.
 * The chart and recent activity follow, and may scroll.
 *
 * Presentational only: the page fetches and passes the numbers in, so the
 * layout can be checked with sample figures.
 */

export interface DashboardFiguresProps {
  platform: boolean;
  feesVerified: number | null;
  /** Month on month change in verified fees, or null with nothing to compare. */
  delta: number | null;
  verifiedCount: number | null;
  pending: number | null;
  practitioners: number | null;
  /** Every signup, approved or not. Shown to a super administrator only. */
  registrations: number | null;
  subscribers: number | null;
  expiring30d: number | null;
  revenueTotal: number | null;
  revenueMonth: number | null;
  /** Revenue split by plan, e.g. "Yearly ₦300,000", when there is any. */
  revenuePlans?: string;
  held: number | null;
  certificates: number | null;
}

const dash = "—";

function naira(value: number | null): string {
  return value === null ? dash : formatNaira(value);
}

function count(value: number | null): string {
  return value === null ? dash : value.toLocaleString("en-NG");
}

export function DashboardFigures(props: DashboardFiguresProps) {
  const {
    platform,
    feesVerified,
    delta,
    verifiedCount,
    pending,
    practitioners,
    registrations,
    subscribers,
    expiring30d,
    revenueTotal,
    revenueMonth,
    revenuePlans,
    held,
    certificates,
  } = props;

  const all = platform ? "All " : "";
  const waiting = pending !== null && pending > 0;
  const share =
    subscribers !== null && practitioners !== null && practitioners > 0
      ? Math.min(100, Math.round((subscribers / practitioners) * 100))
      : 0;
  const awaitingApproval =
    registrations !== null && practitioners !== null ? registrations - practitioners : 0;

  return (
    <div className="space-y-4">
      {/* Money */}
      <section
        aria-label="Money"
        className="relative overflow-hidden rounded-[var(--radius-card)] bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 text-white shadow-sm"
      >
        {/* Decorative rings, echoing the seal, kept faint so figures stay the subject. */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 text-white/[0.06]"
          viewBox="0 0 200 200"
          fill="none"
          stroke="currentColor"
          strokeWidth="14"
        >
          <circle cx="100" cy="100" r="90" />
          <circle cx="100" cy="100" r="55" />
        </svg>

        <div className="relative grid divide-y divide-white/15 md:grid-cols-3 md:divide-x md:divide-y-0">
          <MoneyFigure
            label={`${all}Branch Fees Verified`}
            value={naira(feesVerified)}
            href={platform ? "/reports" : "/transactions?filter=verified"}
            badge={
              delta === null ? null : (
                <span className="tabular inline-flex items-center gap-1 rounded-full bg-accent-400 px-2 py-0.5 text-xs font-bold text-brand-900">
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
                </span>
              )
            }
            note={
              delta === null
                ? `Across ${count(verifiedCount)} verified submissions`
                : "from last month"
            }
          />
          <MoneyFigure
            label={`${all}Subscription Revenue`}
            value={naira(revenueTotal)}
            note={`${naira(revenueMonth)} this month · ${revenuePlans ?? "Paystack payments only"}`}
          />
          <MoneyFigure
            label={`${all}Held for Practitioners`}
            value={naira(held)}
            note="Verified, not yet sent on"
            href={platform ? "/all-branches" : "/transactions?filter=to_remit"}
            action={!platform && held !== null && held > 0 ? "Send payments" : undefined}
          />
        </div>
      </section>

      {/* Work and people */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={`${all}Pending Verification`}
          icon="clock"
          value={count(pending)}
          highlight={waiting}
          href={platform ? "/all-branches" : "/transactions?filter=pending_verification"}
          footer={
            waiting ? (
              <span className="font-semibold text-brand-800">
                {platform ? "Waiting across branches" : "Review now →"}
              </span>
            ) : (
              "Nothing waiting"
            )
          }
        />

        <MetricCard
          label={`${all}Practitioners`}
          icon="people"
          value={count(practitioners)}
          suffix="active"
          href={platform ? "/all-branches" : "/practitioners"}
          footer={
            platform
              ? awaitingApproval > 0
                ? `${count(registrations)} registered · ${awaitingApproval} awaiting or refused`
                : `${count(registrations)} registered, all approved`
              : "Approved by your branch"
          }
        />

        <MetricCard
          label={`${all}Subscribed`}
          icon="money"
          value={count(subscribers)}
          suffix={practitioners === null ? undefined : `of ${count(practitioners)}`}
          href={platform ? "/all-branches" : "/practitioners"}
          footer={
            <>
              <span
                className="mb-1.5 block h-1.5 overflow-hidden rounded-full bg-hairline"
                role="img"
                aria-label={`${share}% of practitioners subscribed`}
              >
                <span
                  className="block h-full rounded-full bg-brand-500"
                  style={{ width: `${share}%` }}
                />
              </span>
              {expiring30d !== null && expiring30d > 0
                ? `${expiring30d} ending within 30 days`
                : "None ending within 30 days"}
            </>
          }
        />

        <MetricCard
          label="Certificates Issued"
          icon="certificate"
          value={count(certificates)}
          href="/certificates"
          footer="All time"
        />
      </div>
    </div>
  );
}

function MoneyFigure({
  label,
  value,
  note,
  badge = null,
  href,
  action,
}: {
  label: string;
  value: string;
  note: string;
  badge?: React.ReactNode;
  href?: string;
  action?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-white/70">{label}</p>
      <p
        className="tabular mt-2 text-3xl font-bold leading-tight lg:text-[2rem]"
        style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
      >
        {value}
      </p>
      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-white/75">
        {badge}
        <span>{note}</span>
      </p>
      {action !== undefined ? (
        <p className="mt-2 text-sm font-semibold text-accent-400">{action} →</p>
      ) : null}
    </>
  );

  const frame = "block px-6 py-5";
  return href === undefined ? (
    <div className={frame}>{body}</div>
  ) : (
    <Link
      href={href}
      className={
        frame +
        " transition hover:bg-white/[0.06] focus-visible:bg-white/[0.08] focus-visible:outline-none"
      }
    >
      {body}
    </Link>
  );
}

function MetricCard({
  label,
  icon,
  value,
  suffix,
  footer,
  href,
  highlight = false,
}: {
  label: string;
  icon: IconName;
  value: string;
  suffix?: string;
  footer: React.ReactNode;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "group block rounded-[var(--radius-card)] border p-4 transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-100 " +
        (highlight
          ? "border-accent-400 bg-accent-50 hover:border-amber-500"
          : "border-hairline bg-surface hover:border-brand-500")
      }
    >
      <div className="flex items-center gap-2.5">
        <span
          className={
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
            (highlight ? "bg-accent-400 text-brand-900" : "bg-brand-50 text-brand-600")
          }
        >
          <Icon name={icon} size={17} />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      </div>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="tabular text-3xl font-bold text-ink">{value}</span>
        {suffix !== undefined ? (
          <span className="text-sm font-medium text-ink-muted">{suffix}</span>
        ) : null}
      </p>
      <div className="mt-1 text-sm text-ink-muted">{footer}</div>
    </Link>
  );
}

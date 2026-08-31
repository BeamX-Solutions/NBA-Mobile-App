import { Icon, type IconName } from "@/components/icons";

/**
 * Shared presentational pieces, matching the supplied admin designs.
 */

/** Circular initials chip used beside every practitioner name in the designs. */
export function Avatar({
  name,
  size = "md",
  tone = "brand",
}: {
  name: string;
  size?: "sm" | "md";
  tone?: "brand" | "accent" | "muted";
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  const dimensions = size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-xs";
  const palette =
    tone === "accent"
      ? "bg-accent-400 text-brand-900"
      : tone === "muted"
        ? "bg-canvas text-ink-muted ring-1 ring-hairline"
        : "bg-brand-600 text-white";

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${dimensions} ${palette}`}
    >
      {initials}
    </span>
  );
}

/**
 * Metric tile: the label in small caps, the figure, a sub-note, and the icon
 * badged in a tinted square on the right.
 *
 * No coloured left bar. The badge already carries the tile's tone, so a stripe
 * repeated the same signal in a heavier form and turned a row of tiles into a
 * row of stripes.
 */
export function StatCard({
  label,
  value,
  note,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string | null;
  note?: string;
  icon: IconName;
  tone?: "brand" | "accent" | "success" | "danger" | "neutral";
}) {
  const badge = {
    brand: "bg-brand-50 text-brand-600",
    accent: "bg-accent-50 text-amber-700",
    success: "bg-emerald-50 text-emerald-700",
    danger: "bg-red-50 text-red-600",
    neutral: "bg-canvas text-ink-muted",
  }[tone];

  return (
    <div className="h-full rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${badge}`}>
          <Icon name={icon} size={18} />
        </span>
      </div>
      <p className="tabular mt-3 text-3xl font-bold text-ink">{value ?? "—"}</p>
      {note !== undefined ? <p className="mt-1 text-sm text-ink-muted">{note}</p> : null}
    </div>
  );
}

/** Status pill with the leading dot used in the Practitioners table. */
export function DotBadge({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "danger" | "warning" | "neutral";
}) {
  const styles = {
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200 before:bg-emerald-500",
    danger: "bg-red-50 text-red-800 ring-red-200 before:bg-red-500",
    warning: "bg-amber-50 text-amber-800 ring-amber-200 before:bg-amber-500",
    neutral: "bg-slate-100 text-slate-700 ring-slate-300 before:bg-slate-400",
  }[tone];

  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset " +
        "before:h-1.5 before:w-1.5 before:rounded-full before:content-[''] " +
        styles
      }
    >
      {label}
    </span>
  );
}

/** "Showing 1 to N of M entries" plus page buttons, as drawn. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (next: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const numbers = Array.from({ length: pages }, (_, i) => i + 1).slice(0, 5);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-3">
      <p className="text-sm text-ink-muted">
        Showing {from} to {to} of {total} {total === 1 ? "entry" : "entries"}
      </p>
      <div className="flex items-center gap-1">
        <PageButton disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </PageButton>
        {numbers.map((n) => (
          <PageButton key={n} active={n === page} onClick={() => onPage(n)}>
            {n}
          </PageButton>
        ))}
        <PageButton disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </PageButton>
      </div>
    </div>
  );
}

function PageButton({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "min-w-9 rounded-[6px] border px-2.5 py-1.5 text-sm font-medium transition " +
        (active
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-hairline text-ink-muted hover:bg-canvas hover:text-ink") +
        (disabled ? " cursor-not-allowed opacity-40 hover:bg-transparent" : "")
      }
    >
      {children}
    </button>
  );
}

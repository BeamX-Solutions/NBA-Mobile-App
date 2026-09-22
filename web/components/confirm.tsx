"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ask before doing something that is hard to take back.
 *
 * The console had grown a set of single-click actions with real consequences
 * behind them: activating a branch changes who can register, appointing an
 * administrator hands somebody the power to issue certificates, and approving a
 * submission mints an RBIN that a land registry may later rely on and that
 * nothing can un-mint. All of those sat one stray click away, several of them
 * in a table where the click target above or below did something different.
 *
 * Confirmation is not friction for its own sake and it is not a substitute for
 * permission: the database refuses what the person is not entitled to do
 * whatever this component does. What it buys is a pause on the actions that
 * are entitled but wrong, which is the failure a permission check cannot catch.
 *
 * The body text is required rather than optional, and it is the point. "Are you
 * sure?" tells somebody nothing they did not already know; saying what will
 * actually happen, and what will not, is what lets them answer. Each call site
 * writes its own.
 */

export function ConfirmButton({
  label,
  busyLabel = "Working…",
  title,
  body,
  confirmLabel,
  tone = "default",
  disabled = false,
  busy = false,
  className,
  onConfirm,
}: {
  label: string;
  busyLabel?: string;
  title: string;
  body: string;
  confirmLabel: string;
  /** Destructive actions get a red confirm button rather than a green one. */
  tone?: "default" | "danger";
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        className={className}
      >
        {busy ? busyLabel : label}
      </button>

      <ConfirmDialog
        open={open}
        title={title}
        body={body}
        confirmLabel={confirmLabel}
        tone={tone}
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          setOpen(false);
          await onConfirm();
        }}
      />
    </>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      // A click on the backdrop cancels. Deliberately not on the panel itself,
      // or selecting the text of the warning would dismiss it.
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[var(--radius-card)] border border-hairline bg-surface p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[var(--radius-input)] px-4 py-2 text-sm font-medium text-ink-muted transition hover:bg-canvas disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={
              "rounded-[var(--radius-input)] px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 " +
              (tone === "danger" ? "bg-red-700 hover:bg-red-800" : "bg-brand-600 hover:bg-brand-700")
            }
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

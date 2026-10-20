"use client";

import { useEffect } from "react";

import { Icon } from "@/components/icons";

/**
 * Asks before signing out, the same way in the console, the practitioner web
 * app and the mobile app.
 *
 * Calm on purpose. Signing out loses nothing (signing back in is the undo),
 * so it is not dressed as a warning: a neutral icon, one line, and Cancel and
 * Sign out side by side in the console's ordinary green. It still asks,
 * because the button sits beside the navigation and an administrator part way
 * through a review would otherwise lose their place to a stray click.
 */
export function SignOutDialog({
  open,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-out-title"
      aria-describedby="sign-out-body"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[var(--radius-card)] border border-hairline bg-surface p-6 text-center shadow-xl"
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Icon name="logout" size={22} />
        </span>
        <h2 id="sign-out-title" className="mt-4 text-lg font-bold text-ink">
          Sign out?
        </h2>
        <p id="sign-out-body" className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          You&rsquo;ll need your email and password to sign back in.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[var(--radius-input)] border border-hairline px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className="rounded-[var(--radius-input)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}

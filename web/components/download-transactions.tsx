"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  buildTransactionsCsv,
  exportFilename,
  fetchTransactionsForExport,
  lagosRange,
} from "@/lib/transactions-export";

/** Today in Lagos as YYYY-MM-DD, which is what a date input takes. */
function lagosToday(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

function saveFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked a moment later: some mobile browsers start the download only after
  // the click handler returns, and an immediately revoked URL leaves them nothing.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * A button that asks for a period and downloads every transaction submitted in
 * it, of any status, as a spreadsheet. Branches asked for it on 28 November
 * 2026; see lib/transactions-export.ts for what the file holds.
 */
export function DownloadTransactions({
  label = "Download transactions",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  function start() {
    // Defaults to the month so far, the period branches most often reconcile.
    const today = lagosToday();
    setFrom(`${today.slice(0, 8)}01`);
    setTo(today);
    setMessage(null);
    setOpen(true);
  }

  async function download(event: React.FormEvent) {
    event.preventDefault();
    const range = lagosRange(from, to);
    if (range === null) {
      setMessage({ tone: "error", text: "Choose a start date on or before the end date." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const rows = await fetchTransactionsForExport((table) => supabase.from(table), range);
      if (rows.length === 0) {
        setMessage({ tone: "info", text: "No transactions were submitted in that period." });
        return;
      }
      saveFile(buildTransactionsCsv(rows), exportFilename(from, to));
      setOpen(false);
    } catch (error) {
      setMessage({
        tone: "error",
        text: `The transactions could not be downloaded. ${error instanceof Error ? error.message : ""}`.trim(),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        className={
          className ??
          "inline-flex items-center gap-2 rounded-[var(--radius-input)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        }
      >
        {label}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Download transactions"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form
            onSubmit={download}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[var(--radius-card)] border border-hairline bg-surface p-6 shadow-xl"
          >
            <h2 className="text-lg font-bold text-ink">Download transactions</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Choose the period. Every transaction submitted between these dates, whatever its
              status, is saved as a spreadsheet you can open in Excel or Google Sheets.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-medium text-ink">From</span>
                <input
                  type="date"
                  required
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-ink">To</span>
                <input
                  type="date"
                  required
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </label>
            </div>

            {message !== null ? (
              <p
                role={message.tone === "error" ? "alert" : "status"}
                className={
                  "mt-4 rounded-[var(--radius-input)] px-3 py-2 text-sm ring-1 " +
                  (message.tone === "error"
                    ? "bg-red-50 text-red-800 ring-red-200"
                    : "bg-canvas text-ink-muted ring-hairline")
                }
              >
                {message.text}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-[var(--radius-input)] px-4 py-2 text-sm font-medium text-ink-muted transition hover:bg-canvas disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-[var(--radius-input)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? "Preparing…" : "Download"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

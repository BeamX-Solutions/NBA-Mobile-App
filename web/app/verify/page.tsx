"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The lookup form, for someone holding a printed certificate rather than a
 * scannable QR code. Public, like the result page.
 */
export default function VerifyLookupPage() {
  const router = useRouter();
  const [bain, setBain] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = bain.trim();
    if (trimmed === "") return;
    // Slashes are left literal: the result route is a catch-all, so the BAIN
    // maps onto path segments directly.
    router.push(`/verify/${trimmed.split("/").map(encodeURIComponent).join("/")}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <div className="text-center">
        <p
          className="text-xl font-bold text-brand-600"
          style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
        >
          NBA Legal Fees
        </p>
        <h1 className="mt-6 text-2xl font-bold text-ink">Verify a Certificate of Compliance</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Enter the BAIN printed on the certificate to confirm it is genuine. No account is needed.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-8 rounded-[var(--radius-card)] border border-hairline bg-surface p-6"
      >
        <label htmlFor="bain" className="block text-sm font-medium text-ink">
          BAIN
        </label>
        <input
          id="bain"
          value={bain}
          onChange={(e) => setBain(e.target.value)}
          placeholder="NBA/2026/00001"
          className="tabular mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <button
          type="submit"
          className="mt-4 w-full rounded-[var(--radius-input)] bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700"
        >
          Verify
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-ink-muted">
        An initiative of the NBA Anaocha Branch
      </p>
    </main>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ADMIN_ROLES, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const { session, profile, ready } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in as an administrator: go straight to the queue.
  useEffect(() => {
    if (ready && session !== null && profile !== null && ADMIN_ROLES.includes(profile.role)) {
      router.replace("/queue");
    }
  }, [ready, session, profile, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError || !data.user) {
      setError("Those details were not recognised.");
      setBusy(false);
      return;
    }

    // This console is for administrators. A practitioner signing in here is
    // signed straight back out, because the whole point of the separation is
    // that the two surfaces are different. This is courtesy, not security:
    // RLS is what actually stops a practitioner reading the branch queue.
    const { data: row } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    const role = (row as { role: string } | null)?.role;
    if (role === undefined || !ADMIN_ROLES.includes(role as never)) {
      await supabase.auth.signOut();
      setError(
        "This console is for branch administrators. Practitioners use the mobile app to calculate fees and submit transactions.",
      );
      setBusy(false);
      return;
    }

    router.replace("/queue");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p
            className="text-2xl font-bold text-brand-600"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            NBA Legal Fees
          </p>
          <p className="mt-1 text-sm text-ink-muted">Branch Console</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6 shadow-sm"
        >
          <h1 className="text-lg font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Verify proof of payment and issue Certificates of Compliance for your branch.
          </p>

          <label className="mt-6 block text-sm font-medium text-ink" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline bg-white px-3 py-2 text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />

          <label className="mt-4 block text-sm font-medium text-ink" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline bg-white px-3 py-2 text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />

          {error !== null ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full rounded-[var(--radius-input)] bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-muted">
          An initiative of the NBA Anaocha Branch
        </p>
      </div>
    </main>
  );
}

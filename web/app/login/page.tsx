"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { ADMIN_ROLES, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Administrator sign in. The layout lives in components/auth-shell, shared
 * with the forgotten-password pages.
 */
export default function LoginPage() {
  const router = useRouter();
  const { session, profile, ready } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in as an administrator: go straight to the overview.
  useEffect(() => {
    if (ready && session !== null && profile !== null && ADMIN_ROLES.includes(profile.role)) {
      router.replace("/dashboard");
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

    router.replace("/dashboard");
  }

  return (
    <AuthShell>
      <h2 className="text-2xl font-bold text-ink">Sign in</h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        Use your branch administrator account.
      </p>

      <form onSubmit={handleSubmit} className="mt-8">
        <label className="block text-sm font-medium text-ink" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@branch.org.ng"
          className="mt-1.5 w-full rounded-[var(--radius-input)] border border-hairline bg-canvas px-3.5 py-2.5 text-ink outline-none transition focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100"
        />

        <div className="mt-5 flex items-baseline justify-between">
          <label className="block text-sm font-medium text-ink" htmlFor="password">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative mt-1.5">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-[var(--radius-input)] border border-hairline bg-canvas py-2.5 pl-3.5 pr-16 text-ink outline-none transition focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[6px] px-2 py-1 text-xs font-semibold text-ink-muted transition hover:bg-canvas hover:text-ink"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        {error !== null ? (
          <p
            role="alert"
            className="mt-5 rounded-[var(--radius-input)] bg-red-50 px-3.5 py-2.5 text-sm leading-relaxed text-red-800 ring-1 ring-red-200"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-7 w-full rounded-[var(--radius-input)] bg-brand-600 px-4 py-3 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="mt-8 rounded-[var(--radius-card)] border border-hairline bg-canvas p-4">
        <p className="text-sm font-medium text-ink">Are you a practitioner?</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Fee calculation, invoices and your certificates live in the mobile app. This console
          is for branch administration only.
        </p>
      </div>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Checking a certificate?{" "}
        <Link href="/verify" className="font-medium text-brand-700 hover:underline">
          Verify by RBIN
        </Link>
      </p>
    </AuthShell>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";

import { AuthError, AuthNotice, AuthShell, authButtonClass, authInputClass } from "@/components/auth-shell";
import { supabase } from "@/lib/supabase";

/**
 * Request a password reset link.
 *
 * Until this existed an administrator who forgot their password had no way
 * back in short of someone resetting it in the Supabase dashboard: Settings
 * changes the password only for someone already signed in, and the
 * practitioner apps sign an administrator out, recovery links included.
 *
 * The link is sent back to this console's own /reset-password. Supabase only
 * honours that if the origin is on the project's Redirect URLs list; otherwise
 * it falls back to the Site URL.
 *
 * The reply is the same whether or not the address has an account, so this
 * page cannot be used to find out who is registered.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        setError(
          resetError.status === 429
            ? "Too many reset requests. Wait a minute and try again."
            : "The reset link could not be sent. Try again in a minute.",
        );
        return;
      }
      setSent(true);
    } catch {
      setError("The reset link could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h2 className="text-2xl font-bold text-ink">Forgot your password?</h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        Enter the email address of your administrator account and we will send you a link to
        choose a new password.
      </p>

      {sent ? (
        <AuthNotice>
          If an account exists for {email.trim()}, a reset link is on its way. It expires after an
          hour. Check your spam folder if it does not arrive.
        </AuthNotice>
      ) : (
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
            className={`mt-1.5 ${authInputClass}`}
          />

          {error !== null ? <AuthError>{error}</AuthError> : null}

          <button type="submit" disabled={busy} className={`mt-7 ${authButtonClass}`}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-ink-muted">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

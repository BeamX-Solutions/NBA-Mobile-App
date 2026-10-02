"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthError, AuthNotice, AuthShell, authButtonClass, authInputClass } from "@/components/auth-shell";
import { isAdmin, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Choose a new password, reached from the link /forgot-password sends.
 *
 * The browser client reads the recovery session out of the link on load
 * (detectSessionInUrl), so by the time the auth provider is ready the person is
 * signed in as themselves and updateUser sets their password. No session means
 * the link was used already, expired, or was opened in a different browser.
 *
 * An administrator goes straight on to the console. Anyone else has still set
 * their own password, which is harmless, but is signed out again and told to
 * use the practitioner app, as on the sign in page.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { session, profile, ready, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [practitionerDone, setPractitionerDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      if (isAdmin(profile)) {
        router.replace("/dashboard");
        return;
      }
      setPractitionerDone(true);
      await signOut();
    } catch {
      setError("Your password could not be changed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  let content: React.ReactNode;
  if (practitionerDone) {
    content = (
      <AuthNotice>
        Your password has been changed. This console is for branch administrators, so sign in to
        the practitioner app with your new password.
      </AuthNotice>
    );
  } else if (!ready) {
    content = <p className="mt-8 text-sm text-ink-muted">Checking your link…</p>;
  } else if (session === null) {
    content = (
      <>
        <AuthError>
          This reset link is invalid or has expired. Links work once, for an hour, in the browser
          they were opened in.
        </AuthError>
        <Link href="/forgot-password" className={`mt-7 block text-center ${authButtonClass}`}>
          Send a new link
        </Link>
      </>
    );
  } else {
    content = (
      <form onSubmit={handleSubmit} className="mt-8">
        <label className="block text-sm font-medium text-ink" htmlFor="password">
          New password
        </label>
        <div className="relative mt-1.5">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${authInputClass} pr-16`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[6px] px-2 py-1 text-xs font-semibold text-ink-muted transition hover:bg-canvas hover:text-ink"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        <label className="mt-5 block text-sm font-medium text-ink" htmlFor="confirm">
          Confirm new password
        </label>
        <input
          id="confirm"
          type={showPassword ? "text" : "password"}
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={`mt-1.5 ${authInputClass}`}
        />

        {error !== null ? <AuthError>{error}</AuthError> : null}

        <button type="submit" disabled={busy} className={`mt-7 ${authButtonClass}`}>
          {busy ? "Saving…" : "Set new password"}
        </button>
      </form>
    );
  }

  return (
    <AuthShell>
      <h2 className="text-2xl font-bold text-ink">Choose a new password</h2>
      <p className="mt-1.5 text-sm text-ink-muted">At least 8 characters.</p>
      {content}
      <p className="mt-6 text-center text-sm text-ink-muted">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

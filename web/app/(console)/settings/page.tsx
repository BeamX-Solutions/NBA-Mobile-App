"use client";

import { useState } from "react";

import { isSuperAdmin, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Your account.
 *
 * The settings icon in the top bar used to open Branch Records, which is not
 * settings and is not yours: it is the branch's own record, it already has a
 * nav entry of its own, and a super administrator cannot open it at all now
 * that the platform role belongs to no branch. So the icon led somewhere
 * meaningless for one role and somewhere duplicated for the other.
 *
 * This is the thing the icon was always implying: the person signed in, not
 * the branch. What you are called, how to reach you, and your password.
 *
 * Role and branch are shown and not editable, deliberately. Both are guarded
 * by protect_profile_columns, an administrator cannot appoint themselves, and
 * a field that looks editable but is refused on save is worse than one that
 * plainly is not.
 */
export default function SettingsPage() {
  const { profile, refresh } = useAuth();

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordNote, setPasswordNote] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    if (profile === null) return;
    if (fullName.trim() === "") {
      setError("Your name cannot be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim() })
        .eq("id", profile.id);

      if (updateError) {
        setError(`Those changes could not be saved. ${updateError.message}`);
        return;
      }
      setSaved(true);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordNote(null);
    setPasswordError(null);

    if (password.length < 8) {
      setPasswordError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setPasswordError("The passwords do not match.");
      return;
    }

    setPasswordBusy(true);
    try {
      // Supabase changes the password of whoever is signed in. There is no
      // path here to change anybody else's, which is the point: an
      // administrator who could set another person's password could sign in
      // as them, and every approval that account made would be deniable.
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) {
        setPasswordError(authError.message);
        return;
      }
      setPassword("");
      setConfirm("");
      setPasswordNote("Your password has been changed.");
    } finally {
      setPasswordBusy(false);
    }
  }

  const roleLabel = isSuperAdmin(profile)
    ? "Super Administrator"
    : profile?.role === "branch_admin"
      ? "Branch Administrator"
      : (profile?.role ?? "Unknown");

  return (
    <>
      <div>
        <h1
          className="text-3xl font-bold text-ink"
          style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
        >
          Settings
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Your account, not the branch&rsquo;s.</p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Your details
          </h2>

          <form onSubmit={saveDetails} className="mt-4 space-y-4">
            <label className="block">
              <span className="block text-sm font-medium text-ink">Full name</span>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>

            <div>
              <span className="block text-sm font-medium text-ink">Email</span>
              <p className="mt-1 text-sm text-ink-muted">{profile?.email}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Your email is how you sign in. Changing it is not offered here.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="block text-sm font-medium text-ink">Role</span>
                <p className="mt-1 text-sm text-ink-muted">{roleLabel}</p>
              </div>
              <div>
                <span className="block text-sm font-medium text-ink">Branch</span>
                <p className="mt-1 text-sm text-ink-muted">
                  {isSuperAdmin(profile) ? "None, platform wide" : (profile?.branch_id ?? "None")}
                </p>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-ink-muted">
              Your role and branch are set centrally and cannot be changed from here. An
              administrator who could appoint themselves would not be much of a control.
            </p>

            {error !== null ? (
              <p
                role="alert"
                className="rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
              >
                {error}
              </p>
            ) : null}
            {saved ? (
              <p className="rounded-[var(--radius-input)] bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
                Saved.
              </p>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="rounded-[var(--radius-input)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </form>
        </section>

        <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Password</h2>

          <form onSubmit={changePassword} className="mt-4 space-y-4">
            <label className="block">
              <span className="block text-sm font-medium text-ink">New password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-ink">Confirm new password</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>

            {passwordError !== null ? (
              <p
                role="alert"
                className="rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
              >
                {passwordError}
              </p>
            ) : null}
            {passwordNote !== null ? (
              <p className="rounded-[var(--radius-input)] bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
                {passwordNote}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={passwordBusy}
              className="rounded-[var(--radius-input)] border border-hairline px-4 py-2 text-sm font-semibold text-ink transition hover:bg-canvas disabled:opacity-50"
            >
              {passwordBusy ? "Working…" : "Change password"}
            </button>

            <p className="text-xs leading-relaxed text-ink-muted">
              You stay signed in on this device. Changing your password here changes only your own,
              and nobody can change it for you from inside the console.
            </p>
          </form>
        </section>
      </div>
    </>
  );
}

"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import { ADMIN_ROLES, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Administrator sign in.
 *
 * A split screen rather than a form floating in the middle of an empty page.
 * The left half carries the brand and says what the console is for; the right
 * half is the form. Below lg the image becomes a short band above the form, so
 * a branch secretary opening this on a phone still gets the identity without
 * scrolling past a screen of photograph to reach the password field.
 *
 * The photograph is a signed certificate, which is what this console exists to
 * issue. A deep brand-green wash sits over it: the source is bright and
 * paper-white, so white type needs the overlay to stay legible rather than the
 * image being chosen for contrast it does not have.
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
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand half. A band on small screens, a full column from lg. */}
      <section className="relative isolate flex min-h-[13rem] flex-col justify-end overflow-hidden px-6 py-8 sm:px-10 lg:min-h-screen lg:justify-between lg:px-14 lg:py-12">
        <Image
          src="/certificate-detail.jpg"
          alt=""
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 52vw"
          className="-z-20 object-cover"
        />
        {/* Two layers: a flat wash to sink the paper-white source, then a
            vertical gradient so the type at the foot always has depth under
            it regardless of how the photograph crops at a given width. */}
        <div className="absolute inset-0 -z-10 bg-brand-800/90" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-900 via-brand-900/40 to-transparent" />

        <div className="hidden items-center gap-3 lg:flex">
          <Image
            src="/nba-logo.png"
            alt=""
            width={52}
            height={52}
            priority
            className="h-13 w-13 rounded-full ring-2 ring-white/25"
          />
          <div>
            <p
              className="text-lg font-bold text-white"
              style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
            >
              NBA Legal Fees
            </p>
            <p className="text-sm text-white/70">Branch Console</p>
          </div>
        </div>

        <div>
          {/* On small screens the seal sits with the heading, since the header
              row above is hidden. */}
          <Image
            src="/nba-logo.png"
            alt=""
            width={44}
            height={44}
            priority
            className="mb-3 h-11 w-11 rounded-full ring-2 ring-white/25 lg:hidden"
          />
          <h1
            className="max-w-lg text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            Verify payments. Issue certificates.
          </h1>
          <p className="mt-3 hidden max-w-md text-white/75 lg:block">
            Review proof of payment from practitioners in your branch, then issue a RBIN and a
            Certificate of Compliance that anyone can check.
          </p>

          <ul className="mt-8 hidden space-y-3 lg:block">
            {[
              "Every certificate is publicly verifiable by its RBIN",
              "Numbering is gapless, and issuance cannot run twice",
              "No administrator can approve their own submission",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm text-white/80">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-400/90 text-brand-900">
                  <Icon name="certificate" size={12} />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-10 hidden text-xs text-white/50 lg:block">
          An initiative of the NBA Anaocha Branch
        </p>
      </section>

      {/* Form half. */}
      <section className="flex items-center justify-center bg-surface px-6 py-10 sm:px-10">
        <div className="w-full max-w-sm">
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

            <label className="mt-5 block text-sm font-medium text-ink" htmlFor="password">
              Password
            </label>
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
              Fee calculation, receipts and your certificates live in the mobile app. This console
              is for branch administration only.
            </p>
          </div>

          <p className="mt-6 text-center text-sm text-ink-muted">
            Checking a certificate?{" "}
            <a href="/verify" className="font-medium text-brand-700 hover:underline">
              Verify by RBIN
            </a>
          </p>

          <p className="mt-8 text-center text-xs text-ink-muted lg:hidden">
            An initiative of the NBA Anaocha Branch
          </p>
        </div>
      </section>
    </div>
  );
}

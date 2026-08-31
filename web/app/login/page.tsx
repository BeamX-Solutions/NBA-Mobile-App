"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import { ADMIN_ROLES, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Sign in to the branch console.
 *
 * A split layout: a brand panel carrying the seal and what the console is for,
 * and the form beside it. The panel is not decoration — it does the work of
 * telling a practitioner who has followed a link here that they are in the
 * wrong place, before they try a password that will be refused.
 *
 * The photograph is a signed and sealed certificate, which is the artefact
 * this whole system exists to issue. It sits under a heavy brand wash rather
 * than at full strength: it should read as texture behind the words, not as a
 * stock image competing with them.
 *
 * Under lg the panel becomes a short band above the form, so a branch
 * secretary on a phone still lands on something branded rather than a white
 * page with two inputs on it.
 */
export default function LoginPage() {
  const router = useRouter();
  const { session, profile, ready } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wrongSurface, setWrongSurface] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && session !== null && profile !== null && ADMIN_ROLES.includes(profile.role)) {
      router.replace("/dashboard");
    }
  }, [ready, session, profile, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setWrongSurface(false);

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
    // signed straight back out. Courtesy, not security: RLS is what actually
    // stops a practitioner reading the branch queue.
    const { data: row } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    const role = (row as { role: string } | null)?.role;
    if (role === undefined || !ADMIN_ROLES.includes(role as never)) {
      await supabase.auth.signOut();
      setWrongSurface(true);
      setBusy(false);
      return;
    }

    router.replace("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel. Short band on small screens, full height from lg. */}
      <section className="relative isolate overflow-hidden bg-brand-700 px-6 py-10 lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-14">
        <Image
          src="/certificate-detail.jpg"
          alt=""
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 52vw"
          className="-z-10 object-cover"
        />
        {/* Two layers: a green wash for legibility, then a darker sweep from the
            bottom so the footer line stays readable over the brightest part of
            the photograph. */}
        <div className="absolute inset-0 -z-10 bg-brand-700/92" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-900/80 via-brand-800/20 to-transparent" />

        <div className="flex items-center gap-3">
          <Image
            src="/nba-logo.png"
            alt=""
            width={52}
            height={52}
            priority
            className="h-13 w-13 rounded-full bg-white/95 p-0.5"
          />
          <div>
            <p
              className="text-lg font-bold text-white"
              style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
            >
              NBA Legal Fees
            </p>
            <p className="text-sm text-brand-100">Branch Console</p>
          </div>
        </div>

        <div className="mt-8 max-w-md lg:mt-0">
          <h1
            className="text-3xl font-bold leading-tight text-white lg:text-4xl"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            Verify payments. Issue certificates.
          </h1>
          <p className="mt-3 text-brand-100">
            Review proof of payment from practitioners in your branch, and issue the BAIN and
            Certificate of Compliance that make a transaction checkable by anyone.
          </p>

          <ul className="mt-7 hidden space-y-3 lg:block">
            {[
              "Every submission in your branch, in one queue",
              "The payment proof beside the figures it evidences",
              "A BAIN and certificate issued together, or not at all",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm text-brand-100">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-400 text-brand-900">
                  <Icon name="certificate" size={13} />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-10 hidden text-xs text-brand-100/80 lg:block">
          An initiative of the NBA Anaocha Branch
        </p>
      </section>

      {/* Form. */}
      <section className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold text-ink">Sign in</h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            Use the administrator account for your branch.
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
              className="mt-1.5 w-full rounded-[var(--radius-input)] border border-hairline bg-white px-3.5 py-2.5 text-ink outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />

            <label className="mt-5 block text-sm font-medium text-ink" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-[var(--radius-input)] border border-hairline bg-white px-3.5 py-2.5 text-ink outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />

            {error !== null ? (
              <p
                role="alert"
                className="mt-5 rounded-[var(--radius-input)] bg-red-50 px-3.5 py-2.5 text-sm text-red-800 ring-1 ring-red-200"
              >
                {error}
              </p>
            ) : null}

            {/* A practitioner who reached this page needs directing, not an
                error. They did nothing wrong; they are on the wrong surface. */}
            {wrongSurface ? (
              <div
                role="alert"
                className="mt-5 rounded-[var(--radius-card)] bg-accent-50 p-4 ring-1 ring-amber-200"
              >
                <p className="text-sm font-semibold text-amber-900">
                  This console is for branch administrators
                </p>
                <p className="mt-1 text-sm text-amber-900/90">
                  Your account is a practitioner account. Calculating fees, generating receipts and
                  holding certificates all happen in the mobile app — there is nothing here for you
                  to do.
                </p>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="mt-7 w-full rounded-[var(--radius-input)] bg-brand-600 px-4 py-3 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-8 border-t border-hairline pt-6">
            <p className="text-sm text-ink-muted">
              Checking whether a certificate is genuine?{" "}
              <a href="/verify" className="font-medium text-brand-700 hover:underline">
                Verify a certificate
              </a>
              , no account needed.
            </p>
          </div>

          <p className="mt-8 text-xs text-ink-muted lg:hidden">
            An initiative of the NBA Anaocha Branch
          </p>
        </div>
      </section>
    </div>
  );
}

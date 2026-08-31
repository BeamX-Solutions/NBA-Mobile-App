"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Public verification landing.
 *
 * Two deliberate departures from the mockup.
 *
 * Lookup is by BAIN only. The mockup offered "SCN or Certificate ID", but a
 * Supreme Court Number is semi-public: allowing it would let anyone holding a
 * practitioner's SCN enumerate the certificates issued to them, turning a
 * check on one document into a directory of who holds what. verify_bain takes
 * the reference printed on the certificate precisely so that only someone with
 * the document in front of them can perform the lookup.
 *
 * The mockup's assurance line — "connected directly to the Nigerian Bar
 * Association registry, all results are officially certified" — is not
 * claimed. This reads one branch's records, not a national registry, and
 * lib/branding.ts is explicit that national endorsement should not be implied
 * until it is formally given. On the page a land registry relies on, an
 * overstated claim is the last thing that should appear.
 */
export default function VerifyLookupPage() {
  const router = useRouter();
  const [bain, setBain] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = bain.trim();
    if (trimmed === "") {
      setError("Enter the BAIN printed on the certificate.");
      return;
    }
    setError(null);
    router.push(`/verify/${trimmed.split("/").map(encodeURIComponent).join("/")}`);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3">
          <Image src="/nba-logo.png" alt="" width={36} height={36} className="h-9 w-9" />
          <span
            className="text-lg font-bold text-brand-600"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            NBA Legal Fees
          </span>
          <span className="text-sm text-ink-muted">Certificate Verification</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <div className="text-center">
          <h1
            className="text-3xl font-bold text-brand-600"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            Verify a Certificate of Compliance
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-ink-muted">
            Confirm that a certificate was genuinely issued, and has not been revoked. No account is
            needed.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="mx-auto mt-8 max-w-xl rounded-[var(--radius-card)] border border-hairline bg-surface p-6"
        >
          <label htmlFor="bain" className="block text-sm font-medium text-ink">
            BAIN
          </label>
          <p className="mt-1 text-sm text-ink-muted">
            The reference printed on the certificate, in the form NBA/2026/00001.
          </p>
          <input
            id="bain"
            value={bain}
            onChange={(e) => setBain(e.target.value)}
            placeholder="NBA/2026/00001"
            className="tabular mt-3 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          {error !== null ? (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="mt-4 w-full rounded-[var(--radius-input)] bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700"
          >
            Verify
          </button>
          <p className="mt-3 text-center text-xs text-ink-muted">
            Scanning the QR code on a certificate opens this check with the BAIN already filled in.
          </p>
        </form>

        <section className="mt-12">
          <h2 className="text-center text-lg font-semibold text-ink">How this works</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Step
              n={1}
              title="Enter the BAIN"
              body="Take the reference from the certificate itself, or scan its QR code. The BAIN is what proves the holder has the document."
            />
            <Step
              n={2}
              title="The register is checked"
              body="The BAIN is looked up against the certificates the issuing branch has actually granted."
            />
            <Step
              n={3}
              title="Confirm the details"
              body="The practitioner, their SCN, the document type, the issuing branch and the date of issue are returned."
            />
          </div>
        </section>

        <div className="mx-auto mt-10 max-w-2xl rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
          <p className="text-sm font-semibold text-ink">What this check does and does not tell you</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            A result confirms that a certificate exists under this BAIN and has not been revoked. It
            does not disclose the consideration or the names of the parties: anyone holding a BAIN
            can run this check, so it establishes authenticity without publishing a client&rsquo;s
            commercial terms.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Certificates are issued by the branch named in the result. This service reflects that
            branch&rsquo;s records.
          </p>
        </div>
      </main>

      <footer className="border-t border-hairline px-6 py-5 text-center text-xs text-ink-muted">
        NBA Legal Fees · An initiative of the NBA Anaocha Branch
      </footer>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700">
        {n}
      </span>
      <p className="mt-3 font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}

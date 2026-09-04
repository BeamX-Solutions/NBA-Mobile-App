import type { Metadata } from "next";
import Link from "next/link";

import { documentLabel, formatDate } from "@/lib/format";
import { createServerClient } from "@/lib/supabase";

/**
 * Public verification of a Certificate of Compliance.
 *
 * Outside every auth guard, deliberately: the people who most need this — a
 * land registry clerk, opposing counsel — will never have an account. It is a
 * server component so the answer arrives as HTML, because it is typically
 * opened by scanning a QR code on whatever connection the registry has.
 *
 * A catch-all segment rather than [rbin] because a RBIN contains forward
 * slashes (NBA/2026/00042). The QR code percent-encodes them, but %2F inside a
 * path segment is handled inconsistently once proxies and CDNs are involved.
 * Joining the segments reconstructs the RBIN whether the code encoded them or
 * left them literal, so both /verify/NBA%2F2026%2F00042 and
 * /verify/NBA/2026/00042 resolve to the same certificate.
 */

interface VerificationResult {
  found: boolean;
  rbin: string;
  practitioner_name: string;
  scn: string | null;
  document_type: string;
  branch_name: string;
  issued_at: string;
  certificate_number: string;
  revoked: boolean;
  revocation_reason: string | null;
}

async function lookup(rbin: string): Promise<VerificationResult | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase.rpc("verify_rbin", { p_rbin: rbin });
  if (error) return null;
  const rows = (data ?? []) as VerificationResult[];
  return rows.length > 0 ? rows[0] : null;
}

export async function generateMetadata(props: PageProps<"/verify/[...rbin]">): Promise<Metadata> {
  const { rbin } = await props.params;
  return {
    title: `Verify ${decodeURIComponent(rbin.join("/"))} — NBA Legal Fees`,
    description: "Confirm whether a Certificate of Compliance is genuine.",
  };
}

export default async function VerifyRbinPage(props: PageProps<"/verify/[...rbin]">) {
  const { rbin } = await props.params;
  const reference = decodeURIComponent(rbin.join("/"));
  const result = await lookup(reference);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-12">
      <Link href="/verify" className="text-sm font-medium text-brand-700 hover:underline">
        ← Verify another certificate
      </Link>

      <h1
        className="mt-4 text-2xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
      >
        Certificate verification
      </h1>
      <p className="tabular mt-1 text-sm text-ink-muted">{reference}</p>

      {result === null ? (
        <div className="mt-8 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-6">
          <p className="font-semibold text-red-900">No certificate found</p>
          <p className="mt-2 text-sm text-red-800">
            No Certificate of Compliance has been issued under this RBIN. If it was copied from a
            printed document, check each character. Otherwise the document should not be relied on.
          </p>
        </div>
      ) : result.revoked ? (
        <div className="mt-8 rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-6">
          <p className="font-semibold text-red-900">This certificate has been revoked</p>
          <p className="mt-2 text-sm text-red-800">
            {result.revocation_reason ?? "No reason was recorded."}
          </p>
          <p className="mt-2 text-sm text-red-800">It should not be relied on.</p>
        </div>
      ) : (
        <div className="mt-8 rounded-[var(--radius-card)] border border-emerald-200 bg-emerald-50 p-6">
          <p className="font-semibold text-emerald-900">This certificate is genuine</p>
          <p className="mt-1 text-sm text-emerald-800">
            Issued by the branch named below and recorded in the register.
          </p>
        </div>
      )}

      {result !== null ? (
        <dl className="mt-6 divide-y divide-hairline rounded-[var(--radius-card)] border border-hairline bg-surface">
          <Row label="Practitioner" value={result.practitioner_name} />
          <Row label="Supreme Court Number" value={result.scn ?? "Not recorded"} />
          <Row label="Document type" value={documentLabel(result.document_type)} />
          <Row label="Issuing branch" value={result.branch_name} />
          <Row label="Date of issue" value={formatDate(result.issued_at)} />
          <Row label="Certificate number" value={result.certificate_number} tabular />
          <Row label="RBIN" value={result.rbin} tabular />
        </dl>
      ) : null}

      <p className="mt-6 text-xs leading-relaxed text-ink-muted">
        This check confirms that a certificate exists under this RBIN and has not been revoked. It
        deliberately does not disclose the consideration or the names of the parties: anyone holding
        a RBIN can perform this lookup, so it establishes authenticity without publishing a client&rsquo;s
        commercial terms.
      </p>

      <p className="mt-8 text-center text-xs text-ink-muted">
        NBA Legal Fees · An initiative of the NBA Anaocha Branch
      </p>
    </main>
  );
}

function Row({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className={"text-sm text-ink " + (tabular ? "tabular font-medium" : "")}>{value}</dd>
    </div>
  );
}

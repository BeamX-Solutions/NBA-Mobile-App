"use client";

import Link from "next/link";

import { isSuperAdmin, useAuth } from "@/lib/auth";

/**
 * Help, written for whoever is signed in.
 *
 * Help Center and Support both pointed at /verify, the public page where a
 * land registry checks a certificate. That is a useful page and it is not
 * help: somebody clicking Help in a console has a question about the console.
 *
 * The rules are the part worth writing down. Most of what surprises an
 * administrator here is deliberate and enforced in the database rather than
 * the interface, so being refused reads as a bug unless somebody has explained
 * why. That is what most of this page is.
 */
export default function HelpPage() {
  const { profile } = useAuth();
  const platform = isSuperAdmin(profile);

  return (
    <>
      <div>
        <h1
          className="text-3xl font-bold text-ink"
          style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
        >
          Help
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {platform
            ? "What this console does, as a super administrator."
            : "What this console does, as a branch administrator."}
        </p>
      </div>

      <div className="mt-6 space-y-4">
        {platform ? (
          <>
            <Topic title="What you are here to do">
              You oversee the platform and the people who administer it. You bring branches onto
              the service and appoint the administrators who run them. You do not run a branch
              yourself, and your account belongs to none.
            </Topic>

            <Topic title="Branches">
              Every branch of the Association is listed, and nearly all are inactive. Activating
              one is what brings it onto the platform: it becomes selectable when a lawyer
              registers, and its members can generate receipts. It carries no fee and no expiry. A
              branch stays active until you switch it off, and switching it off stops new
              registrations and new receipts without touching accounts or certificates that already
              exist. <Ref href="/all-branches">Branches</Ref>
            </Topic>

            <Topic title="Administrators">
              A practitioner becomes an administrator here, and stops being one here. You cannot
              change your own role, and you cannot change another super administrator&rsquo;s: if
              you could demote yourself you might be the last one, and no screen could appoint
              another. Promotion to super administrator is deliberately not offered.{" "}
              <Ref href="/administrators">Administrators</Ref>
            </Topic>

            <Topic title="What you cannot do, on purpose">
              You cannot approve a submission or open a branch&rsquo;s own record. Approving is
              branch work and carries a rule that two different people must have handled a
              certificate; an overseer who also approved would hold the work and the oversight of
              it at once. You can revoke a certificate, because a bad certificate is a platform
              level problem and the branch that issued it may be the reason it is bad.
            </Topic>
          </>
        ) : (
          <>
            <Topic title="What you are here to do">
              You run your branch: you check that practitioners have paid the branch fee, approve
              the ones that are good, and keep the details printed on your branch&rsquo;s receipts
              and certificates up to date.
            </Topic>

            <Topic title="Verifying a payment">
              A practitioner calculates a fee, generates a receipt, pays your branch and uploads
              proof. It arrives in your queue. Approving issues the RBIN and creates the
              Certificate of Compliance in one step, and it cannot be undone by approving again.
              Rejecting requires a reason, which is shown to the practitioner so they know what to
              correct. <Ref href="/transactions">Transactions</Ref>
            </Topic>

            <Topic title="Why you cannot approve your own submission">
              If you also practise law, your own submissions cannot be approved by you. A
              certificate a land registry may rely on should have been seen by two people. A branch
              whose only administrator also practises needs a second administrator to process their
              work, which your super administrator can appoint.
            </Topic>

            <Topic title="Revoking a certificate">
              A certificate issued in error can be withdrawn from its transaction record. A reason
              is required and is published: anyone checking that reference is told the certificate
              was revoked and why, rather than being told nothing. Only a super administrator can
              reverse a revocation. <Ref href="/certificates">Certificates</Ref>
            </Topic>

            <Topic title="Why a practitioner cannot generate a receipt">
              Almost always their subscription has lapsed. Their record shows it, and it is not
              something you or anyone else can grant from this console: entitlement follows a
              payment. If your branch itself has been deactivated, none of its members can generate
              receipts until it is activated again.{" "}
              <Ref href="/practitioners">Practitioners</Ref>
            </Topic>

            <Topic title="Your branch's details">
              The bank account on your receipts, the chairman named on your certificates and the
              signature printed on them are yours to keep current. The branch name, code and
              activation are set centrally. <Ref href="/branch-records">Branch Records</Ref>
            </Topic>
          </>
        )}

        <Topic title="What a certificate proves">
          A printed certificate proves nothing by itself; anyone can produce a document that looks
          like one. What proves it is the reference, checked against the register on the public
          verification page. That page is open to anyone, needs no account, and is what a land
          registry or opposing counsel should be pointed at.{" "}
          <a
            href="/verify"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-700 hover:underline"
          >
            Public verification
          </a>
        </Topic>

        <Topic title="The figures">
          Fees are the prescribed minimum under the Legal Practitioners (Remuneration) Order, 2023, not a price. A practitioner
          may agree more, and may charge less only on application to the Bar Remuneration
          Committee. The figures are exclusive of VAT and of disbursements such as stamp duty and
          registration fees.
        </Topic>
      </div>

      <div className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
        <p className="text-sm font-semibold text-ink">Still stuck</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Anything this page does not answer goes to whoever administers the platform for the
          Association. If something here looks wrong rather than merely confusing, say so before
          working around it: most refusals in this console are deliberate, and the ones that are not
          are worth knowing about.
        </p>
      </div>
    </>
  );
}

function Topic({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
      <h2 className="font-bold text-ink">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{children}</p>
    </section>
  );
}

function Ref({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-brand-700 hover:underline">
      {children}
    </Link>
  );
}

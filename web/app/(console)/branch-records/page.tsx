"use client";

import { useCallback, useState } from "react";

import { Icon } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/use-async-data";

/**
 * Branch Records, following the supplied design: branch information and
 * remittance details on the left, the export panel and administrators on the
 * right, with an edit mode behind the header button.
 *
 * Branch name, code, state and activation are read only. protect_branch_columns
 * rejects a branch renaming or reactivating itself, and activation is a
 * commercial decision made outside this console — so the design's editable
 * Branch Name field would fail on save rather than being refused up front.
 *
 * The design's "Add Administrator" control is absent. user_role has four
 * values — individual, branch_member, branch_admin, super_admin — and none of
 * the roles drawn there (Financial Officer, Records Manager, Editor) exist.
 * Promoting a member is also blocked by protect_profile_columns, which raises
 * 42501 when a non-admin's role changes, so this needs a schema decision
 * before it can be a screen.
 */

interface Branch {
  id: string;
  name: string;
  branch_code: string;
  state: string;
  activation_status: string;
  expires_at: string | null;
  account_name: string | null;
  account_number: string | null;
  bank_name: string | null;
  chairman_name: string | null;
  chairman_signature_url: string | null;
}

/** What the signatures bucket accepts, mirroring the bucket's own constraint. */
const SIGNATURE_TYPES = ["image/png", "image/jpeg"];
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

interface Admin {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

export default function BranchPage() {
  const { profile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [chairmanName, setChairmanName] = useState("");
  const [signatureBusy, setSignatureBusy] = useState(false);
  const [signatureError, setSignatureError] = useState<string | null>(null);

  const branchId = profile?.branch_id ?? null;

  const fetchBranch = useCallback(async () => {
    if (branchId === null) throw new Error("Your account is not attached to a branch.");
    const [branchResult, adminResult] = await Promise.all([
      supabase
        .from("branches")
        .select(
          "id, name, branch_code, state, activation_status, expires_at, account_name, account_number, bank_name, chairman_name, chairman_signature_url",
        )
        .eq("id", branchId)
        .single(),
      supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .in("role", ["branch_admin", "super_admin"]),
    ]);

    if (branchResult.error || branchResult.data === null) {
      throw new Error(`Your branch could not be loaded. ${branchResult.error?.message ?? ""}`.trim());
    }
    const row = branchResult.data as Branch;

    // The bucket is private, so the stored value is an object path and not
    // something an <img> can load. A short signed URL is drawn purely to show
    // the administrator what is currently on their certificates.
    let preview: string | null = null;
    if (row.chairman_signature_url !== null) {
      const { data: signed } = await supabase.storage
        .from("signatures")
        .createSignedUrl(row.chairman_signature_url, 60 * 10);
      preview = signed?.signedUrl ?? null;
    }

    return { branch: row, admins: (adminResult.data ?? []) as Admin[], preview };
  }, [branchId]);

  const { data, error: loadError, reload: load } = useAsyncData(fetchBranch);
  const branch = data?.branch ?? null;
  const admins = data?.admins ?? [];
  const signaturePreview = data?.preview ?? null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (branch === null) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    const { error } = await supabase
      .from("branches")
      .update({
        account_name: accountName.trim() || null,
        account_number: accountNumber.trim() || null,
        bank_name: bankName.trim() || null,
        chairman_name: chairmanName.trim() || null,
      })
      .eq("id", branch.id);

    if (error) {
      setSaveError(`Those changes could not be saved. ${error.message}`);
    } else {
      setSaved(true);
      setEditing(false);
      await load();
    }
    setSaving(false);
  }

  /**
   * Uploading is immediate and outside the form's save, because it is a file
   * transfer rather than a field edit: a half-finished upload should not be
   * sitting in a form waiting for someone to press Save, and the result has to
   * be visible before the administrator can judge whether it is the right
   * image the right way up.
   */
  async function uploadSignature(file: File) {
    if (branch === null) return;
    setSignatureError(null);

    if (!SIGNATURE_TYPES.includes(file.type)) {
      setSignatureError("The signature must be a PNG or a JPEG.");
      return;
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      setSignatureError("The signature must be 2MB or smaller. Crop the scan to the signature.");
      return;
    }

    setSignatureBusy(true);
    try {
      // Path is scoped by branch id so the storage policy can match on the
      // leading folder, exactly as the proofs bucket matches on the owner.
      const extension = file.type === "image/png" ? "png" : "jpg";
      const path = `${branch.id}/signature.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("signatures")
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadError) {
        setSignatureError(`The signature could not be uploaded. ${uploadError.message}`);
        return;
      }

      // A branch that switches between PNG and JPEG leaves the old object
      // behind at the other extension, so the column is what decides which one
      // is current. Written after the upload succeeds, never before.
      const { error: linkError } = await supabase
        .from("branches")
        .update({ chairman_signature_url: path })
        .eq("id", branch.id);

      if (linkError) {
        setSignatureError(`The signature was uploaded but could not be linked. ${linkError.message}`);
        return;
      }

      await load();
    } finally {
      setSignatureBusy(false);
    }
  }

  async function removeSignature() {
    if (branch === null || branch.chairman_signature_url === null) return;
    setSignatureBusy(true);
    setSignatureError(null);
    try {
      // The column is cleared first. If the object delete fails, the branch has
      // an orphaned file and no signature printed, which is recoverable; the
      // other order risks a column pointing at a file that is gone, which puts
      // a broken image on certificates.
      const { error: linkError } = await supabase
        .from("branches")
        .update({ chairman_signature_url: null })
        .eq("id", branch.id);

      if (linkError) {
        setSignatureError(`The signature could not be removed. ${linkError.message}`);
        return;
      }

      await supabase.storage.from("signatures").remove([branch.chairman_signature_url]);
      await load();
    } finally {
      setSignatureBusy(false);
    }
  }

  if (loadError !== null) {
    return (
      <div className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-800">{loadError}</p>
      </div>
    );
  }

  if (branch === null) return <p className="text-sm text-ink-muted">Loading…</p>;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold text-ink"
            style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
          >
            Branch Records
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Manage the details printed on receipts and certificates.
          </p>
        </div>
        <button
          onClick={() => {
            // Seeded here rather than when the branch loads. The fields are
            // only meaningful while editing, and filling them from an effect
            // watching the loaded row meant a render spent copying data into
            // state that nothing was reading yet.
            if (!editing && branch !== null) {
              setAccountName(branch.account_name ?? "");
              setAccountNumber(branch.account_number ?? "");
              setBankName(branch.bank_name ?? "");
              setChairmanName(branch.chairman_name ?? "");
            }
            setEditing((open) => !open);
            setSaved(false);
            setSaveError(null);
          }}
          className="rounded-[var(--radius-input)] bg-accent-400 px-4 py-2.5 text-sm font-bold text-brand-900 transition hover:brightness-95"
        >
          {editing ? "Cancel editing" : "Edit Branch Info"}
        </button>
      </div>

      {saved ? (
        <p className="mt-4 rounded-[var(--radius-input)] bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          Saved.
        </p>
      ) : null}

      <form onSubmit={save} className="mt-6 grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <div className="space-y-5">
          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
            <h2 className="flex items-center gap-2 border-b border-hairline pb-3 text-lg font-bold text-brand-600">
              <Icon name="branch" />
              Branch Information
            </h2>
            <dl className="mt-4 grid gap-5 sm:grid-cols-2">
              <Read label="Branch Name" value={branch.name} />
              <Read label="Branch Code" value={branch.branch_code} tabular />
              <Read label="State" value={branch.state} />
              <Read
                label="Status"
                value={
                  branch.activation_status +
                  (branch.expires_at !== null ? ` until ${formatDate(branch.expires_at)}` : "")
                }
              />
            </dl>
            <p className="mt-4 text-xs text-ink-muted">
              Name, code, state and activation are set centrally. The database refuses a branch
              renaming or reactivating itself.
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
            <h2 className="flex items-center gap-2 border-b border-hairline pb-3 text-lg font-bold text-brand-600">
              <Icon name="money" />
              Remittance Bank Details
            </h2>
            <p className="mt-3 text-sm text-ink-muted">
              Printed on every receipt. A practitioner pays their branch fee into this account
              before uploading proof, so an error here stops the whole pipeline.
            </p>

            {editing ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Bank Name" value={bankName} onChange={setBankName} />
                <Field label="Account Name" value={accountName} onChange={setAccountName} />
                <Field
                  label="Account Number"
                  value={accountNumber}
                  onChange={setAccountNumber}
                  inputMode="numeric"
                  tabular
                />
              </div>
            ) : (
              <>
                <dl className="mt-4 grid gap-5 sm:grid-cols-2">
                  <Read label="Bank Name" value={branch.bank_name ?? "Not set"} />
                  <Read label="Account Name" value={branch.account_name ?? "Not set"} />
                </dl>
                <div className="mt-5">
                  <p className="text-xs uppercase tracking-wide text-ink-muted">Account Number</p>
                  <div className="mt-1 flex items-center justify-between gap-3 rounded-[var(--radius-input)] bg-canvas px-4 py-3">
                    <span className="tabular text-xl font-bold text-ink">
                      {branch.account_number ?? "Not set"}
                    </span>
                    {branch.account_number !== null ? (
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(branch.account_number ?? "");
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1800);
                        }}
                        className="rounded-[6px] border border-hairline bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:text-ink"
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
            <h2 className="flex items-center gap-2 border-b border-hairline pb-3 text-lg font-bold text-brand-600">
              <Icon name="certificate" />
              Certificate Signatory
            </h2>
            <p className="mt-3 text-sm text-ink-muted">
              Printed on every Certificate of Compliance issued by this branch.
            </p>
            {editing ? (
              <div className="mt-4 max-w-sm">
                <Field label="Branch Chairman" value={chairmanName} onChange={setChairmanName} />
              </div>
            ) : (
              <dl className="mt-4">
                <Read label="Branch Chairman" value={branch.chairman_name ?? "Not set"} />
              </dl>
            )}
            {/* Outside the edit toggle on purpose. The name is a field that
                saves with the rest of the form; the signature is a file that
                uploads on selection, and hiding it behind Edit would imply it
                is staged and saved alongside the others. */}
            <div className="mt-5 border-t border-hairline pt-4">
              <p className="text-sm font-medium text-ink">Signature</p>
              <p className="mt-1 text-sm text-ink-muted">
                A PNG with a transparent background reproduces best. It is printed on the signature
                line of every certificate issued from now on, and is not applied retrospectively to
                certificates already downloaded.
              </p>

              {signatureError !== null ? (
                <p
                  role="alert"
                  className="mt-3 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
                >
                  {signatureError}
                </p>
              ) : null}

              {signaturePreview !== null ? (
                <div className="mt-3">
                  {/* Plain img, not next/image: this is a short-lived signed
                      URL on a private bucket, which the image optimiser cannot
                      usefully cache and should not be asked to. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={signaturePreview}
                    alt={`Signature of ${branch.chairman_name ?? "the chairman"}`}
                    className="h-20 w-auto max-w-[16rem] rounded-[var(--radius-input)] border border-hairline bg-white object-contain p-2"
                  />
                </div>
              ) : (
                <p className="mt-3 rounded-[var(--radius-input)] bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                  No signature uploaded. Certificates print the chairman&rsquo;s name over an empty
                  signature line.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label
                  className={
                    "cursor-pointer rounded-[var(--radius-input)] border border-hairline px-4 py-2 text-sm font-semibold text-ink transition hover:bg-canvas " +
                    (signatureBusy ? "pointer-events-none opacity-50" : "")
                  }
                >
                  {signatureBusy
                    ? "Working…"
                    : signaturePreview !== null
                      ? "Replace signature"
                      : "Upload signature"}
                  <input
                    type="file"
                    accept={SIGNATURE_TYPES.join(",")}
                    className="hidden"
                    disabled={signatureBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // Cleared so selecting the same file twice, after a
                      // failed upload, still fires a change event.
                      e.target.value = "";
                      if (file !== undefined) uploadSignature(file);
                    }}
                  />
                </label>

                {signaturePreview !== null ? (
                  <button
                    type="button"
                    onClick={removeSignature}
                    disabled={signatureBusy}
                    className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {saveError !== null ? (
            <p
              role="alert"
              className="rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
            >
              {saveError}
            </p>
          ) : null}

          {editing ? (
            <button
              type="submit"
              disabled={saving}
              className="rounded-[var(--radius-input)] bg-brand-600 px-5 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          ) : null}
        </div>

        <div className="space-y-5">
          <section className="rounded-[var(--radius-card)] bg-brand-600 p-6 text-white">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Icon name="reports" />
              Monthly Export
            </h2>
            <p className="mt-2 text-sm text-brand-100">
              Download this branch&rsquo;s transactions and verified fees as a spreadsheet.
            </p>
            <a
              href="/reports"
              className="mt-4 block rounded-[var(--radius-input)] bg-white px-4 py-2.5 text-center font-semibold text-brand-700 transition hover:bg-brand-50"
            >
              Go to Reports
            </a>
          </section>

          <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold text-brand-600">
              <Icon name="people" />
              Administrators
            </h2>
            <ul className="mt-4 space-y-3">
              {admins.map((admin) => (
                <li key={admin.id} className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                    {admin.full_name
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase())
                      .join("") || "?"}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {admin.full_name}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      {admin.role === "super_admin" ? "Super Administrator" : "Branch Administrator"}
                    </span>
                  </span>
                </li>
              ))}
              {admins.length === 0 ? (
                <li className="text-sm text-ink-muted">No administrators found.</li>
              ) : null}
            </ul>
            <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-ink-muted">
              Administrators are appointed centrally. Promoting a member from here is blocked by the
              database, and the roles in the designs — Financial Officer, Records Manager, Editor —
              do not exist in the schema yet.
            </p>
          </section>
        </div>
      </form>
    </>
  );
}

function Read({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={"mt-1 text-ink " + (tabular ? "tabular font-medium" : "")}>{value}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  inputMode,
  tabular,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "numeric";
  tabular?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className={
          "mt-1 w-full rounded-[var(--radius-input)] border border-hairline px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 " +
          (tabular ? "tabular" : "")
        }
      />
    </label>
  );
}

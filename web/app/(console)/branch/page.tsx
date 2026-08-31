"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";

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
}

/**
 * Branch settings.
 *
 * These four editable fields are the ones that appear on documents a
 * practitioner or a third party reads: the bank details are printed on every
 * receipt, and the chairman's name is printed on every Certificate of
 * Compliance. Getting them wrong means practitioners pay into the wrong
 * account, so they are worth a screen of their own.
 *
 * branch_code, name, state and activation are read-only here. A branch cannot
 * rename or reactivate itself: protect_branch_columns rejects it, and
 * activation is a commercial decision made by the national body.
 */
export default function BranchPage() {
  const { profile } = useAuth();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [chairmanName, setChairmanName] = useState("");

  const load = useCallback(async () => {
    if (!profile?.branch_id) {
      setLoadError("Your account is not attached to a branch.");
      return;
    }
    const { data, error } = await supabase
      .from("branches")
      .select(
        "id, name, branch_code, state, activation_status, expires_at, account_name, account_number, bank_name, chairman_name",
      )
      .eq("id", profile.branch_id)
      .single();

    if (error || data === null) {
      setLoadError("Your branch could not be loaded.");
      return;
    }
    const row = data as Branch;
    setBranch(row);
    setAccountName(row.account_name ?? "");
    setAccountNumber(row.account_number ?? "");
    setBankName(row.bank_name ?? "");
    setChairmanName(row.chairman_name ?? "");
  }, [profile?.branch_id]);

  useEffect(() => {
    load();
  }, [load]);

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
      setSaveError("Those changes could not be saved. You may not administer this branch.");
    } else {
      setSaved(true);
      await load();
    }
    setSaving(false);
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
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
      >
        {branch.name}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Branch code <span className="tabular font-medium">{branch.branch_code}</span> · {branch.state}{" "}
        · {branch.activation_status}
        {branch.expires_at !== null ? ` until ${formatDate(branch.expires_at)}` : ""}
      </p>

      <form
        onSubmit={save}
        className="mt-6 max-w-2xl rounded-[var(--radius-card)] border border-hairline bg-surface p-6"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Bank account for branch fees
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Printed on every receipt. A practitioner pays their branch fee into this account before
          uploading proof, so an error here stops the whole pipeline.
        </p>

        <Text label="Account name" value={accountName} onChange={setAccountName} />
        <Text
          label="Account number"
          value={accountNumber}
          onChange={setAccountNumber}
          inputMode="numeric"
          tabular
        />
        <Text label="Bank" value={bankName} onChange={setBankName} />

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Certificate signatory
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Printed on every Certificate of Compliance issued by this branch.
        </p>
        <Text label="Branch Chairman" value={chairmanName} onChange={setChairmanName} />

        {saveError !== null ? (
          <p
            role="alert"
            className="mt-4 rounded-[var(--radius-input)] bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
          >
            {saveError}
          </p>
        ) : null}
        {saved ? (
          <p className="mt-4 rounded-[var(--radius-input)] bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
            Saved.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="mt-6 rounded-[var(--radius-input)] bg-brand-600 px-4 py-2 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>

      <p className="mt-4 max-w-2xl text-xs text-ink-muted">
        The chairman&rsquo;s signature image is not yet supported: the certificate prints the name only.
      </p>
    </>
  );
}

function Text({
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
    <label className="mt-4 block">
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

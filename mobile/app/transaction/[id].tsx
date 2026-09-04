import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DetailRow, Screen, ScreenHeading, SectionTitle } from '@/components/ui/Screen';
import { ConfirmDialog } from '@/components/ui/States';
import { Stepper } from '@/components/ui/Stepper';
import { useAuth } from '@/lib/auth-context';
import type { Transaction } from '@/lib/database.types';
import { documentTypeLabels } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/** Matches the 10MB limit in SPEC.md rather than the 5MB shown in the mockup. */
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Ownership is asserted in the query, not inferred from the id. RLS
      // permits a branch admin to read any transaction in their branch, so
      // fetching by id alone would open another practitioner's transaction in
      // the personal detail screen. Administrators review in the web console,
      // which is the surface built for it.
      const { data, error: loadError } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', id)
        .eq('user_id', profile?.id ?? '')
        .single();
      if (loadError) {
        setError('This transaction could not be loaded.');
        return;
      }
      setTransaction(data as Transaction);
    } finally {
      setLoading(false);
    }
  }, [id, profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePickFile() {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ACCEPTED_TYPES,
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    const size = asset.size ?? 0;

    // Validate before upload rather than after: on a slow connection an
    // oversized file would otherwise waste minutes before failing.
    if (size > MAX_PROOF_BYTES) {
      setError('That file is larger than 10MB. Please attach a smaller file.');
      return;
    }
    if (asset.mimeType !== undefined && !ACCEPTED_TYPES.includes(asset.mimeType)) {
      setError('Attach a PDF, JPG or PNG.');
      return;
    }

    setFile({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? 'application/octet-stream',
      size,
    });
  }

  async function handleSubmit() {
    if (transaction === null || file === null) {
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      // Path is scoped by user id so the storage policy can restrict a
      // practitioner to their own folder.
      const extension = file.name.split('.').pop() ?? 'bin';
      const path = `${transaction.user_id}/${transaction.id}.${extension}`;

      const response = await fetch(file.uri);
      const body = await response.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('proofs')
        .upload(path, body, { contentType: file.mimeType, upsert: true });

      if (uploadError) {
        setError('The file could not be uploaded. Please check your connection and try again.');
        return;
      }

      // The database trigger enforces that proof_url is present before the
      // status may move to pending_verification, so both are set together.
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ proof_url: path, status: 'pending_verification' })
        .eq('id', transaction.id);

      if (updateError) {
        setError('The submission was rejected. Please try again.');
        return;
      }

      router.back();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Screen scroll={false} style={styles.centered}>
        <ActivityIndicator color={palette.primary} size="large" />
      </Screen>
    );
  }

  if (transaction === null) {
    return (
      <Screen>
        <Card>
          <Text style={styles.error}>{error ?? 'This transaction could not be found.'}</Text>
        </Card>
      </Screen>
    );
  }

  const canSubmitProof =
    transaction.status === 'awaiting_payment' || transaction.status === 'rejected';

  return (
    <Screen>
      <ScreenHeading
        title="Upload Proof"
        subtitle="Submit payment evidence for verification to proceed with document stamping."
      />

      {/* Step 1 is the receipt being generated, 2 is submitting proof, 3 is
          the branch verifying it. */}
      <Stepper current={transaction.status === 'verified' ? 3 : 2} total={3} />

      <View style={styles.statusRow}>
        <StatusBadge status={transaction.status} />
      </View>

      {transaction.status === 'rejected' && transaction.rejection_reason !== null ? (
        <Card style={[styles.card, styles.rejectionCard]}>
          <Text style={styles.rejectionTitle}>Rejected by your branch</Text>
          <Text style={styles.rejectionReason}>{transaction.rejection_reason}</Text>
        </Card>
      ) : null}

      <Card style={styles.card}>
        <SectionTitle>Transaction</SectionTitle>
        <DetailRow label="Name of Practitioner" value={profile?.full_name ?? 'Not set'} />
        <DetailRow label="Supreme Court Number" value={profile?.scn ?? 'Not set'} />
        <DetailRow label="Parties to the Document" value={transaction.parties} />
        <DetailRow
          label="Type of Document"
          value={documentTypeLabels[transaction.document_type]}
        />
        <DetailRow label="Consideration" value={formatNaira(transaction.consideration)} />
        <DetailRow
          label="Amount Payable"
          value={formatNaira(transaction.amount_payable)}
          emphasise
        />
        {transaction.rbin !== null ? <DetailRow label="RBIN" value={transaction.rbin} /> : null}
      </Card>

      {canSubmitProof ? (
        <Card style={styles.card}>
          <SectionTitle>Upload Proof of Payment</SectionTitle>

          <Pressable
            accessibilityRole="button"
            onPress={handlePickFile}
            style={styles.dropzone}>
            <View style={styles.dropzoneIcon}>
              <MaterialIcons name="upload-file" size={26} color={palette.textMuted} />
            </View>
            <Text style={styles.dropzoneTitle}>Tap or click to browse files</Text>
            <Text style={styles.dropzoneHint}>Supported formats: PDF, JPG, PNG (max 10MB)</Text>
            <View style={styles.selectFile}>
              <Text style={styles.selectFileLabel}>Select File</Text>
            </View>
          </Pressable>

          {file !== null ? (
            <View style={styles.filePill}>
              <Text style={styles.fileName} numberOfLines={1}>
                {file.name}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => setFile(null)}>
                <Text style={styles.removeFile}>Remove</Text>
              </Pressable>
            </View>
          ) : null}

          {error !== null ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label="Submit for Verification"
            onPress={() => setConfirming(true)}
            disabled={file === null}
            loading={submitting}
            style={styles.submit}
          />

          {/*
            Submission is genuinely one way from the practitioner's side. Once
            the status moves to pending_verification the database blocks
            further edits, so the only route back is a branch admin rejecting
            it. That is worth a confirmation step.
          */}
          <ConfirmDialog
            visible={confirming}
            title="Submit for verification?"
            body="Your branch will review this proof of payment. You will not be able to change the transaction or replace the file while it is under review."
            confirmLabel="Submit"
            cancelLabel="Keep editing"
            busy={submitting}
            onCancel={() => setConfirming(false)}
            onConfirm={async () => {
              await handleSubmit();
              setConfirming(false);
            }}
          />
        </Card>
      ) : (
        <Card style={styles.card}>
          <Text style={styles.awaitingText}>
            {transaction.status === 'pending_verification'
              ? 'Your proof of payment is with your branch for verification. You will be notified once it is reviewed.'
              : 'This transaction has been verified. Your Certificate of Compliance is available under Certificates.'}
          </Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: {
    marginBottom: spacing.md,
  },
  card: {
    marginBottom: spacing.lg,
  },
  rejectionCard: {
    backgroundColor: palette.dangerSurface,
    borderColor: palette.danger,
  },
  rejectionTitle: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.danger,
    marginBottom: spacing.xs,
  },
  rejectionReason: {
    fontSize: fontSize.body,
    color: palette.danger,
    lineHeight: 21,
  },
  dropzone: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: palette.borderStrong,
    borderRadius: radius.card,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    backgroundColor: palette.surfaceMuted,
  },
  dropzoneIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.card,
    backgroundColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  dropzoneTitle: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
  },
  selectFile: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.button,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.surface,
    marginTop: spacing.md,
  },
  selectFileLabel: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
  },
  dropzoneHint: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  filePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surfaceMuted,
    borderRadius: radius.input,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.md,
  },
  fileName: {
    flex: 1,
    fontSize: fontSize.label,
    color: palette.text,
  },
  removeFile: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.danger,
  },
  submit: {
    marginTop: spacing.lg,
  },
  error: {
    fontSize: fontSize.label,
    color: palette.danger,
    marginTop: spacing.md,
  },
  awaitingText: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    lineHeight: 22,
  },
});

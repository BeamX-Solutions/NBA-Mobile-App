import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { DetailRow, Screen, ScreenHeading, SectionTitle } from '@/components/ui/Screen';
import { ConfirmDialog, ErrorState, LoadingState } from '@/components/ui/States';
import { useAuth } from '@/lib/auth-context';
import type { Transaction } from '@/lib/database.types';
import { documentTypeLabels } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

interface ReviewRow extends Transaction {
  profiles: { full_name: string; scn: string | null; email: string } | null;
}

/**
 * Review one submission and either verify or reject it.
 *
 * The rules enforced here are also enforced by database triggers, which are
 * the real boundary: only the owning branch's administrator may move a
 * transaction out of pending_verification, a rejection must carry a reason,
 * and verified_by is stamped server side rather than accepted from the
 * client. This screen exists to make those rules legible, not to implement
 * them.
 */
export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();

  const [row, setRow] = useState<ReviewRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'verify' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = profile?.role === 'branch_admin' || profile?.role === 'super_admin';

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('transactions')
      // Named foreign key, as in the queue: transactions reaches profiles
      // through both user_id and verified_by.
      .select('*, profiles!transactions_user_id_fkey(full_name, scn, email)')
      .eq('id', id)
      .single();

    if (error) {
      setLoadError('This submission could not be loaded.');
      setLoading(false);
      return;
    }

    const record = data as ReviewRow;
    setRow(record);

    // Proofs live in a private bucket, so a signed URL is minted per view
    // rather than storing a public link anywhere.
    if (record.proof_url !== null) {
      const { data: signed } = await supabase.storage
        .from('proofs')
        .createSignedUrl(record.proof_url, 60 * 10);
      setProofUrl(signed?.signedUrl ?? null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(decision: 'verify' | 'reject') {
    if (row === null) {
      return;
    }
    if (decision === 'reject' && reason.trim() === '') {
      setReasonError('A reason is required so the practitioner can correct and resubmit.');
      setConfirming(null);
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      if (decision === 'verify') {
        // Approval goes through issue_bain rather than a plain status update.
        // Verifying, drawing the BAIN, and creating the certificate have to
        // happen together or not at all: a direct update could leave a
        // transaction verified with no certificate, or burn a sequence number
        // on a certificate that was never created. The function does all
        // three in one database transaction, under a row lock, so two
        // administrators approving at once cannot both mint a number.
        const { data, error } = await supabase.rpc('issue_bain', {
          p_transaction_id: row.id,
        });

        if (error) {
          setActionError(
            `The BAIN could not be issued: ${error.message}. Nothing has been changed.`
          );
          return;
        }

        const issued = (data ?? []) as { bain: string; certificate_number: string }[];
        router.replace({
          pathname: '/result',
          params: {
            title: 'Certificate Issued',
            message:
              issued.length > 0
                ? `BAIN ${issued[0].bain} has been issued and the Certificate of Compliance created.`
                : 'The certificate has been issued.',
            reference: issued[0]?.certificate_number ?? '',
          },
        });
        return;
      }

      const { error } = await supabase
        .from('transactions')
        .update({ status: 'rejected', rejection_reason: reason.trim() })
        .eq('id', row.id);

      if (error) {
        setActionError(
          'The decision could not be saved. You may not have permission, or the transaction may have already been reviewed.'
        );
        return;
      }
      router.replace('/admin/verify');
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Loading submission" />
      </Screen>
    );
  }

  if (loadError !== null || row === null) {
    return (
      <Screen>
        <ErrorState body={loadError ?? 'Not found.'} onRetry={load} />
      </Screen>
    );
  }

  const decidable = isAdmin && row.status === 'pending_verification';

  return (
    <Screen>
      <ScreenHeading title="Review Submission" />

      <Card>
        <View style={styles.headerRow}>
          <Text style={styles.practitioner}>{row.profiles?.full_name ?? 'Unknown'}</Text>
          <StatusBadge status={row.status} />
        </View>

        <DetailRow label="Supreme Court Number" value={row.profiles?.scn ?? 'Not recorded'} />
        <DetailRow label="Document Type" value={documentTypeLabels[row.document_type]} />
        <DetailRow label="Parties" value={row.parties} />
        <DetailRow label="Consideration" value={formatNaira(row.consideration)} />
        <DetailRow label="Amount Payable" value={formatNaira(row.amount_payable)} emphasise />
        <DetailRow label="Submitted" value={new Date(row.created_at).toLocaleString()} />
      </Card>

      <Card style={styles.card}>
        <SectionTitle icon="attach-file" underline>
          Proof of payment
        </SectionTitle>

        {proofUrl !== null ? (
          <>
            {/* Images preview inline; PDFs cannot, so they open externally. */}
            {/\.(jpg|jpeg|png)$/i.test(row.proof_url ?? '') ? (
              <Image source={{ uri: proofUrl }} style={styles.proofImage} resizeMode="contain" />
            ) : (
              <View style={styles.pdfBlock}>
                <MaterialIcons name="picture-as-pdf" size={40} color={palette.textMuted} />
                <Text style={styles.pdfText}>PDF document</Text>
              </View>
            )}
            <Pressable
              accessibilityRole="link"
              onPress={() => Linking.openURL(proofUrl)}
              style={styles.openRow}>
              <MaterialIcons name="open-in-new" size={18} color={palette.primary} />
              <Text style={styles.openText}>Open full size</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.muted}>No file was attached to this submission.</Text>
        )}
      </Card>

      {row.status === 'rejected' && row.rejection_reason !== null ? (
        <Card style={styles.card}>
          <SectionTitle icon="cancel" underline>
            Rejection reason
          </SectionTitle>
          <Text style={styles.muted}>{row.rejection_reason}</Text>
        </Card>
      ) : null}

      {decidable ? (
        <Card style={styles.card}>
          <SectionTitle icon="gavel" underline>
            Decision
          </SectionTitle>
          <Text style={styles.muted}>
            Verifying issues a Bar Association Identification Number and a Certificate of
            Compliance. Both carry legal weight, so confirm the payment actually reached the branch
            account before approving.
          </Text>

          <TextField
            label="Reason (required to reject)"
            placeholder="e.g. The amount transferred does not match the receipt."
            multiline
            value={reason}
            onChangeText={(text) => {
              setReason(text);
              setReasonError(undefined);
            }}
            error={reasonError}
          />

          {actionError !== null ? <Text style={styles.actionError}>{actionError}</Text> : null}

          <Button label="Verify payment" onPress={() => setConfirming('verify')} loading={busy} />
          <Button
            label="Reject"
            variant="danger"
            onPress={() => setConfirming('reject')}
            style={styles.reject}
          />
        </Card>
      ) : null}

      <ConfirmDialog
        visible={confirming === 'verify'}
        title="Verify this payment?"
        body="This issues a BAIN and a Certificate of Compliance to the practitioner. Certificates are permanent records and cannot be withdrawn casually."
        confirmLabel="Verify"
        busy={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => decide('verify')}
      />

      <ConfirmDialog
        visible={confirming === 'reject'}
        destructive
        title="Reject this submission?"
        body="The practitioner will see your reason and can correct the problem and resubmit."
        confirmLabel="Reject"
        busy={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => decide('reject')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  practitioner: {
    flex: 1,
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  proofImage: {
    width: '100%',
    height: 280,
    borderRadius: radius.input,
    backgroundColor: palette.surfaceMuted,
  },
  pdfBlock: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    backgroundColor: palette.surfaceMuted,
    borderRadius: radius.input,
    gap: spacing.sm,
  },
  pdfText: {
    fontSize: fontSize.body,
    color: palette.textMuted,
  },
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  openText: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.primary,
  },
  muted: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    lineHeight: 21,
    marginBottom: spacing.md,
  },
  actionError: {
    fontSize: fontSize.label,
    color: palette.danger,
    marginBottom: spacing.md,
  },
  reject: {
    marginTop: spacing.sm,
  },
});

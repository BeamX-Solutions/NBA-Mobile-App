import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DetailRow, Screen, ScreenHeading, SectionTitle } from '@/components/ui/Screen';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useAuth } from '@/lib/auth-context';
import { ORDER_SHORT_NAME, PRODUCT_NAME } from '@/lib/branding';
import type { Branch, Transaction } from '@/lib/database.types';
import { documentTypeLabels, type DocumentType } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { shareReceiptPdf } from '@/lib/pdf';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

interface TransactionWithBranch extends Transaction {
  branches: Branch | null;
}

/**
 * The payment instruction: what is owed, and the account it goes to.
 *
 * This sits between calculating a fee and uploading proof, and it is the step
 * that makes the rest possible. Payment happens by bank transfer outside the
 * app, so if the practitioner cannot see the branch account details they
 * cannot pay, and nothing downstream ever happens.
 */
export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const [transaction, setTransaction] = useState<TransactionWithBranch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('transactions')
      .select('*, branches(*)')
      .eq('id', id)
      .single();

    if (error) {
      setLoadError('This receipt could not be loaded.');
    } else {
      setTransaction(data as TransactionWithBranch);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function copy(label: string, value: string) {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Loading receipt" />
      </Screen>
    );
  }

  if (loadError !== null || transaction === null) {
    return (
      <Screen>
        <ErrorState body={loadError ?? 'This receipt could not be found.'} onRetry={load} />
      </Screen>
    );
  }

  const branch = transaction.branches;
  const reference = transaction.receipt_number ?? transaction.id.slice(0, 8).toUpperCase();

  async function handleDownloadPdf() {
    if (transaction === null) {
      return;
    }
    setGeneratingPdf(true);
    setPdfError(null);
    try {
      await shareReceiptPdf({
        receiptNumber: reference,
        issuedAt: transaction.created_at,
        practitionerName: profile?.full_name ?? 'Practitioner',
        scn: profile?.scn ?? null,
        parties: transaction.parties,
        documentType: transaction.document_type as DocumentType,
        consideration: transaction.consideration,
        amountPayable: transaction.amount_payable,
        branchName: branch?.name ?? 'NBA Branch',
        accountName: branch?.account_name ?? null,
        accountNumber: branch?.account_number ?? null,
        bankName: branch?.bank_name ?? null,
      });
    } catch (error) {
      setPdfError(
        error instanceof Error ? error.message : 'The PDF could not be generated. Please try again.'
      );
    } finally {
      setGeneratingPdf(false);
    }
  }

  return (
    <Screen>
      <ScreenHeading
        title="Payment Receipt"
        subtitle="Pay this amount to your branch, then upload the payment slip."
      />

      <Card>
        <View style={styles.header}>
          <Image
            source={require('@/assets/images/nba-logo.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <View style={styles.headerText}>
            <Text style={styles.org}>{branch?.name ?? 'NBA Branch'}</Text>
            <Text style={styles.orgSub}>{PRODUCT_NAME}</Text>
          </View>
        </View>

        <View style={styles.amountBlock}>
          <Text style={styles.amountLabel}>TOTAL AMOUNT PAYABLE TO THE BRANCH</Text>
          <Text style={styles.amount}>{formatNaira(transaction.amount_payable)}</Text>
          <Text style={styles.amountNote}>Computed under the {ORDER_SHORT_NAME}</Text>
        </View>

        <DetailRow label="Reference" value={reference} emphasise />
        <DetailRow label="Document Type" value={documentTypeLabels[transaction.document_type]} />
        <DetailRow label="Parties" value={transaction.parties} />
        <DetailRow label="Consideration" value={formatNaira(transaction.consideration)} />
        <DetailRow label="Date" value={new Date(transaction.created_at).toLocaleDateString()} />
      </Card>

      <Card style={styles.card}>
        <SectionTitle icon="account-balance" underline>
          Pay into this account
        </SectionTitle>

        {branch?.account_number ? (
          <>
            <CopyRow
              label="Account Name"
              value={branch.account_name ?? branch.name}
              copied={copied === 'Account Name'}
              onCopy={() => copy('Account Name', branch.account_name ?? branch.name)}
            />
            <CopyRow
              label="Account Number"
              value={branch.account_number}
              copied={copied === 'Account Number'}
              onCopy={() => copy('Account Number', branch.account_number ?? '')}
            />
            <CopyRow
              label="Bank"
              value={branch.bank_name ?? 'Not set'}
              copied={copied === 'Bank'}
              onCopy={() => copy('Bank', branch.bank_name ?? '')}
            />
            <CopyRow
              label="Use this reference"
              value={reference}
              copied={copied === 'Reference'}
              onCopy={() => copy('Reference', reference)}
            />

            <View style={styles.notice}>
              <MaterialIcons name="info-outline" size={18} color={palette.accentText} />
              <Text style={styles.noticeText}>
                Quote the reference on your transfer. Without it your branch may not be able to
                match the payment to this transaction.
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.notice}>
            <MaterialIcons name="warning-amber" size={18} color={palette.accentText} />
            <Text style={styles.noticeText}>
              Your branch has not published its bank details yet. Contact the branch secretariat for
              payment instructions before uploading proof.
            </Text>
          </View>
        )}
      </Card>

      <Button
        label="I have paid, upload proof"
        onPress={() => router.replace(`/transaction/${transaction.id}`)}
        style={styles.action}
      />
      <Button
        label="Download PDF"
        variant="outline"
        loading={generatingPdf}
        style={styles.actionSecondary}
        onPress={handleDownloadPdf}
      />
      {pdfError !== null ? <Text style={styles.pdfError}>{pdfError}</Text> : null}
      <Button
        label="Share receipt"
        variant="outline"
        style={styles.actionSecondary}
        onPress={() =>
          Share.share({
            message: `${PRODUCT_NAME} payment reference ${reference}. Amount payable: ${formatNaira(
              transaction.amount_payable
            )} to ${branch?.account_name ?? branch?.name ?? 'your NBA branch'}${
              branch?.account_number ? `, account ${branch.account_number}` : ''
            }${branch?.bank_name ? `, ${branch.bank_name}` : ''}.`,
          })
        }
      />
    </Screen>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <View style={styles.copyRow}>
      <View style={styles.copyText}>
        <Text style={styles.copyLabel}>{label}</Text>
        <Text style={styles.copyValue}>{value}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        onPress={onCopy}
        hitSlop={8}
        style={styles.copyButton}>
        <MaterialIcons
          name={copied ? 'check' : 'content-copy'}
          size={18}
          color={copied ? palette.primary : palette.textMuted}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  logo: {
    width: 44,
    height: 44,
  },
  headerText: {
    flex: 1,
  },
  org: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primaryText,
  },
  orgSub: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
  },
  amountBlock: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  amountLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  amount: {
    fontSize: 34,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
    marginTop: spacing.xs,
  },
  amountNote: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  card: {
    marginTop: spacing.lg,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  copyText: {
    flex: 1,
  },
  copyLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  copyValue: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
    marginTop: 2,
  },
  copyButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: palette.accentSurface,
    borderRadius: radius.input,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.caption,
    color: palette.accentText,
    lineHeight: 17,
  },
  action: {
    marginTop: spacing.lg,
  },
  pdfError: {
    fontSize: fontSize.label,
    color: palette.danger,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  actionSecondary: {
    marginTop: spacing.sm,
  },
});

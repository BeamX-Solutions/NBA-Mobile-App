import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Screen, ScreenHeading } from '@/components/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAuth } from '@/lib/auth-context';
import type { Transaction } from '@/lib/database.types';
import { documentTypeLabels } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { payInStatus, payoutStatus } from '@/lib/payments';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * Payments: for each invoice, whether the client has paid the branch, and
 * whether the branch has paid the practitioner their share.
 *
 * The columns the client asked for are Amount, Date, Pay-in Status, Payout
 * Status and Action. A phone has no room for a five column table, so each
 * invoice is a card carrying the same five, in the same order.
 *
 * A payout is Confirmed once the branch records it with the bank's receipt,
 * and the receipt opens from here, so the practitioner can check it against
 * their own statement.
 */

type Row = Pick<
  Transaction,
  | 'id'
  | 'invoice_number'
  | 'document_type'
  | 'status'
  | 'due_to_practitioner'
  | 'remitted_at'
  | 'remittance_reference'
  | 'created_at'
> & { payouts: { receipt_path: string } | null };

/** A practitioner's invoices are counted in tens, not thousands. */
const LIMIT = 200;

export default function PaymentsScreen() {
  const { session } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    // Scoped to the signed-in user explicitly: a branch administrator, who
    // practises too, may read the whole branch's transactions under RLS.
    const { data, error } = await supabase
      .from('transactions')
      .select(
        'id, invoice_number, document_type, status, due_to_practitioner, remitted_at, remittance_reference, created_at, payouts(receipt_path)',
      )
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (error) {
      setLoadError('Your payments could not be loaded.');
      return;
    }
    setLoadError(null);
    setRows(data as unknown as Row[]);
  }, [session?.user]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openReceipt = useCallback(async (path: string) => {
    setReceiptError(null);
    // Private bucket, short lived link: a receipt carries account numbers.
    const { data, error } = await supabase.storage
      .from('payout-receipts')
      .createSignedUrl(path, 600);
    if (error || data === null) {
      setReceiptError('The receipt could not be opened. Try again.');
      return;
    }
    await Linking.openURL(data.signedUrl);
  }, []);

  const heading = (
    <ScreenHeading
      title="Payments"
      subtitle="What your clients have paid your branch, and what your branch has paid you."
    />
  );

  if (loadError !== null) {
    return (
      <Screen onRefresh={refresh} refreshing={refreshing}>
        {heading}
        <ErrorState body={loadError} onRetry={load} />
      </Screen>
    );
  }

  if (rows === null) {
    return (
      <Screen>
        {heading}
        <LoadingState label="Loading your payments" />
      </Screen>
    );
  }

  if (rows.length === 0) {
    return (
      <Screen onRefresh={refresh} refreshing={refreshing}>
        {heading}
        <EmptyState
          icon="payments"
          title="No payments yet"
          body="When you generate an invoice and your client pays your branch, it appears here, and so does your branch paying you your share."
        />
      </Screen>
    );
  }

  const owed = rows.filter((r) => payoutStatus(r)?.label === 'Pending');
  const paid = rows.filter((r) => payoutStatus(r)?.label === 'Confirmed');
  const sum = (list: Row[]) => list.reduce((total, r) => total + r.due_to_practitioner, 0);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      {heading}

      <View style={styles.summary}>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Pending from your branch</Text>
          <Text style={styles.summaryValue}>{formatNaira(sum(owed))}</Text>
          <Text style={styles.summaryNote}>
            {owed.length} {owed.length === 1 ? 'invoice' : 'invoices'}
          </Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Paid to you</Text>
          <Text style={[styles.summaryValue, styles.summaryPaid]}>{formatNaira(sum(paid))}</Text>
          <Text style={styles.summaryNote}>
            {paid.length} {paid.length === 1 ? 'invoice' : 'invoices'}
          </Text>
        </Card>
      </View>

      {receiptError !== null ? <Text style={styles.errorText}>{receiptError}</Text> : null}

      {rows.map((row) => (
        <PaymentCard key={row.id} row={row} onReceipt={openReceipt} />
      ))}
    </Screen>
  );
}

function PaymentCard({ row, onReceipt }: { row: Row; onReceipt: (path: string) => void }) {
  const payIn = payInStatus(row.status);
  const payout = payoutStatus(row);
  const receipt = row.payouts?.receipt_path ?? null;

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <Text style={styles.documentType}>{documentTypeLabels[row.document_type]}</Text>
          <Text style={styles.reference}>{row.invoice_number ?? 'No reference yet'}</Text>
        </View>
        <View style={styles.amountBlock}>
          <Text style={styles.fieldLabel}>Amount</Text>
          <Text style={styles.amount}>{formatNaira(row.due_to_practitioner)}</Text>
        </View>
      </View>

      <View style={styles.fields}>
        <Field label="Date">
          <Text style={styles.fieldValue}>{new Date(row.created_at).toLocaleDateString()}</Text>
        </Field>
        <Field label="Pay-in">
          <Badge label={payIn.label} surface={payIn.surface} color={payIn.color} />
        </Field>
        <Field label="Payout">
          {payout === null ? (
            <Text style={styles.fieldValue}>—</Text>
          ) : (
            <Badge label={payout.label} surface={payout.surface} color={payout.color} />
          )}
        </Field>
      </View>

      <View style={styles.actions}>
        {receipt !== null ? (
          <Pressable accessibilityRole="button" onPress={() => onReceipt(receipt)} hitSlop={8}>
            <Text style={styles.action}>View receipt</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/transaction/${row.id}`)}
          hitSlop={8}>
          <Text style={receipt !== null ? styles.actionQuiet : styles.action}>View invoice</Text>
        </Pressable>
      </View>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  summaryCard: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
  },
  summaryValue: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.accentText,
    marginTop: spacing.xs,
  },
  summaryPaid: {
    color: palette.success,
  },
  summaryNote: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardTitle: {
    flex: 1,
  },
  documentType: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  reference: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  amountBlock: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
  },
  fields: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  field: {
    gap: spacing.xs,
    minWidth: 90,
  },
  fieldLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
  },
  fieldValue: {
    fontSize: fontSize.body,
    color: palette.text,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  action: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.primary,
  },
  actionQuiet: {
    fontSize: fontSize.body,
    color: palette.textMuted,
  },
  errorText: {
    fontSize: fontSize.body,
    color: palette.danger,
    textAlign: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.input,
  },
});

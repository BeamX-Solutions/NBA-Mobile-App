import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Field';
import { Screen, ScreenHeading } from '@/components/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAuth } from '@/lib/auth-context';
import type { Transaction } from '@/lib/database.types';
import { documentTypeLabels } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing, statusStyles } from '@/theme/tokens';
import type { TransactionStatus } from '@/theme/tokens';

const statusOptions = [
  { value: 'all' as const, label: 'All Statuses' },
  ...(Object.keys(statusStyles) as TransactionStatus[]).map((value) => ({
    value,
    label: statusStyles[value].label,
  })),
];

const PAGE_SIZE = 10;

export default function TransactionsScreen() {
  const { session } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  // Distinct from "loaded successfully with no rows": an outage and an empty
  // account need different screens, so the error is tracked separately rather
  // than collapsing both into an empty list.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | 'all'>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    if (!session?.user) {
      return;
    }
    // Scoped to the signed-in user explicitly. RLS is a ceiling, not a filter:
    // its policies are OR'd, so a branch admin is permitted to read every
    // transaction in their branch. Without this the admin's personal list
    // rendered the whole branch as though it were their own.
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      setLoadError('Your transactions could not be loaded.');
      // Left null so the error state renders instead of an empty list.
      return;
    }
    setLoadError(null);
    setTransactions(data as Transaction[]);
  }, [session?.user]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const visible = useMemo(() => {
    if (transactions === null) {
      return [];
    }
    const term = search.trim().toLowerCase();
    return transactions.filter((transaction) => {
      if (statusFilter !== 'all' && transaction.status !== statusFilter) {
        return false;
      }
      if (term === '') {
        return true;
      }
      const label = documentTypeLabels[transaction.document_type].toLowerCase();
      return (
        label.includes(term) ||
        transaction.parties.toLowerCase().includes(term) ||
        (transaction.receipt_number ?? '').toLowerCase().includes(term)
      );
    });
  }, [transactions, search, statusFilter]);

  // The search and filter controls are hidden until there is something to
  // search. Offering a filter over an empty list is noise, and it pushes the
  // explanation of what the screen is for below the fold.
  const hasAny = transactions !== null && transactions.length > 0;

  if (loadError !== null) {
    return (
      <Screen resetScrollOnFocus onRefresh={refresh} refreshing={refreshing}>
        <ScreenHeading
          title="Transactions"
          subtitle="Review your recent fee calculations and invoice statuses."
        />
        <ErrorState body={loadError} onRetry={load} />
      </Screen>
    );
  }

  if (transactions === null) {
    return (
      <Screen resetScrollOnFocus>
        <ScreenHeading
          title="Transactions"
          subtitle="Review your recent fee calculations and invoice statuses."
        />
        <LoadingState label="Loading your transactions" />
      </Screen>
    );
  }

  if (!hasAny) {
    return (
      <Screen resetScrollOnFocus onRefresh={refresh} refreshing={refreshing}>
        <ScreenHeading
          title="Transactions"
          subtitle="Review your recent fee calculations and invoice statuses."
        />
        <EmptyState
          icon="receipt-long"
          title="No transactions yet"
          body="When you calculate a fee and generate a receipt, it appears here so you can pay your branch and upload proof of payment."
          actionLabel="Calculate a fee"
          onAction={() => router.replace('/(tabs)')}
        />
      </Screen>
    );
  }

  return (
    <Screen resetScrollOnFocus onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeading
        title="Transactions"
        subtitle="Review your recent fee calculations and invoice statuses."
      />

      <View style={styles.searchBox}>
        <MaterialIcons name="search" size={20} color={palette.textMuted} />
        <TextInput
          placeholder="Search by Document Type or ID"
          placeholderTextColor={palette.textDisabled}
          value={search}
          onChangeText={setSearch}
          style={styles.searchInput}
        />
      </View>

      <SelectField
        label=""
        placeholder="All Statuses"
        value={statusFilter}
        onChange={setStatusFilter}
        options={statusOptions}
      />

      {visible.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>No transactions match your search.</Text>
        </Card>
      ) : (
        <>
          {visible.slice(0, visibleCount).map((transaction) => (
            <TransactionCard key={transaction.id} transaction={transaction} />
          ))}
          {visible.length > visibleCount ? (
            <Button
              label="Load More Transactions"
              variant="outline"
              onPress={() => setVisibleCount((count) => count + PAGE_SIZE)}
              style={styles.loadMore}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

function TransactionCard({ transaction }: { transaction: Transaction }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/transaction/${transaction.id}`)}>
      <Card style={styles.transactionCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.documentType}>{documentTypeLabels[transaction.document_type]}</Text>
          <StatusBadge status={transaction.status} />
        </View>

        <Text style={styles.reference}>
          {transaction.receipt_number ?? 'No reference yet'} -{' '}
          {new Date(transaction.created_at).toLocaleDateString()}
        </Text>

        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.feeLabel}>Professional Fee</Text>
            <Text style={styles.feeValue}>{formatNaira(transaction.amount_payable)}</Text>
          </View>
          <Text style={styles.consideration}>
            Consideration: {formatNaira(transaction.consideration)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.input,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.body,
    color: palette.text,
    paddingVertical: spacing.md,
  },
  loadMore: {
    marginTop: spacing.sm,
  },
  loader: {
    marginTop: spacing.xl,
  },
  transactionCard: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  documentType: {
    flex: 1,
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
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  feeLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
  },
  feeValue: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
  },
  consideration: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textAlign: 'right',
    flex: 1,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    paddingVertical: spacing.lg,
  },
  errorText: {
    fontSize: fontSize.body,
    color: palette.danger,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});

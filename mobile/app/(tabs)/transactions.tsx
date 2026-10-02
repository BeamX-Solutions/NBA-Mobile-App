import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  afterCursorFilter,
  cleanSearchTerm,
  PAGE_SIZE,
  pageOf,
  transactionSearchFilter,
  type Cursor,
} from '@/lib/paging';
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

/** How long typing must pause before the search runs. */
const SEARCH_DELAY_MS = 300;

export default function TransactionsScreen() {
  const { session } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  // Distinct from "loaded successfully with no rows": an outage and an empty
  // account need different screens, so the error is tracked separately rather
  // than collapsing both into an empty list.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | 'all'>('all');
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // Whether the practitioner has any transactions at all, as distinct from
  // none matching the current search. Only an unfiltered load can tell.
  const [hasAny, setHasAny] = useState<boolean | null>(null);
  // Each first-page load gets a number, and a reply that is no longer the
  // latest is dropped, so a slow search cannot overwrite a newer one.
  const latestLoad = useRef(0);

  // The search runs once typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(cleanSearchTerm(search)), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(
    async (cursor: Cursor | null) => {
      if (!session?.user) {
        return null;
      }
      // Scoped to the signed-in user explicitly. RLS is a ceiling, not a filter:
      // its policies are OR'd, so a branch admin is permitted to read every
      // transaction in their branch. Without this the admin's personal list
      // rendered the whole branch as though it were their own.
      let query = supabase.from('transactions').select('*').eq('user_id', session.user.id);
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (term !== '') {
        query = query.or(transactionSearchFilter(term));
      }
      if (cursor !== null) {
        query = query.or(afterCursorFilter('created_at', cursor));
      }
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE + 1);
      if (error) {
        return null;
      }
      return pageOf(data as Transaction[], (row) => ({ at: row.created_at, id: row.id }));
    },
    [session?.user, statusFilter, term],
  );

  const load = useCallback(async () => {
    const loadNumber = ++latestLoad.current;
    const page = await fetchPage(null);
    if (loadNumber !== latestLoad.current) {
      return;
    }
    if (page === null) {
      setLoadError('Your transactions could not be loaded.');
      // Left as it was so the error state renders instead of an empty list.
      return;
    }
    setLoadError(null);
    setMoreError(null);
    setTransactions(page.rows);
    setNextCursor(page.nextCursor);
    if (term === '' && statusFilter === 'all') {
      setHasAny(page.rows.length > 0);
    } else if (page.rows.length > 0) {
      setHasAny(true);
    } else {
      // Searched before the unfiltered list ever arrived: keep the controls up
      // with "no match" rather than a spinner that cannot resolve.
      setHasAny((current) => current ?? true);
    }
  }, [fetchPage, term, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (nextCursor === null || loadingMore) {
      return;
    }
    const loadNumber = latestLoad.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchPage(nextCursor);
      // The search changed while this page was loading: it belongs to the old list.
      if (loadNumber !== latestLoad.current) {
        return;
      }
      if (page === null) {
        setMoreError('More transactions could not be loaded. Try again.');
        return;
      }
      setTransactions((current) => [...(current ?? []), ...page.rows]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, nextCursor, loadingMore]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const filtering = term !== '' || statusFilter !== 'all';

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

  if (transactions === null || hasAny === null) {
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

  // The search and filter controls are hidden until there is something to
  // search. Offering a filter over an empty list is noise, and it pushes the
  // explanation of what the screen is for below the fold.
  if (!hasAny && !filtering) {
    return (
      <Screen resetScrollOnFocus onRefresh={refresh} refreshing={refreshing}>
        <ScreenHeading
          title="Transactions"
          subtitle="Review your recent fee calculations and invoice statuses."
        />
        <EmptyState
          icon="receipt-long"
          title="No transactions yet"
          body="When you calculate a fee and generate an invoice, it appears here so you can upload your client's payment slip and follow it to the certificate."
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

      {transactions.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>No transactions match your search.</Text>
        </Card>
      ) : (
        <>
          {transactions.map((transaction) => (
            <TransactionCard key={transaction.id} transaction={transaction} />
          ))}
          {moreError !== null ? <Text style={styles.errorText}>{moreError}</Text> : null}
          {nextCursor !== null ? (
            <Button
              label="Load More Transactions"
              variant="outline"
              loading={loadingMore}
              onPress={loadMore}
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
          {transaction.invoice_number ?? 'No reference yet'} -{' '}
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

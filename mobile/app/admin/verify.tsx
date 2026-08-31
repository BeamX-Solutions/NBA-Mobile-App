import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Field';
import { Screen, ScreenHeading } from '@/components/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAuth } from '@/lib/auth-context';
import type { Transaction } from '@/lib/database.types';
import { documentTypeLabels } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, spacing, statusStyles } from '@/theme/tokens';
import type { TransactionStatus } from '@/theme/tokens';

interface QueueRow extends Transaction {
  profiles: { full_name: string; scn: string | null } | null;
}

const filterOptions = [
  { value: 'pending_verification' as const, label: 'Awaiting my review' },
  { value: 'verified' as const, label: 'Verified' },
  { value: 'rejected' as const, label: 'Rejected' },
  { value: 'all' as const, label: 'All statuses' },
];

/**
 * Branch administrator's verification queue.
 *
 * This is the half of the product without which nothing completes: a
 * transaction cannot reach verified, and no BAIN or certificate is ever
 * issued, until an administrator acts here.
 *
 * SPEC.md section 2 puts bulk verification on the web portal, and that is
 * still the right home for reviewing many payments at a desk. This exists
 * because a branch with no portal access at all cannot operate, and because
 * the mobile flow is untestable end to end without it.
 *
 * Access is enforced by RLS, not by this screen: the policies restrict
 * transactions to the administrator's own branch, so a non-admin who reached
 * this route would simply see nothing.
 */
export default function VerificationQueueScreen() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<TransactionStatus | 'all'>('pending_verification');

  const isAdmin = profile?.role === 'branch_admin' || profile?.role === 'super_admin';

  const load = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    let query = supabase
      .from('transactions')
      // The foreign key has to be named: transactions references profiles
      // twice, through user_id and through verified_by, so an unqualified
      // profiles(...) embed is ambiguous and PostgREST rejects the whole
      // query with PGRST201 rather than choosing one.
      .select('*, profiles!transactions_user_id_fkey(full_name, scn)')
      .order('created_at', { ascending: true });

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;
    if (error) {
      setLoadError('The verification queue could not be loaded.');
      return;
    }
    setLoadError(null);
    setRows(data as QueueRow[]);
  }, [isAdmin, filter]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!isAdmin) {
    return (
      <Screen>
        <EmptyState
          icon="lock-outline"
          title="Administrators only"
          body="This queue is for branch administrators, who review proof of payment and issue certificates. Your account does not have that role."
        />
      </Screen>
    );
  }

  if (loadError !== null) {
    return (
      <Screen onRefresh={refresh} refreshing={refreshing}>
        <ScreenHeading title="Verification Queue" />
        <ErrorState body={loadError} onRetry={load} />
      </Screen>
    );
  }

  if (rows === null) {
    return (
      <Screen>
        <ScreenHeading title="Verification Queue" />
        <LoadingState label="Loading the queue" />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeading
        title="Verification Queue"
        subtitle="Review proof of payment submitted by practitioners in your branch."
      />

      <SelectField
        label=""
        placeholder="Awaiting my review"
        value={filter}
        onChange={setFilter}
        options={filterOptions}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={filter === 'pending_verification' ? 'Nothing to review' : 'Nothing here'}
          body={
            filter === 'pending_verification'
              ? 'When a practitioner in your branch uploads proof of payment, it appears here for review.'
              : 'No transactions match this filter.'
          }
        />
      ) : (
        rows.map((row) => <QueueCard key={row.id} row={row} />)
      )}
    </Screen>
  );
}

function QueueCard({ row }: { row: QueueRow }) {
  const status = statusStyles[row.status];
  const waitingDays = Math.floor(
    (Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/admin/review/${row.id}`)}>
      <Card style={styles.card} accentColor={status.accent}>
        <View style={styles.cardHeader}>
          <Text style={styles.practitioner}>{row.profiles?.full_name ?? 'Unknown practitioner'}</Text>
          <StatusBadge status={row.status} />
        </View>

        <Text style={styles.meta}>
          {row.profiles?.scn ?? 'No SCN'} - {documentTypeLabels[row.document_type]}
        </Text>
        <Text style={styles.meta}>{row.parties}</Text>

        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.amountLabel}>Amount payable</Text>
            <Text style={styles.amount}>{formatNaira(row.amount_payable)}</Text>
          </View>
          {row.status === 'pending_verification' ? (
            <View style={styles.waiting}>
              <MaterialIcons name="schedule" size={14} color={palette.textMuted} />
              <Text style={styles.waitingText}>
                {waitingDays === 0 ? 'Today' : `${waitingDays}d waiting`}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  practitioner: {
    flex: 1,
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  meta: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.md,
  },
  amountLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
  },
  amount: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
  },
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  waitingText: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
  },
});

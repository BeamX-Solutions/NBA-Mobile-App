import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DetailRow, Screen, SectionTitle, SettingsRow } from '@/components/ui/Screen';
import { ConfirmDialog } from '@/components/ui/States';
import { useAuth } from '@/lib/auth-context';
import type { Branch, Subscription } from '@/lib/database.types';
import { formatNaira } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, spacing } from '@/theme/tokens';

const planLabels: Record<Subscription['plan'], string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export default function ProfileScreen() {
  const { profile, signOut } = useAuth();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchResult, subscriptionResult] = await Promise.all([
        profile?.branch_id
          ? supabase.from('branches').select('*').eq('id', profile.branch_id).single()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('subscriptions')
          .select('*')
          .eq('status', 'active')
          .order('expires_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      setBranch((branchResult.data as Branch | null) ?? null);
      setSubscription((subscriptionResult.data as Subscription | null) ?? null);
    } finally {
      setLoading(false);
    }
  }, [profile?.branch_id]);

  useEffect(() => {
    load();
  }, [load]);

  if (profile === null) {
    return (
      <Screen scroll={false} style={styles.centered}>
        <ActivityIndicator color={palette.primary} size="large" />
      </Screen>
    );
  }

  return (
    <Screen resetScrollOnFocus>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <MaterialIcons name="person" size={44} color={palette.textMuted} />
        </View>
        <Text style={styles.name}>{profile.full_name || 'Practitioner'}</Text>
        <Text style={styles.subline}>
          {profile.scn ?? 'No SCN recorded'}
          {branch !== null ? ` - ${branch.name}` : ''}
        </Text>
      </View>

      <Card style={styles.card}>
        <SectionTitle icon="work-outline" underline>
          Professional Details
        </SectionTitle>
        <DetailRow label="Full Name" value={profile.full_name || 'Not set'} />
        <DetailRow label="Supreme Court Number" value={profile.scn ?? 'Not set'} />
        <DetailRow label="Branch" value={branch?.name ?? 'No branch affiliation'} />
        <DetailRow label="State of Practice" value={profile.practice_state ?? 'Not set'} />
        <DetailRow label="Email" value={profile.email} />
      </Card>

      <Card style={styles.card}>
        <SectionTitle icon="workspace-premium" underline>
          Subscription Status
        </SectionTitle>
        {loading ? (
          <ActivityIndicator color={palette.primary} />
        ) : subscription === null ? (
          <View>
            <Text style={styles.noSubscription}>
              You do not have an active subscription. Fee calculations remain free. A subscription
              is required to generate receipts and certificates.
            </Text>
          </View>
        ) : (
          <View>
            <View style={styles.planRow}>
              <Text style={styles.planName}>
                {planLabels[subscription.plan]}
                {subscription.rate_type === 'branch_discounted' ? ' (Branch rate)' : ''}
              </Text>
              <Badge label="Active" />
            </View>
            <DetailRow
              label="Amount Paid"
              value={formatNaira(subscription.amount)}
            />
            <DetailRow
              label="Expiry Date"
              value={new Date(subscription.expires_at).toLocaleDateString()}
            />
          </View>
        )}
        <Button
          label={subscription === null ? 'Choose a Plan' : 'Renew Now'}
          onPress={() => router.push('/subscription/plans')}
          style={styles.renew}
        />
      </Card>

      <Card style={styles.card}>
        <SectionTitle icon="settings" underline>
          Account Settings
        </SectionTitle>
        <SettingsRow
          icon="edit"
          label="Edit Profile"
          onPress={() => router.push('/profile/edit')}
        />
        {/* Only administrators see the queue. RLS is the real gate: a
            practitioner who reached the route would see an empty list. */}
        {profile?.role === 'branch_admin' || profile?.role === 'super_admin' ? (
          <SettingsRow
            icon="fact-check"
            label="Verification Queue"
            onPress={() => router.push('/admin/verify')}
          />
        ) : null}
        <SettingsRow
          icon="notifications-none"
          label="Notification Settings"
          onPress={() => router.push('/settings/notifications')}
        />
        <SettingsRow
          icon="security"
          label="Security"
          onPress={() => router.push('/settings/security')}
        />
        <SettingsRow
          icon="help-outline"
          label="Help & Support"
          onPress={() => router.push('/settings/help')}
        />
      </Card>

      <Button
        label="Log Out"
        variant="danger"
        onPress={() => setConfirmingLogout(true)}
        style={styles.logout}
      />

      <ConfirmDialog
        visible={confirmingLogout}
        destructive
        title="Log out?"
        body="You will need your email and password to sign in again. Any certificates already issued stay available once you return."
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        busy={loggingOut}
        onCancel={() => setConfirmingLogout(false)}
        onConfirm={async () => {
          setLoggingOut(true);
          await signOut();
          // No need to reset state or navigate: clearing the session flips the
          // guard in the root layout and this screen unmounts.
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 20,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 2,
    borderColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  renew: {
    marginTop: spacing.lg,
  },
  name: {
    fontSize: fontSize.heading,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  subline: {
    fontSize: fontSize.label,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  card: {
    marginBottom: spacing.lg,
  },
  planRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  planName: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  noSubscription: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    lineHeight: 22,
  },
  logout: {
    marginTop: spacing.sm,
  },
});

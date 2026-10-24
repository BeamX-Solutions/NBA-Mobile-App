import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { formatNaira } from '@/lib/money';
import { findPlan } from '@/lib/plans';
import { fontFamily, fontSize, fontWeight, palette, spacing } from '@/theme/tokens';

/**
 * What a plan costs, and where to buy it.
 *
 * Apple and Google reject an app that sells a digital subscription through
 * anything but their own in-app purchase (SPEC.md, section 2). So this screen
 * sells nothing and links nowhere: subscriptions are bought on the NBA
 * Calculator website, through Paystack, and the app reads the result. This is
 * the "reader app" pattern, and it is compliant only as long as the screen
 * carries no purchase button and no link to one.
 *
 * Entitlement still comes from the server alone: the subscription a
 * practitioner buys on the website appears here because the database says
 * so, not because this screen was told.
 */
export default function PaymentScreen() {
  const { plan: planId } = useLocalSearchParams<{ plan: string }>();
  const plan = planId === undefined ? undefined : findPlan(planId);

  if (plan === undefined) {
    return (
      <Screen>
        <Card>
          <Text style={styles.error}>That plan could not be found.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card style={styles.summary}>
        <Text style={styles.summaryLabel}>SELECTED PLAN</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryName}>{plan.name}</Text>
          <Text style={styles.summaryPrice}>{formatNaira(plan.amount)}</Text>
        </View>
        <Text style={styles.summaryPeriod}>{plan.perMonthHint}</Text>
      </Card>

      <Card style={styles.notice}>
        <View style={styles.noticeHeader}>
          <MaterialIcons name="language" size={22} color={palette.primary} />
          <Text style={styles.noticeTitle}>Subscribe on the NBA Calculator website</Text>
        </View>
        <Text style={styles.noticeBody}>
          Subscriptions are not sold in this app. Sign in to the NBA Calculator website with this
          account and choose your plan there.
        </Text>
        <Text style={styles.noticeBody}>
          Once your payment is confirmed, your subscription appears here automatically.
        </Text>
      </Card>

      <Button label="Back" variant="outline" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    marginBottom: spacing.lg,
  },
  summaryLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    letterSpacing: 0.5,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: spacing.xs,
  },
  summaryName: {
    fontSize: fontSize.heading,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  summaryPrice: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
  },
  summaryPeriod: {
    fontSize: fontSize.label,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  notice: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  noticeTitle: {
    flex: 1,
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  noticeBody: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    lineHeight: 21,
  },
  error: {
    fontSize: fontSize.body,
    color: palette.danger,
    textAlign: 'center',
  },
});

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { formatNaira } from '@/lib/money';
import { findPlan } from '@/lib/plans';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

type PaymentMethod = 'card' | 'transfer' | 'ussd';

const methods: {
  id: PaymentMethod;
  label: string;
  description: string;
  icon: 'credit-card' | 'account-balance' | 'dialpad';
  tags?: string[];
}[] = [
  {
    id: 'card',
    label: 'Debit/Credit Card',
    description: 'Secure payment via Paystack integration',
    icon: 'credit-card',
    tags: ['VISA', 'MASTERCARD', 'VERVE'],
  },
  {
    id: 'transfer',
    label: 'Bank Transfer',
    description: 'Direct transfer to official NBA account',
    icon: 'account-balance',
  },
  {
    id: 'ussd',
    label: 'USSD',
    description: 'Quick code payment from your mobile device',
    icon: 'dialpad',
  },
];

export default function PaymentScreen() {
  const { plan: planId } = useLocalSearchParams<{ plan: string }>();
  const plan = findPlan(planId ?? 'standard');
  const [method, setMethod] = useState<PaymentMethod>('card');

  if (plan === undefined) {
    return (
      <Screen>
        <Card>
          <Text style={styles.error}>That plan could not be found.</Text>
        </Card>
      </Screen>
    );
  }

  function handlePay() {
    // Payment is not wired up. Charging a card requires the Paystack
    // integration and a server side webhook to grant entitlement, which is
    // Phase 3 (SPEC.md). Entitlement must never be granted from the client:
    // a subscription the app activates locally is one any user can activate.
    router.push({
      pathname: '/result',
      params: {
        title: 'Payment not yet available',
        message:
          'Card payment is not connected yet. Your subscription will activate once payment is confirmed by the server.',
      },
    });
  }

  return (
    <Screen>
      <Card style={styles.summary}>
        <Text style={styles.summaryLabel}>SELECTED PLAN</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryName}>{plan.name}</Text>
          <View style={styles.summaryPriceRow}>
            <Text style={styles.summaryPrice}>{formatNaira(plan.amount)}</Text>
            <Text style={styles.summaryPeriod}>/year</Text>
          </View>
        </View>
      </Card>

      <Text style={styles.sectionLabel}>Select Payment Option</Text>

      {methods.map((option) => {
        const selected = method === option.id;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => setMethod(option.id)}>
            <Card style={[styles.method, selected && styles.methodSelected]}>
              <View style={styles.methodHeader}>
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
                <Text style={styles.methodLabel}>{option.label}</Text>
                <MaterialIcons name={option.icon} size={22} color={palette.textMuted} />
              </View>
              <Text style={styles.methodDescription}>{option.description}</Text>
              {option.tags !== undefined ? (
                <View style={styles.tags}>
                  {option.tags.map((tag) => (
                    <View key={tag} style={styles.tag}>
                      <Text style={styles.tagLabel}>{tag}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          </Pressable>
        );
      })}

      <View style={styles.secured}>
        <MaterialIcons name="lock-outline" size={16} color={palette.textMuted} />
        <Text style={styles.securedText}>Secured by Paystack</Text>
      </View>

      <Button label={`Pay Now ${formatNaira(plan.amount)}`} onPress={handlePay} />
      <Button
        label="Cancel"
        variant="outline"
        onPress={() => router.back()}
        style={styles.cancel}
      />
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
  summaryPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
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
  },
  sectionLabel: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
    marginBottom: spacing.md,
  },
  method: {
    marginBottom: spacing.md,
  },
  methodSelected: {
    borderColor: palette.primary,
    borderWidth: 2,
    backgroundColor: palette.surfaceMuted,
  },
  methodHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: palette.primary,
  },
  radioDot: {
    width: 11,
    height: 11,
    borderRadius: radius.pill,
    backgroundColor: palette.primary,
  },
  methodLabel: {
    flex: 1,
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  methodDescription: {
    fontSize: fontSize.label,
    color: palette.textMuted,
    marginTop: spacing.xs,
    marginLeft: 34,
  },
  tags: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginLeft: 34,
  },
  tag: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tagLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    letterSpacing: 0.5,
  },
  secured: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginVertical: spacing.lg,
  },
  securedText: {
    fontSize: fontSize.label,
    color: palette.textMuted,
  },
  cancel: {
    marginTop: spacing.md,
    borderWidth: 0,
  },
  error: {
    fontSize: fontSize.body,
    color: palette.danger,
    textAlign: 'center',
  },
});

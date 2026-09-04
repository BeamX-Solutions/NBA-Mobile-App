import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { formatNaira } from '@/lib/money';
import { planOptions, subscriptionIncludes, type PlanOption } from '@/lib/plans';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

export default function PlansScreen() {
  const [selected, setSelected] = useState<string>('standard');

  return (
    <Screen>
      <View style={styles.heading}>
        <Text style={styles.title}>Choose Your Plan</Text>
        <Text style={styles.subtitle}>
          Choose how long you want to subscribe for. Every plan includes the same
          services, so the only difference is the term.
        </Text>
      </View>

      {/* Placeholder figures, not the branch's. See lib/plans.ts. */}
      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          Pricing is provisional and not yet confirmed by the NBA.
        </Text>
      </View>

      {/* Listed once rather than repeated on each card, because the plans
          differ only in duration. Repeating an identical list four times would
          suggest the plans differ in what they buy. */}
      <Card style={styles.includes}>
        <Text style={styles.includesTitle}>Every plan includes</Text>
        {subscriptionIncludes.map((line) => (
          <View key={line} style={styles.featureRow}>
            <MaterialIcons name="check-circle-outline" size={18} color={palette.success} />
            <Text style={styles.featureLabel}>{line}</Text>
          </View>
        ))}
      </Card>

      {planOptions.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          selected={selected === plan.id}
          onSelect={() => setSelected(plan.id)}
        />
      ))}

      <Button
        label="Continue to Payment"
        onPress={() =>
          router.push({ pathname: '/subscription/payment', params: { plan: selected } })
        }
        style={styles.continue}
      />
    </Screen>
  );
}

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: PlanOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onSelect}>
      <Card style={[styles.card, selected && styles.cardSelected]}>
        {plan.highlighted ? (
          <View style={styles.popular}>
            <Text style={styles.popularLabel}>Best value</Text>
          </View>
        ) : null}

        <Text style={styles.planName}>{plan.name}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatNaira(plan.amount)}</Text>
        </View>
        {/* Every plan buys the same thing, so the only comparison that helps
            is what each duration works out to per month. */}
        <Text style={styles.period}>{plan.perMonthHint}</Text>

        <Button
          label={selected ? `${plan.name} selected` : `Select ${plan.name}`}
          variant={selected ? 'primary' : 'outline'}
          onPress={onSelect}
        />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.heading,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  notice: {
    backgroundColor: palette.accentSurface,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: radius.input,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeText: {
    fontSize: fontSize.caption,
    color: palette.accentText,
    textAlign: 'center',
  },
  card: {
    marginBottom: spacing.lg,
  },
  cardSelected: {
    borderColor: palette.primary,
    borderWidth: 2,
  },
  popular: {
    position: 'absolute',
    top: -12,
    alignSelf: 'center',
    backgroundColor: palette.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  popularLabel: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.textInverse,
  },
  planName: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.xs,
  },
  price: {
    fontSize: fontSize.display,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
  },
  period: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    marginLeft: spacing.xs,
  },
  includes: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  includesTitle: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: palette.textMuted,
    marginBottom: spacing.xs,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  featureLabel: {
    flex: 1,
    fontSize: fontSize.body,
    color: palette.text,
  },
  continue: {
    marginTop: spacing.sm,
  },
});

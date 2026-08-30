import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { formatNaira } from '@/lib/money';
import { planOptions, type PlanOption } from '@/lib/plans';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

export default function PlansScreen() {
  const [selected, setSelected] = useState<string>('standard');

  return (
    <Screen>
      <View style={styles.heading}>
        <Text style={styles.title}>Choose Your Plan</Text>
        <Text style={styles.subtitle}>
          Select a subscription to access premium features and official certification.
        </Text>
      </View>

      {/* Pricing here is provisional. See lib/plans.ts and DESIGN_REVIEW.md
          item 1: the mockups and the brief disagree by 18x on a different
          pricing axis, and nobody has settled which is correct. */}
      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          Pricing is provisional and not yet confirmed by the NBA.
        </Text>
      </View>

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
  const isFree = plan.amount === 0;

  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onSelect}>
      <Card style={[styles.card, selected && styles.cardSelected]}>
        {plan.highlighted ? (
          <View style={styles.popular}>
            <Text style={styles.popularLabel}>Most Popular</Text>
          </View>
        ) : null}

        <Text style={styles.planName}>{plan.name}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{isFree ? 'Free' : formatNaira(plan.amount)}</Text>
          {isFree ? null : <Text style={styles.period}>/year</Text>}
        </View>

        <View style={styles.features}>
          {plan.features.map((feature) => (
            <View key={feature.label} style={styles.featureRow}>
              <MaterialIcons
                name={feature.included ? 'check-circle-outline' : 'cancel'}
                size={18}
                color={feature.included ? palette.success : palette.textDisabled}
              />
              <Text
                style={[styles.featureLabel, !feature.included && styles.featureLabelExcluded]}>
                {feature.label}
              </Text>
            </View>
          ))}
        </View>

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
  features: {
    marginVertical: spacing.md,
    gap: spacing.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  featureLabel: {
    fontSize: fontSize.body,
    color: palette.text,
  },
  featureLabelExcluded: {
    color: palette.textDisabled,
  },
  continue: {
    marginTop: spacing.sm,
  },
});

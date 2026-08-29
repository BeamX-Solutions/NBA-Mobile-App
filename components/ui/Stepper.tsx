import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, Text, View } from 'react-native';

import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * Progress indicator from the Upload Proof mockup: completed steps show a
 * tick, the current step shows its number, and later steps are greyed.
 *
 * @param current 1-based index of the step in progress
 */
export function Stepper({ current, total }: { current: number; total: number }) {
  const steps = Array.from({ length: total }, (_, index) => index + 1);

  return (
    <View style={styles.row} accessibilityRole="progressbar">
      {steps.map((step) => {
        const done = step < current;
        const active = step === current;
        return (
          <View key={step} style={styles.segment}>
            <View
              style={[
                styles.connector,
                (done || active) && styles.connectorActive,
                step === 1 && styles.connectorFirst,
              ]}
            />
            <View style={[styles.dot, (done || active) && styles.dotActive]}>
              {done ? (
                <MaterialIcons name="check" size={14} color={palette.textInverse} />
              ) : (
                <Text style={[styles.dotLabel, active && styles.dotLabelActive]}>{step}</Text>
              )}
            </View>
          </View>
        );
      })}
      <View style={styles.connector} />
    </View>
  );
}

const DOT = 28;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  connector: {
    flex: 1,
    height: 2,
    backgroundColor: palette.border,
  },
  connectorActive: {
    backgroundColor: palette.primary,
  },
  connectorFirst: {
    maxWidth: 24,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.xs,
  },
  dotActive: {
    backgroundColor: palette.primary,
  },
  dotLabel: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.textMuted,
  },
  dotLabelActive: {
    color: palette.textInverse,
  },
});

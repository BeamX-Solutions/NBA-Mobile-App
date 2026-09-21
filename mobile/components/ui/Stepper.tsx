import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * Progress through the three stages of a transaction: completed stages show a
 * tick, the stage in progress shows its number in a ring, and later stages are
 * greyed.
 *
 * The track starts at the first step and ends at the last. An earlier version
 * hung a stub of line off both ends, which read as two invisible stages either
 * side of the three real ones. Connectors are drawn only between steps now, so
 * the line spans exactly what it describes.
 *
 * @param current 1-based index of the step in progress
 * @param labels one short caption per step; its length is the number of steps
 */
export function Stepper({ current, labels }: { current: number; labels: readonly string[] }) {
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: labels.length, now: current }}
      accessibilityLabel={`Step ${current} of ${labels.length}: ${labels[current - 1] ?? ''}`}>
      {labels.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;

        return (
          <Fragment key={label}>
            {index > 0 ? (
              <View style={[styles.connector, step <= current && styles.connectorDone]} />
            ) : null}

            <View style={styles.step}>
              <View style={[styles.ring, active && styles.ringActive]}>
                <View style={[styles.dot, (done || active) && styles.dotDone]}>
                  {done ? (
                    <MaterialIcons name="check" size={15} color={palette.textInverse} />
                  ) : (
                    <Text style={[styles.number, active && styles.numberOnFill]}>{step}</Text>
                  )}
                </View>
              </View>
              <Text
                style={[styles.label, (done || active) && styles.labelDone]}
                numberOfLines={2}>
                {label}
              </Text>
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

const DOT = 28;
const RING = 4;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    // Steps carry a caption under the dot, so they are not the same height as
    // the connectors. Aligning to the top lets the connector be nudged down to
    // the middle of the dots rather than the middle of the whole row.
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  step: {
    width: 84,
    alignItems: 'center',
  },
  connector: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: palette.border,
    marginTop: RING + (DOT - 2) / 2,
    marginHorizontal: spacing.xs,
  },
  connectorDone: {
    backgroundColor: palette.primary,
  },
  ring: {
    padding: RING,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  ringActive: {
    backgroundColor: palette.primarySurface,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  number: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.textMuted,
  },
  numberOnFill: {
    color: palette.textInverse,
  },
  label: {
    marginTop: spacing.xs,
    fontSize: fontSize.caption,
    fontFamily: fontFamily.bodyMedium,
    fontWeight: fontWeight.medium,
    color: palette.textMuted,
    textAlign: 'center',
  },
  labelDone: {
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
  },
});

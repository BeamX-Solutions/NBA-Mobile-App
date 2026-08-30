import { StyleSheet, Text, View } from 'react-native';

import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';
import { statusStyles, type TransactionStatus } from '@/theme/tokens';

/** Status pill used on the transaction cards. */
export function StatusBadge({ status }: { status: TransactionStatus }) {
  const style = statusStyles[status];
  return (
    <View style={[styles.badge, { backgroundColor: style.surface }]}>
      <Text style={[styles.text, { color: style.text }]}>{style.label}</Text>
    </View>
  );
}

/** Generic pill, used for the certificate year and "Official Issue" markers. */
export function Badge({
  label,
  surface = palette.successSurface,
  color = palette.success,
}: {
  label: string;
  surface?: string;
  color?: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: surface }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
  },
});

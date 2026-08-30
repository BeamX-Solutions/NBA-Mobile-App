import { StyleSheet, View, type ViewProps } from 'react-native';

import { palette, radius, spacing } from '@/theme/tokens';

/**
 * White surface card with the soft border used across every mockup screen.
 * An optional accent stripe down the left edge marks status, as on the
 * transaction cards.
 */
export function Card({
  accentColor,
  style,
  children,
  ...rest
}: ViewProps & { accentColor?: string }) {
  return (
    <View
      {...rest}
      style={[
        styles.card,
        accentColor !== undefined && { borderLeftWidth: 4, borderLeftColor: accentColor },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
  },
});

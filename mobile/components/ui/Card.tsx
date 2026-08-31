import { StyleSheet, View, type ViewProps } from 'react-native';

import { palette, radius, spacing } from '@/theme/tokens';

/**
 * White surface card with the soft border used across every screen.
 *
 * There is deliberately no accent stripe. Status is already carried by the
 * badge on the card, and repeating it as a coloured left edge said the same
 * thing a second time in a heavier voice, which turned a list of cards into a
 * column of stripes. The prop was removed rather than defaulted off, so it
 * cannot quietly come back.
 */
export function Card({ style, children, ...rest }: ViewProps) {
  return (
    <View {...rest} style={[styles.card, style]}>
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

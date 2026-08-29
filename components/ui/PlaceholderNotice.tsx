import { StyleSheet, Text, View } from 'react-native';

import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * Shown wherever a figure derived from the placeholder scale is displayed.
 *
 * This is a safety control, not decoration. Until the real Schedule to the
 * Order is loaded, every fee this app shows is invented. A practitioner who
 * quoted a client from an unmarked screen would be relying on a number with
 * no legal basis, so the warning stays visible rather than being dismissible.
 * Delete this component only when the real rates are in place.
 */
export function PlaceholderNotice() {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>Provisional figures</Text>
      <Text style={styles.body}>
        These rates are placeholders for development and are not the published Schedule to the
        Remuneration Order. Do not rely on them to quote a client.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.accentSurface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: palette.accent,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.accentText,
    marginBottom: spacing.xs,
  },
  body: {
    fontSize: fontSize.caption,
    color: palette.accentText,
    lineHeight: 17,
  },
});

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * The "Action Successful" screen from the mockups, generalised so any flow
 * can land on it. Pass title, message and an optional reference through the
 * query string.
 */
export default function ResultScreen() {
  const { title, message, reference } = useLocalSearchParams<{
    title?: string;
    message?: string;
    reference?: string;
  }>();

  const stamp = new Date().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Screen style={styles.screen}>
      <View style={styles.icon}>
        <MaterialIcons name="check" size={54} color={palette.primary} />
      </View>

      <Text style={styles.title}>{title ?? 'Action Successful'}</Text>
      <Text style={styles.message}>
        {message ?? 'Your changes have been securely saved and processed by the system.'}
      </Text>

      {reference !== undefined ? (
        <Card style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Reference ID</Text>
            <Text style={styles.rowValue}>{reference}</Text>
          </View>
          <View style={[styles.row, styles.rowLast]}>
            <Text style={styles.rowLabel}>Date &amp; Time</Text>
            <Text style={styles.rowValue}>{stamp}</Text>
          </View>
        </Card>
      ) : null}

      <Button
        label="Continue to Dashboard"
        onPress={() => router.dismissTo('/(tabs)')}
        style={styles.action}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    width: 110,
    height: 110,
    borderRadius: 26,
    backgroundColor: palette.successSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: fontSize.display,
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
    textAlign: 'center',
  },
  message: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 22,
  },
  card: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    paddingVertical: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    gap: spacing.md,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowLabel: {
    fontSize: fontSize.label,
    color: palette.textMuted,
  },
  rowValue: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
    letterSpacing: 0.5,
  },
  action: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    borderRadius: radius.button,
  },
});

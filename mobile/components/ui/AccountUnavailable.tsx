import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { PRODUCT_NAME } from '@/lib/branding';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * Shown when there is a session but the profile behind it could not be read.
 *
 * The role and membership status on the profile decide what this app shows,
 * so without it there is nothing safe to render. This used to leave the user
 * on the loading spinner forever. Signing them out instead would log
 * practitioners out on every passing network failure, so they get a retry,
 * and a way out if retrying keeps failing. The web app has the same screen.
 */
export function AccountUnavailable({
  onRetry,
  onSignOut,
  busy,
}: {
  onRetry: () => Promise<void>;
  onSignOut: () => void;
  busy?: boolean;
}) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.iconCircle}>
        <MaterialIcons name="error-outline" size={40} color={palette.danger} />
      </View>

      <Text style={styles.title}>Account unavailable</Text>

      <Text style={styles.body}>
        We could not confirm your account details. Check your connection and try
        again. If this keeps happening, sign out and sign in again.
      </Text>

      <View style={styles.actions}>
        <Button label="Try again" loading={retrying} onPress={retry} />
        <Button label="Sign out" variant="outline" loading={busy} onPress={onSignOut} />
      </View>

      <Text style={styles.footnote}>{PRODUCT_NAME}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: palette.background,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: palette.dangerSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 21,
  },
  actions: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
    gap: spacing.md,
  },
  footnote: {
    fontSize: fontSize.caption,
    color: palette.textDisabled,
    marginTop: spacing.xxl,
  },
});

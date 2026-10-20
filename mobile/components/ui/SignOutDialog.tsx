import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * Asks before signing out, the same way here, in the practitioner web app and
 * in the admin console.
 *
 * Calm on purpose. Signing out loses nothing (signing back in is the undo),
 * so it is not dressed as a warning: a neutral icon, one line, and Cancel and
 * Sign out side by side in the app's ordinary green.
 */
export function SignOutDialog({
  visible,
  busy = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.dialog} accessibilityRole="alert">
          <View style={styles.iconCircle}>
            <MaterialIcons name="logout" size={24} color={palette.primary} />
          </View>
          <Text style={styles.title}>Sign out?</Text>
          <Text style={styles.body}>You'll need your email and password to sign back in.</Text>

          <View style={styles.actions}>
            <Button label="Cancel" variant="outline" disabled={busy} onPress={onCancel} style={styles.action} />
            <Button label="Sign out" loading={busy} onPress={onConfirm} style={styles.action} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: palette.scrim,
  },
  wrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  dialog: {
    backgroundColor: palette.surface,
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: palette.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
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
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  action: {
    flex: 1,
  },
});

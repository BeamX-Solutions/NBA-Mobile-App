import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

type IconName = ComponentProps<typeof MaterialIcons>['name'];

/**
 * Shown when a list legitimately has nothing in it.
 *
 * A new practitioner sees this before they see anything else, so it carries
 * the explanation of what the screen is for and the action that fills it,
 * rather than just saying "nothing here".
 */
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.block}>
      <View style={styles.iconCircle}>
        <MaterialIcons name={icon} size={40} color={palette.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {actionLabel !== undefined && onAction !== undefined ? (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Shown when a fetch failed, as distinct from succeeding with no rows.
 *
 * The distinction matters: "you have no transactions yet" and "we could not
 * load your transactions" call for completely different responses from the
 * user, and conflating them makes an outage look like an empty account.
 */
export function ErrorState({
  title = 'Something went wrong',
  body,
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.block}>
      <View style={[styles.iconCircle, styles.iconCircleError]}>
        <MaterialIcons name="cloud-off" size={40} color={palette.danger} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>
        {body ?? 'Check your connection and try again. Nothing has been lost.'}
      </Text>
      {onRetry !== undefined ? (
        <View style={styles.action}>
          <Button label="Try again" variant="outline" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

/** Centred spinner for first load, where there is nothing to show yet. */
export function LoadingState({ label }: { label?: string }) {
  return (
    <View style={styles.block}>
      <ActivityIndicator color={palette.primary} size="large" />
      {label !== undefined ? <Text style={[styles.body, styles.loadingLabel]}>{label}</Text> : null}
    </View>
  );
}

/**
 * Confirmation before something the user cannot undo.
 *
 * Used for logging out and for submitting proof of payment. Submission is
 * genuinely irreversible from the practitioner's side: once a transaction
 * moves to pending_verification the database blocks further edits, so the
 * only way back is for a branch admin to reject it.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel} />
      <View style={styles.dialogWrap} pointerEvents="box-none">
        <View style={styles.dialog}>
          <View style={[styles.iconCircle, destructive && styles.iconCircleError]}>
            <MaterialIcons
              name={destructive ? 'warning-amber' : 'help-outline'}
              size={32}
              color={destructive ? palette.danger : palette.primary}
            />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>

          <View style={styles.dialogActions}>
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              loading={busy}
              onPress={onConfirm}
            />
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              disabled={busy}
              hitSlop={8}
              style={styles.cancel}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: palette.successSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  iconCircleError: {
    backgroundColor: palette.dangerSurface,
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
  loadingLabel: {
    marginTop: spacing.md,
  },
  action: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  backdrop: {
    // Spelled out rather than spreading StyleSheet.absoluteFillObject, which
    // React Native 0.86 removed. Its replacement, absoluteFill, is a
    // registered style rather than a plain object, so it cannot be spread to
    // add a background colour alongside it.
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: palette.scrim,
  },
  dialogWrap: {
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
  dialogActions: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
  },
  cancel: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
  },
  cancelText: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.textMuted,
  },
});

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Screen, ScreenHeading } from '@/components/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAuth } from '@/lib/auth-context';
import {
  notificationPresentation,
  parseNotification,
  type InboxNotification,
} from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { refreshUnreadCount } from '@/lib/unread-notifications';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

const PAGE_SIZE = 50;
const SUBTITLE = 'Updates about your account, payments and certificates.';
const MARK_ERROR = 'This could not be marked as read. Check your connection and try again.';

/**
 * The inbox: newest first. Opening a notification marks it read and goes to
 * what it is about; the rows themselves are written by database triggers.
 */
export default function NotificationsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [notifications, setNotifications] = useState<InboxNotification[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (userId === null) return;
    const { data, error } = await supabase
      .from('notifications')
      .select('id, kind, title, body, link, created_at, read_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);

    if (error) {
      setLoadError('Your notifications could not be loaded.');
      return;
    }
    const now = new Date();
    setLoadError(null);
    setNotifications(
      (data ?? [])
        .map((row) => parseNotification(row, now))
        .filter((row): row is InboxNotification => row !== null),
    );
  }, [userId]);

  // Reloaded on every visit, so returning from a transaction shows it read.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    if (userId !== null) await refreshUnreadCount(userId);
    setRefreshing(false);
  }, [load, userId]);

  const markRead = useCallback(
    async (ids: string[] | null): Promise<boolean> => {
      const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids });
      if (userId !== null) await refreshUnreadCount(userId);
      return !error;
    },
    [userId],
  );

  const open = useCallback(
    async (notification: InboxNotification) => {
      setActionError(null);
      setBusy(true);
      try {
        const marked = notification.read || (await markRead([notification.id]));
        // A failed mark should not stop someone reaching what it is about.
        if (notification.route !== null) {
          router.push(notification.route);
          return;
        }
        if (!marked) {
          setActionError(MARK_ERROR);
          return;
        }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load, markRead],
  );

  const markAll = useCallback(async () => {
    setActionError(null);
    setBusy(true);
    try {
      if (!(await markRead(null))) {
        setActionError(MARK_ERROR);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }, [load, markRead]);

  if (loadError !== null) {
    return (
      <Screen onRefresh={refresh} refreshing={refreshing}>
        <ScreenHeading title="Notifications" subtitle={SUBTITLE} />
        <ErrorState body={loadError} onRetry={load} />
      </Screen>
    );
  }

  if (notifications === null) {
    return (
      <Screen>
        <ScreenHeading title="Notifications" subtitle={SUBTITLE} />
        <LoadingState label="Loading your notifications" />
      </Screen>
    );
  }

  if (notifications.length === 0) {
    return (
      <Screen onRefresh={refresh} refreshing={refreshing}>
        <ScreenHeading title="Notifications" subtitle={SUBTITLE} />
        <EmptyState
          icon="notifications-none"
          title="No notifications yet"
          body="You will be told here when your branch approves your account, reviews a payment or issues a certificate."
        />
      </Screen>
    );
  }

  const hasUnread = notifications.some((notification) => !notification.read);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeading title="Notifications" subtitle={SUBTITLE} />

      {hasUnread ? (
        <Pressable
          accessibilityRole="button"
          onPress={markAll}
          disabled={busy}
          hitSlop={8}
          style={styles.markAll}>
          <Text style={[styles.markAllLabel, busy && styles.disabled]}>Mark all as read</Text>
        </Pressable>
      ) : null}

      {actionError !== null ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {actionError}
        </Text>
      ) : null}

      <Card style={styles.list}>
        {notifications.map((notification, index) => (
          <NotificationRow
            key={notification.id}
            notification={notification}
            last={index === notifications.length - 1}
            disabled={busy}
            onPress={() => open(notification)}
          />
        ))}
      </Card>
    </Screen>
  );
}

function NotificationRow({
  notification,
  last,
  disabled,
  onPress,
}: {
  notification: InboxNotification;
  last: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { icon, tone } = notificationPresentation(notification.kind);
  const danger = tone === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${notification.read ? '' : 'Unread. '}${notification.title}. ${notification.body}. ${notification.when}`}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        !notification.read && styles.rowUnread,
        last && styles.rowLast,
        pressed && styles.rowPressed,
      ]}>
      <View style={[styles.iconCircle, danger ? styles.iconDanger : styles.iconSuccess]}>
        <MaterialIcons name={icon} size={22} color={danger ? palette.danger : palette.primary} />
      </View>
      <View style={styles.rowText}>
        <View style={styles.titleLine}>
          <Text style={[styles.title, !notification.read && styles.titleUnread]}>
            {notification.title}
          </Text>
          {notification.read ? null : <View style={styles.dot} />}
        </View>
        <Text style={styles.body}>{notification.body}</Text>
        <Text style={styles.when}>{notification.when}</Text>
      </View>
    </Pressable>
  );
}

const ICON_SIZE = 40;
const DOT_SIZE = 8;

const styles = StyleSheet.create({
  markAll: {
    alignSelf: 'flex-end',
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  markAllLabel: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.primary,
  },
  disabled: {
    opacity: 0.6,
  },
  actionError: {
    fontSize: fontSize.label,
    color: palette.danger,
    backgroundColor: palette.dangerSurface,
    borderRadius: radius.input,
    padding: spacing.md,
    marginBottom: spacing.md,
    lineHeight: 19,
  },
  list: {
    padding: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  rowUnread: {
    backgroundColor: palette.primarySurface,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowPressed: {
    backgroundColor: palette.surfaceMuted,
  },
  iconCircle: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSuccess: {
    backgroundColor: palette.successSurface,
  },
  iconDanger: {
    backgroundColor: palette.dangerSurface,
  },
  rowText: {
    flex: 1,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSize.body,
    fontFamily: fontFamily.body,
    color: palette.text,
  },
  titleUnread: {
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: radius.pill,
    backgroundColor: palette.primary,
    marginTop: 7,
  },
  body: {
    fontSize: fontSize.label,
    color: palette.textMuted,
    marginTop: spacing.xs,
    lineHeight: 19,
  },
  when: {
    fontSize: fontSize.caption,
    color: palette.textDisabled,
    marginTop: spacing.xs,
  },
});

import type MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { Href } from 'expo-router';
import type { ComponentProps } from 'react';

import type { NotificationKind } from '@/lib/database.types';

type IconName = ComponentProps<typeof MaterialIcons>['name'];

/**
 * Notifications as the inbox shows them.
 *
 * The rows are written by database triggers with their title and body already
 * worded, and shared with the web app, so this only validates them, decides
 * how each kind looks, and turns the stored link (a web app path) into a
 * route in this app.
 */

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'membership_approved',
  'membership_rejected',
  'payment_rejected',
  'certificate_issued',
  'share_paid',
  'certificate_revoked',
  'certificate_restored',
];

export interface InboxNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Where tapping it goes in this app, or null when it leads nowhere. */
  route: Href | null;
  /** "Just now", "5 min ago", "Yesterday", or a date. */
  when: string;
  read: boolean;
}

export type NotificationTone = 'success' | 'danger';

const presentation: Record<NotificationKind, { icon: IconName; tone: NotificationTone }> = {
  membership_approved: { icon: 'how-to-reg', tone: 'success' },
  membership_rejected: { icon: 'person-off', tone: 'danger' },
  payment_rejected: { icon: 'error-outline', tone: 'danger' },
  certificate_issued: { icon: 'verified', tone: 'success' },
  share_paid: { icon: 'payments', tone: 'success' },
  certificate_revoked: { icon: 'gpp-bad', tone: 'danger' },
  certificate_restored: { icon: 'verified-user', tone: 'success' },
};

export function notificationPresentation(kind: NotificationKind) {
  return presentation[kind];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The stored link is a web app path. Only the paths the triggers write are
 * recognised; anything else leads nowhere rather than somewhere unexpected.
 *
 * /membership has no route here: the root layout already shows a pending or
 * rejected member their membership screen in place of the app.
 */
export function mobileRouteFor(link: unknown): Href | null {
  if (typeof link !== 'string') return null;
  if (link === '/' || link === '/membership') return '/(tabs)';
  if (link === '/profile/edit') return '/profile/edit';

  const match = /^\/(transactions|certificates)\/([^/?#]+)$/.exec(link);
  if (match === null || !UUID.test(match[2])) return null;
  const id = match[2];
  return match[1] === 'transactions'
    ? { pathname: '/transaction/[id]', params: { id } }
    : { pathname: '/certificate/[id]', params: { id } };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function relativeTime(createdAt: Date, now: Date): string {
  const elapsed = now.getTime() - createdAt.getTime();
  if (elapsed < MINUTE) return 'Just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < 24 * HOUR) return `${Math.floor(elapsed / HOUR)} h ago`;
  if (elapsed < 48 * HOUR) return 'Yesterday';
  return createdAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  });
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Validates a row from the notifications table; a malformed one is dropped, not shown. */
export function parseNotification(value: unknown, now: Date): InboxNotification | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const kind = row.kind;
  if (typeof row.id !== 'string' || !UUID.test(row.id)) return null;
  if (typeof kind !== 'string' || !NOTIFICATION_KINDS.includes(kind as NotificationKind)) return null;
  const title = text(row.title);
  const body = text(row.body);
  if (title === null || body === null || typeof row.created_at !== 'string') return null;
  const createdAt = new Date(row.created_at);
  if (Number.isNaN(createdAt.getTime())) return null;
  if (row.read_at !== null && typeof row.read_at !== 'string') return null;
  return {
    id: row.id,
    kind: kind as NotificationKind,
    title,
    body,
    route: mobileRouteFor(row.link),
    when: relativeTime(createdAt, now),
    read: row.read_at !== null,
  };
}

/** "9+" past nine, as the header badge shows it; empty when there is nothing unread. */
export function unreadBadge(count: number): string {
  if (!Number.isInteger(count) || count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

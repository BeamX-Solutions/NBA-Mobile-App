import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * The unread count behind the header's bell.
 *
 * Every screen mounts its own AppHeader, so the count lives here, once, rather
 * than in each header: a header that mounts asks for a refresh, a second
 * request for the same user while one is in flight shares it, and every
 * header reads the same number. It is keyed by user so a count left over from
 * the previous account never shows after signing in as someone else.
 */

interface Snapshot {
  userId: string | null;
  count: number;
}

let snapshot: Snapshot = { userId: null, count: 0 };
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-reads the count. A failed read shows no badge rather than an error. */
export function refreshUnreadCount(userId: string): Promise<void> {
  const pending = inFlight.get(userId);
  if (pending !== undefined) return pending;

  const request = (async () => {
    try {
      // RLS already limits this to the user's own rows; the filter says so
      // explicitly, as every personal query here does.
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null);
      publish({ userId, count: error ? 0 : (count ?? 0) });
    } catch {
      publish({ userId, count: 0 });
    } finally {
      inFlight.delete(userId);
    }
  })();
  inFlight.set(userId, request);
  return request;
}

/** The signed-in user's unread count, refreshed on mount and when the app returns to the foreground. */
export function useUnreadCount(): number {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const current = useSyncExternalStore(subscribe, () => snapshot);

  useEffect(() => {
    if (userId === null) return;
    refreshUnreadCount(userId);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshUnreadCount(userId);
    });
    return () => subscription.remove();
  }, [userId]);

  return userId !== null && current.userId === userId ? current.count : 0;
}

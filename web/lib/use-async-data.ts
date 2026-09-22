"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Load data once on mount, and again on demand.
 *
 * Every console screen needs the same three things: fetch on mount, hold the
 * result, and refetch after a mutation. Each screen had written that out by
 * hand as a `load` callback invoked from an effect, and that shape is the one
 * react-hooks/set-state-in-effect rejects: an effect that calls something
 * which updates state is a cascading render, whether or not the update happens
 * after an await, because the lint cannot see across the async boundary.
 *
 * The pattern the rule does accept is the one its own message describes,
 * subscribing to something external and updating state from a callback. That
 * is what this is. The fetcher is handed in and is required to be pure in the
 * React sense: it fetches and returns, and updates no state of its own. Only
 * this hook writes state, and only from inside the promise callback.
 *
 * `fetcher` must be stable, so wrap it in useCallback in the caller. An inline
 * arrow would be a new function on every render and would refetch forever.
 *
 * The `alive` flag is not ceremony. These screens are navigated away from
 * while a query is in flight, and React unmounts the component without
 * cancelling the request; without the flag the response lands on a component
 * that no longer exists and React warns about an update on an unmounted tree.
 */
export function useAsyncData<T>(fetcher: () => Promise<T>): {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Refetch. Safe to call from an event handler; not from an effect. */
  reload: () => Promise<void>;
  /** Replace the held data without a round trip. */
  set: (next: T) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No setLoading(true) here. It would be the one genuinely synchronous
    // state update in this effect, and it is not needed: loading starts true,
    // and a refetch through reload keeps the previous rows on screen rather
    // than blanking the table, which is what you want after a mutation.
    let alive = true;

    fetcher().then(
      (next) => {
        if (!alive) return;
        setData(next);
        setError(null);
        setLoading(false);
      },
      (cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      },
    );

    return () => {
      alive = false;
    };
  }, [fetcher]);

  const reload = useCallback(async () => {
    try {
      setData(await fetcher());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [fetcher]);

  return { data, error, loading, reload, set: setData };
}

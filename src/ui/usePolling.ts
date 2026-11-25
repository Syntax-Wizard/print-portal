/**
 * Poll an async source while the tab is visible.
 * Hidden tabs stop polling so many open tabs don't burden the printer's small web server.
 */

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export interface Polled<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  updatedAt: Date | undefined;
  refresh: () => Promise<void>;
  /** Publish data fetched elsewhere (e.g. by job tracking), saving a duplicate request. */
  push: (value: T) => void;
}

export function usePolling<T>(load: () => Promise<T>, intervalMs: number): Polled<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const loadRef = useRef(load);
  loadRef.current = load;
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const value = await loadRef.current();
        setData(value);
        setError(undefined);
        setUpdatedAt(new Date());
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState === "hidden") return;
      timer = setTimeout(async () => {
        await refresh();
        schedule();
      }, intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh().then(schedule);
      else clearTimeout(timer);
    };
    void refresh().then(schedule);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, refresh]);

  const push = useCallback((value: T) => {
    setData(value);
    setError(undefined);
    setLoading(false);
    setUpdatedAt(new Date());
  }, []);

  return { data, error, loading, updatedAt, refresh, push };
}

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { schedulingApi, type ApiProblem } from '@/lib/scheduling/dashboard/api';

// Loads one API resource and lets the caller reload it after a change. The last good data stays on screen while a reload is
// running, so a table never blanks out under a user who is about to click. A failed load keeps the previous data too and
// reports the problem, so the screen can offer "Try again" without losing its place.

export type LoadState = 'loading' | 'ready' | 'error';

export interface SchedulingData<T> {
  state: LoadState;
  data: T | null;
  problem: ApiProblem | null;
  /** True while a reload is running behind data that is already shown. */
  refreshing: boolean;
  reload: () => void;
}

export function useSchedulingData<T>(path: string | null): SchedulingData<T> {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<T | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const hasData = useRef(false);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      if (hasData.current) setRefreshing(true);
      else setState('loading');
      try {
        const result = await schedulingApi<T>('GET', path, undefined, controller.signal);
        if (cancelled) return;
        if (result.ok) {
          hasData.current = true;
          setData(result.data);
          setProblem(null);
          setState('ready');
        } else {
          setProblem(result.problem);
          setState(hasData.current ? 'ready' : 'error');
        }
      } catch {
        // aborted: a newer load or an unmount replaced this one
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  return { state, data, problem, refreshing, reload };
}

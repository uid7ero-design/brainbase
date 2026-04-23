'use client';

import { useState, useEffect } from 'react';

export function useWeather() {
  const [state, setState] = useState({ loading: true, current: null, forecast: [] });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/weather');
        if (!res.ok) throw new Error('fetch_failed');
        const data = await res.json();
        if (!cancelled) setState({ loading: false, ...data });
      } catch {
        if (!cancelled) setState(s => ({ ...s, loading: false }));
      }
    }

    load();
    const t = setInterval(load, 10 * 60 * 1000); // refresh every 10 min
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return state;
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const POLL_INTERVAL = 5000;

export function useSpotify() {
  const [state, setState] = useState({
    connected: false,
    loading: true,
    isPlaying: false,
    track: null,
  });
  const intervalRef = useRef(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/now-playing', {
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) {
        if (mountedRef.current) setState(s => ({ ...s, loading: false }));
        return;
      }
      const data = await res.json();
      if (mountedRef.current) setState({ ...data, loading: false });
    } catch {
      if (mountedRef.current) setState(s => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(intervalRef.current);
    };
  }, [poll]);

  const getDeviceId = useCallback(async () => {
    try {
      const res  = await fetch('/api/spotify/devices', { credentials: 'same-origin' });
      const data = await res.json();
      const devices = data.devices ?? [];
      // Prefer the active device, otherwise take the first available
      const active = devices.find((d) => d.is_active) ?? devices[0] ?? null;
      return active?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  const control = useCallback(async (action, extraBody = {}) => {
    try {
      const body = { action, ...extraBody };
      // For play, attach a device_id so Spotify knows where to send audio
      if (action === 'play' && !extraBody.device_id) {
        const deviceId = await getDeviceId();
        if (deviceId) body.device_id = deviceId;
      }
      await fetch('/api/spotify/control', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTimeout(poll, 700);
    } catch {
      // ignore
    }
  }, [poll, getDeviceId]);

  const connect = useCallback(async () => {
    const res = await fetch('/api/spotify/login', { credentials: 'same-origin' });
    const data = await res.json();
    if (data.error) {
      console.error('[Spotify]', data.error);
      alert('Spotify config error: ' + data.error);
      return;
    }
    if (data.url) window.location.href = data.url;
  }, []);

  const search = useCallback(async (query) => {
    if (!query?.trim()) return [];
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.tracks ?? [];
    } catch {
      return [];
    }
  }, []);

  const playUri = useCallback(async (uri) => {
    await control('play', { uri });
  }, [control]);

  const toggle = useCallback(() => {
    control(state.isPlaying ? 'pause' : 'play');
  }, [control, state.isPlaying]);

  const play  = useCallback(() => control('play'),     [control]);
  const pause = useCallback(() => control('pause'),    [control]);
  const next  = useCallback(() => control('next'),     [control]);
  const prev  = useCallback(() => control('prev'),     [control]);

  return { ...state, connect, toggle, play, pause, next, prev, search, playUri };
}

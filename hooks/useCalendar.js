'use client';
import { useState, useEffect, useCallback } from 'react';

export function useCalendar() {
  const [connected,  setConnected]  = useState(false);
  const [accounts,   setAccounts]   = useState([]);   // list of emails
  const [events,     setEvents]     = useState([]);
  const [loading,    setLoading]    = useState(true);

  const checkStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/integrations/gcal/status');
      const d = await r.json();
      setConnected(d.connected);
      setAccounts(d.accounts ?? []);
    } catch {}
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const r = await fetch('/api/integrations/gcal/events');
      if (!r.ok) return;
      const d = await r.json();
      setEvents(d.events ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await checkStatus();
      setLoading(false);
    }
    init();
  }, [checkStatus]);

  useEffect(() => {
    if (!connected) return;
    fetchEvents();
    const id = setInterval(fetchEvents, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [connected, fetchEvents]);

  const connect = useCallback(async () => {
    const r = await fetch('/api/integrations/gcal/login');
    const d = await r.json();
    if (d.url) window.location.href = d.url;
  }, []);

  const disconnect = useCallback(async (email) => {
    const url = email
      ? `/api/integrations/gcal/status?email=${encodeURIComponent(email)}`
      : '/api/integrations/gcal/status';
    await fetch(url, { method: 'DELETE' });
    await checkStatus();
    await fetchEvents();
  }, [checkStatus, fetchEvents]);

  const createEvent = useCallback(async ({ title, date, time, duration = 60 }) => {
    const r = await fetch('/api/integrations/gcal/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, date, time, duration }),
    });
    if (r.ok) await fetchEvents();
    return r.ok;
  }, [fetchEvents]);

  return { connected, accounts, events, loading, connect, disconnect, createEvent, refresh: fetchEvents };
}

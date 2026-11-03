'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/app';
import CoachingTimetable from '@/app/dashboard/sessions/page';
import { COACHING_FAILURE, COACHING_LOCK, clearCoachingLock, coachingWritePending } from '@/lib/tennisBusiness/coachingFetch';
export default function CoachingRecovery() {
  const [mode, setMode] = useState<'checking' | 'ready' | 'review'>('checking');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const failed = () => setMode('review');
    window.addEventListener(COACHING_FAILURE, failed);
    // Browser-only recovery state is read after hydration, before mounting any write-capable controls.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setMode(sessionStorage.getItem(COACHING_LOCK) ? 'review' : 'ready'); } catch { setMode('review'); }
    return () => window.removeEventListener(COACHING_FAILURE, failed);
  }, []);
  async function review() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (coachingWritePending()) throw new Error('Wait for the current change to finish, then review again.');
      for (const [path, field] of [['sessions?include_archived=1', 'sessions'], ['sessions/instances', 'instances'], ['players', 'contacts']]) {
        const response = await fetch('/api/business/tennis/coaching/' + path, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error('Saved coaching records are unavailable. Check your access and try again.');
        const data = await response.json();
        if (!Array.isArray(data[field])) throw new Error('Saved coaching records could not be confirmed.');
      }
      clearCoachingLock(); setMode('ready');
    } catch (error) { setError(error instanceof Error ? error.message : 'Review failed. Changes remain locked.'); }
    finally { setBusy(false); }
  }
  if (mode === 'checking') return <p role="status">Checking saved coaching state…</p>;
  if (mode === 'ready') return <CoachingTimetable />;
  return <section aria-label="Coaching recovery"><h1>Review the saved timetable</h1><p role="alert">A read failed or a change could not be confirmed. Do not repeat the change until you have checked the saved sessions and bookings.</p><p>Review reloads saved records. It does not repeat the original booking or attendance change.</p>{error && <p role="alert">{error}</p>}<Button disabled={busy} onClick={review}>{busy ? 'Checking saved records…' : 'Review saved timetable'}</Button></section>;
}

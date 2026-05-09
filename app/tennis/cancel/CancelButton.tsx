'use client';

import { useState } from 'react';

export default function CancelButton({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleCancel() {
    setState('loading');
    try {
      const res = await fetch('/api/tennis/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setState('done');
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error ?? 'Something went wrong');
        setState('error');
      }
    } catch {
      setErrorMsg('Network error — please try again.');
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div className="text-center py-4">
        <p className="text-green-400 font-semibold mb-2">Request cancelled</p>
        <p className="text-sm text-zinc-500 mb-5">We've noted your cancellation. Feel free to re-enquire at any time.</p>
        <a href="/tennis" className="text-sm text-zinc-400 hover:text-white transition-colors">← Back to LD Tennis</a>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="text-center py-4">
        <p className="text-red-400 font-medium mb-2">{errorMsg}</p>
        <button onClick={() => setState('idle')} className="text-sm text-zinc-400 hover:text-white transition-colors">Try again</button>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <button
        onClick={handleCancel}
        disabled={state === 'loading'}
        className="flex-1 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 font-semibold px-5 py-2.5 rounded-full transition-colors text-sm disabled:opacity-50"
      >
        {state === 'loading' ? 'Cancelling…' : 'Yes, cancel my request'}
      </button>
      <a
        href="/tennis"
        className="flex-1 text-center bg-white/4 text-zinc-400 border border-white/8 hover:border-white/16 hover:text-white font-medium px-5 py-2.5 rounded-full transition-colors text-sm"
      >
        Keep my request
      </a>
    </div>
  );
}

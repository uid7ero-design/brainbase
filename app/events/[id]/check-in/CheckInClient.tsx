'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import jsQR from 'jsqr';
import { ArrowLeft, Camera, Search, CheckCircle2, XCircle, RotateCcw, Undo2 } from 'lucide-react';
import {
  FONT, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, VIOLET_SOFT, BORDER,
  Panel, primaryBtnStyle, secondaryBtnStyle, inputStyle, EventsSharedStyles,
} from '../../_components/ui';

type Attendee = {
  id: string;
  attendee_name: string;
  ticket_type_name: string | null;
  session_name: string | null;
  checked_in_at: string | null;
};

type Identifier = { ticket_token: string } | { attendee_id: string };

type ResultState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'preview'; attendee: Attendee; identifier: Identifier }
  | { kind: 'confirmed'; attendee: Attendee; first: boolean }
  | { kind: 'error'; message: string; reason?: string };

// jsQR decodes raw pixel data (no built-in camera/UI layer, unlike
// heavier all-in-one scanner packages) — this component drives the
// getUserMedia -> <video> -> <canvas> -> ImageData -> jsQR loop itself
// via requestAnimationFrame, giving full control over start/stop and
// the manual-fallback UI sitting alongside it.
export default function CheckInClient({ eventId }: { eventId: string }) {
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [result, setResult] = useState<ResultState>({ kind: 'idle' });
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDecodedRef = useRef<string | null>(null);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Attendee[] | null>(null);
  const [searching, setSearching] = useState(false);

  function stopScanning() {
    setScanning(false);
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  useEffect(() => () => stopScanning(), []); // camera cleanup on unmount

  async function startScanning() {
    setCameraError(null);
    lastDecodedRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      tick();
    } catch {
      setCameraError('Could not access the camera. Use manual search instead.');
    }
  }

  function tick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code?.data && code.data !== lastDecodedRef.current) {
          lastDecodedRef.current = code.data;
          stopScanning();
          void doResolve({ ticket_token: extractToken(code.data) });
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  // The QR encodes a full ticket URL (see lib/events/qr.ts) — extract
  // just the token (the last path segment) so this works whether the
  // decoded value is a URL or, defensively, a bare token string.
  function extractToken(decoded: string): string {
    try {
      const parts = new URL(decoded).pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || decoded;
    } catch {
      return decoded.trim();
    }
  }

  async function doResolve(identifier: Identifier) {
    setResult({ kind: 'loading' });
    try {
      const res = await fetch(`/api/events/${eventId}/check-in/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(identifier),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ kind: 'error', message: body.error ?? 'Ticket not valid.', reason: body.reason });
        return;
      }
      setResult({ kind: 'preview', attendee: body.attendee, identifier });
    } catch {
      setResult({ kind: 'error', message: 'Network error. Please try again.' });
    }
  }

  async function doConfirm() {
    if (result.kind !== 'preview') return;
    const identifier = result.identifier;
    try {
      const res = await fetch(`/api/events/${eventId}/check-in/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(identifier),
      });
      const body = await res.json().catch(() => ({}));
      if (body.attendee) {
        setResult({ kind: 'confirmed', attendee: body.attendee, first: !!body.first });
      } else {
        setResult({ kind: 'error', message: body.error ?? 'Check-in failed.', reason: body.reason });
      }
    } catch {
      setResult({ kind: 'error', message: 'Network error. Please try again.' });
    }
  }

  async function doUndo(attendeeId: string, name: string) {
    if (!window.confirm(`Undo check-in for ${name}? They will be marked as not checked in.`)) return;
    try {
      const res = await fetch(`/api/events/${eventId}/check-in/undo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendee_id: attendeeId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error ?? 'Failed to undo check-in.');
        return;
      }
      resetToIdle();
      if (mode === 'manual') void runSearch(query);
    } catch {
      alert('Network error.');
    }
  }

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/events/${eventId}/check-in/search?q=${encodeURIComponent(trimmed)}`);
      const body = await res.json().catch(() => ({}));
      setSearchResults(body.attendees ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (mode !== 'manual') return;
    const t = setTimeout(() => { void runSearch(query); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode]);

  function resetToIdle() {
    setResult({ kind: 'idle' });
    lastDecodedRef.current = null;
  }

  function switchMode(next: 'scan' | 'manual') {
    stopScanning();
    resetToIdle();
    setMode(next);
  }

  return (
    <div style={{ padding: 32, fontFamily: FONT, color: TEXT_PRIMARY, maxWidth: 560, margin: '0 auto' }}>
      <EventsSharedStyles />
      <Link href={`/events/${eventId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: VIOLET_SOFT, fontSize: 12.5, textDecoration: 'none', marginBottom: 16, fontWeight: 600 }}>
        <ArrowLeft size={13} /> Back to event
      </Link>

      <h1 style={{ fontSize: 21, fontWeight: 700, margin: '0 0 16px', letterSpacing: '-.01em' }}>Check-in</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => switchMode('scan')}
          style={{ ...(mode === 'scan' ? primaryBtnStyle : secondaryBtnStyle), flex: 1, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Camera size={16} /> Scan QR
        </button>
        <button
          onClick={() => switchMode('manual')}
          style={{ ...(mode === 'manual' ? primaryBtnStyle : secondaryBtnStyle), flex: 1, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Search size={16} /> Manual search
        </button>
      </div>

      {mode === 'scan' && result.kind !== 'preview' && result.kind !== 'confirmed' && (
        <Panel style={{ marginBottom: 16 }}>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
            <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: scanning ? 'block' : 'none' }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            {!scanning && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <button onClick={startScanning} style={{ ...primaryBtnStyle, minHeight: 52, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Camera size={18} /> Start camera
                </button>
              </div>
            )}
          </div>
          {cameraError && <div role="alert" style={{ color: '#FCA5A5', fontSize: 13, marginTop: 10 }}>{cameraError}</div>}
          {scanning && (
            <div style={{ marginTop: 10, textAlign: 'center' }}>
              <button onClick={stopScanning} style={{ ...secondaryBtnStyle, minHeight: 40 }}>Stop camera</button>
            </div>
          )}
        </Panel>
      )}

      {mode === 'manual' && result.kind !== 'preview' && result.kind !== 'confirmed' && (
        <Panel style={{ marginBottom: 16 }}>
          <input
            value={query} onChange={e => setQuery(e.target.value)} placeholder="Search attendee name…"
            className="bb-evt-input" style={{ ...inputStyle, minHeight: 48, fontSize: 15, width: '100%' }}
            autoFocus
          />
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {searching && <div style={{ fontSize: 13, color: TEXT_MUTED }}>Searching…</div>}
            {!searching && searchResults !== null && searchResults.length === 0 && (
              <div style={{ fontSize: 13, color: TEXT_MUTED }}>No attendees match &ldquo;{query}&rdquo;.</div>
            )}
            {searchResults?.map(a => (
              <div key={a.id} className="bb-evt-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', background: 'rgba(255,255,255,.02)', border: `1px solid ${BORDER}`, borderRadius: 10 }}>
                <button
                  onClick={() => void doResolve({ attendee_id: a.id })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flex: 1, minHeight: 44, color: TEXT_PRIMARY, fontFamily: FONT }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{a.attendee_name}</div>
                  <div style={{ fontSize: 12, color: a.checked_in_at ? '#4ADE80' : TEXT_MUTED, marginTop: 2 }}>
                    {a.checked_in_at ? `Checked in · ${new Date(a.checked_in_at).toLocaleTimeString()}` : 'Not checked in'}
                  </div>
                </button>
                {a.checked_in_at && (
                  <button
                    onClick={() => void doUndo(a.id, a.attendee_name)}
                    aria-label={`Undo check-in for ${a.attendee_name}`}
                    style={{ minHeight: 40, minWidth: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT_SECONDARY, cursor: 'pointer' }}
                  >
                    <Undo2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {result.kind === 'loading' && (
        <Panel style={{ textAlign: 'center', padding: 40 }}><span style={{ color: TEXT_MUTED, fontSize: 14 }}>Looking up ticket…</span></Panel>
      )}

      {result.kind === 'preview' && (
        <Panel style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: VIOLET_SOFT, marginBottom: 10 }}>Confirm attendee</div>
          <AttendeeSummary attendee={result.attendee} />
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button onClick={resetToIdle} style={{ ...secondaryBtnStyle, flex: 1, minHeight: 52, fontSize: 15 }}>Cancel</button>
            <button onClick={() => void doConfirm()} style={{ ...primaryBtnStyle, flex: 1, minHeight: 52, fontSize: 15 }}>Confirm check-in</button>
          </div>
        </Panel>
      )}

      {result.kind === 'confirmed' && (
        <Panel style={{ textAlign: 'center' }}>
          <ResultBanner
            tone={result.first ? 'success' : 'warning'}
            icon={result.first ? <CheckCircle2 size={40} /> : <RotateCcw size={40} />}
            title={result.first ? 'Checked in' : 'Already checked in'}
          />
          <AttendeeSummary attendee={result.attendee} />
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            {!result.first && (
              <button onClick={() => void doUndo(result.attendee.id, result.attendee.attendee_name)} style={{ ...secondaryBtnStyle, flex: 1, minHeight: 52, fontSize: 15 }}>
                Undo check-in
              </button>
            )}
            <button onClick={() => { resetToIdle(); if (mode === 'scan') void startScanning(); }} style={{ ...primaryBtnStyle, flex: 1, minHeight: 52, fontSize: 15 }}>
              {mode === 'scan' ? 'Scan next' : 'Search again'}
            </button>
          </div>
        </Panel>
      )}

      {result.kind === 'error' && (
        <Panel style={{ textAlign: 'center' }}>
          <ResultBanner
            tone="danger"
            icon={<XCircle size={40} />}
            title={result.reason === 'cancelled' ? 'Ticket cancelled' : 'Ticket not valid'}
          />
          <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '8px 0 0' }}>{result.message}</p>
          <button onClick={resetToIdle} style={{ ...primaryBtnStyle, width: '100%', minHeight: 52, fontSize: 15, marginTop: 20 }}>Try again</button>
        </Panel>
      )}
    </div>
  );
}

function ResultBanner({ tone, icon, title }: { tone: 'success' | 'warning' | 'danger'; icon: React.ReactNode; title: string }) {
  const color = tone === 'success' ? '#4ADE80' : tone === 'warning' ? '#FBBF24' : '#F87171';
  const bg = tone === 'success' ? 'rgba(74,222,128,.12)' : tone === 'warning' ? 'rgba(251,191,36,.12)' : 'rgba(248,113,113,.12)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, color }}>
        {icon}
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color }}>{title}</div>
    </div>
  );
}

function AttendeeSummary({ attendee }: { attendee: Attendee }) {
  return (
    <div style={{ textAlign: 'left', border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SummaryRow label="Attendee" value={attendee.attendee_name} />
      {attendee.ticket_type_name && <SummaryRow label="Ticket" value={attendee.ticket_type_name} />}
      {attendee.session_name && <SummaryRow label="Session" value={attendee.session_name} />}
      {attendee.checked_in_at && <SummaryRow label="Checked in" value={new Date(attendee.checked_in_at).toLocaleString()} />}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
      <span style={{ color: TEXT_MUTED }}>{label}</span>
      <span style={{ color: TEXT_PRIMARY, fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

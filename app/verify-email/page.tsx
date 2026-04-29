'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const FONT = "var(--font-inter), -apple-system, sans-serif";

function VerifyContent() {
  const params   = useSearchParams();
  const status   = params.get('status'); // 'success' | 'invalid' | null
  const prefill  = params.get('email') ?? '';

  const [email,     setEmail]     = useState(prefill);
  const [sent,      setSent]      = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const res = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.status === 429) {
      setError('Too many requests — please wait a moment.');
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  if (status === 'success') {
    return (
      <Card>
        <Icon color="#22C55E">✓</Icon>
        <h1 style={headingStyle}>Email verified</h1>
        <p style={subStyle}>Your account is now active. You can sign in.</p>
        <Link href="/login" style={btnStyle}>Sign in</Link>
      </Card>
    );
  }

  if (status === 'invalid') {
    return (
      <Card>
        <Icon color="#EF4444">✕</Icon>
        <h1 style={headingStyle}>Link expired or invalid</h1>
        <p style={subStyle}>Verification links expire after 24 hours. Request a new one below.</p>
        {sent ? (
          <p style={{ ...subStyle, color: '#86EFAC' }}>Check your inbox — a new link is on its way.</p>
        ) : (
          <form onSubmit={resend} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              style={inputStyle}
            />
            {error && <p style={{ color: '#FCA5A5', fontSize: 13, margin: 0 }}>{error}</p>}
            <button type="submit" disabled={loading} style={btnStyle}>
              {loading ? 'Sending…' : 'Send new verification link'}
            </button>
          </form>
        )}
      </Card>
    );
  }

  // Default — arrived here without a status (e.g. from "resend" on login)
  return (
    <Card>
      <Icon color="#A78BFA">✉</Icon>
      <h1 style={headingStyle}>Check your inbox</h1>
      <p style={subStyle}>
        We sent a verification link to your email address. Click it to activate your account.
      </p>
      {sent ? (
        <p style={{ ...subStyle, color: '#86EFAC' }}>A new link has been sent.</p>
      ) : (
        <form onSubmit={resend} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <p style={{ ...subStyle, marginBottom: 4 }}>Didn't get it? Enter your email to resend:</p>
          <input
            type="email" required value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            style={inputStyle}
          />
          {error && <p style={{ color: '#FCA5A5', fontSize: 13, margin: 0 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ ...btnStyle, background: 'rgba(124,58,237,0.20)', border: '1px solid rgba(124,58,237,0.35)', color: '#C4B5FD' }}>
            {loading ? 'Sending…' : 'Resend verification link'}
          </button>
        </form>
      )}
      <Link href="/login" style={{ ...subStyle, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', display: 'block', marginTop: 20, fontSize: 12 }}>
        ← Back to sign in
      </Link>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <div style={{ background: '#08090C', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: '24px' }}>
      <Suspense>
        <VerifyContent />
      </Suspense>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', maxWidth: 400, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '40px 36px', textAlign: 'center' }}>
      {children}
    </div>
  );
}

function Icon({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ width: 52, height: 52, borderRadius: '50%', background: `${color}18`, border: `1px solid ${color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color, margin: '0 auto 20px', fontFamily: 'monospace' }}>
      {children}
    </div>
  );
}

const headingStyle: React.CSSProperties = { margin: '0 0 10px', fontSize: 20, fontWeight: 700, color: '#F4F4F5', letterSpacing: '-0.01em' };
const subStyle:     React.CSSProperties = { margin: '0 0 20px', fontSize: 14, color: 'rgba(255,255,255,0.50)', lineHeight: 1.6 };
const inputStyle:   React.CSSProperties = { width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 8, color: '#F4F4F5', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: FONT };
const btnStyle:     React.CSSProperties = { display: 'inline-block', padding: '10px 24px', background: '#7C3AED', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', fontFamily: FONT };

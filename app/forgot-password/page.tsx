'use client';
import { useState } from 'react';
import Link from 'next/link';

const FONT = "var(--font-inter), -apple-system, sans-serif";

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');

    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (res.status === 429) {
      setError('Too many requests — please wait a moment before trying again.');
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 14px',
    background: '#111318', border: '1px solid #1f2937',
    borderRadius: 8, color: '#f9fafb', fontSize: 14,
    outline: 'none', boxSizing: 'border-box', fontFamily: FONT,
  };

  return (
    <div style={{ background: '#07080B', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: '#F4F4F5' }}>
            Reset password
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
            Enter your email and we'll send you a reset link.
          </p>
        </div>

        {sent ? (
          <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.22)', borderRadius: 12, padding: '24px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: '#86EFAC' }}>Check your inbox</p>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.50)', lineHeight: 1.6 }}>
              If an account with that email exists, a reset link has been sent. It expires in 1 hour.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 500, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Email address
              </label>
              <input
                type="email" required autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@organisation.gov.au"
                style={inp}
              />
            </div>

            {error && (
              <p style={{ color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 }}>
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} style={{ padding: '11px 0', background: loading ? '#1f2937' : '#7C3AED', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', transition: 'background 0.15s', fontFamily: FONT }}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Link href="/login" style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

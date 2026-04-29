'use client';
import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

const FONT = "var(--font-inter), -apple-system, sans-serif";

function ResetContent() {
  const params  = useSearchParams();
  const router  = useRouter();
  const token   = params.get('token') ?? '';

  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [done,      setDone]      = useState(false);

  if (!token) {
    return (
      <Card>
        <h1 style={headingStyle}>Invalid link</h1>
        <p style={subStyle}>This reset link is missing or malformed. Please request a new one.</p>
        <Link href="/forgot-password" style={btnStyle}>Request new link</Link>
      </Card>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return; }

    setLoading(true); setError('');
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong.');
      setLoading(false);
      return;
    }

    setDone(true);
    setTimeout(() => router.push('/login'), 2500);
  }

  if (done) {
    return (
      <Card>
        <div style={{ fontSize: 36, marginBottom: 16 }}>✓</div>
        <h1 style={headingStyle}>Password updated</h1>
        <p style={subStyle}>Your password has been changed. Redirecting to sign in…</p>
      </Card>
    );
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 14px',
    background: '#111318', border: '1px solid #1f2937',
    borderRadius: 8, color: '#f9fafb', fontSize: 14,
    outline: 'none', boxSizing: 'border-box', fontFamily: FONT,
  };

  return (
    <Card>
      <h1 style={{ ...headingStyle, marginBottom: 6 }}>Choose a new password</h1>
      <p style={{ ...subStyle, marginBottom: 24 }}>Must be at least 8 characters.</p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' }}>
        <div>
          <label style={labelStyle}>New password</label>
          <input type="password" required autoFocus value={password} onChange={e => setPassword(e.target.value)} minLength={8} style={inp} />
        </div>
        <div>
          <label style={labelStyle}>Confirm password</label>
          <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} minLength={8} style={inp} />
        </div>

        {error && (
          <p style={{ color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} style={{ padding: '11px 0', background: loading ? '#1f2937' : '#7C3AED', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: FONT }}>
          {loading ? 'Updating…' : 'Set new password'}
        </button>
      </form>

      <div style={{ marginTop: 20 }}>
        <Link href="/login" style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)', textDecoration: 'none' }}>
          ← Back to sign in
        </Link>
      </div>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div style={{ background: '#07080B', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: '24px' }}>
      <Suspense>
        <ResetContent />
      </Suspense>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', maxWidth: 420, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '40px 36px', textAlign: 'center' }}>
      {children}
    </div>
  );
}

const FONT_FAMILY = FONT;
const headingStyle: React.CSSProperties = { margin: '0 0 10px', fontSize: 20, fontWeight: 700, color: '#F4F4F5', letterSpacing: '-0.01em', fontFamily: FONT_FAMILY };
const subStyle:     React.CSSProperties = { margin: '0 0 20px', fontSize: 14, color: 'rgba(255,255,255,0.50)', lineHeight: 1.6 };
const labelStyle:   React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 500, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const btnStyle:     React.CSSProperties = { display: 'inline-block', padding: '10px 24px', background: '#7C3AED', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', fontFamily: FONT_FAMILY };

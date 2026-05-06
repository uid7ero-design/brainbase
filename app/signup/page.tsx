'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HlnaOrb } from '@/components/brand/HlnaOrb';

const FONT = "var(--font-inter), Inter, -apple-system, sans-serif";

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  background: '#111318', border: '1px solid #1f2937',
  borderRadius: 8, color: '#f9fafb', fontSize: 14,
  outline: 'none', boxSizing: 'border-box', fontFamily: FONT,
};

const labelStyle: React.CSSProperties = {
  display: 'block', color: '#9ca3af', fontSize: 12,
  fontWeight: 500, marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.06em',
};

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', orgName: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(p => ({ ...p, [key]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }

    setPending(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:     form.name,
          email:    form.email,
          orgName:  form.orgName,
          password: form.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Signup failed.'); return; }
      router.push('/trial');
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{
      background: '#07080B', minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT,
    }}>
      <div style={{ width: '100%', maxWidth: 440, padding: '0 24px' }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <HlnaOrb size={160} state="idle" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F5F7FA', margin: '0 0 6px', letterSpacing: '-0.01em' }}>
            Start your free trial
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(167,139,250,0.60)', margin: 0 }}>
            14 days · No credit card required
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Full name</label>
            <input
              type="text" required autoFocus
              placeholder="James Palmer"
              value={form.name} onChange={set('name')}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Work email</label>
            <input
              type="email" required
              placeholder="james@council.gov.au"
              value={form.email} onChange={set('email')}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Organisation name</label>
            <input
              type="text" required
              placeholder="City of Burnside"
              value={form.orgName} onChange={set('orgName')}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password" required minLength={8}
              placeholder="Min. 8 characters"
              value={form.password} onChange={set('password')}
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Confirm password</label>
            <input
              type="password" required
              placeholder="Repeat password"
              value={form.confirm} onChange={set('confirm')}
              style={inputStyle}
            />
          </div>

          {error && (
            <p style={{
              color: '#f87171', fontSize: 13, margin: 0,
              background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
              borderRadius: 6, padding: '8px 12px',
            }}>{error}</p>
          )}

          <button
            type="submit" disabled={pending}
            style={{
              marginTop: 4, padding: '11px 0',
              background: pending ? '#1f2937' : '#7C3AED',
              color: '#fff', border: 'none', borderRadius: 8,
              fontSize: 14, fontWeight: 600,
              cursor: pending ? 'not-allowed' : 'pointer',
              fontFamily: FONT,
            }}
          >
            {pending ? 'Creating account…' : 'Start free trial →'}
          </button>
        </form>

        <p style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.30)' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: 'rgba(167,139,250,0.75)', textDecoration: 'none' }}>Sign in</Link>
        </p>

        <div style={{ marginTop: 20, textAlign: 'center', display: 'flex', gap: 16, justifyContent: 'center' }}>
          <Link href="/terms"   style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)', textDecoration: 'none' }}>Terms</Link>
          <Link href="/privacy" style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)', textDecoration: 'none' }}>Privacy</Link>
        </div>
      </div>
    </div>
  );
}

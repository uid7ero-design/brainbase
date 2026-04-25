'use client';
import { useActionState } from 'react';
import { login } from '@/app/actions/auth';

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <div style={{ background: '#07080B', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-inter), Inter, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380, padding: '0 24px' }}>

        {/* Logo / wordmark */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <svg width="52" height="52" viewBox="0 0 64 64" style={{ display: 'block', margin: '0 auto 16px' }} aria-hidden="true">
            <defs>
              <linearGradient id="login-lambda" gradientUnits="userSpaceOnUse" x1="32" y1="53.8" x2="32" y2="9">
                <stop offset="0%" stopColor="#5B21B6"/>
                <stop offset="50%" stopColor="#7C3AED"/>
                <stop offset="100%" stopColor="#C084FC"/>
              </linearGradient>
            </defs>
            <path d="M 12.2,53.8 L 32,9 L 51.8,53.8" fill="none" stroke="url(#login-lambda)" strokeWidth="8.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '.04em', color: '#F5F7FA', marginBottom: 8 }}>
            BR<span style={{ color: '#A78BFA' }}>Λ</span>INBASE
          </div>
          <p style={{ color: '#4a5568', fontSize: 13, margin: 0 }}>Sign in to continue</p>
        </div>

        <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 500, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Username
            </label>
            <input
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              style={{
                width: '100%', padding: '10px 14px', background: '#111318', border: '1px solid #1f2937',
                borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 500, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Password
            </label>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              style={{
                width: '100%', padding: '10px 14px', background: '#111318', border: '1px solid #1f2937',
                borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {state?.error && (
            <p style={{ color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 }}>
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            style={{
              marginTop: 4, padding: '11px 0', background: pending ? '#1f2937' : '#1a6aff',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: pending ? 'not-allowed' : 'pointer', transition: 'background 0.15s',
            }}
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

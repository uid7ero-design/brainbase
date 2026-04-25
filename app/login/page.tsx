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
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'radial-gradient(circle at 40% 40%, #6ee7f7, #1a6aff 60%, #0a0f2e)', margin: '0 auto 16px', boxShadow: '0 0 32px rgba(110,231,247,0.3)' }} />
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Brainbase</h1>
          <p style={{ color: '#4a5568', fontSize: 13, marginTop: 6 }}>Sign in to continue</p>
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

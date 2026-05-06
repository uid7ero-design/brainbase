'use client';
import { useState } from 'react';
import { useActionState } from 'react';
import Link from 'next/link';
import { login } from '@/app/actions/auth';
import { HlnaOrb } from '@/components/brand/HlnaOrb';

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  const [email, setEmail] = useState('');

  return (
    <div style={{
      background: '#07080B',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-inter), Inter, sans-serif',
    }}>

      <div style={{ width: '100%', maxWidth: 420, padding: '0 24px' }}>

        {/* ── Orb hero ─────────────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
            <HlnaOrb size={220} state="idle" />
          </div>
          <div style={{ marginBottom: 8 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '.12em', color: '#F5F7FA', margin: '0 0 6px', fontFamily: 'var(--font-inter), Inter, sans-serif' }}>
              HLN<span style={{ color: '#A78BFA' }}>Λ</span>
            </h1>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.18em', color: 'rgba(167,139,250,.55)', textTransform: 'uppercase', margin: '0 0 4px' }}>
              Hyper Learning Neural Agent
            </p>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, letterSpacing: '.10em', color: 'rgba(34,197,94,.70)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E', display: 'inline-block' }} />
              HLNA READY
            </span>
          </div>
        </div>

        {/* ── Email-unverified notice ───────────────────────────────────── */}
        {state?.unverified && (
          <div style={{ padding: '14px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, marginBottom: 16 }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#FCD34D', fontWeight: 600 }}>
              Email not verified
            </p>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
              Check your inbox for a verification link, or request a new one.
            </p>
            <Link href={`/verify-email${email ? `?email=${encodeURIComponent(email)}` : ''}`} style={{ fontSize: 12, color: '#A78BFA', textDecoration: 'none', fontWeight: 500 }}>
              Resend verification email →
            </Link>
          </div>
        )}

        {/* ── Sign-in form ─────────────────────────────────────────────── */}
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
              style={{ width: '100%', padding: '10px 14px', background: '#111318', border: '1px solid #1f2937', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ color: '#9ca3af', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Password
              </label>
              <Link href="/forgot-password" style={{ fontSize: 12, color: 'rgba(167,139,250,0.70)', textDecoration: 'none' }}>
                Forgot password?
              </Link>
            </div>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              onChange={e => {
                // Capture email from username field for unverified UX
                const form = (e.target as HTMLElement).closest('form') as HTMLFormElement;
                setEmail((form.elements.namedItem('username') as HTMLInputElement)?.value ?? '');
              }}
              style={{ width: '100%', padding: '10px 14px', background: '#111318', border: '1px solid #1f2937', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {state?.error && !state.unverified && (
            <p style={{ color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 }}>
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            style={{ marginTop: 4, padding: '11px 0', background: pending ? '#1f2937' : '#7C3AED', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: pending ? 'not-allowed' : 'pointer', transition: 'background 0.15s' }}
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* ── Sign up CTA ───────────────────────────────────────────────── */}
        <p style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.30)' }}>
          No account?{' '}
          <Link href="/signup" style={{ color: 'rgba(167,139,250,0.75)', textDecoration: 'none', fontWeight: 500 }}>
            Start a free 14-day trial →
          </Link>
        </p>

        {/* ── Legal footer ─────────────────────────────────────────────── */}
        <div style={{ marginTop: 16, textAlign: 'center', display: 'flex', gap: 16, justifyContent: 'center' }}>
          <Link href="/terms"   style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textDecoration: 'none' }}>Terms</Link>
          <Link href="/privacy" style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textDecoration: 'none' }}>Privacy</Link>
        </div>

      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { login } from '@/app/actions/auth';
import { OrbitalBackground } from '@/components/brand/OrbitalBackground';
import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark';

export default function LoginPage() {
  const router = useRouter();

  const [state, action, pending] = useActionState(
    login,
    undefined,
  );

  const [username, setUsername] = useState('');

  useEffect(() => {
    if (state?.redirectTo) {
      router.push(state.redirectTo);
    }
  }, [state?.redirectTo, router]);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 40,
    padding: '0 12px',

    background: 'rgba(10,12,16,.62)',

    border:
      '1px solid rgba(255,255,255,.13)',

    borderRadius: 8,

    color: '#F5F7FA',

    fontSize: 13,

    outline: 'none',

    boxSizing: 'border-box',

    transition:
      'border-color .15s, box-shadow .15s, background .15s',

    WebkitBoxShadow:
      '0 0 0 1000px rgba(10,12,16,.94) inset',

    WebkitTextFillColor: '#F5F7FA',

    caretColor: '#FFFFFF',
  };

  return (
    <main
      style={{
        minHeight: '100vh',

        background: '#07080B',

        display: 'flex',

        alignItems: 'center',

        justifyContent: 'center',

        fontFamily:
          'var(--font-inter), Inter, sans-serif',

        position: 'relative',

        overflow: 'hidden',

        padding: '24px 16px',
      }}
    >
      {/* Hybrid Orbit atmosphere — Phase D.3. Replaces the old ambient
          gradient + decorative idle HlnaOrb (purely ambient there: static
          state="idle", aria-hidden, no ref/functional wiring). intensity
          ="low" (not the default "medium") because at full strength the
          asset's own bright core glow sat directly behind the sign-in
          card, reading too close to "a giant assistant orb" for a quiet
          auth page — confirmed via live QA. */}
      <OrbitalBackground variant="field" intensity="low" placement="center" />

      {/* Content-safe vignette: darkens the centre where the form sits
          without touching OrbitalBackground itself, so the orbital field
          stays fully visible at the edges but never competes with
          readability directly behind the card. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(circle at 50% 47%, rgba(7,8,11,.68) 0%, rgba(7,8,11,.24) 30%, transparent 58%)',
        }}
      />

      <section
        style={{
          width: '100%',

          maxWidth: 430,

          position: 'relative',

          zIndex: 2,

          display: 'flex',

          flexDirection: 'column',

          alignItems: 'center',
        }}
      >
        {/* BrainBase hero */}
        <header
          style={{
            width: '100%',

            textAlign: 'center',

            marginBottom: 18,
          }}
        >
          {/* Optical centring wrapper */}
          <div
            style={{
              width: '100%',

              display: 'flex',

              justifyContent: 'center',

              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 390,

                maxWidth: '100%',

                display: 'flex',

                justifyContent: 'center',

                alignItems: 'center',

                overflow: 'visible',
              }}
            >
              <BrainBaseWordmark
                width={280}
              />
            </div>
          </div>

          {/* HLNA status */}
          <div
            style={{
              marginTop: 5,

              display: 'inline-flex',

              alignItems: 'center',

              gap: 7,

              padding: '5px 9px',

              borderRadius: 999,

              background:
                'rgba(255,255,255,.012)',

              border:
                '1px solid rgba(255,255,255,.045)',

              backdropFilter: 'blur(3px)',

              WebkitBackdropFilter:
                'blur(3px)',
            }}
          >
            <span
              style={{
                fontSize: 8,

                fontWeight: 500,

                letterSpacing: '.10em',

                textTransform: 'uppercase',

                color:
                  'rgba(255,255,255,.27)',
              }}
            >
              Powered by
            </span>

            <span
              style={{
                fontSize: 10,

                fontWeight: 700,

                letterSpacing: '.09em',

                color: '#F5F7FA',
              }}
            >
              HLN
              <span
                style={{
                  color: '#8A4DFF',
                }}
              >
                Λ
              </span>
            </span>

            <span
              style={{
                width: 4,

                height: 4,

                borderRadius: '50%',

                background: '#22C55E',

                boxShadow:
                  '0 0 5px rgba(34,197,94,.8)',
              }}
            />

            <span
              style={{
                fontSize: 8,

                fontWeight: 600,

                letterSpacing: '.08em',

                color:
                  'rgba(34,197,94,.72)',
              }}
            >
              READY
            </span>
          </div>
        </header>

        {/* Small ultra-transparent login card */}
        <div
          style={{
            width: '100%',

            maxWidth: 280,

            marginTop: 34,

            padding: '16px 16px 15px',

            borderRadius: 13,

            background:
              'linear-gradient(180deg, rgba(10,12,16,.075) 0%, rgba(10,12,16,.035) 100%)',

            border:
              '1px solid rgba(255,255,255,.065)',

            boxShadow:
              '0 16px 38px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.015)',

            backdropFilter: 'blur(1.5px)',

            WebkitBackdropFilter:
              'blur(1.5px)',
          }}
        >
          <h1
            style={{
              margin: '0 0 13px',

              fontSize: 15,

              lineHeight: 1.2,

              fontWeight: 600,

              letterSpacing: '-.02em',

              color: '#F5F7FA',
            }}
          >
            Sign in
          </h1>

          {/* Verification message */}
          {state?.unverified && (
            <div
              style={{
                padding: '9px 10px',

                marginBottom: 11,

                background:
                  'rgba(245,158,11,.035)',

                border:
                  '1px solid rgba(245,158,11,.13)',

                borderRadius: 7,
              }}
            >
              <p
                style={{
                  margin: '0 0 4px',

                  fontSize: 10,

                  fontWeight: 600,

                  color: '#FCD34D',
                }}
              >
                Email not verified
              </p>

              <p
                style={{
                  margin: '0 0 6px',

                  fontSize: 10,

                  lineHeight: 1.4,

                  color:
                    'rgba(255,255,255,.42)',
                }}
              >
                Check your inbox or request
                another verification link.
              </p>

              <Link
                href={`/verify-email${
                  username
                    ? `?email=${encodeURIComponent(
                        username,
                      )}`
                    : ''
                }`}
                style={{
                  fontSize: 9,

                  color: '#A78BFA',

                  textDecoration: 'none',

                  fontWeight: 500,
                }}
              >
                Resend verification email →
              </Link>
            </div>
          )}

          {/* Login form */}
          <form
            action={action}
            style={{
              display: 'flex',

              flexDirection: 'column',

              gap: 11,
            }}
          >
            <div>
              <label
                htmlFor="username"
                style={{
                  display: 'block',

                  marginBottom: 5,

                  fontSize: 8,

                  fontWeight: 600,

                  letterSpacing: '.07em',

                  textTransform:
                    'uppercase',

                  color:
                    'rgba(255,255,255,.48)',
                }}
              >
                Username
              </label>

              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={e =>
                  setUsername(
                    e.target.value,
                  )
                }
                style={inputStyle}
                onFocus={e => {
                  e.currentTarget.style.borderColor =
                    'rgba(138,77,255,.72)';

                  e.currentTarget.style.boxShadow =
                    '0 0 0 2px rgba(138,77,255,.07), 0 0 0 1000px rgba(10,12,16,.94) inset';
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor =
                    'rgba(255,255,255,.13)';

                  e.currentTarget.style.boxShadow =
                    '0 0 0 1000px rgba(10,12,16,.94) inset';
                }}
              />
            </div>

            <div>
              <div
                style={{
                  display: 'flex',

                  alignItems: 'center',

                  justifyContent:
                    'space-between',

                  marginBottom: 5,
                }}
              >
                <label
                  htmlFor="password"
                  style={{
                    fontSize: 8,

                    fontWeight: 600,

                    letterSpacing: '.07em',

                    textTransform:
                      'uppercase',

                    color:
                      'rgba(255,255,255,.48)',
                  }}
                >
                  Password
                </label>

                <Link
                  href="/forgot-password"
                  style={{
                    fontSize: 8,

                    color:
                      'rgba(167,139,250,.78)',

                    textDecoration: 'none',
                  }}
                >
                  Forgot password?
                </Link>
              </div>

              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                style={inputStyle}
                onFocus={e => {
                  e.currentTarget.style.borderColor =
                    'rgba(138,77,255,.72)';

                  e.currentTarget.style.boxShadow =
                    '0 0 0 2px rgba(138,77,255,.07), 0 0 0 1000px rgba(10,12,16,.94) inset';
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor =
                    'rgba(255,255,255,.13)';

                  e.currentTarget.style.boxShadow =
                    '0 0 0 1000px rgba(10,12,16,.94) inset';
                }}
              />
            </div>

            {/* Error */}
            {state?.error &&
              !state.unverified && (
                <p
                  style={{
                    margin: 0,

                    padding: '7px 9px',

                    borderRadius: 7,

                    fontSize: 10,

                    color: '#F87171',

                    background:
                      'rgba(248,113,113,.04)',

                    border:
                      '1px solid rgba(248,113,113,.12)',
                  }}
                >
                  {state.error}
                </p>
              )}

            {/* Submit */}
            <button
              type="submit"
              disabled={pending}
              style={{
                height: 40,

                marginTop: 1,

                border: 'none',

                borderRadius: 8,

                background: pending
                  ? '#242832'
                  : 'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',

                boxShadow: pending
                  ? 'none'
                  : '0 7px 18px rgba(106,61,255,.15)',

                color: '#FFFFFF',

                fontSize: 12,

                fontWeight: 600,

                cursor: pending
                  ? 'not-allowed'
                  : 'pointer',

                transition:
                  'opacity .15s, transform .15s',
              }}
              onMouseEnter={e => {
                if (!pending) {
                  e.currentTarget.style.opacity =
                    '.92';
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.opacity =
                  '1';
              }}
            >
              {pending
                ? 'Signing in…'
                : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Signup */}
        <p
          style={{
            margin: '13px 0 0',

            textAlign: 'center',

            fontSize: 9,

            color:
              'rgba(255,255,255,.23)',
          }}
        >
          New to BrainBase?{' '}
          <Link
            href="/signup"
            style={{
              color: '#A78BFA',

              textDecoration: 'none',

              fontWeight: 500,
            }}
          >
            Start free trial →
          </Link>
        </p>

        {/* Legal footer */}
        <footer
          style={{
            display: 'flex',

            justifyContent: 'center',

            gap: 14,

            marginTop: 8,
          }}
        >
          <Link
            href="/terms"
            style={{
              fontSize: 7,

              color:
                'rgba(255,255,255,.15)',

              textDecoration: 'none',
            }}
          >
            Terms
          </Link>

          <Link
            href="/privacy"
            style={{
              fontSize: 7,

              color:
                'rgba(255,255,255,.15)',

              textDecoration: 'none',
            }}
          >
            Privacy
          </Link>
        </footer>
      </section>
    </main>
  );
}
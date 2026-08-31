'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { HlnaOrb } from '@/components/brand/HlnaOrb';
import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark';

const FONT =
  'var(--font-inter), Inter, -apple-system, sans-serif';

export default function SignupPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    name: '',
    email: '',
    orgName: '',
    password: '',
    confirm: '',
  });

  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  function set(key: keyof typeof form) {
    return (
      e: React.ChangeEvent<HTMLInputElement>,
    ) => {
      setForm(previous => ({
        ...previous,
        [key]: e.target.value,
      }));
    };
  }

  async function handleSubmit(
    e: React.FormEvent,
  ) {
    e.preventDefault();

    setError('');

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        form.email.trim(),
      )
    ) {
      setError(
        'Please enter a valid email address.',
      );
      return;
    }

    if (
      form.password !==
      form.confirm
    ) {
      setError(
        'Passwords do not match.',
      );
      return;
    }

    setPending(true);

    try {
      const res = await fetch(
        '/api/auth/signup',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            name: form.name.trim(),

            email:
              form.email.trim(),

            orgName:
              form.orgName.trim(),

            password:
              form.password,
          }),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error ??
            'Signup failed.',
        );

        return;
      }

      router.push('/trial');
    } catch {
      setError(
        'Something went wrong. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',

    height: 40,

    padding: '0 12px',

    background:
      'rgba(10,12,16,.62)',

    border:
      '1px solid rgba(255,255,255,.13)',

    borderRadius: 8,

    color: '#F5F7FA',

    fontSize: 13,

    outline: 'none',

    boxSizing: 'border-box',

    fontFamily: FONT,

    transition:
      'border-color .15s, box-shadow .15s, background .15s',

    WebkitBoxShadow:
      '0 0 0 1000px rgba(10,12,16,.94) inset',

    WebkitTextFillColor:
      '#F5F7FA',

    caretColor: '#FFFFFF',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',

    marginBottom: 5,

    fontSize: 8,

    fontWeight: 600,

    letterSpacing: '.07em',

    textTransform: 'uppercase',

    color:
      'rgba(255,255,255,.48)',
  };

  function handleFocus(
    e: React.FocusEvent<HTMLInputElement>,
  ) {
    e.currentTarget.style.borderColor =
      'rgba(138,77,255,.72)';

    e.currentTarget.style.boxShadow =
      '0 0 0 2px rgba(138,77,255,.07), 0 0 0 1000px rgba(10,12,16,.94) inset';
  }

  function handleBlur(
    e: React.FocusEvent<HTMLInputElement>,
  ) {
    e.currentTarget.style.borderColor =
      'rgba(255,255,255,.13)';

    e.currentTarget.style.boxShadow =
      '0 0 0 1000px rgba(10,12,16,.94) inset';
  }

  return (
    <main
      style={{
        minHeight: '100vh',

        background: '#07080B',

        display: 'flex',

        alignItems: 'center',

        justifyContent: 'center',

        fontFamily: FONT,

        position: 'relative',

        overflow: 'hidden',

        padding: '24px 16px',
      }}
    >
      {/* Ambient background */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',

          inset: 0,

          pointerEvents: 'none',

          background: `
            radial-gradient(
              circle at 50% 35%,
              rgba(106,61,255,.13) 0%,
              rgba(41,163,255,.05) 30%,
              transparent 62%
            )
          `,
        }}
      />

      {/* HLNA ambient orb */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',

          left: '50%',

          top: '48%',

          transform:
            'translate(-50%, -50%)',

          opacity: 0.20,

          pointerEvents: 'none',
        }}
      >
        <HlnaOrb
          size={640}
          state="idle"
        />
      </div>

      <section
        style={{
          width: '100%',

          maxWidth: 450,

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

            marginBottom: 14,
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

                justifyContent:
                  'center',

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

              backdropFilter:
                'blur(3px)',

              WebkitBackdropFilter:
                'blur(3px)',
            }}
          >
            <span
              style={{
                fontSize: 8,

                fontWeight: 500,

                letterSpacing:
                  '.10em',

                textTransform:
                  'uppercase',

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

                letterSpacing:
                  '.09em',

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

                letterSpacing:
                  '.08em',

                color:
                  'rgba(34,197,94,.72)',
              }}
            >
              READY
            </span>
          </div>
        </header>

        {/* Trial card */}
        <div
          style={{
            width: '100%',

            maxWidth: 330,

            marginTop: 26,

            padding:
              '17px 18px 16px',

            borderRadius: 14,

            background:
              'linear-gradient(180deg, rgba(10,12,16,.075) 0%, rgba(10,12,16,.035) 100%)',

            border:
              '1px solid rgba(255,255,255,.065)',

            boxShadow:
              '0 16px 38px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.015)',

            backdropFilter:
              'blur(1.5px)',

            WebkitBackdropFilter:
              'blur(1.5px)',
          }}
        >
          {/* Compact heading */}
          <div
            style={{
              marginBottom: 14,

              display: 'flex',

              alignItems: 'baseline',

              justifyContent:
                'space-between',

              gap: 12,
            }}
          >
            <h1
              style={{
                margin: 0,

                fontSize: 15,

                lineHeight: 1.2,

                fontWeight: 600,

                letterSpacing:
                  '-.02em',

                color: '#F5F7FA',
              }}
            >
              Start free trial
            </h1>

            <span
              style={{
                fontSize: 8,

                color:
                  'rgba(167,139,250,.72)',

                whiteSpace: 'nowrap',
              }}
            >
              14 days · free
            </span>
          </div>

          <form
            onSubmit={handleSubmit}
            style={{
              display: 'flex',

              flexDirection: 'column',

              gap: 11,
            }}
          >
            {/* Full name */}
            <div>
              <label
                htmlFor="name"
                style={labelStyle}
              >
                Full name
              </label>

              <input
                id="name"
                type="text"
                required
                autoFocus
                autoComplete="name"
                placeholder="Your name"
                value={form.name}
                onChange={set('name')}
                style={inputStyle}
                onFocus={handleFocus}
                onBlur={handleBlur}
              />
            </div>

            {/* Email */}
            <div>
              <label
                htmlFor="email"
                style={labelStyle}
              >
                Work email
              </label>

              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@organisation.com"
                value={form.email}
                onChange={set('email')}
                style={inputStyle}
                onFocus={handleFocus}
                onBlur={handleBlur}
              />
            </div>

            {/* Organisation */}
            <div>
              <label
                htmlFor="organisation"
                style={labelStyle}
              >
                Organisation
              </label>

              <input
                id="organisation"
                type="text"
                required
                autoComplete="organization"
                placeholder="Organisation name"
                value={form.orgName}
                onChange={set(
                  'orgName',
                )}
                style={inputStyle}
                onFocus={handleFocus}
                onBlur={handleBlur}
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                style={labelStyle}
              >
                Password
              </label>

              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                value={form.password}
                onChange={set(
                  'password',
                )}
                style={inputStyle}
                onFocus={handleFocus}
                onBlur={handleBlur}
              />
            </div>

            {/* Confirm */}
            <div>
              <label
                htmlFor="confirmPassword"
                style={labelStyle}
              >
                Confirm password
              </label>

              <input
                id="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                placeholder="Repeat password"
                value={form.confirm}
                onChange={set(
                  'confirm',
                )}
                style={inputStyle}
                onFocus={handleFocus}
                onBlur={handleBlur}
              />
            </div>

            {/* Error */}
            {error && (
              <p
                style={{
                  margin: 0,

                  padding:
                    '7px 9px',

                  borderRadius: 7,

                  fontSize: 10,

                  color: '#F87171',

                  background:
                    'rgba(248,113,113,.04)',

                  border:
                    '1px solid rgba(248,113,113,.12)',
                }}
              >
                {error}
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

                fontFamily: FONT,

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
                ? 'Creating account…'
                : 'Start free trial →'}
            </button>
          </form>
        </div>

        {/* Login CTA */}
        <p
          style={{
            margin: '13px 0 0',

            textAlign: 'center',

            fontSize: 9,

            color:
              'rgba(255,255,255,.23)',
          }}
        >
          Already have an account?{' '}
          <Link
            href="/login"
            style={{
              color: '#A78BFA',

              textDecoration: 'none',

              fontWeight: 500,
            }}
          >
            Sign in →
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
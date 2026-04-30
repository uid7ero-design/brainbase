'use client';

import { useState, useRef, useEffect } from 'react';
import { Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

interface Props {
  name: string;
  onUnlock: () => void;
}

export default function LockScreen({ name, onUnlock }: Props) {
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/verify-lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        onUnlock();
      } else {
        const data = await res.json().catch(() => ({}));
        setAttempts(a => a + 1);
        setError(data.error || 'Incorrect password.');
        setPassword('');
        inputRef.current?.focus();
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const firstName = name.split(' ')[0];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Blurred backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backdropFilter: 'blur(24px) saturate(0.6) brightness(0.35)',
          WebkitBackdropFilter: 'blur(24px) saturate(0.6) brightness(0.35)',
          background: 'rgba(8, 9, 12, 0.78)',
        }}
      />

      {/* Card */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '400px',
          margin: '0 24px',
          padding: '48px 40px',
          borderRadius: '24px',
          background: 'linear-gradient(160deg, rgba(17,17,30,0.97) 0%, rgba(13,13,21,0.99) 100%)',
          border: '1px solid rgba(109,40,217,0.28)',
          boxShadow: '0 0 80px rgba(109,40,217,0.14), 0 40px 80px rgba(0,0,0,0.65)',
          animation: 'lockIn .38s cubic-bezier(0.34,1.56,0.64,1)',
          textAlign: 'center',
          fontFamily: 'var(--font-geist-sans), var(--font-inter), sans-serif',
        }}
      >
        {/* Ambient glow */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '-80px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '300px',
            height: '200px',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(109,40,217,0.22) 0%, transparent 70%)',
            filter: 'blur(20px)',
            pointerEvents: 'none',
          }}
        />

        {/* Lock icon */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: '16px',
            background: 'rgba(109,40,217,0.15)',
            border: '1px solid rgba(109,40,217,0.35)',
            marginBottom: '24px',
            color: '#A78BFA',
          }}
        >
          <Lock size={24} />
        </div>

        <h2
          style={{
            fontSize: '20px',
            fontWeight: 700,
            color: '#F4F4F5',
            margin: '0 0 10px',
            letterSpacing: '-0.02em',
          }}
        >
          Session Locked
        </h2>
        <p
          style={{
            fontSize: '14px',
            color: '#52525B',
            margin: '0 0 32px',
            lineHeight: 1.6,
          }}
        >
          Locked due to inactivity.
          <br />
          Continue as{' '}
          <span style={{ color: '#A1A1AA', fontWeight: 500 }}>{firstName}</span>
        </p>

        <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              style={{
                width: '100%',
                padding: '13px 48px 13px 16px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${error ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: '#F4F4F5',
                fontSize: '15px',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                transition: 'border-color .2s',
              }}
              onFocus={e => {
                if (!error) e.currentTarget.style.borderColor = 'rgba(109,40,217,0.5)';
              }}
              onBlur={e => {
                if (!error) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
              }}
            />
            <button
              type="button"
              onClick={() => setShowPw(s => !s)}
              tabIndex={-1}
              style={{
                position: 'absolute',
                right: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#52525B',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                borderRadius: '10px',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.18)',
                color: '#F87171',
                fontSize: '13px',
                textAlign: 'left',
              }}
            >
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              padding: '14px',
              borderRadius: '12px',
              border: 'none',
              cursor: loading || !password ? 'not-allowed' : 'pointer',
              background:
                loading || !password
                  ? 'rgba(109,40,217,0.25)'
                  : 'linear-gradient(135deg, #6D28D9, #7C3AED)',
              color: loading || !password ? 'rgba(196,181,253,0.4)' : '#fff',
              fontSize: '15px',
              fontWeight: 600,
              transition: 'all .2s',
              fontFamily: 'inherit',
              letterSpacing: '0.01em',
            }}
          >
            {loading ? 'Verifying…' : 'Unlock Session'}
          </button>
        </form>

        {attempts >= 3 && (
          <p style={{ marginTop: '20px', fontSize: '12px', color: '#52525B' }}>
            Forgotten your password?{' '}
            <a
              href="/login"
              style={{ color: '#A78BFA', textDecoration: 'none', fontWeight: 500 }}
            >
              Sign in again
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

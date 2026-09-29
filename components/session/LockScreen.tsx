'use client';

import { useState, useRef, useEffect, useId } from 'react';
import { Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/app/Button';
import styles from './LockScreen.module.css';

interface Props {
  name: string;
  onUnlock: () => void;
}

// Visual-convergence (remaining visual islands pass): the lock screen is a
// calm, theme-aware modal dialog on an opaque page surface — one focus
// point (the password field), no glass/blur/glow/gradient chrome. Unlock
// behaviour is unchanged: same /api/auth/verify-lock request, same attempt
// counting, same messages, same delayed autofocus and onUnlock callback.
// There is deliberately no Escape-to-close: a locked session can only be
// left by unlocking (or signing in again).

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])';

export default function LockScreen({ name, onUnlock }: Props) {
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const inputId = `${uid}-password`;
  const errorId = `${uid}-error`;

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

  // Keep keyboard focus inside the lock dialog (aria-modal): Tab and
  // Shift+Tab cycle through its own controls only.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !cardRef.current) return;
    const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      cardRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === cardRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const firstName = name.split(' ')[0];

  return (
    <div className={styles.overlay}>
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.icon} aria-hidden="true">
          <Lock size={20} />
        </div>

        <h2 id={titleId} className={styles.title}>
          Session Locked
        </h2>
        <p id={descId} className={styles.description}>
          Locked due to inactivity.
          <br />
          Continue as{' '}
          <span className={styles.name}>{firstName}</span>
        </p>

        <form onSubmit={handleUnlock} className={styles.form} aria-busy={loading || undefined}>
          <div className={styles.inputWrap}>
            <label htmlFor={inputId} className={styles.visuallyHidden}>
              Password
            </label>
            <input
              id={inputId}
              ref={inputRef}
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              className={styles.input}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPw(s => !s)}
              className={styles.toggle}
              aria-label="Show password"
              aria-pressed={showPw}
              aria-controls={inputId}
            >
              {showPw ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>

          {error && (
            <p id={errorId} className={styles.error} role="alert">
              <AlertCircle size={14} className={styles.errorIcon} aria-hidden="true" />
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            className={styles.submit}
            disabled={loading || !password}
          >
            {loading ? 'Verifying…' : 'Unlock Session'}
          </Button>
        </form>

        {attempts >= 3 && (
          <p className={styles.help}>
            Forgotten your password?{' '}
            <a href="/login">Sign in again</a>
          </p>
        )}
      </div>
    </div>
  );
}

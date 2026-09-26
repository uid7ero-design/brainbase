'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { login } from '@/app/actions/auth';
import { AuthFooter, AuthShell, authStyles as styles } from '@/components/public/auth/AuthShell';

export default function LoginPage() {
  const router = useRouter();
  const [state, action, pending] = useActionState(login, undefined);
  const [username, setUsername] = useState('');

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state?.redirectTo, router]);

  return (
    <AuthShell>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h1 className={styles.title}>Sign in</h1>
          <span className={styles.trialMeta}>Secure access</span>
        </div>

        <form action={action} className={styles.form}>
          {state?.unverified && (
            <div className={styles.notice}>
              <strong className={styles.noticeTitle}>Email not verified</strong>
              <p className={styles.noticeBody}>Check your inbox or request another verification link.</p>
              <Link
                href={`/verify-email${username ? `?email=${encodeURIComponent(username)}` : ''}`}
                className={styles.link}
              >
                Resend verification email →
              </Link>
            </div>
          )}

          <div className={styles.field}>
            <label htmlFor="username" className={styles.label}>Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={event => setUsername(event.target.value)}
              className={styles.input}
            />
          </div>

          <div className={styles.field}>
            <div className={styles.fieldHead}>
              <label htmlFor="password" className={styles.label}>Password</label>
              <Link href="/forgot-password" className={styles.link}>Forgot password?</Link>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={styles.input}
            />
          </div>

          {state?.error && !state.unverified && (
            <p className={styles.error} role="alert">{state.error}</p>
          )}

          <button type="submit" disabled={pending} className={styles.submit}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>

      <AuthFooter prompt="New to BrainBase?" href="/signup" linkText="Start free trial →" />
    </AuthShell>
  );
}

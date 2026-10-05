'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthFooter, AuthShell, authStyles as styles } from '@/components/public/auth/AuthShell';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    username: '',
    email: '',
    orgName: '',
    password: '',
    confirm: '',
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  function set(key: keyof typeof form) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm(previous => ({ ...previous, [key]: event.target.value }));
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          username: form.username.trim(),
          email: form.email.trim(),
          orgName: form.orgName.trim(),
          password: form.password,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Signup failed.');
        return;
      }
      router.push('/trial');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h1 className={styles.title}>Start free trial</h1>
          <span className={styles.trialMeta}>14 days · free</span>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="name" className={styles.label}>Full name</label>
            <input id="name" type="text" required autoFocus autoComplete="name" placeholder="Your name" value={form.name} onChange={set('name')} className={styles.input} />
          </div>

          <div className={styles.field}>
            <label htmlFor="username" className={styles.label}>Username</label>
            <input id="username" type="text" required autoComplete="username" placeholder="Choose a username" value={form.username} onChange={set('username')} className={styles.input} />
          </div>

          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>Work email</label>
            <input id="email" type="email" required autoComplete="email" placeholder="you@organisation.com" value={form.email} onChange={set('email')} className={styles.input} />
          </div>

          <div className={styles.field}>
            <label htmlFor="organisation" className={styles.label}>Organisation</label>
            <input id="organisation" type="text" required autoComplete="organization" placeholder="Organisation name" value={form.orgName} onChange={set('orgName')} className={styles.input} />
          </div>

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>Password</label>
            <input id="password" type="password" required minLength={8} autoComplete="new-password" placeholder="Minimum 8 characters" value={form.password} onChange={set('password')} className={styles.input} />
          </div>

          <div className={styles.field}>
            <label htmlFor="confirmPassword" className={styles.label}>Confirm password</label>
            <input id="confirmPassword" type="password" required autoComplete="new-password" placeholder="Repeat password" value={form.confirm} onChange={set('confirm')} className={styles.input} />
          </div>

          {error && <p className={styles.error} role="alert">{error}</p>}

          <button type="submit" disabled={pending} className={styles.submit}>
            {pending ? 'Creating account…' : 'Start free trial →'}
          </button>
        </form>
      </div>

      <AuthFooter prompt="Already have an account?" href="/login" linkText="Sign in →" />
    </AuthShell>
  );
}

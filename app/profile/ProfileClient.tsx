'use client';
import { useActionState, useTransition, useState } from 'react';
import { updateProfile, updatePassword, updateSecureMode } from '@/app/actions/profile';
import { useSessionContext } from '@/components/session/SessionProvider';
import { Shield, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { Field, FormError, buttonProps, fieldControlClassName } from '@/components/ui/app';

export default function ProfileClient({
  name,
  username,
  secureModeDefault,
}: {
  name: string;
  username: string;
  secureModeDefault: boolean;
}) {
  const [profileState, profileAction, profilePending] = useActionState(updateProfile, undefined);
  const [pwState, pwAction, pwPending] = useActionState(updatePassword, undefined);
  const { secureMode: contextSecureMode, setSecureModeOptimistic } = useSessionContext();
  const [securePending, startSecureTransition] = useTransition();

  // Initialise from the prop; reflect changes made in this session via context
  const [localSecure, setLocalSecure] = useState(secureModeDefault);
  const activeSecure = contextSecureMode ?? localSecure;

  function toggleSecureMode() {
    const next = !activeSecure;
    setLocalSecure(next);
    setSecureModeOptimistic(next);
    startSecureTransition(async () => {
      await updateSecureMode(next);
    });
  }

  return (
    <div style={{ background: 'var(--bg-base)', minHeight: 'calc(100vh - 52px)', fontFamily: 'var(--font-inter), Inter, sans-serif', color: 'var(--text-primary)', padding: '40px 16px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        <Link href="/" style={{ color: 'var(--text-secondary)', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 32 }}>
          ← Back
        </Link>

        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 4px' }}>My Profile</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 32px' }}>@{username}</p>

        {/* Display name */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 18px' }}>Display Name</h2>
          <form action={profileAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Name">
              {control => <input {...control} name="name" type="text" required defaultValue={name} className={fieldControlClassName} />}
            </Field>
            {profileState?.error && <FormError>{profileState.error}</FormError>}
            {profileState?.success && <p role="status" style={successStyle}>{profileState.success}</p>}
            <button type="submit" disabled={profilePending} {...buttonProps('primary')}>
              {profilePending ? 'Saving…' : 'Update name'}
            </button>
          </form>
        </div>

        {/* Password */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 18px' }}>Change Password</h2>
          <form action={pwAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Current password">
              {control => <input {...control} name="current" type="password" required className={fieldControlClassName} />}
            </Field>
            <Field label="New password">
              {control => <input {...control} name="password" type="password" required className={fieldControlClassName} />}
            </Field>
            <Field label="Confirm new password">
              {control => <input {...control} name="confirm" type="password" required className={fieldControlClassName} />}
            </Field>
            {pwState?.error && <FormError>{pwState.error}</FormError>}
            {pwState?.success && <p role="status" style={successStyle}>{pwState.success}</p>}
            <button type="submit" disabled={pwPending} {...buttonProps('primary')}>
              {pwPending ? 'Saving…' : 'Update password'}
            </button>
          </form>
        </div>

        {/* Secure Mode */}
        <div
          style={{
            background: activeSecure ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-surface)',
            border: `1px solid ${activeSecure ? 'var(--brand-brainbase-accent-border)' : 'var(--border)'}`,
            borderRadius: 12,
            padding: 24,
            transition: 'background .25s, border-color .25s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {activeSecure
                  ? <Shield size={15} aria-hidden="true" style={{ color: 'var(--brand-brainbase-accent)' }} />
                  : <ShieldOff size={15} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                }
                <h2 id="secure-mode-heading" style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                  Secure Mode
                </h2>
                {activeSecure && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    padding: '2px 8px',
                    borderRadius: 20,
                    background: 'var(--brand-brainbase-accent-muted)',
                    border: '1px solid var(--brand-brainbase-accent-border)',
                    color: 'var(--brand-brainbase-accent)',
                    textTransform: 'uppercase',
                  }}>
                    ON
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                {activeSecure
                  ? 'Idle lock at 5 min · Session ends when tab closes.'
                  : 'Idle lock at 10 min · Session persists across tab closes.'}
              </p>
            </div>

            {/* Toggle pill */}
            <button
              type="button"
              role="switch"
              aria-checked={activeSecure}
              onClick={toggleSecureMode}
              disabled={securePending}
              aria-labelledby="secure-mode-heading"
              style={{
                flexShrink: 0,
                width: 44,
                height: 24,
                borderRadius: 12,
                border: `1px solid ${activeSecure ? 'var(--brand-brainbase-accent)' : 'var(--border-strong)'}`,
                cursor: securePending ? 'wait' : 'pointer',
                position: 'relative',
                background: activeSecure ? 'var(--brand-brainbase-accent)' : 'var(--bg-sunken)',
                transition: 'background .25s',
                opacity: securePending ? 0.6 : 1,
              }}
            >
              <span style={{
                position: 'absolute',
                top: 2,
                left: activeSecure ? 22 : 2,
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: activeSecure ? 'var(--brand-brainbase-on-accent)' : 'var(--text-muted)',
                transition: 'left .22s cubic-bezier(.4,0,.2,1)',
              }} />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties    = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24, marginBottom: 20 };
const successStyle: React.CSSProperties = { color: 'var(--status-success)', fontSize: 13, background: 'var(--status-success-muted)', border: '1px solid var(--status-success-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', margin: 0 };

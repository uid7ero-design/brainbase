'use client';
import { useActionState, useTransition, useState } from 'react';
import { updateProfile, updatePassword, updateSecureMode } from '@/app/actions/profile';
import { useSessionContext } from '@/components/session/SessionProvider';
import { Shield, ShieldOff } from 'lucide-react';
import Link from 'next/link';

const BG     = '#07080B';
const CARD   = '#0e1014';
const BORDER = '#1a1d24';

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
    <div style={{ background: BG, minHeight: 'calc(100vh - 52px)', fontFamily: 'var(--font-inter), Inter, sans-serif', color: '#f9fafb', padding: '40px 24px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        <Link href="/" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 32 }}>
          ← Back
        </Link>

        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 4px' }}>My Profile</h1>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 32px' }}>@{username}</p>

        {/* Display name */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 18px' }}>Display Name</h2>
          <form action={profileAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input name="name" type="text" required defaultValue={name} style={inputStyle} />
            </div>
            {profileState?.error && <p style={errorStyle}>{profileState.error}</p>}
            {profileState?.success && <p style={successStyle}>{profileState.success}</p>}
            <button type="submit" disabled={profilePending} style={btnStyle}>
              {profilePending ? 'Saving…' : 'Update name'}
            </button>
          </form>
        </div>

        {/* Password */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 18px' }}>Change Password</h2>
          <form action={pwAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Current password</label>
              <input name="current" type="password" required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>New password</label>
              <input name="password" type="password" required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Confirm new password</label>
              <input name="confirm" type="password" required style={inputStyle} />
            </div>
            {pwState?.error && <p style={errorStyle}>{pwState.error}</p>}
            {pwState?.success && <p style={successStyle}>{pwState.success}</p>}
            <button type="submit" disabled={pwPending} style={btnStyle}>
              {pwPending ? 'Saving…' : 'Update password'}
            </button>
          </form>
        </div>

        {/* Secure Mode */}
        <div
          style={{
            background: activeSecure ? 'rgba(109,40,217,0.06)' : CARD,
            border: `1px solid ${activeSecure ? 'rgba(109,40,217,0.28)' : BORDER}`,
            borderRadius: 12,
            padding: 24,
            transition: 'background .25s, border-color .25s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {activeSecure
                  ? <Shield size={15} style={{ color: '#A78BFA' }} />
                  : <ShieldOff size={15} style={{ color: '#52525B' }} />
                }
                <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: activeSecure ? '#E9D5FF' : '#f9fafb' }}>
                  Secure Mode
                </h2>
                {activeSecure && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    padding: '2px 8px',
                    borderRadius: 20,
                    background: 'rgba(109,40,217,0.2)',
                    border: '1px solid rgba(167,139,250,0.3)',
                    color: '#C4B5FD',
                    textTransform: 'uppercase',
                  }}>
                    ON
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>
                {activeSecure
                  ? 'Idle lock at 5 min · Session ends when tab closes.'
                  : 'Idle lock at 10 min · Session persists across tab closes.'}
              </p>
            </div>

            {/* Toggle pill */}
            <button
              onClick={toggleSecureMode}
              disabled={securePending}
              aria-label="Toggle secure mode"
              style={{
                flexShrink: 0,
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                cursor: securePending ? 'wait' : 'pointer',
                position: 'relative',
                background: activeSecure
                  ? 'linear-gradient(135deg, #6D28D9, #7C3AED)'
                  : 'rgba(255,255,255,0.08)',
                transition: 'background .25s',
                opacity: securePending ? 0.6 : 1,
              }}
            >
              <span style={{
                position: 'absolute',
                top: 3,
                left: activeSecure ? 23 : 3,
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left .22s cubic-bezier(.4,0,.2,1)',
              }} />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties  = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const inputStyle: React.CSSProperties  = { width: '100%', padding: '10px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const btnStyle: React.CSSProperties    = { padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const errorStyle: React.CSSProperties  = { color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 };
const successStyle: React.CSSProperties = { color: '#34d399', fontSize: 13, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 };

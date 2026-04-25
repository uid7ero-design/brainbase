'use client';
import { useActionState } from 'react';
import { updateProfile, updatePassword } from '@/app/actions/profile';
import Link from 'next/link';

const BG = '#07080B';
const CARD = '#0e1014';
const BORDER = '#1a1d24';

export default function ProfilePage() {
  const [profileState, profileAction, profilePending] = useActionState(updateProfile, undefined);
  const [pwState, pwAction, pwPending] = useActionState(updatePassword, undefined);

  return (
    <div style={{ background: BG, minHeight: '100vh', fontFamily: 'var(--font-inter), Inter, sans-serif', color: '#f9fafb', padding: '40px 24px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        {/* Back */}
        <Link href="/" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 32 }}>
          ← Back
        </Link>

        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 8px' }}>My Profile</h1>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 32px' }}>Update your name and password</p>

        {/* Name */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 18px' }}>Display Name</h2>
          <form action={profileAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input name="name" type="text" required
                style={inputStyle} />
            </div>
            {profileState?.error && <p style={errorStyle}>{profileState.error}</p>}
            {profileState?.success && <p style={successStyle}>{profileState.success}</p>}
            <button type="submit" disabled={profilePending} style={btnStyle}>
              {profilePending ? 'Saving…' : 'Update name'}
            </button>
          </form>
        </div>

        {/* Password */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24 }}>
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

      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', background: '#111318', border: '1px solid #1a1d24', borderRadius: 8, color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '10px 0', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const errorStyle: React.CSSProperties = { color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 };
const successStyle: React.CSSProperties = { color: '#34d399', fontSize: 13, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 6, padding: '8px 12px', margin: 0 };

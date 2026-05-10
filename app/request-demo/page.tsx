"use client";

import { useState } from "react";
import Link from "next/link";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#08090C';

const BUSINESS_TYPES = [
  'Tennis Coaching',
  'Sports Coaching',
  'Personal Training',
  'Fitness Studio',
  'Martial Arts',
  'Dance / Performing Arts',
  'Swimming / Aquatics',
  'Tutoring / Education',
  'Allied Health',
  'Other',
];

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(226,232,240,.55)', marginBottom: 7, letterSpacing: '.03em' }}>
        {label}{required && <span style={{ color: '#10b981', marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,.10)',
  background: 'rgba(255,255,255,.04)',
  color: '#F1F5F9',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  transition: 'border-color .15s',
};

export default function RequestDemoPage() {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', business_name: '',
    business_type: '', description: '', num_clients: '',
    num_users: '', goal: '', referral: '',
  });
  const [focusField, setFocusField] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

  function focusStyle(name: string): React.CSSProperties {
    return {
      ...inputStyle,
      borderColor: focusField === name ? 'rgba(16,185,129,.50)' : 'rgba(255,255,255,.10)',
      boxShadow: focusField === name ? '0 0 0 3px rgba(16,185,129,.08)' : 'none',
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.email.trim() || !form.business_name.trim()) {
      setError('Name, email, and business name are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/request-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Something went wrong.');
      }
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        input::placeholder, textarea::placeholder { color: rgba(255,255,255,.20); }
        select option { background: #16181d; color: #F1F5F9; }
      `}</style>

      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(16,185,129,.08) 0%, transparent 65%)',
      }} />

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 24px 96px', position: 'relative', zIndex: 1 }}>

        {/* Back */}
        <div style={{ paddingTop: 28 }}>
          <Link href="/for-coaches" style={{
            fontSize: 13, color: 'rgba(255,255,255,.35)', textDecoration: 'none', transition: 'color .15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,.60)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,.35)')}>
            ← Back
          </Link>
        </div>

        {done ? (
          <div style={{ paddingTop: 100, textAlign: 'center', animation: 'fadeUp .4s ease both' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', margin: '0 auto 28px',
              background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24,
            }}>✓</div>
            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F1F5F9', margin: '0 0 14px' }}>
              Request received
            </h1>
            <p style={{ fontSize: 15, color: 'rgba(226,232,240,.50)', lineHeight: 1.7, maxWidth: 400, margin: '0 auto 36px' }}>
              We'll be in touch shortly to set up a time that works for you.
            </p>
            <Link href="/for-coaches" style={{
              display: 'inline-block', padding: '11px 28px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,.12)', color: 'rgba(226,232,240,.65)',
              textDecoration: 'none', fontSize: 14, transition: 'border-color .15s, color .15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.25)'; e.currentTarget.style.color = '#F1F5F9'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.12)'; e.currentTarget.style.color = 'rgba(226,232,240,.65)'; }}>
              ← Back to overview
            </Link>
          </div>
        ) : (
          <>
            {/* Header */}
            <section style={{ padding: '64px 0 40px', textAlign: 'center' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '4px 12px', borderRadius: 20, marginBottom: 20,
                background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.18)',
              }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E', animation: 'pulse 2.5s ease-in-out infinite' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(52,211,153,.82)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Request a Demo</span>
              </div>
              <h1 style={{
                fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 700,
                letterSpacing: '-.03em', lineHeight: 1.15,
                color: '#F1F5F9', margin: '0 0 14px',
              }}>
                Let's set up your system
              </h1>
              <p style={{ fontSize: 15, color: 'rgba(226,232,240,.45)', margin: 0, lineHeight: 1.7 }}>
                Tell us about your business and we'll reach out to book a time.
              </p>
            </section>

            {/* Form */}
            <form onSubmit={submit} style={{ animation: 'fadeUp .35s ease both' }}>
              <div style={{
                padding: '32px', borderRadius: 16,
                background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.08)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.22)', marginBottom: 20 }}>Your details</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Full Name" required>
                    <input
                      value={form.name} onChange={set('name')} placeholder="Jane Smith"
                      style={focusStyle('name')}
                      onFocus={() => setFocusField('name')} onBlur={() => setFocusField(null)}
                    />
                  </Field>
                  <Field label="Email" required>
                    <input
                      type="email" value={form.email} onChange={set('email')} placeholder="jane@example.com"
                      style={focusStyle('email')}
                      onFocus={() => setFocusField('email')} onBlur={() => setFocusField(null)}
                    />
                  </Field>
                </div>

                <Field label="Phone">
                  <input
                    type="tel" value={form.phone} onChange={set('phone')} placeholder="+61 4xx xxx xxx"
                    style={focusStyle('phone')}
                    onFocus={() => setFocusField('phone')} onBlur={() => setFocusField(null)}
                  />
                </Field>

                <div style={{ height: 1, background: 'rgba(255,255,255,.06)', margin: '8px 0 24px' }} />
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.22)', marginBottom: 20 }}>Your business</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Business Name" required>
                    <input
                      value={form.business_name} onChange={set('business_name')} placeholder="Ace Tennis Academy"
                      style={focusStyle('business_name')}
                      onFocus={() => setFocusField('business_name')} onBlur={() => setFocusField(null)}
                    />
                  </Field>
                  <Field label="Business Type">
                    <select
                      value={form.business_type} onChange={set('business_type')}
                      style={{
                        ...focusStyle('business_type'),
                        colorScheme: 'dark',
                        appearance: 'none',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='rgba(255,255,255,0.3)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 12px center',
                        paddingRight: 36,
                        cursor: 'pointer',
                      }}
                      onFocus={() => setFocusField('business_type')} onBlur={() => setFocusField(null)}
                    >
                      <option value="">Select type…</option>
                      {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                </div>

                <Field label="About your business">
                  <textarea
                    value={form.description} onChange={set('description')}
                    placeholder="What do you offer? How does your business run today?"
                    rows={3}
                    style={{
                      ...focusStyle('description'),
                      resize: 'vertical', lineHeight: 1.6,
                      borderColor: focusField === 'description' ? 'rgba(16,185,129,.50)' : 'rgba(255,255,255,.10)',
                      boxShadow: focusField === 'description' ? '0 0 0 3px rgba(16,185,129,.08)' : 'none',
                    }}
                    onFocus={() => setFocusField('description')} onBlur={() => setFocusField(null)}
                  />
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Clients / Participants">
                    <input
                      value={form.num_clients} onChange={set('num_clients')} placeholder="e.g. 40"
                      style={focusStyle('num_clients')}
                      onFocus={() => setFocusField('num_clients')} onBlur={() => setFocusField(null)}
                    />
                  </Field>
                  <Field label="Team / Users">
                    <input
                      value={form.num_users} onChange={set('num_users')} placeholder="e.g. 2"
                      style={focusStyle('num_users')}
                      onFocus={() => setFocusField('num_users')} onBlur={() => setFocusField(null)}
                    />
                  </Field>
                </div>

                <Field label="What do you want to achieve?">
                  <textarea
                    value={form.goal} onChange={set('goal')}
                    placeholder="e.g. Save time on admin, understand my revenue, manage bookings better…"
                    rows={2}
                    style={{
                      ...focusStyle('goal'),
                      resize: 'vertical', lineHeight: 1.6,
                      borderColor: focusField === 'goal' ? 'rgba(16,185,129,.50)' : 'rgba(255,255,255,.10)',
                      boxShadow: focusField === 'goal' ? '0 0 0 3px rgba(16,185,129,.08)' : 'none',
                    }}
                    onFocus={() => setFocusField('goal')} onBlur={() => setFocusField(null)}
                  />
                </Field>

                <Field label="How did you hear about us?">
                  <input
                    value={form.referral} onChange={set('referral')} placeholder="e.g. Google, a friend, social media…"
                    style={focusStyle('referral')}
                    onFocus={() => setFocusField('referral')} onBlur={() => setFocusField(null)}
                  />
                </Field>

                {error && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.20)', color: '#fca5a5', fontSize: 13, marginBottom: 20 }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    width: '100%', padding: '14px', borderRadius: 9,
                    fontWeight: 600, fontSize: 15, letterSpacing: '.02em',
                    background: submitting ? 'rgba(16,185,129,.10)' : 'rgba(16,185,129,.20)',
                    border: submitting ? '1px solid rgba(16,185,129,.20)' : '1px solid rgba(16,185,129,.38)',
                    color: submitting ? 'rgba(245,247,250,.40)' : '#F5F7FA',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    transition: 'background .15s, border-color .15s',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => { if (!submitting) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,.30)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(16,185,129,.58)'; } }}
                  onMouseLeave={e => { if (!submitting) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,.20)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(16,185,129,.38)'; } }}
                >
                  {submitting ? 'Sending…' : 'Request a Demo →'}
                </button>

                <p style={{ margin: '14px 0 0', fontSize: 12, color: 'rgba(255,255,255,.20)', textAlign: 'center' }}>
                  No commitment. We'll reach out within 24 hours.
                </p>
              </div>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

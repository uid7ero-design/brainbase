'use client';

import Link from 'next/link';
import { HlnaOrb } from '@/components/brand/HlnaOrb';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

const MODULES = [
  { label: 'Waste & Recycling',    color: '#10B981', icon: '♻️' },
  { label: 'Fleet Management',     color: '#38BDF8', icon: '🚛' },
  { label: 'Roads & Infrastructure', color: '#F59E0B', icon: '🛣️' },
  { label: 'Water & Utilities',    color: '#6366F1', icon: '💧' },
  { label: 'Parks & Open Spaces',  color: '#34D399', icon: '🌳' },
  { label: 'Labour & Workforce',   color: '#FB923C', icon: '👷' },
  { label: 'Facilities',           color: '#A78BFA', icon: '🏢' },
  { label: 'Logistics & Freight',  color: '#F472B6', icon: '📦' },
  { label: 'Construction',         color: '#FBBF24', icon: '🏗️' },
  { label: 'Supply Chain',         color: '#2DD4BF', icon: '🔗' },
  { label: 'Environment & ESG',    color: '#4ADE80', icon: '🌍' },
  { label: 'Depot Operations',     color: '#C084FC', icon: '🏭' },
];

export default function DemoPage() {
  return (
    <div style={{ fontFamily: FONT, background: '#08090C', minHeight: '100vh', color: '#F5F7FA' }}>
      <style>{`
        @keyframes pulse  { 0%,100%{opacity:1}50%{opacity:.4} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '80px 24px 48px', maxWidth: 760, margin: '0 auto', animation: 'fadeUp .6s ease both' }}>
        {/* Orb */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 40 }}>
          <HlnaOrb size={120} state="idle" />
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 24, padding: '4px 12px', borderRadius: 20, background: 'rgba(167,139,250,.1)', border: '1px solid rgba(167,139,250,.2)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#A78BFA', animation: 'pulse 2s ease-in-out infinite', display: 'inline-block' }} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', color: '#A78BFA', textTransform: 'uppercase' }}>Live Platform Demo</span>
        </div>

        <h1 style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.15, margin: '0 0 16px', letterSpacing: '-.02em' }}>
          See HLNΛ in action
        </h1>
        <p style={{ fontSize: 16, color: 'rgba(245,247,250,.55)', lineHeight: 1.7, margin: '0 0 36px' }}>
          Brainbase gives operational teams a single voice-first AI command centre across 12 intelligence modules.
          No dashboards to memorise — just ask.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/login" style={{
            fontSize: 14, fontWeight: 600, textDecoration: 'none',
            background: 'linear-gradient(135deg, #6D28D9, #A78BFA)',
            color: '#fff', padding: '10px 24px', borderRadius: 10,
            transition: 'opacity .15s',
          }}>
            Enter Platform →
          </Link>
          <Link href="/pricing" style={{
            fontSize: 14, fontWeight: 500, textDecoration: 'none',
            color: 'rgba(245,247,250,.65)', padding: '10px 24px', borderRadius: 10,
            border: '1px solid rgba(255,255,255,.1)',
            transition: 'border-color .15s, color .15s',
          }}>
            View Pricing
          </Link>
        </div>
      </div>

      {/* Simulated command bar */}
      <div style={{ maxWidth: 700, margin: '0 auto 64px', padding: '0 24px' }}>
        <div style={{
          borderRadius: 14, border: '1px solid rgba(167,139,250,.2)',
          background: 'rgba(255,255,255,.03)', padding: '20px 24px',
          backdropFilter: 'blur(12px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #6D28D9, #A78BFA)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="2" width="6" height="12" rx="3"/>
                <path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/>
              </svg>
            </div>
            <div style={{ fontSize: 14, color: 'rgba(245,247,250,.50)', fontStyle: 'italic' }}>
              "What's our waste diversion rate this quarter, and how does it compare to last year?"
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 16, fontSize: 13, color: 'rgba(245,247,250,.75)', lineHeight: 1.7 }}>
            Your waste diversion rate this quarter is <span style={{ color: '#10B981', fontWeight: 600 }}>61.4%</span>, up from <span style={{ fontWeight: 600 }}>54.2%</span> in the same period last year — a <span style={{ color: '#A78BFA', fontWeight: 600 }}>+7.2 point improvement</span>. Green waste sorting and the new depot processing contract are the primary drivers. You&apos;re on track to hit your 65% annual target.
          </div>
        </div>
      </div>

      {/* 12 Modules grid */}
      <div style={{ maxWidth: 960, margin: '0 auto 80px', padding: '0 24px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, textAlign: 'center', marginBottom: 32, color: 'rgba(245,247,250,.85)' }}>
          12 intelligence modules, one platform
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {MODULES.map(m => (
            <div key={m.label} style={{
              padding: '14px 16px', borderRadius: 12,
              background: 'rgba(255,255,255,.03)',
              border: `1px solid ${m.color}22`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 18 }}>{m.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(245,247,250,.75)' }}>{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA footer */}
      <div style={{ textAlign: 'center', padding: '0 24px 80px' }}>
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <p style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Ready to operate with clarity?</p>
          <p style={{ fontSize: 14, color: 'rgba(245,247,250,.45)', margin: 0 }}>Sign up or talk to our team.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
            <Link href="/login" style={{
              fontSize: 14, fontWeight: 600, textDecoration: 'none',
              background: 'linear-gradient(135deg, #6D28D9, #A78BFA)',
              color: '#fff', padding: '10px 22px', borderRadius: 10,
            }}>
              Get Started
            </Link>
            <Link href="/pricing" style={{
              fontSize: 14, fontWeight: 500, textDecoration: 'none',
              color: 'rgba(245,247,250,.65)', padding: '10px 22px', borderRadius: 10,
              border: '1px solid rgba(255,255,255,.10)',
            }}>
              See Pricing
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

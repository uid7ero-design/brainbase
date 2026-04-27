"use client";

import { useState } from "react";
import Link from "next/link";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#08090C';

const KEYFRAMES = `
  @keyframes orbFloat   { 0%, 100% { transform: translateY(0px) scale(1); }       50% { transform: translateY(-12px) scale(1.022); } }
  @keyframes heroGlow   { 0%, 100% { opacity: .55; }              50% { opacity: 1; }              }
  @keyframes pulse      { 0%, 100% { opacity: 1; }                50% { opacity: .4; }             }
`;

const CAPABILITIES = [
  {
    color: '#38BDF8',
    title: 'Voice-First AI',
    description: 'Talk to HLNΛ in plain language. Ask about your data, request reports, or navigate between dashboards without touching a keyboard.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="9" y="2" width="6" height="12" rx="3"/>
        <path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>
      </svg>
    ),
  },
  {
    color: '#A78BFA',
    title: '12 Intelligence Modules',
    description: 'Fleet, waste, water, roads, parks, labour, facilities, logistics, supply, depot, construction, and environment — all in one platform.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    color: '#10B981',
    title: 'Real Data, Real Answers',
    description: 'Upload your operational data and HLNΛ reads it instantly — answering questions about cost, compliance, performance, and risk.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    ),
  },
  {
    color: '#F59E0B',
    title: 'Smart Memory',
    description: 'HLNΛ remembers your preferences, past queries, and operational context. Every session gets smarter.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>
        <path d="M12 6v6l4 2"/>
      </svg>
    ),
  },
  {
    color: '#EC4899',
    title: 'Navigate by Voice',
    description: '"Take me to fleet." "Open waste management." HLNΛ routes you instantly across all dashboards with a single spoken command.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11"/>
      </svg>
    ),
  },
  {
    color: '#06B6D4',
    title: 'Integrated Operations',
    description: 'Connect Google Calendar, Gmail, and Spotify. HLNΛ pulls in context from your whole day — not just your dashboards.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
    ),
  },
];

const DASHBOARDS = [
  { title: 'Fleet Management',      color: '#3B82F6', category: 'Operations',    href: '/dashboard/fleet',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
  { title: 'Waste & Recycling',     color: '#10B981', category: 'Operations',    href: '/dashboard/waste',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg> },
  { title: 'Water & Utilities',     color: '#06B6D4', category: 'Infrastructure', href: '/dashboard/water',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2C6 8 4 12 4 16a8 8 0 0 0 16 0c0-4-2-8-8-14z"/></svg> },
  { title: 'Roads & Infrastructure', color: '#64748B', category: 'Infrastructure', href: '/dashboard/roads',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 17l3-10 3 4 3-8 3 4 3-8"/><path d="M3 21h18"/></svg> },
  { title: 'Parks & Open Spaces',   color: '#22C55E', category: 'Environment',   href: '/dashboard/parks',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 22V12"/><path d="M5 9l7-7 7 7"/><path d="M5 22h14"/><path d="M5 16l7-4 7 4"/></svg> },
  { title: 'Environmental & ESG',   color: '#16A34A', category: 'Environment',   href: '/dashboard/environment',  icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg> },
  { title: 'Labour & Workforce',    color: '#A855F7', category: 'People',        href: '/dashboard/labour',       icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  { title: 'Facilities Management', color: '#8B5CF6', category: 'Operations',    href: '/dashboard/facilities',   icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h6"/><path d="M3 15h6"/></svg> },
  { title: 'Construction Projects', color: '#F97316', category: 'Capital Works',  href: '/dashboard/construction', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 21h18"/><path d="M9 21V7l3-4 3 4v14"/><path d="M9 11h6"/><rect x="2" y="14" width="5" height="7"/><rect x="17" y="14" width="5" height="7"/></svg> },
  { title: 'Supply Chain',          color: '#0EA5E9', category: 'Logistics',     href: '/dashboard/supply',       icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="5" cy="6" r="3"/><circle cx="19" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M5 9v3l7 4 7-4V9"/><path d="M12 13V7"/></svg> },
  { title: 'Logistics & Freight',   color: '#F59E0B', category: 'Logistics',     href: '/dashboard/logistics',    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14"/><path d="M3 20h18"/><circle cx="17" cy="17" r="3"/></svg> },
  { title: 'Depot Operations',      color: '#EC4899', category: 'Logistics',     href: '/dashboard/depot',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="7" width="20" height="15" rx="1"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg> },
];

const STEPS = [
  { n: '01', title: 'Connect your data', body: 'Upload Excel files, link your calendar, email, and operational systems. BrainBase structures it automatically.' },
  { n: '02', title: 'Ask HLNΛ anything', body: 'Speak or type. "Which zone has the highest contamination?" "Show me overdue fleet services." Helena answers from your data.' },
  { n: '03', title: 'Operate with clarity', body: 'Navigate 12 service dashboards by voice. Get insights, spot risks, and brief your team — in seconds, not hours.' },
];

export default function Home() {
  const [hoveredDash, setHoveredDash] = useState<string | null>(null);
  const [hoveredCap,  setHoveredCap]  = useState<number | null>(null);

  return (
    <main style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT }}>
      <style>{KEYFRAMES}</style>

      {/* ── Ambient backdrop ──────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(79,70,229,.12) 0%, transparent 65%)',
      }} />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 32px 96px', position: 'relative', zIndex: 1 }}>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section style={{ padding: '96px 0 80px', display: 'flex', alignItems: 'center', gap: 72, flexWrap: 'wrap' }}>

          {/* Left — text */}
          <div style={{ flex: '1 1 400px', maxWidth: 560 }}>

            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 12px', borderRadius: 20, marginBottom: 28,
              background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.18)',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E', animation: 'pulse 2.5s ease-in-out infinite' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(167,139,250,.82)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Operational Intelligence</span>
            </div>

            <h1 style={{
              fontSize: 'clamp(40px, 5vw, 62px)', fontWeight: 700,
              letterSpacing: '-.03em', lineHeight: 1.06,
              color: '#F1F5F9', margin: '0 0 22px',
            }}>
              Your operations,<br />
              <span style={{
                background: 'linear-gradient(135deg, #818CF8 0%, #A78BFA 55%, #C084FC 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>unified.</span>
            </h1>

            <p style={{
              fontSize: 17, lineHeight: 1.75, margin: '0 0 36px',
              color: 'rgba(226,232,240,.72)', maxWidth: 460,
            }}>
              One intelligent platform for every council service — fleet, waste, water, roads, parks, and more.
              Ask HLNΛ in plain English and get answers from your live operational data in seconds.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href="/command" style={{
                padding: '11px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: 'rgba(99,102,241,.18)', border: '1px solid rgba(99,102,241,.38)',
                color: '#F1F5F9', textDecoration: 'none', letterSpacing: '.01em',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06)',
                transition: 'border-color .15s, background .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,.28)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,.55)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,.18)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,.38)'; }}>
                Open Command Centre
              </Link>
              <Link href="/dashboards" style={{
                padding: '11px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: 'transparent', border: '1px solid rgba(255,255,255,.11)',
                color: 'rgba(226,232,240,.62)', textDecoration: 'none', letterSpacing: '.01em',
                transition: 'color .15s, border-color .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = 'rgba(226,232,240,.88)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.22)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(226,232,240,.62)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.11)'; }}>
                Browse Dashboards →
              </Link>
            </div>
          </div>

          {/* Right — orb */}
          <div style={{ flex: '0 1 580px', minWidth: 320, display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>

            {/* Atmospheric bloom behind orb */}
            <div style={{
              position: 'absolute', inset: -60,
              background: 'radial-gradient(circle at 50% 48%, rgba(79,70,229,.22) 0%, rgba(99,102,241,.10) 45%, transparent 70%)',
              filter: 'blur(40px)',
              animation: 'heroGlow 7s ease-in-out infinite',
              pointerEvents: 'none',
            }} />

            {/* Orb — transparent asset, floats on page background */}
            <div style={{ position: 'relative', width: '100%', maxWidth: 520 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hlna-orb-only.webp"
                alt="HLNA"
                style={{
                  width: '100%', display: 'block',
                  objectFit: 'contain',
                  animation: 'orbFloat 6s ease-in-out infinite',
                  filter: 'drop-shadow(0 0 40px rgba(120,80,255,.65)) drop-shadow(0 0 100px rgba(80,120,255,.45))',
                }}
              />
            </div>
          </div>
        </section>

        {/* ── Stats bar ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 0,
          borderRadius: 12, overflow: 'hidden',
          border: '1px solid rgba(255,255,255,.07)',
          marginBottom: 72,
        }}>
          {[
            { value: '12', label: 'Intelligence modules' },
            { value: 'HLNΛ', label: 'Voice AI assistant' },
            { value: '3', label: 'Wake modes (voice, space, chat)' },
            { value: 'Live', label: 'Real-time data analysis' },
          ].map((s, i) => (
            <div key={i} style={{
              flex: 1, padding: '20px 24px', textAlign: 'center',
              borderRight: i < 3 ? '1px solid rgba(255,255,255,.07)' : 'none',
              background: 'rgba(255,255,255,.02)',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', marginBottom: 4 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', letterSpacing: '.04em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(139,92,246,.70)', textTransform: 'uppercase', marginBottom: 8 }}>How it works</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: 0 }}>
              From data to decision in three steps.
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{
                padding: '24px', borderRadius: 14,
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: `linear-gradient(90deg, rgba(139,92,246,.50), transparent)`,
                  borderRadius: '14px 14px 0 0',
                }} />
                <div style={{
                  width: 36, height: 36, borderRadius: 9, marginBottom: 16,
                  background: 'rgba(139,92,246,.12)', border: '1px solid rgba(139,92,246,.22)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: '#C4B5FD', letterSpacing: '.04em',
                }}>
                  {step.n}
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', margin: '0 0 8px', letterSpacing: '-.01em' }}>{step.title}</h3>
                <p style={{ fontSize: 13, color: 'rgba(226,232,240,.64)', lineHeight: 1.65, margin: 0 }}>{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Capabilities ──────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(139,92,246,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Capabilities</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: 0 }}>
              Everything you need to run operations.
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {CAPABILITIES.map((cap, i) => {
              const isHov = hoveredCap === i;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredCap(i)}
                  onMouseLeave={() => setHoveredCap(null)}
                  style={{
                    padding: '22px', borderRadius: 14, cursor: 'default',
                    background: isHov ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.03)',
                    border: isHov ? '1px solid rgba(255,255,255,.14)' : '1px solid rgba(255,255,255,.07)',
                    transform: isHov ? 'translateY(-2px)' : 'translateY(0)',
                    transition: 'all .18s', position: 'relative', overflow: 'hidden',
                  }}>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: isHov ? `linear-gradient(90deg, ${cap.color}80, rgba(139,92,246,.50))` : 'transparent',
                    transition: 'background .18s', borderRadius: '14px 14px 0 0',
                  }} />
                  <div style={{
                    width: 38, height: 38, borderRadius: 9, marginBottom: 14,
                    background: `${cap.color}14`, border: `1px solid ${cap.color}28`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: cap.color,
                  }}>
                    {cap.icon}
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', margin: '0 0 8px', letterSpacing: '-.01em' }}>{cap.title}</h3>
                  <p style={{ fontSize: 13, color: 'rgba(226,232,240,.64)', lineHeight: 1.65, margin: 0 }}>{cap.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Intelligence Modules ──────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(139,92,246,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Intelligence Modules</div>
              <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: 0 }}>
                12 dashboards. One command centre.
              </h2>
            </div>
            <Link href="/dashboards" style={{
              padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)',
              color: 'rgba(230,237,243,.60)', textDecoration: 'none', whiteSpace: 'nowrap',
            }}>
              View all →
            </Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {DASHBOARDS.map((d) => {
              const isHov = hoveredDash === d.title;
              return (
                <Link
                  key={d.title}
                  href={d.href}
                  style={{ textDecoration: 'none' }}
                  onMouseEnter={() => setHoveredDash(d.title)}
                  onMouseLeave={() => setHoveredDash(null)}
                >
                  <div style={{
                    padding: '14px 16px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12,
                    background: isHov ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.03)',
                    border: isHov ? '1px solid rgba(255,255,255,.14)' : '1px solid rgba(255,255,255,.07)',
                    transform: isHov ? 'translateY(-1px)' : 'translateY(0)',
                    transition: 'all .15s', cursor: 'pointer',
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 7, flexShrink: 0,
                      background: `${d.color}14`, border: `1px solid ${d.color}28`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: d.color,
                    }}>
                      {d.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA', lineHeight: 1.3 }}>{d.title}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.28)', letterSpacing: '.04em', marginTop: 2 }}>{d.category}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── CTA banner ────────────────────────────────────────────────── */}
        <div style={{
          padding: '40px', borderRadius: 16,
          background: 'rgba(139,92,246,.08)', border: '1px solid rgba(139,92,246,.20)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 24, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', right: -60, top: -60,
            width: 240, height: 240, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(139,92,246,.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(167,139,250,.70)', textTransform: 'uppercase', marginBottom: 8 }}>
              Ready to begin
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', margin: '0 0 8px' }}>
              Open your command centre.
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(230,237,243,.45)', margin: 0, maxWidth: 440, lineHeight: 1.5 }}>
              HLNΛ is ready. Say "Hey Helena" or press Space to start. All 12 modules are live.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <Link href="/command" style={{
              padding: '12px 24px', borderRadius: 9, fontWeight: 600, fontSize: 14,
              background: 'rgba(139,92,246,.28)', border: '1px solid rgba(139,92,246,.50)',
              color: '#F5F7FA', textDecoration: 'none', letterSpacing: '.02em',
              transition: 'background .15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,.40)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(139,92,246,.28)')}>
              Open Command Centre
            </Link>
            <Link href="/dashboards" style={{
              padding: '12px 24px', borderRadius: 9, fontWeight: 600, fontSize: 14,
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)',
              color: 'rgba(230,237,243,.75)', textDecoration: 'none', letterSpacing: '.02em',
              transition: 'background .15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.10)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.06)')}>
              Browse Modules
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

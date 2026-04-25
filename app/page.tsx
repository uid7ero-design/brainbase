"use client";

import { useState } from "react";
import Link from "next/link";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#08090C';

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

      {/* ── Ambient backdrop ──────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(139,92,246,.10) 0%, transparent 60%)',
      }} />

      {/* ── Nav ───────────────────────────────────────────────────────── */}
      <nav style={{
        height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 32px', borderBottom: '1px solid rgba(255,255,255,.06)',
        background: 'rgba(8,9,12,.92)', backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#F5F7FA', letterSpacing: '.04em' }}>
          BR<span style={{ color: '#A78BFA' }}>Λ</span>INBASE
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="/dashboards" style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', textDecoration: 'none', fontWeight: 500, transition: 'color .15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,.80)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,.45)')}>
            Dashboards
          </Link>
          <Link href="/dashboard" style={{ opacity: 0.45, textDecoration: 'none', transition: 'opacity .15s', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.45')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/brand/hlna-wordmark.svg" alt="HLNA" style={{ height: 16, width: 'auto' }} />
          </Link>
          <Link href="/command" style={{
            padding: '6px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600,
            background: 'rgba(139,92,246,.18)', border: '1px solid rgba(139,92,246,.40)',
            color: '#C4B5FD', textDecoration: 'none', letterSpacing: '.02em',
            transition: 'background .15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,.28)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(139,92,246,.18)')}>
            Command Centre
          </Link>
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 32px 96px', position: 'relative', zIndex: 1 }}>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section style={{ padding: '80px 0 72px', display: 'flex', alignItems: 'center', gap: 48, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 480px', maxWidth: 600 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '5px 12px', borderRadius: 20, marginBottom: 24,
              background: 'rgba(139,92,246,.10)', border: '1px solid rgba(139,92,246,.25)',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E' }} />
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/assets/brand/hlna-wordmark.svg" alt="HLNA" style={{ height: 12, width: 'auto', opacity: 0.9 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(167,139,250,.90)', letterSpacing: '.08em', textTransform: 'uppercase' }}>· Operational Intelligence</span>
              </span>
            </div>

            <h1 style={{
              fontSize: 'clamp(36px, 5vw, 60px)', fontWeight: 700,
              letterSpacing: '-.03em', lineHeight: 1.1,
              color: '#F5F7FA', margin: '0 0 20px',
            }}>
              Your operations,<br />
              <span style={{ color: '#A78BFA' }}>unified.</span>
            </h1>

            <p style={{ fontSize: 17, color: 'rgba(230,237,243,.55)', lineHeight: 1.7, margin: '0 0 12px', maxWidth: 480 }}>
              BrainBase connects every service — fleet, waste, water, roads, parks, and more — into one intelligent command centre.
            </p>
            <p style={{ fontSize: 15, color: 'rgba(230,237,243,.38)', lineHeight: 1.7, margin: '0 0 36px', maxWidth: 480 }}>
              Powered by HLNΛ, your AI operations analyst. Ask questions in plain English, navigate by voice, and get instant answers from your live data.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href="/command" style={{
                padding: '12px 24px', borderRadius: 9, fontSize: 14, fontWeight: 600,
                background: 'rgba(139,92,246,.22)', border: '1px solid rgba(139,92,246,.45)',
                color: '#F5F7FA', textDecoration: 'none', letterSpacing: '.02em',
                transition: 'background .15s',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,.34)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(139,92,246,.22)')}>
                Open Command Centre
              </Link>
              <Link href="/dashboards" style={{
                padding: '12px 24px', borderRadius: 9, fontSize: 14, fontWeight: 600,
                background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)',
                color: 'rgba(230,237,243,.75)', textDecoration: 'none', letterSpacing: '.02em',
                transition: 'background .15s',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.09)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.05)')}>
                Browse Dashboards →
              </Link>
            </div>
          </div>

          {/* Hero visual — voice conversation preview */}
          <div style={{ flex: '1 1 320px', maxWidth: 440 }}>
            <div style={{
              borderRadius: 16, overflow: 'hidden',
              background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)',
            }}>
              {/* Panel header */}
              <div style={{
                padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.05)',
                background: 'rgba(99,102,241,.05)', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00CFEA', boxShadow: '0 0 8px #00CFEA', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.55)', textTransform: 'uppercase' }}>HLNA</span>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,.22)', letterSpacing: '.06em', textTransform: 'uppercase' }}>· Hyper Learning Neural Agent</span>
              </div>

              {/* Conversation */}
              <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { role: 'user',      text: 'Which zone has the highest contamination rate?' },
                  { role: 'assistant', text: 'Zone 8 Industrial is at 22.4% — the highest across all zones, with 12 education actions logged and a slight upward trend of +1.2%.' },
                  { role: 'user',      text: 'Take me to fleet.' },
                  { role: 'assistant', text: 'Opening Fleet Management now.' },
                ].map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '82%', padding: '9px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
                      background: m.role === 'user' ? 'rgba(255,255,255,.05)' : 'rgba(99,102,241,.18)',
                      border: m.role === 'user' ? '1px solid rgba(255,255,255,.07)' : '1px solid rgba(99,102,241,.28)',
                      color: 'rgba(255,255,255,.85)',
                    }}>
                      {m.text}
                    </div>
                  </div>
                ))}
              </div>

              {/* Mic bar hint */}
              <div style={{
                padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,.05)',
                background: 'rgba(255,255,255,.02)', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 7,
                  background: 'rgba(124,58,237,.10)', border: '1px solid rgba(124,58,237,.28)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round">
                    <rect x="9" y="2" width="6" height="12" rx="3"/>
                    <path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/>
                  </svg>
                </div>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', letterSpacing: '.04em' }}>Hold Space or say "Hey Helena"</span>
              </div>
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
                <p style={{ fontSize: 13, color: 'rgba(230,237,243,.45)', lineHeight: 1.6, margin: 0 }}>{step.body}</p>
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
                  <p style={{ fontSize: 13, color: 'rgba(230,237,243,.42)', lineHeight: 1.6, margin: 0 }}>{cap.description}</p>
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

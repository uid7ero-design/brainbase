"use client";

import { useState } from "react";
import Link from "next/link";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#08090C';

const FEATURES = [
  {
    color: '#10B981',
    title: 'Session Management',
    description: 'Create structured sessions without guesswork.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
      </svg>
    ),
  },
  {
    color: '#38BDF8',
    title: 'Client & Player Management',
    description: 'Keep every player, client, and guardian organised.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    color: '#A78BFA',
    title: 'Weekly Schedule',
    description: 'See your entire week clearly in one place.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18"/>
        <path d="M9 21V9"/>
      </svg>
    ),
  },
  {
    color: '#6366F1',
    title: 'Website & Booking Presence',
    description: 'Create and manage your own coaching website — showcase your sessions, pricing, and locations, all connected to your system.',
    badge: 'Coming Soon',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
  },
  {
    color: '#F59E0B',
    title: 'Revenue Visibility',
    description: 'Understand what your time is worth.',
    badge: 'Coming Soon',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
  },
  {
    color: '#EC4899',
    title: 'Client Communication',
    description: 'Message players, send reminders, and keep everyone informed about sessions.',
    badge: 'Coming Soon',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
];

const SCHEDULE = [
  { day: 'Monday',    time: '4:00 pm',  type: 'Hot Shots',    revenue: 60,  capacity: 6, players: [{ name: 'Jack', paid: true }, { name: 'Emily', paid: true }, { name: 'Noah', paid: false }] },
  { day: 'Tuesday',   time: '9:00 am',  type: 'Private 60',   revenue: 70,  capacity: 1, players: [{ name: 'Sarah', paid: true }] },
  { day: 'Wednesday', time: '10:30 am', type: 'Group Program', revenue: 60,  capacity: 8, players: [{ name: 'Tom', paid: true }, { name: 'Mia', paid: false }, { name: 'Luca', paid: true }, { name: 'Zara', paid: true }] },
];

const WHO_FOR = ['Tennis & Sports Coaches', 'Personal Trainers', 'Clubs & Academies', 'Service-based Businesses'];

const FUTURE_BULLETS = [
  'Know your weekly revenue',
  'Spot empty sessions before the week starts',
  'Understand where your business is growing',
];

const PRICING = [
  {
    name: 'Starter',
    tagline: 'Get your sessions organised',
    price: 29,
    color: '#10B981',
    accentBg: 'rgba(16,185,129,.12)',
    accentBorder: 'rgba(16,185,129,.28)',
    cardBg: 'rgba(255,255,255,.03)',
    cardBorder: 'rgba(255,255,255,.08)',
    cta: 'Get Started',
    features: ['Session scheduling', 'Client management', 'Weekly schedule view'],
    popular: false,
  },
  {
    name: 'Growth',
    tagline: 'Start understanding your business',
    price: 59,
    color: '#34D399',
    accentBg: 'rgba(16,185,129,.22)',
    accentBorder: 'rgba(16,185,129,.48)',
    cardBg: 'rgba(16,185,129,.06)',
    cardBorder: 'rgba(16,185,129,.28)',
    cta: 'Start Growing',
    features: ['Everything in Starter', 'Revenue tracking', 'Session insights', 'Player tracking'],
    popular: true,
  },
  {
    name: 'Pro',
    tagline: 'Run your business like a system',
    price: 99,
    color: '#a5b4fc',
    accentBg: 'rgba(99,102,241,.16)',
    accentBorder: 'rgba(99,102,241,.34)',
    cardBg: 'rgba(255,255,255,.03)',
    cardBorder: 'rgba(99,102,241,.18)',
    cta: 'Go Pro',
    features: ['Everything in Growth', 'Advanced insights', 'Multi-location support', 'Priority support'],
    popular: false,
  },
];

export default function ForCoaches() {
  const [hoveredFeature, setHoveredFeature] = useState<number | null>(null);
  const [ctaHov,         setCtaHov]         = useState(false);
  const [heroHov,        setHeroHov]        = useState(false);
  const [heroDemoHov,    setHeroDemoHov]    = useState(false);
  const [hoveredRow,     setHoveredRow]     = useState<number | null>(null);

  return (
    <main style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
      `}</style>

      {/* Ambient backdrop */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 45% at 50% 0%, rgba(16,185,129,.10) 0%, transparent 65%)',
      }} />

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 32px 96px', position: 'relative', zIndex: 1 }}>

        {/* Back link */}
        <div style={{ paddingTop: 28 }}>
          <Link href="/" style={{
            fontSize: 13, color: 'rgba(255,255,255,.35)', textDecoration: 'none',
            letterSpacing: '.01em', transition: 'color .15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,.60)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,.35)')}>
            ← Back to home
          </Link>
        </div>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section style={{ padding: '80px 0 56px', textAlign: 'center', maxWidth: 700, margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '4px 12px', borderRadius: 20, marginBottom: 28,
            background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.20)',
          }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E', animation: 'pulse 2.5s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(52,211,153,.82)', letterSpacing: '.08em', textTransform: 'uppercase' }}>For Coaches &amp; Service Businesses</span>
          </div>

          <h1 style={{
            fontSize: 'clamp(36px, 5vw, 58px)', fontWeight: 700,
            letterSpacing: '-.03em', lineHeight: 1.08,
            color: '#F1F5F9', margin: '0 0 22px',
          }}>
            Stop Running Your<br />
            <span style={{
              background: 'linear-gradient(135deg, #34D399 0%, #10B981 55%, #059669 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>Sessions in Chaos</span>
          </h1>

          <p style={{ fontSize: 18, lineHeight: 1.75, margin: '0 0 36px', color: 'rgba(226,232,240,.68)' }}>
            See your week clearly, keep every client organised, and finally understand what your time is worth.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              href="/for-coaches/demo"
              onMouseEnter={() => setHeroHov(true)}
              onMouseLeave={() => setHeroHov(false)}
              style={{
                display: 'inline-block',
                padding: '14px 36px', borderRadius: 9, fontWeight: 600, fontSize: 15,
                background: heroHov ? 'rgba(16,185,129,.30)' : 'rgba(16,185,129,.20)',
                border: heroHov ? '1px solid rgba(16,185,129,.58)' : '1px solid rgba(16,185,129,.38)',
                color: '#F5F7FA', textDecoration: 'none', letterSpacing: '.02em',
                transition: 'background .15s, border-color .15s',
                boxShadow: heroHov ? '0 0 24px rgba(16,185,129,.15)' : 'none',
              }}>
              View the System →
            </Link>
            <Link
              href="/request-demo"
              onMouseEnter={() => setHeroDemoHov(true)}
              onMouseLeave={() => setHeroDemoHov(false)}
              style={{
                display: 'inline-block',
                padding: '14px 36px', borderRadius: 9, fontWeight: 600, fontSize: 15,
                background: 'transparent',
                border: heroDemoHov ? '1px solid rgba(255,255,255,.25)' : '1px solid rgba(255,255,255,.12)',
                color: heroDemoHov ? '#F5F7FA' : 'rgba(226,232,240,.65)',
                textDecoration: 'none', letterSpacing: '.02em',
                transition: 'border-color .15s, color .15s',
              }}>
              Request a Demo →
            </Link>
          </div>
        </section>

        {/* ── Who it's for ──────────────────────────────────────────────── */}
        <section style={{ marginBottom: 56, textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.10em', color: 'rgba(255,255,255,.22)', textTransform: 'uppercase', marginBottom: 16 }}>
            Built for
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
            {WHO_FOR.map((label, i) => (
              <div key={i} style={{
                fontSize: 13, fontWeight: 500, color: 'rgba(226,232,240,.45)',
                padding: '6px 16px', borderRadius: 20,
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
              }}>
                {label}
              </div>
            ))}
          </div>
        </section>

        {/* ── Before / After ────────────────────────────────────────────── */}
        <section style={{ marginBottom: 56 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            borderRadius: 14, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,.07)',
          }}>
            <div style={{ padding: '28px 32px', background: 'rgba(239,68,68,.03)', borderRight: '1px solid rgba(255,255,255,.07)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', color: 'rgba(248,113,113,.45)', textTransform: 'uppercase', marginBottom: 12 }}>Before</div>
              <p style={{ fontSize: 15, color: 'rgba(226,232,240,.38)', margin: 0, lineHeight: 1.55 }}>
                Spreadsheets, messages, and guessing
              </p>
            </div>
            <div style={{ padding: '28px 32px', background: 'rgba(16,185,129,.04)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', color: 'rgba(52,211,153,.60)', textTransform: 'uppercase', marginBottom: 12 }}>After</div>
              <p style={{ fontSize: 15, color: 'rgba(226,232,240,.72)', margin: 0, lineHeight: 1.55 }}>
                Clear schedule, organised clients, real numbers
              </p>
            </div>
          </div>
        </section>

        {/* ── Example block ─────────────────────────────────────────────── */}
        <section id="how-it-works" style={{ marginBottom: 72 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(52,211,153,.70)', textTransform: 'uppercase', marginBottom: 8 }}>In practice</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: 0 }}>
              Your week, structured.
            </h2>
          </div>

          <p style={{ fontSize: 14, color: 'rgba(255,255,255,.35)', marginBottom: 20, textAlign: 'center', letterSpacing: '.01em' }}>
            This is what your week could look like:
          </p>

          <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.025)' }}>

            {/* Title bar */}
            <div style={{
              padding: '12px 20px', background: 'rgba(255,255,255,.03)',
              borderBottom: '1px solid rgba(255,255,255,.07)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(239,68,68,.50)' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(245,158,11,.50)' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(16,185,129,.50)' }} />
                <span style={{ marginLeft: 8, fontSize: 11, color: 'rgba(255,255,255,.25)', letterSpacing: '.04em' }}>weekly schedule</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span style={{ fontSize: 11, color: 'rgba(52,211,153,.60)', letterSpacing: '.04em', fontFamily: '"JetBrains Mono", monospace' }}>● Live</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,.22)' }}>Updated just now</span>
              </div>
            </div>

            <div style={{ padding: '20px 28px 24px', fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace' }}>
              {SCHEDULE.map((session, i) => {
                const isHov = hoveredRow === i;
                return (
                  <div key={i}
                    onMouseEnter={() => setHoveredRow(i)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{
                      display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap',
                      padding: '16px 10px', borderRadius: 8,
                      borderBottom: i < SCHEDULE.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                      background: isHov ? 'rgba(16,185,129,.04)' : 'transparent',
                      transform: isHov ? 'translateX(2px)' : 'translateX(0)',
                      transition: 'all .15s',
                    }}>
                    <div style={{ minWidth: 148, flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#34D399', marginBottom: 2 }}>{session.day}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.28)' }}>{session.time}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                        <div style={{
                          fontSize: 11, fontWeight: 600, letterSpacing: '.04em',
                          padding: '3px 10px', borderRadius: 6,
                          background: 'rgba(16,185,129,.10)', border: '1px solid rgba(16,185,129,.22)',
                          color: '#6EE7B7',
                        }}>
                          {session.type}
                        </div>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.30)' }}>
                          ${session.revenue} · {session.players.length}/{session.capacity} players
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {session.players.map((player, j) => (
                          <span key={j} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 11, borderRadius: 20, padding: '2px 9px',
                            color: player.paid ? 'rgba(226,232,240,.70)' : 'rgba(226,232,240,.50)',
                            background: player.paid ? 'rgba(255,255,255,.05)' : 'rgba(245,158,11,.06)',
                            border: player.paid ? '1px solid rgba(255,255,255,.09)' : '1px solid rgba(245,158,11,.20)',
                          }}>
                            {player.paid
                              ? <span style={{ color: '#34D399', fontSize: 9 }}>✓</span>
                              : <span style={{ color: '#F59E0B', fontSize: 9 }}>⏳</span>
                            }
                            {player.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Revenue total */}
              <div style={{ marginTop: 4, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.38)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 3 }}>Weekly revenue</div>
                    <div style={{ fontSize: 11, color: 'rgba(52,211,153,.55)' }}>+ $185 today</div>
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 700, color: '#6EE7B7', letterSpacing: '-.03em', textShadow: '0 0 20px rgba(52,211,153,.35)' }}>$1,420</div>
                </div>
              </div>

              {/* Insight */}
              <div style={{ marginTop: 14, padding: '9px 14px', borderRadius: 8, background: 'rgba(245,158,11,.05)', border: '1px solid rgba(245,158,11,.12)' }}>
                <span style={{ fontSize: 12, color: 'rgba(245,158,11,.70)' }}>⚠ 2 sessions below capacity</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 16 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(52,211,153,.70)', textTransform: 'uppercase', marginBottom: 8 }}>What you get</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: 0 }}>
              Run your entire operation from one place
            </h2>
          </div>

          {[
            { label: 'Core System',    slice: [0, 3] as [number, number] },
            { label: 'Business Layer', slice: [3, 6] as [number, number] },
          ].map(({ label, slice }) => (
            <div key={label} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.22)', marginBottom: 12 }}>{label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {FEATURES.slice(...slice).map((feat, idx) => {
                  const i = slice[0] + idx;
                  const isHov = hoveredFeature === i;
                  return (
                    <div
                      key={i}
                      onMouseEnter={() => setHoveredFeature(i)}
                      onMouseLeave={() => setHoveredFeature(null)}
                      style={{
                        padding: '24px', borderRadius: 14, cursor: 'default',
                        background: isHov ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.03)',
                        border: isHov ? '1px solid rgba(255,255,255,.13)' : '1px solid rgba(255,255,255,.07)',
                        transform: isHov ? 'translateY(-2px)' : 'translateY(0)',
                        transition: 'all .18s', position: 'relative', overflow: 'hidden',
                      }}>
                      <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                        background: isHov ? `linear-gradient(90deg, ${feat.color}80, transparent)` : 'transparent',
                        transition: 'background .18s', borderRadius: '14px 14px 0 0',
                      }} />
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 10,
                          background: `${feat.color}14`, border: `1px solid ${feat.color}28`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: feat.color,
                        }}>
                          {feat.icon}
                        </div>
                        {feat.badge && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, letterSpacing: '.06em',
                            padding: '3px 8px', borderRadius: 20,
                            background: `${feat.color}12`, border: `1px solid ${feat.color}25`,
                            color: feat.color, textTransform: 'uppercase',
                          }}>
                            {feat.badge}
                          </span>
                        )}
                      </div>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', margin: '0 0 8px', letterSpacing: '-.01em' }}>{feat.title}</h3>
                      <p style={{ fontSize: 13, color: 'rgba(226,232,240,.60)', lineHeight: 1.65, margin: 0 }}>{feat.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {/* ── HLNA positioning ──────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', padding: '28px 0 56px' }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.20)', letterSpacing: '.05em' }}>
            Powered by HLNΛ — your operational intelligence layer
          </span>
        </div>

        {/* ── Coming soon ───────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <div style={{
            padding: '32px 36px', borderRadius: 14,
            background: 'rgba(99,102,241,.04)', border: '1px solid rgba(99,102,241,.12)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.10em', color: 'rgba(165,180,252,.45)', textTransform: 'uppercase', marginBottom: 12 }}>
              Coming next
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#F5F7FA', margin: '0 0 18px', letterSpacing: '-.01em' }}>
              Soon you'll be able to:
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {FUTURE_BULLETS.map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(165,180,252,.35)', flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: 'rgba(226,232,240,.45)' }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Value bridge ─────────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <p style={{ fontSize: 16, color: 'rgba(226,232,240,.55)', margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>
            You&apos;re already running sessions — this shows you what they&apos;re worth.
          </p>
        </div>

        {/* ── Pricing ───────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(52,211,153,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Pricing</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 10px' }}>
              Start running your business properly
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,.32)', margin: 0 }}>
              Stop guessing your schedule, your clients, and your income.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
            {PRICING.map((plan, i) => (
              <div key={i} style={{
                padding: '32px 28px', borderRadius: 16, position: 'relative', overflow: 'hidden',
                background: plan.cardBg, border: `1px solid ${plan.cardBorder}`,
                boxShadow: plan.popular ? '0 0 32px rgba(16,185,129,.08)' : 'none',
              }}>
                {plan.popular && (
                  <div style={{
                    position: 'absolute', top: 16, right: 16,
                    fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                    padding: '3px 10px', borderRadius: 20,
                    background: 'rgba(16,185,129,.16)', border: '1px solid rgba(16,185,129,.35)',
                    color: '#34D399',
                  }}>Most Popular</div>
                )}

                <div style={{ fontSize: 13, fontWeight: 600, color: plan.color, marginBottom: 4 }}>{plan.name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.36)', marginBottom: 18, lineHeight: 1.4 }}>{plan.tagline}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 24 }}>
                  <span style={{ fontSize: 40, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.03em' }}>${plan.price}</span>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,.30)' }}> / month</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 28 }}>
                  {plan.features.map((f, j) => (
                    <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <svg width="13" height="13" viewBox="0 0 12 9" fill="none">
                        <path d="M1 4.5L4.5 8L11 1" stroke={plan.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span style={{ fontSize: 13, color: 'rgba(226,232,240,.62)' }}>{f}</span>
                    </div>
                  ))}
                </div>

                <Link href="/request-demo" style={{
                  display: 'block', textAlign: 'center',
                  width: '100%', padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  fontFamily: FONT, textDecoration: 'none',
                  background: plan.accentBg, border: `1px solid ${plan.accentBorder}`,
                  color: plan.popular ? '#F5F7FA' : plan.color,
                  transition: 'opacity .15s', boxSizing: 'border-box',
                }}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,.30)', margin: '0 0 8px' }}>
            No contracts. Cancel anytime.
          </p>
          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.18)', margin: 0 }}>
            Early access pricing — limited to first users.
          </p>
        </section>

        {/* ── Social proof ──────────────────────────────────────────────── */}
        <section style={{ marginBottom: 72 }}>
          <div style={{
            padding: '32px 40px', borderRadius: 14,
            background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', color: 'rgba(255,255,255,.25)', textTransform: 'uppercase', marginBottom: 10 }}>
              Real businesses
            </div>
            <p style={{ fontSize: 17, fontWeight: 500, color: 'rgba(230,237,243,.72)', margin: 0, lineHeight: 1.6 }}>
              Built with real coaching businesses — starting with{' '}
              <a href="https://ldtennis.com.au" target="_blank" rel="noopener noreferrer" style={{ color: '#34D399', fontWeight: 600, textDecoration: 'none', borderBottom: '1px solid rgba(52,211,153,.35)', paddingBottom: 1 }}>LD Tennis</a>
            </p>
          </div>
        </section>

        {/* ── CTA section ───────────────────────────────────────────────── */}
        <div style={{
          padding: '48px 40px', borderRadius: 16,
          background: 'rgba(16,185,129,.07)', border: '1px solid rgba(16,185,129,.18)',
          textAlign: 'center', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', left: '50%', top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 400, height: 200, borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(16,185,129,.08) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(52,211,153,.70)', textTransform: 'uppercase', marginBottom: 12 }}>
              Ready
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', margin: '0 0 12px' }}>
              Know your schedule. Know your clients. Know your numbers.
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(230,237,243,.45)', margin: '0 0 28px', lineHeight: 1.55 }}>
              See exactly how your sessions, clients, and revenue connect.
            </p>
            <Link
              href="/request-demo"
              onMouseEnter={() => setCtaHov(true)}
              onMouseLeave={() => setCtaHov(false)}
              style={{
                display: 'inline-block',
                padding: '13px 32px', borderRadius: 9, fontWeight: 600, fontSize: 15,
                background: ctaHov ? 'rgba(16,185,129,.30)' : 'rgba(16,185,129,.20)',
                border: ctaHov ? '1px solid rgba(16,185,129,.58)' : '1px solid rgba(16,185,129,.38)',
                color: '#F5F7FA', textDecoration: 'none', letterSpacing: '.02em',
                transition: 'background .15s, border-color .15s',
                boxShadow: ctaHov ? '0 0 24px rgba(16,185,129,.15)' : 'none',
              }}>
              Request a Demo →
            </Link>
          </div>
        </div>

      </div>
    </main>
  );
}

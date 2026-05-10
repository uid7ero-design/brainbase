"use client";

import { useState } from "react";
import Link from "next/link";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#08090C';

const DEMO_SCHEDULE = [
  { day: 'Monday',    time: '4:00 pm',  type: 'Hot Shots',    capacity: 6, players: [{ name: 'Jack', paid: true }, { name: 'Emily', paid: true }, { name: 'Noah', paid: false }],                                  revenue: 60 },
  { day: 'Tuesday',   time: '9:00 am',  type: 'Private 60',   capacity: 1, players: [{ name: 'Sarah', paid: true }],                                                                                              revenue: 70 },
  { day: 'Wednesday', time: '10:30 am', type: 'Group Program', capacity: 6, players: [{ name: 'Tom', paid: true }, { name: 'Mia', paid: true }, { name: 'Luca', paid: false }],                                   revenue: 60 },
  { day: 'Thursday',  time: '5:00 pm',  type: 'Private 30',   capacity: 1, players: [{ name: 'James', paid: true }],                                                                                             revenue: 35 },
  { day: 'Friday',    time: '3:30 pm',  type: 'Hot Shots',    capacity: 6, players: [{ name: 'Olivia', paid: true }, { name: 'Ben', paid: true }, { name: 'Chloe', paid: true }, { name: 'Ryan', paid: false }], revenue: 80 },
];

const TOTAL = DEMO_SCHEDULE.reduce((s, d) => s + d.revenue, 0);

export default function CoachingDemoPage() {
  const [ctaHov,         setCtaHov]        = useState(false);
  const [scheduleCtaHov, setScheduleCtaHov] = useState(false);
  const [hoveredRow,     setHoveredRow]     = useState<number | null>(null);

  return (
    <main style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }`}</style>

      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(16,185,129,.09) 0%, transparent 65%)',
      }} />

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 32px 96px', position: 'relative', zIndex: 1 }}>

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

        {/* Hero */}
        <section style={{ padding: '72px 0 56px', textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '4px 12px', borderRadius: 20, marginBottom: 24,
            background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.18)',
          }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E', animation: 'pulse 2.5s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(52,211,153,.82)', letterSpacing: '.08em', textTransform: 'uppercase' }}>System Demo</span>
          </div>

          <h1 style={{
            fontSize: 'clamp(30px, 4.5vw, 50px)', fontWeight: 700,
            letterSpacing: '-.03em', lineHeight: 1.1,
            color: '#F1F5F9', margin: '0 0 18px',
          }}>
            See how your week actually runs
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(226,232,240,.50)', margin: '0 auto', maxWidth: 500, lineHeight: 1.7 }}>
            This is how your sessions, clients, and revenue connect in one place.
          </p>
        </section>

        {/* Schedule context header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', margin: '0 0 8px' }}>
            This is your week in real-time
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(226,232,240,.40)', margin: 0, lineHeight: 1.55 }}>
            Every session, every player, every dollar — in one place.
          </p>
        </div>

        {/* Mock schedule dashboard */}
        <section style={{ marginBottom: 32 }}>
          <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,.09)', background: 'rgba(255,255,255,.025)' }}>

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
                <span style={{ marginLeft: 8, fontSize: 11, color: 'rgba(255,255,255,.25)', letterSpacing: '.04em', fontFamily: '"JetBrains Mono", monospace' }}>weekly schedule</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span style={{ fontSize: 11, color: 'rgba(52,211,153,.60)', letterSpacing: '.04em', fontFamily: '"JetBrains Mono", monospace' }}>● Live</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,.22)' }}>Updated just now</span>
              </div>
            </div>

            <div style={{ padding: '8px 28px 24px', fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace' }}>
              {DEMO_SCHEDULE.map((session, i) => {
                const isHov = hoveredRow === i;
                return (
                  <div key={i}
                    onMouseEnter={() => setHoveredRow(i)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{
                      display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap',
                      padding: '16px 10px', borderRadius: 8,
                      borderBottom: i < DEMO_SCHEDULE.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
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
                          {session.players.length}/{session.capacity} players
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {session.players.map((p, j) => (
                          <span key={j} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 11, borderRadius: 20, padding: '2px 9px',
                            color: p.paid ? 'rgba(226,232,240,.70)' : 'rgba(226,232,240,.50)',
                            background: p.paid ? 'rgba(255,255,255,.05)' : 'rgba(245,158,11,.06)',
                            border: p.paid ? '1px solid rgba(255,255,255,.09)' : '1px solid rgba(245,158,11,.20)',
                          }}>
                            {p.paid
                              ? <span style={{ color: '#34D399', fontSize: 9 }}>✓</span>
                              : <span style={{ color: '#F59E0B', fontSize: 9 }}>⏳</span>
                            }
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, paddingTop: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(52,211,153,.65)' }}>${session.revenue}</span>
                    </div>
                  </div>
                );
              })}

              {/* Revenue total */}
              <div style={{ marginTop: 4, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.38)', marginBottom: 3 }}>Weekly Revenue</div>
                  <div style={{ fontSize: 11, color: 'rgba(52,211,153,.55)' }}>+ $80 today</div>
                </div>
                <div style={{ fontSize: 32, fontWeight: 700, color: '#6EE7B7', letterSpacing: '-.03em', textShadow: '0 0 20px rgba(52,211,153,.35)' }}>${TOTAL.toLocaleString()}</div>
              </div>

              {/* Insight */}
              <div style={{ marginTop: 14, padding: '9px 14px', borderRadius: 8, background: 'rgba(52,211,153,.05)', border: '1px solid rgba(52,211,153,.14)' }}>
                <span style={{ fontSize: 12, color: 'rgba(52,211,153,.70)' }}>📈 Friday is your highest earning day</span>
              </div>
            </div>
          </div>
        </section>

        {/* Post-schedule CTA */}
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <Link
            href="/app"
            onMouseEnter={() => setScheduleCtaHov(true)}
            onMouseLeave={() => setScheduleCtaHov(false)}
            style={{
              display: 'inline-block',
              padding: '12px 32px', borderRadius: 9, fontWeight: 600, fontSize: 14,
              background: scheduleCtaHov ? 'rgba(16,185,129,.28)' : 'rgba(16,185,129,.18)',
              border: scheduleCtaHov ? '1px solid rgba(16,185,129,.55)' : '1px solid rgba(16,185,129,.36)',
              color: '#F5F7FA', textDecoration: 'none', letterSpacing: '.02em',
              transition: 'background .15s, border-color .15s',
              boxShadow: scheduleCtaHov ? '0 0 24px rgba(16,185,129,.15)' : 'none',
            }}>
            Start your week like this →
          </Link>
        </div>

        {/* Three pillars */}
        <section style={{ marginBottom: 64 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {[
              { color: '#34D399', label: 'Your schedule', body: 'Every session, every day — structured and visible at a glance.' },
              { color: '#60a5fa', label: 'Your clients',  body: 'Every player linked to their session, guardian details included.' },
              { color: '#a5b4fc', label: 'Your numbers',  body: 'See what each week is actually worth — not a guess, the real figure.' },
            ].map((item, i) => (
              <div key={i} style={{
                padding: '22px 20px', borderRadius: 12,
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: item.color, marginBottom: 10, opacity: .80 }}>{item.label}</div>
                <p style={{ fontSize: 13, color: 'rgba(226,232,240,.55)', lineHeight: 1.65, margin: 0 }}>{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,.28)', marginBottom: 24 }}>
            Ready to set up your real schedule?
          </p>
          <Link
            href="/request-demo"
            onMouseEnter={() => setCtaHov(true)}
            onMouseLeave={() => setCtaHov(false)}
            style={{
              display: 'inline-block',
              padding: '14px 40px', borderRadius: 9, fontWeight: 600, fontSize: 15,
              background: ctaHov ? 'rgba(16,185,129,.30)' : 'rgba(16,185,129,.20)',
              border: ctaHov ? '1px solid rgba(16,185,129,.58)' : '1px solid rgba(16,185,129,.38)',
              color: '#F5F7FA', textDecoration: 'none', letterSpacing: '.02em',
              transition: 'background .15s, border-color .15s',
              boxShadow: ctaHov ? '0 0 28px rgba(16,185,129,.18)' : 'none',
            }}>
            Request a Demo →
          </Link>
          <p style={{ marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,.18)' }}>
            No contracts. Cancel anytime.
          </p>
        </div>

      </div>
    </main>
  );
}

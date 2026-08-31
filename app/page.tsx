'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import CommandDemo from '@/components/CommandDemo';
import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark';
import { OrbitalBackground } from '@/components/brand/OrbitalBackground';
import { HeroOrbitMark } from '@/components/brand/HeroOrbitMark';

const FONT =
  'var(--font-inter), "Inter", -apple-system, sans-serif';

const BG = '#07080B';

const KEYFRAMES = `
  html {
    scroll-behavior: smooth;
  }

  @keyframes glowPulse {
    0%, 100% {
      opacity: .45;
    }

    50% {
      opacity: .82;
    }
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }

    50% {
      opacity: .38;
    }
  }

  .bb-home-path-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .bb-home-module-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .bb-home-outcome-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .bb-home-how-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .bb-home-two-col-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .bb-home-hlna-grid {
    display: grid;
    grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr);
    gap: 56px;
    align-items: center;
  }

  @media (max-width: 920px) {
    .bb-home-path-grid,
    .bb-home-module-grid,
    .bb-home-how-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .bb-home-outcome-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .bb-home-hlna-grid {
      grid-template-columns: 1fr;
      gap: 36px;
    }
  }

  @media (max-width: 680px) {
    .bb-home-shell,
    .bb-home-hero-inner {
      padding-left: 18px !important;
      padding-right: 18px !important;
    }

    .bb-home-hero {
      min-height: auto !important;
      padding-top: 62px !important;
      padding-bottom: 72px !important;
    }

    .bb-hero-orbit-mark {
      width: 260px !important;
      height: 260px !important;
    }

    .bb-home-path-grid,
    .bb-home-module-grid,
    .bb-home-outcome-grid,
    .bb-home-how-grid,
    .bb-home-two-col-grid {
      grid-template-columns: 1fr;
    }

    .bb-home-section-card {
      padding: 30px 22px !important;
    }

    .bb-home-cta {
      padding: 38px 22px !important;
    }

    .bb-home-footer {
      padding-left: 18px !important;
      padding-right: 18px !important;
    }
  }
`;

const PROOF_POINTS = [
  'Start with what you need',
  'Connect existing systems',
  'Expand when ready',
];

const PROBLEM_TOOLS = [
  'Website & forms',
  'Email',
  'Spreadsheets',
  'Calendars',
  'CRM',
  'Reporting',
  'Specialist systems',
];

const SOLUTION_OUTCOMES = [
  {
    title: 'One operational view',
    body: 'Bring disconnected information, systems and workflows into one environment.',
    color: '#8A4DFF',
  },
  {
    title: 'Less manual admin',
    body: 'Reduce repetitive work, duplicated entry and time spent moving between tools.',
    color: '#38BDF8',
  },
  {
    title: 'Faster decisions',
    body: 'Surface the information that matters without manually searching across systems.',
    color: '#A78BFA',
  },
  {
    title: 'Better visibility',
    body: 'Understand activity, performance and priorities from a clearer operational picture.',
    color: '#22C55E',
  },
];

const CAPABILITIES = [
  {
    title: 'Clients & CRM',
    description:
      'Contacts, pipelines, communication history and client activity in one connected workspace.',
    color: '#8A4DFF',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: 'Leads',
    description:
      'Capture enquiries and follow them through to a client without losing track of where things stand.',
    color: '#22C55E',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16l-6 8v7l-4 2v-9z" />
      </svg>
    ),
  },
  {
    title: 'Scheduling & Bookings',
    description:
      'Manage appointments, sessions, programs and capacity with less manual coordination.',
    color: '#38BDF8',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    title: 'Workflow Automation',
    description:
      'Reduce repetitive admin with connected processes, triggers and follow-up workflows.',
    color: '#F59E0B',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    title: 'Dashboards & Reporting',
    description:
      'Operational KPIs, trends and reporting brought together in a clear visual layer.',
    color: '#A78BFA',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    title: 'Web Systems',
    description:
      'Websites that capture enquiries and connect directly into your wider operational environment.',
    color: '#6366F1',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    title: 'HLNΛ Intelligence',
    description:
      'Ask questions and surface what matters across your connected operation.',
    color: '#EC4899',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
      </svg>
    ),
  },
  {
    title: 'Events & Ticketing',
    description:
      'Publish events with multiple free and paid ticket types, manage registrations, and issue digital tickets with QR check-in. Stripe Connect settles payments directly to your own bank account.',
    color: '#FBBF24',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
        <path d="M13 5v14" strokeDasharray="2 2" />
      </svg>
    ),
  },
];

const CONFIG_EXAMPLES = [
  {
    title: 'Tennis organisation',
    color: '#8A4DFF',
    items: ['Courts', 'Coaching sessions', 'Players', 'Capacity'],
  },
  {
    title: 'Consultancy',
    color: '#38BDF8',
    items: [
      'Consultations',
      'Appointment durations',
      'Intake questions',
      'Teams meetings',
    ],
  },
];

const INTEGRATION_CAPABILITIES = [
  'Clients & CRM',
  'Scheduling & Bookings',
  'Dashboards & Reporting',
];

const HOW_STEPS = [
  {
    n: '01',
    title: 'Capture',
    body: 'Bring information in from enquiries, forms, bookings and the systems you already use.',
  },
  {
    n: '02',
    title: 'Organise',
    body: 'Turn that information into structured clients, leads, schedules and records.',
  },
  {
    n: '03',
    title: 'Operate',
    body: 'Run day-to-day work — follow-up, sessions, workflows and communication — in one place.',
  },
  {
    n: '04',
    title: 'Understand',
    body: 'Use dashboards and HLNΛ to see what needs attention.',
  },
];

const INTELLIGENCE = [
  {
    title: 'Ask your operation',
    body: 'Use natural language to interrogate the information available inside BRΛINBΛSE.',
  },
  {
    title: 'Surface what matters',
    body: 'HLNΛ helps identify important activity, changes and operational signals.',
  },
  {
    title: 'Connected context',
    body: 'Bring information from across the platform together around the question being asked.',
  },
  {
    title: 'Move toward action',
    body: 'Use intelligence to help navigate priorities, workflows and decisions.',
  },
];

const PROOF_FLOW = [
  'Website enquiries → leads',
  'Leads → organised clients',
  'Clients → scheduled sessions',
  'Activity → operational dashboard',
];

const STARTING_POINTS = [
  {
    eyebrow: 'Client Operations',
    title: 'Run clients, bookings and follow-up in one place.',
    body: 'A BRΛINBΛSE configuration for client-based businesses — leads, clients, bookings and follow-up in one connected environment.',
    href: '/client-operations',
    action: 'Explore Client Operations',
    color: '#8A4DFF',
    number: '01',
  },
  {
    eyebrow: 'Web Systems',
    title: 'Turn your website into part of the operation.',
    body: 'Start with the customer-facing website and connect the operation behind it — enquiries, CRM, workflows and reporting.',
    href: '/web-systems',
    action: 'Explore Web Systems',
    color: '#6366F1',
    number: '02',
  },
  {
    eyebrow: 'Platform Demo',
    title: 'See the wider BRΛINBΛSE platform in action.',
    body: 'Explore an interactive example showing how connected information, workflows, dashboards and HLNΛ come together.',
    href: '/demo',
    action: 'Explore the platform demo',
    color: '#38BDF8',
    number: '03',
  },
];

export default function Home() {
  const [hoveredCapability, setHoveredCapability] = useState<number | null>(null);
  const [hoveredOutcome, setHoveredOutcome] = useState<number | null>(null);
  const [hoveredPath, setHoveredPath] = useState<number | null>(null);

  useEffect(() => {
    if (window.location.hash) {
      return;
    }

    const scrollToTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };

    scrollToTop();

    const frame = window.requestAnimationFrame(scrollToTop);
    const timer = window.setTimeout(scrollToTop, 50);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: BG,
        color: '#F5F7FA',
        fontFamily: FONT,
        overflow: 'hidden',
      }}
    >
      <style>{KEYFRAMES}</style>

      {/* Hybrid Orbit atmosphere — Phase D.3, tuned in D.3.1, made
          persistent/page-level in D.3.1B. Previously scoped to just the
          hero section; now a single fixed layer behind the whole page
          (position:fixed via the style override, inset:0, zIndex 0) so
          content scrolls normally above it instead of the atmosphere
          being a one-off hero graphic that cuts abruptly to flat black
          below. Intensity is NOT varied here — OrbitalBackground itself
          stays at one setting for the whole page (per instruction: one
          shared instance, not duplicated/re-tuned per section). The
          "gets quieter further down the page" effect is achieved entirely
          by the zone scrims below progressively obscuring more of this
          same fixed layer as they scroll into view — not by touching this
          component or its props. */}
      <OrbitalBackground
        variant="field"
        intensity="high"
        placement="top-right"
        style={{ position: 'fixed' }}
      />

      {/* ==================================================================
          1. HERO — Phase D.3.1: pulled out of bb-home-shell's maxWidth:1220
          constraint so the section (and OrbitalBackground within it) can
          span the full available viewport width — the previous nested
          structure boxed the atmosphere/artwork in at 1220px minus 64px of
          padding, which is why the old hero visual clipped rather than
          simply cropping naturally at the edges. Content itself still sits
          inside its own maxWidth:1220 inner wrapper immediately below, so
          readable width is unchanged — only the section's background layer
          now reaches the true viewport edges.
      =================================================================== */}

      <section
        className="bb-home-hero"
        style={{
          minHeight: 'calc(100vh - 52px)',
          display: 'flex',
          alignItems: 'center',
          padding: '50px 0 78px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Content-safe mask (D.3.1) — fades the atmosphere out behind the
            headline/copy/CTA column so decorative rings/nodes never
            compete with glyphs, while leaving it at full strength toward
            the right (where the hero visual now carries the primary
            visual weight) and the outer edges. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: 'linear-gradient(90deg, rgba(7,8,11,.82) 0%, rgba(7,8,11,.58) 32%, rgba(7,8,11,.18) 52%, transparent 66%)',
          }}
        />

        <div
          className="bb-home-hero-inner"
          style={{
            maxWidth: 1220,
            margin: '0 auto',
            padding: '0 32px',
            width: '100%',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: 64,
              alignItems: 'center',
              width: '100%',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <div style={{ maxWidth: 620, position: 'relative', zIndex: 2 }}>
              <div style={{ marginBottom: 31, display: 'inline-flex', alignItems: 'center' }}>
                <BrainBaseWordmark
                  width={280}
                  style={{ maxWidth: '90vw' }}
                />
              </div>

              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  marginBottom: 22,
                  borderRadius: 999,
                  background: 'rgba(255,255,255,.024)',
                  border: '1px solid rgba(255,255,255,.085)',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#22C55E',
                    boxShadow: '0 0 7px rgba(34,197,94,.85)',
                    animation: 'pulse 2.5s ease-in-out infinite',
                  }}
                />

                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 650,
                    letterSpacing: '.11em',
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,.52)',
                  }}
                >
                  Connected operational platform
                </span>
              </div>

              <h1
                style={{
                  margin: '0 0 24px',
                  maxWidth: 610,
                  fontSize: 'clamp(42px, 5.4vw, 68px)',
                  lineHeight: 1.02,
                  fontWeight: 650,
                  letterSpacing: '-.045em',
                  color: '#F5F7FA',
                }}
              >
                One platform.
                <br />
                <span
                  style={{
                    background: 'linear-gradient(100deg, #8A4DFF 0%, #A78BFA 46%, #5C7CFF 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  Built around how
                </span>
                <br />
                your business works.
              </h1>

              <p
                style={{
                  margin: '0 0 26px',
                  maxWidth: 535,
                  fontSize: 16,
                  lineHeight: 1.72,
                  color: 'rgba(226,232,240,.70)',
                }}
              >
                BRΛINBΛSE brings the parts of your operation that matter into
                one connected environment. Start with the capabilities you
                need, configure them around your workflow and connect the
                systems you already use.
              </p>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginBottom: 22,
                }}
              >
                <Link
                  href="/demo"
                  style={{
                    height: 46,
                    padding: '0 22px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 9,
                    background: 'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                    color: '#FFFFFF',
                    fontSize: 13,
                    fontWeight: 650,
                    textDecoration: 'none',
                    boxShadow: '0 8px 26px rgba(106,61,255,.22)',
                  }}
                >
                  Explore BRΛINBΛSE →
                </Link>

                <Link
                  href="/request-demo"
                  style={{
                    height: 44,
                    padding: '0 20px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 9,
                    border: '1px solid rgba(255,255,255,.10)',
                    background: 'rgba(255,255,255,.025)',
                    color: 'rgba(245,247,250,.72)',
                    textDecoration: 'none',
                    fontSize: 13,
                    fontWeight: 550,
                  }}
                >
                  Discuss your operation
                </Link>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap',
                  marginBottom: 20,
                }}
              >
                {PROOF_POINTS.map((point, index) => (
                  <div
                    key={point}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                    }}
                  >
                    {index > 0 && (
                      <span
                        style={{
                          width: 3,
                          height: 3,
                          borderRadius: '50%',
                          background: 'rgba(255,255,255,.18)',
                        }}
                      />
                    )}

                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 550,
                        color: 'rgba(226,232,240,.52)',
                      }}
                    >
                      {point}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,.34)',
                  }}
                >
                  Intelligence layer
                </span>

                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.10em',
                    color: '#F5F7FA',
                  }}
                >
                  HLN<span style={{ color: '#8A4DFF' }}>Λ</span>
                </span>

                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: '#22C55E',
                    boxShadow: '0 0 5px rgba(34,197,94,.7)',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                minHeight: 590,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                transform: 'translateY(-10px)',
              }}
            >
              {/* Phase D.3.1 — replaces this page's standalone raster
                  lens-style hero <img> (public/hlna-orb-only.webp, a
                  camera-aperture-looking asset predating and conflicting
                  with Hybrid Orbit) with HeroOrbitMark: a dedicated,
                  static/presentational SVG built from the same approved
                  master mark geometry OrbitalBackground and HelenaOrbital
                  both derive from — not a fourth visual system, and never
                  interactive/stateful (no listening/thinking/speaking),
                  so it can't be mistaken for Helena actually being
                  present. The webp asset itself is untouched/not deleted
                  — components/brand/HlnaOrb.jsx (the functional assistant
                  visual used elsewhere: MicButton, IntelRail, demo,
                  command, BrainBase.jsx's fallback) still loads it as its
                  own ORB_SRC; only this page's homepage-hero usage of it
                  is replaced. See components/brand/HeroOrbitMark.tsx. */}

              {/* Phase D.3.1A — broad, soft dimming layer (page-local,
                  OrbitalBackground itself untouched) covering the mark's
                  lower zone through the HLNA card below it. Live review
                  found a few of the static asset's own larger "sphere"
                  nodes near this whole area competing slightly with the
                  primary visual. Deliberately low opacity and wide/soft —
                  this softens emphasis, it does not remove the node
                  system or flatten the background. */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '60%',
                  transform: 'translate(-50%, -50%)',
                  width: 820,
                  height: 620,
                  maxWidth: '145vw',
                  maxHeight: '110vw',
                  pointerEvents: 'none',
                  background: 'radial-gradient(ellipse, rgba(7,8,11,.38) 0%, rgba(7,8,11,.2) 45%, transparent 74%)',
                }}
              />

              <div
                style={{
                  width: '100%',
                  maxWidth: 530,
                  height: 420,
                  position: 'relative',
                }}
              >
                {/* Local scrim (D.3.1) — OrbitalBackground's own baked-in
                    "core" glow (from the static asset) sat directly behind
                    this exact zone, reading as a second bright orb next to
                    HeroOrbitMark's core. This clears OrbitalBackground's
                    bleed-through in just this local box (painted first, so
                    everything below still renders on top of it) rather
                    than repositioning/weakening OrbitalBackground globally
                    — the surrounding rings/stars stay fully visible.
                    All three layers below share the exact same absolute-
                    center anchor so they align on top of one another,
                    rather than mixing absolutely-positioned glow layers
                    with a normal-flow-sized mark (which is what produced
                    two visibly offset orbs the first time). */}
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 1000,
                    height: 1000,
                    maxWidth: '140vw',
                    maxHeight: '140vw',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(7,8,11,.85) 0%, rgba(7,8,11,.55) 38%, rgba(7,8,11,.2) 58%, transparent 76%)',
                  }}
                />

                {/* D.3.1A — reduced from 480px/.16 peak opacity: at full
                    size/strength this read as a soft second core sitting
                    underneath HeroOrbitMark's own crisp one. Smaller and
                    dimmer now so it stays a halo hugging the mark's rings
                    rather than an independently-legible blob. */}
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 360,
                    height: 360,
                    maxWidth: '70vw',
                    maxHeight: '70vw',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(138,77,255,.10) 0%, rgba(88,68,220,.04) 40%, transparent 68%)',
                    filter: 'blur(24px)',
                    animation: 'glowPulse 7s ease-in-out infinite',
                  }}
                />

                {/* D.3.1A nudged the mark +26px right / -20px up from
                    dead-centre. D.3.1B: live measurement (getBoundingClientRect)
                    showed that +26px put the mark's own centre-X 26px right
                    of the HLNA card's centre-X below it — enough to read as
                    two separate things rather than one vertical group.
                    Reduced to +8px: still a small intentional rightward
                    bias (preserving overall right-side visual weight,
                    per instruction), but close enough that mark and card
                    now read as one aligned group. Vertical nudge (-20px)
                    is unaffected — that was never the alignment issue. */}
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(calc(-50% + 8px), calc(-50% - 20px))',
                  }}
                >
                  <HeroOrbitMark size={400} className="bb-hero-orbit-mark" />
                </div>
              </div>

              <div
                style={{
                  width: 'min(420px, 92%)',
                  marginTop: 28,
                  padding: '14px 15px',
                  borderRadius: 12,
                  background: 'rgba(7,8,11,.42)',
                  border: '1px solid rgba(255,255,255,.085)',
                  backdropFilter: 'blur(9px)',
                  WebkitBackdropFilter: 'blur(9px)',
                  boxShadow: '0 18px 50px rgba(0,0,0,.24)',
                  position: 'relative',
                  zIndex: 2,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: '#8A4DFF',
                      boxShadow: '0 0 7px rgba(138,77,255,.9)',
                    }}
                  />

                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 650,
                      letterSpacing: '.10em',
                      textTransform: 'uppercase',
                      color: 'rgba(167,139,250,.82)',
                    }}
                  >
                    HLNΛ · Operational intelligence
                  </span>
                </div>

                <CommandDemo placeholder="Ask BRΛINBΛSE what's happening across your operation..." />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Phase D.3.1B introduced persistent atmosphere via three
          independently-gradiented full-bleed "zone" wrappers below the
          hero. D.3.1C: live scroll QA found visible brightness seams at
          every zone boundary — root cause confirmed by measuring each
          zone's actual rendered height: Zone 1 was 1668px tall fading
          .35->.68 (≈.0002 opacity/px), Zone 2 was 3094px tall fading
          .68->.85 (≈.00006 opacity/px, ~3.6x slower), Zone 3 was 1092px
          tall fading .85->.95 (≈.00009 opacity/px, sped back up again).
          The colour VALUES matched exactly at each boundary, but the fade
          RATE didn't — each zone independently spans 0%->100% of its own
          gradient over its own arbitrary, content-driven height, so the
          fade curve's slope was discontinuous at every seam even though
          its value wasn't. Fixed by replacing the three independent
          scrims with ONE continuous veil: a single absolutely-positioned
          div (inset:0, so its height matches its container's actual
          content height automatically — never a hardcoded pixel value)
          holding one multi-stop gradient spanning the entire below-hero
          region in one unbroken curve. OrbitalBackground remains the
          single page-level fixed layer from D.3.1B, untouched here — only
          how much of it shows through changes, and now as one smooth
          function of scroll position rather than three independent ones.
          The outer wrapper still breaks out to 100vw (calc(50% - 50vw),
          safe because <main> sets overflow:'hidden') so the veil reaches
          the true viewport edges; the inner bb-home-shell keeps the exact
          same maxWidth:1220/padding/centring it always had — no section's
          own JSX/layout is touched, only what sits behind it. */}

      <div
        style={{
          position: 'relative',
          width: '100vw',
          marginLeft: 'calc(50% - 50vw)',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: 'linear-gradient(180deg, rgba(7,8,11,.28) 0%, rgba(7,8,11,.52) 30%, rgba(7,8,11,.80) 65%, rgba(7,8,11,.93) 100%)',
          }}
        />

        <div
          className="bb-home-shell"
          style={{
            maxWidth: 1220,
            margin: '0 auto',
            padding: '0 32px 96px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* PLATFORM STATEMENT */}

          <section
          style={{
            marginBottom: 104,
            padding: '28px 30px',
            borderRadius: 17,
            background: 'linear-gradient(135deg, rgba(138,77,255,.05), rgba(255,255,255,.015))',
            border: '1px solid rgba(255,255,255,.065)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 1,
            overflow: 'hidden',
          }}
        >
          {[
            ['One platform', 'Connected operations'],
            ['HLNΛ', 'Intelligence layer'],
            ['Configurable', 'Built around your operation'],
            ['Expandable', 'Add more when you need it'],
          ].map(([value, label], index) => (
            <div
              key={value}
              style={{
                padding: '13px 22px',
                textAlign: 'center',
                borderRight: index < 3 ? '1px solid rgba(255,255,255,.05)' : 'none',
              }}
            >
              <div
                style={{
                  marginBottom: 5,
                  fontSize: 17,
                  fontWeight: 650,
                  letterSpacing: '-.02em',
                  color: '#F5F7FA',
                }}
              >
                {value}
              </div>

              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.36)' }}>{label}</div>
            </div>
          ))}
        </section>

        {/* ================================================================
            2. THE PROBLEM
        ================================================================= */}

        <section style={{ marginBottom: 112 }}>
          <SectionHeading
            eyebrow="The Problem"
            title="Your business shouldn't need ten disconnected systems to get work done."
            description="Most businesses build up a mix of tools like these — usually without planning to. None of them are wrong on their own, but information gets copied between systems, follow-up gets missed and reporting turns into manual work instead of a clear picture."
            centred
          />

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 30,
            }}
          >
            {PROBLEM_TOOLS.map(tool => (
              <span
                key={tool}
                style={{
                  padding: '7px 14px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 550,
                  color: 'rgba(226,232,240,.62)',
                  background: 'rgba(255,255,255,.02)',
                  border: '1px solid rgba(255,255,255,.07)',
                }}
              >
                {tool}
              </span>
            ))}
          </div>

          <div
            style={{
              maxWidth: 620,
              margin: '0 auto',
              padding: '28px 32px',
              borderRadius: 16,
              textAlign: 'center',
              background: 'rgba(255,255,255,.018)',
              border: '1px solid rgba(255,255,255,.07)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 18,
                lineHeight: 1.5,
                fontWeight: 600,
                letterSpacing: '-.01em',
                color: 'rgba(226,232,240,.85)',
              }}
            >
              Most businesses don&apos;t have a software problem.
              <br />
              They have a{' '}
              <span style={{ color: '#A78BFA' }}>connection</span> problem.
            </p>
          </div>
        </section>

        {/* ================================================================
            3. THE SOLUTION
        ================================================================= */}

        <section style={{ marginBottom: 112 }}>
          <SectionHeading
            eyebrow="The BRΛINBΛSE Approach"
            title="One connected place to run the parts of your business that matter."
            description="BRΛINBΛSE brings the information, workflows and operational context you rely on into one connected environment."
            centred
          />

          <div className="bb-home-outcome-grid">
            {SOLUTION_OUTCOMES.map((item, index) => {
              const active = hoveredOutcome === index;

              return (
                <div
                  key={item.title}
                  onMouseEnter={() => setHoveredOutcome(index)}
                  onMouseLeave={() => setHoveredOutcome(null)}
                  style={{
                    minHeight: 175,
                    padding: '24px',
                    borderRadius: 14,
                    background: active ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.016)',
                    border: '1px solid rgba(255,255,255,.06)',
                    transition: 'all .16s',
                    transform: active ? 'translateY(-2px)' : 'translateY(0)',
                  }}
                >
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: item.color,
                      boxShadow: active ? `0 0 12px ${item.color}` : `0 0 6px ${item.color}70`,
                      marginBottom: 21,
                    }}
                  />

                  <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 650, color: '#F5F7FA' }}>
                    {item.title}
                  </h3>

                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: 'rgba(226,232,240,.58)' }}>
                    {item.body}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ================================================================
            4. START WITH WHAT YOU NEED
        ================================================================= */}

        <section style={{ marginBottom: 112 }}>
          <SectionHeading
            eyebrow="Start With What You Need"
            title="You don't need the whole platform."
            description="Here's what that looks like in practice."
            centred
          />

          <div className="bb-home-path-grid">
            <div
              style={{
                minHeight: 230,
                padding: '26px',
                borderRadius: 16,
                background: 'rgba(34,197,94,.045)',
                border: '1px solid rgba(34,197,94,.16)',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  padding: '4px 10px',
                  marginBottom: 20,
                  borderRadius: 999,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '.09em',
                  textTransform: 'uppercase',
                  color: '#6EE7B7',
                  background: 'rgba(34,197,94,.09)',
                  border: '1px solid rgba(34,197,94,.22)',
                }}
              >
                Today
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                {['CRM', 'Bookings'].map(item => (
                  <div
                    key={item}
                    style={{
                      padding: '11px 14px',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#F5F7FA',
                      background: 'rgba(7,8,11,.3)',
                      border: '1px solid rgba(255,255,255,.06)',
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                minHeight: 230,
                padding: '26px',
                borderRadius: 16,
                background: 'rgba(255,255,255,.012)',
                border: '1px dashed rgba(255,255,255,.14)',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  padding: '4px 10px',
                  marginBottom: 20,
                  borderRadius: 999,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '.09em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,.45)',
                  background: 'rgba(255,255,255,.03)',
                  border: '1px solid rgba(255,255,255,.1)',
                }}
              >
                As you grow
              </div>

              <div
                style={{
                  padding: '11px 14px',
                  marginBottom: 12,
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'rgba(226,232,240,.55)',
                  background: 'rgba(7,8,11,.2)',
                  border: '1px dashed rgba(255,255,255,.1)',
                }}
              >
                Add another capability
              </div>

              <p style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: 'rgba(226,232,240,.42)' }}>
                Shows how the platform is designed to expand — not a
                specific capability available today.
              </p>
            </div>

            <div
              style={{
                minHeight: 230,
                padding: '26px',
                borderRadius: 16,
                background: 'rgba(56,189,248,.04)',
                border: '1px solid rgba(56,189,248,.15)',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  padding: '4px 10px',
                  marginBottom: 20,
                  borderRadius: 999,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '.09em',
                  textTransform: 'uppercase',
                  color: '#7DD3FC',
                  background: 'rgba(56,189,248,.09)',
                  border: '1px solid rgba(56,189,248,.22)',
                }}
              >
                Connected
              </div>

              <div
                style={{
                  padding: '11px 14px',
                  marginBottom: 12,
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#F5F7FA',
                  background: 'rgba(7,8,11,.3)',
                  border: '1px solid rgba(255,255,255,.06)',
                }}
              >
                Microsoft 365
              </div>

              <p style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: 'rgba(226,232,240,.42)' }}>
                An external system connected to BRΛINBΛSE — not a
                BRΛINBΛSE capability itself.
              </p>
            </div>
          </div>
        </section>

        {/* ================================================================
            5. CAPABILITIES
        ================================================================= */}

        <section id="product" style={{ marginBottom: 112, scrollMarginTop: 100 }}>
          <SectionHeading
            eyebrow="Capabilities"
            title="One place to run the work that matters."
            description="Start with the capabilities you need today. Add more as your operation grows."
          />

          <div className="bb-home-module-grid">
            {CAPABILITIES.map((capability, index) => {
              const active = hoveredCapability === index;

              return (
                <div
                  key={capability.title}
                  onMouseEnter={() => setHoveredCapability(index)}
                  onMouseLeave={() => setHoveredCapability(null)}
                  style={{
                    minHeight: 185,
                    padding: '24px',
                    borderRadius: 14,
                    position: 'relative',
                    overflow: 'hidden',
                    background: active
                      ? `rgba(${hexToRgbStr(capability.color)}, .055)`
                      : 'rgba(255,255,255,.018)',
                    border: active
                      ? `1px solid ${capability.color}32`
                      : '1px solid rgba(255,255,255,.065)',
                    transform: active ? 'translateY(-2px)' : 'translateY(0)',
                    transition: 'all .17s',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 1,
                      background: `linear-gradient(90deg, ${capability.color}76, transparent)`,
                    }}
                  />

                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 9,
                      marginBottom: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: capability.color,
                      background: `${capability.color}10`,
                      border: `1px solid ${capability.color}22`,
                    }}
                  >
                    {capability.icon}
                  </div>

                  <h3
                    style={{
                      margin: '0 0 8px',
                      fontSize: 15,
                      fontWeight: 650,
                      letterSpacing: '-.015em',
                      color: '#F5F7FA',
                    }}
                  >
                    {capability.title}
                  </h3>

                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: 'rgba(226,232,240,.58)' }}>
                    {capability.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ================================================================
            6. CONFIGURABILITY
        ================================================================= */}

        <section style={{ marginBottom: 112 }}>
          <SectionHeading
            eyebrow="Configurability"
            title="Configured around how you work."
            description="Two businesses can use the same BRΛINBΛSE capability very differently — Bookings, for example."
            centred
          />

          <div className="bb-home-two-col-grid" style={{ marginBottom: 20 }}>
            {CONFIG_EXAMPLES.map(example => (
              <div
                key={example.title}
                style={{
                  padding: '26px',
                  borderRadius: 16,
                  background: 'rgba(255,255,255,.017)',
                  border: '1px solid rgba(255,255,255,.065)',
                }}
              >
                <div
                  style={{
                    marginBottom: 6,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '.11em',
                    textTransform: 'uppercase',
                    color: example.color,
                  }}
                >
                  Bookings capability
                </div>

                <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 650, color: '#F5F7FA' }}>
                  {example.title}
                </h3>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {example.items.map(item => (
                    <span
                      key={item}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 550,
                        color: 'rgba(226,232,240,.68)',
                        background: 'rgba(7,8,11,.28)',
                        border: '1px solid rgba(255,255,255,.07)',
                      }}
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p
            style={{
              margin: 0,
              textAlign: 'center',
              fontSize: 13,
              fontWeight: 600,
              color: 'rgba(226,232,240,.55)',
            }}
          >
            Same capability. Different operation.
          </p>
        </section>

        {/* ================================================================
            7. INTEGRATIONS
        ================================================================= */}

        <section style={{ marginBottom: 112 }}>
          <SectionHeading
            eyebrow="Integrations"
            title="Keep the systems that already make sense."
            description="BRΛINBΛSE doesn't need to replace every specialist system your business relies on. It can connect with external systems where it makes sense, keeping important information closer to the operation."
            centred
          />

          <div className="bb-home-two-col-grid">
            <div
              style={{
                padding: '26px',
                borderRadius: 16,
                background: 'rgba(138,77,255,.035)',
                border: '1px solid rgba(138,77,255,.14)',
              }}
            >
              <div
                style={{
                  marginBottom: 14,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '.11em',
                  textTransform: 'uppercase',
                  color: '#A78BFA',
                }}
              >
                BRΛINBΛSE capabilities
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {INTEGRATION_CAPABILITIES.map(item => (
                  <span
                    key={item}
                    style={{
                      padding: '7px 13px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 550,
                      color: 'rgba(226,232,240,.7)',
                      background: 'rgba(7,8,11,.3)',
                      border: '1px solid rgba(255,255,255,.07)',
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div
              style={{
                padding: '26px',
                borderRadius: 16,
                background: 'rgba(255,255,255,.012)',
                border: '1px solid rgba(255,255,255,.07)',
              }}
            >
              <div
                style={{
                  marginBottom: 14,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '.11em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,.42)',
                }}
              >
                Connected external systems
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                <span
                  style={{
                    padding: '7px 13px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 550,
                    color: 'rgba(226,232,240,.7)',
                    background: 'rgba(7,8,11,.3)',
                    border: '1px solid rgba(255,255,255,.07)',
                  }}
                >
                  Microsoft 365
                </span>
              </div>

              <p style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: 'rgba(226,232,240,.42)' }}>
                Shown as an example of a connected external system — not
                every integration is available for every system.
              </p>
            </div>
          </div>
        </section>

        {/* ================================================================
            8. HOW THE PLATFORM WORKS
        ================================================================= */}

        <section style={{ marginBottom: 112 }}>
          <SectionHeading
            eyebrow="How BRΛINBΛSE Works"
            title="Capture. Organise. Operate. Understand."
            description="BRΛINBΛSE turns the information you already have into decisions your people can act on."
            centred
          />

          <div className="bb-home-how-grid">
            {HOW_STEPS.map(step => (
              <div
                key={step.n}
                style={{
                  padding: '24px',
                  minHeight: 205,
                  borderRadius: 14,
                  background: 'rgba(255,255,255,.017)',
                  border: '1px solid rgba(255,255,255,.06)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: 'linear-gradient(90deg, rgba(138,77,255,.62), transparent)',
                  }}
                />

                <div
                  style={{
                    marginBottom: 27,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.10em',
                    color: 'rgba(167,139,250,.65)',
                  }}
                >
                  {step.n}
                </div>

                <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 650, color: '#F5F7FA' }}>
                  {step.title}
                </h3>

                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: 'rgba(226,232,240,.58)' }}>
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ================================================================
            9. HLNΛ
        ================================================================= */}

        <section
          className="bb-home-section-card"
          style={{
            marginBottom: 112,
            padding: '54px 50px',
            borderRadius: 22,
            border: '1px solid rgba(138,77,255,.17)',
            background: 'linear-gradient(135deg, rgba(138,77,255,.085), rgba(56,189,248,.022) 68%, rgba(255,255,255,.012))',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 30px 90px rgba(0,0,0,.16)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              width: 480,
              height: 480,
              right: -150,
              top: -220,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(138,77,255,.13), transparent 68%)',
            }}
          />

          <div className="bb-home-hlna-grid">
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 14,
                  fontSize: 10,
                  fontWeight: 650,
                  letterSpacing: '.13em',
                  color: 'rgba(167,139,250,.80)',
                  textTransform: 'uppercase',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#8A4DFF',
                    boxShadow: '0 0 8px rgba(138,77,255,.8)',
                  }}
                />

                Inside BRΛINBΛSE
              </div>

              <h2
                style={{
                  margin: '0 0 18px',
                  fontSize: 'clamp(28px, 3.6vw, 40px)',
                  lineHeight: 1.1,
                  letterSpacing: '-.035em',
                  fontWeight: 650,
                  color: '#F5F7FA',
                }}
              >
                HLN
                <span style={{ color: '#8A4DFF' }}>Λ</span> — intelligence
                across your operation.
              </h2>

              <p
                style={{
                  margin: '0 0 26px',
                  maxWidth: 450,
                  fontSize: 14,
                  lineHeight: 1.72,
                  color: 'rgba(226,232,240,.63)',
                }}
              >
                When your clients, workflows, scheduling, activity and
                operational data are connected, HLNΛ can help surface what
                is happening, what has changed and what may need attention.
              </p>

              <Link
                href="/demo"
                style={{ fontSize: 11, fontWeight: 600, color: '#C4B5FD', textDecoration: 'none' }}
              >
                See HLNΛ in the platform demo →
              </Link>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 12,
                position: 'relative',
              }}
            >
              {INTELLIGENCE.map((item, index) => (
                <div
                  key={item.title}
                  style={{
                    minHeight: 126,
                    padding: '20px',
                    borderRadius: 13,
                    background: 'rgba(7,8,11,.34)',
                    border: '1px solid rgba(255,255,255,.07)',
                    backdropFilter: 'blur(5px)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: 46,
                      height: 1,
                      background:
                        index % 2 === 0
                          ? 'linear-gradient(90deg, #8A4DFF, transparent)'
                          : 'linear-gradient(90deg, #38BDF8, transparent)',
                    }}
                  />

                  <h3 style={{ margin: '0 0 7px', fontSize: 13, fontWeight: 650, color: '#F5F7FA' }}>
                    {item.title}
                  </h3>

                  <p style={{ margin: 0, fontSize: 11, lineHeight: 1.62, color: 'rgba(226,232,240,.57)' }}>
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            10. PROOF / REAL DEPLOYMENT
        ================================================================= */}

        <section style={{ marginBottom: 112 }}>
          <div
            style={{
              padding: '38px 40px',
              borderRadius: 17,
              position: 'relative',
              overflow: 'hidden',
              background: 'linear-gradient(135deg, rgba(16,185,129,.045), rgba(138,77,255,.018))',
              border: '1px solid rgba(16,185,129,.15)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 30,
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: 999,
                      background: 'rgba(16,185,129,.09)',
                      border: '1px solid rgba(16,185,129,.22)',
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      color: '#6EE7B7',
                    }}
                  >
                    REAL DEPLOYMENT EXAMPLE
                  </span>

                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: '#22C55E',
                      boxShadow: '0 0 6px #22C55E',
                      animation: 'pulse 2.5s ease-in-out infinite',
                    }}
                  />
                </div>

                <h2 style={{ margin: '0 0 11px', fontSize: 27, fontWeight: 650, letterSpacing: '-.03em', color: '#F5F7FA' }}>
                  LD Tennis
                </h2>

                <p style={{ margin: 0, maxWidth: 560, fontSize: 13, lineHeight: 1.7, color: 'rgba(226,232,240,.56)' }}>
                  A real BRΛINBΛSE deployment, configured around how LD
                  Tennis operates. Leads, clients, bookings, follow-up and
                  reporting work together through the same connected
                  platform.
                </p>

                <Link
                  href="/client-operations/demo"
                  style={{
                    display: 'inline-flex',
                    marginTop: 17,
                    fontSize: 11,
                    fontWeight: 650,
                    color: '#6EE7B7',
                    textDecoration: 'none',
                  }}
                >
                  Explore the deployment →
                </Link>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {PROOF_FLOW.map(item => (
                  <div
                    key={item}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '10px 12px',
                      borderRadius: 9,
                      background: 'rgba(7,8,11,.28)',
                      border: '1px solid rgba(255,255,255,.06)',
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: '#22C55E',
                        flexShrink: 0,
                      }}
                    />

                    <span style={{ fontSize: 12, fontWeight: 550, color: 'rgba(226,232,240,.68)' }}>
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            11. STARTING POINTS
        ================================================================= */}

        <section style={{ marginBottom: 112 }}>
          <SectionHeading
            eyebrow="Starting Points"
            title="More than one way to start with BRΛINBΛSE."
            description="Start with whichever part of the operation needs attention first. Each is a way into the same connected platform, not a separate product."
            centred
          />

          <div className="bb-home-path-grid">
            {STARTING_POINTS.map((path, index) => {
              const active = hoveredPath === index;

              return (
                <Link
                  key={path.title}
                  href={path.href}
                  onMouseEnter={() => setHoveredPath(index)}
                  onMouseLeave={() => setHoveredPath(null)}
                  style={{
                    minHeight: 310,
                    padding: '27px',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 16,
                    position: 'relative',
                    overflow: 'hidden',
                    textDecoration: 'none',
                    background: active
                      ? `rgba(${hexToRgbStr(path.color)}, .055)`
                      : 'rgba(255,255,255,.017)',
                    border: active ? `1px solid ${path.color}34` : '1px solid rgba(255,255,255,.065)',
                    transform: active ? 'translateY(-3px)' : 'translateY(0)',
                    transition: 'all .18s',
                    boxShadow: active ? `0 18px 45px ${path.color}0E` : 'none',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 1,
                      background: `linear-gradient(90deg, ${path.color}90, transparent)`,
                    }}
                  />

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      marginBottom: 38,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '.11em',
                        textTransform: 'uppercase',
                        color: path.color,
                      }}
                    >
                      {path.eyebrow}
                    </div>

                    <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.22)' }}>
                      {path.number}
                    </div>
                  </div>

                  <h3
                    style={{
                      margin: '0 0 13px',
                      fontSize: 21,
                      lineHeight: 1.18,
                      fontWeight: 650,
                      letterSpacing: '-.028em',
                      color: '#F5F7FA',
                    }}
                  >
                    {path.title}
                  </h3>

                  <p style={{ margin: '0 0 28px', fontSize: 12, lineHeight: 1.7, color: 'rgba(226,232,240,.57)' }}>
                    {path.body}
                  </p>

                  <div style={{ marginTop: 'auto', paddingTop: 6, fontSize: 11, fontWeight: 600, color: path.color }}>
                    {path.action} →
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ================================================================
            12. FINAL CTA
        ================================================================= */}

        <section
          className="bb-home-cta"
          style={{
            padding: '54px 46px',
            borderRadius: 20,
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(135deg, rgba(138,77,255,.085), rgba(86,119,255,.035))',
            border: '1px solid rgba(138,77,255,.16)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '50%',
              top: '-180px',
              transform: 'translateX(-50%)',
              width: 540,
              height: 420,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(138,77,255,.13), transparent 68%)',
              pointerEvents: 'none',
            }}
          />

          <div style={{ position: 'relative', maxWidth: 680, margin: '0 auto' }}>
            <div
              style={{
                marginBottom: 13,
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '.13em',
                color: 'rgba(167,139,250,.70)',
              }}
            >
              Your operation
            </div>

            <h2
              style={{
                margin: '0 0 15px',
                fontSize: 'clamp(29px, 4vw, 42px)',
                lineHeight: 1.09,
                letterSpacing: '-.038em',
                fontWeight: 650,
                color: '#F5F7FA',
              }}
            >
              Tell us what you&apos;re trying to improve.
            </h2>

            <p
              style={{
                margin: '0 auto 28px',
                maxWidth: 570,
                fontSize: 14,
                lineHeight: 1.7,
                color: 'rgba(226,232,240,.60)',
              }}
            >
              Tell us what is creating friction in your operation and we can
              explore where BRΛINBΛSE could fit.
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Link
                href="/request-demo"
                style={{
                  height: 45,
                  padding: '0 22px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 9,
                  background: 'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 650,
                  textDecoration: 'none',
                  boxShadow: '0 8px 24px rgba(106,61,255,.18)',
                }}
              >
                Discuss your operation →
              </Link>

              <Link
                href="/demo"
                style={{
                  height: 43,
                  padding: '0 20px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 9,
                  border: '1px solid rgba(255,255,255,.09)',
                  background: 'rgba(255,255,255,.025)',
                  color: 'rgba(245,247,250,.68)',
                  textDecoration: 'none',
                  fontSize: 12,
                  fontWeight: 550,
                }}
              >
                Explore BRΛINBΛSE
              </Link>
            </div>
          </div>
        </section>
        </div>

        {/* FOOTER — D.3.1D: moved INSIDE the same continuous-veil wrapper
            (previously a sibling after it, separated by this footer's own
            72px marginTop). That 72px gap sat entirely outside both the
            veil (which ended at the wrapper's previous bottom edge) and
            the footer's own background (which didn't start until after
            the margin) — live DOM measurement confirmed it precisely:
            veil ended at y=7222, footer began at y=7294, a 72px band
            where neither covered the fixed OrbitalBackground, letting it
            show through completely undimmed — the visible band. Now that
            footer lives inside the wrapper, the veil's own inset:0 sizing
            (which derives from real content height, not a hardcoded
            value) automatically extends over the footer too, and the
            72px marginTop is just internal breathing room within the
            veiled area rather than a hole in it. The footer's own
            separate near-opaque background (D.3.1B/C: rgba(5,6,10,.9-.94))
            is removed entirely — the veil, now reaching all the way to
            the footer's own bottom edge, already provides the "nearly
            black" darkening on its own; a second independent background
            here would be exactly the "second atmospheric treatment"
            section 4 says to avoid. */}

        <footer
          style={{
            borderTop: '1px solid rgba(255,255,255,.05)',
            marginTop: 72,
            position: 'relative',
            zIndex: 1,
          }}
        >
        <div
          className="bb-home-footer"
          style={{
            maxWidth: 1220,
            margin: '0 auto',
            padding: '28px 32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 22,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <BrainBaseWordmark
              width={100}
              style={{ opacity: 0.70 }}
            />

            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.30)' }}>
              One connected operational platform.
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Link href="/client-operations" style={footerLinkStyle}>
              Client Operations
            </Link>

            <Link href="/web-systems" style={footerLinkStyle}>
              Web Systems
            </Link>

            <Link href="/pricing" style={footerLinkStyle}>
              Pricing
            </Link>

            <Link href="/demo" style={footerLinkStyle}>
              Demo
            </Link>

            <Link href="/terms" style={footerLinkStyle}>
              Terms
            </Link>

            <Link href="/privacy" style={footerLinkStyle}>
              Privacy
            </Link>

            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.20)' }}>© 2026 BRΛINBΛSE</span>
          </div>
        </div>
      </footer>
      </div>
    </main>
  );
}

const footerLinkStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'rgba(255,255,255,.30)',
  textDecoration: 'none',
};

function SectionHeading({
  eyebrow,
  title,
  description,
  centred = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  centred?: boolean;
}) {
  return (
    <div
      style={{
        maxWidth: centred ? 700 : 650,
        margin: centred ? '0 auto 39px' : '0 0 39px',
        textAlign: centred ? 'center' : 'left',
      }}
    >
      <div
        style={{
          marginBottom: 10,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '.13em',
          textTransform: 'uppercase',
          color: 'rgba(167,139,250,.68)',
        }}
      >
        {eyebrow}
      </div>

      <h2
        style={{
          margin: '0 0 13px',
          fontSize: 'clamp(28px, 4vw, 40px)',
          lineHeight: 1.09,
          letterSpacing: '-.037em',
          fontWeight: 650,
          color: '#F5F7FA',
        }}
      >
        {title}
      </h2>

      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'rgba(226,232,240,.60)' }}>
        {description}
      </p>
    </div>
  );
}

function hexToRgbStr(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return `${r},${g},${b}`;
}

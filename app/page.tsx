'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

import CommandDemo from '@/components/CommandDemo';
import EnquiryModal from '@/components/web-services/EnquiryModal';

const FONT =
  'var(--font-inter), "Inter", -apple-system, sans-serif';

const BG = '#07080B';

const KEYFRAMES = `
  html {
    scroll-behavior: smooth;
  }

  @keyframes orbFloat {
    0%, 100% {
      transform: translateY(0px) scale(1);
    }

    50% {
      transform: translateY(-10px) scale(1.018);
    }
  }

  @keyframes glowPulse {
    0%, 100% {
      opacity: .45;
    }

    50% {
      opacity: .80;
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
`;

const PLATFORM_MODULES = [
  {
    title: 'CRM & Clients',
    description:
      'Contacts, pipelines, communication history and client activity in one connected workspace.',
    color: '#8A4DFF',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: 'Scheduling & Bookings',
    description:
      'Manage appointments, sessions and capacity with less manual coordination.',
    color: '#38BDF8',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    title: 'Dashboards & Reporting',
    description:
      'Operational KPIs, trends and reporting brought together in a single visual layer.',
    color: '#A78BFA',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    title: 'Workflow Automation',
    description:
      'Reduce repetitive admin with connected processes, triggers and follow-up workflows.',
    color: '#F59E0B',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    title: 'Intelligent Websites',
    description:
      'Web systems that capture enquiries and connect directly into the wider BrainBase ecosystem.',
    color: '#6366F1',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    title: 'Client Portals',
    description:
      'Give clients controlled access to the information, activity and services relevant to them.',
    color: '#EC4899',
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
];

const OUTCOMES = [
  {
    title: 'One operational view',
    body: 'Bring disconnected information, systems and workflows into one environment.',
    color: '#8A4DFF',
  },
  {
    title: 'Less manual admin',
    body: 'Reduce repetitive tasks, duplicated entry and time spent moving between tools.',
    color: '#38BDF8',
  },
  {
    title: 'Faster decisions',
    body: 'Surface the information that matters without manually searching through multiple systems.',
    color: '#A78BFA',
  },
  {
    title: 'Better visibility',
    body: 'Understand activity, performance and priorities from a clearer operational picture.',
    color: '#22C55E',
  },
];

const INTELLIGENCE = [
  {
    title: 'Ask your operation',
    body: 'Use natural language to interrogate the information available inside BrainBase.',
  },
  {
    title: 'Surface what matters',
    body: 'HLNΛ helps identify important activity, changes and operational signals.',
  },
  {
    title: 'Navigate intelligently',
    body: 'Move through BrainBase using the intelligence layer instead of manually hunting for information.',
  },
  {
    title: 'Connected context',
    body: 'The intelligence layer works across the systems and operational information connected to the platform.',
  },
];

const WEBSITE_SERVICES = [
  {
    title: 'Web design & development',
    body: 'Modern responsive websites designed for performance, credibility and growth.',
    color: '#6366F1',
  },
  {
    title: 'Lead capture & automation',
    body: 'Capture enquiries and route them directly into CRM, follow-up and operational workflows.',
    color: '#8A4DFF',
  },
  {
    title: 'Business integrations',
    body: 'Connect your website with bookings, internal tools, dashboards, portals and data sources.',
    color: '#38BDF8',
  },
  {
    title: 'Managed infrastructure',
    body: 'Hosting, optimisation, maintenance, security and ongoing support as part of the solution.',
    color: '#22C55E',
  },
];

const DEPLOYMENT_FLOW = [
  {
    number: '01',
    title: 'Website enquiry',
    body:
      'A new enquiry is captured directly through the public website.',
    color: '#6366F1',
  },
  {
    number: '02',
    title: 'Client organised',
    body:
      'Contact details and client information are organised inside BrainBase.',
    color: '#8A4DFF',
  },
  {
    number: '03',
    title: 'Bookings & scheduling',
    body:
      'Sessions, appointments and availability are managed from the same environment.',
    color: '#38BDF8',
  },
  {
    number: '04',
    title: 'Follow-up & operations',
    body:
      'Communication, workflows and client activity stay connected after the initial enquiry.',
    color: '#22C55E',
  },
];

export default function Home() {
  const [enquiryOpen, setEnquiryOpen] =
    useState(false);

  useEffect(() => {
    if (window.location.hash) {
      return;
    }

    const scrollToTop = () => {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: 'auto',
      });
    };

    scrollToTop();

    const frame = window.requestAnimationFrame(
      scrollToTop,
    );

    const timer = window.setTimeout(
      scrollToTop,
      50,
    );

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  const [hoveredModule, setHoveredModule] =
    useState<number | null>(null);

  const [hoveredOutcome, setHoveredOutcome] =
    useState<number | null>(null);

  const [hoveredWeb, setHoveredWeb] =
    useState<number | null>(null);

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

      {/* Ambient background */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          background: `
            radial-gradient(
              ellipse 70% 46% at 50% -5%,
              rgba(138,77,255,.13) 0%,
              rgba(74,54,180,.05) 38%,
              transparent 72%
            )
          `,
        }}
      />

      <div
        style={{
          maxWidth: 1220,
          margin: '0 auto',
          padding: '0 32px 96px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* ================================================================
            HERO
        ================================================================= */}
        <section
          style={{
            minHeight: 'calc(100vh - 52px)',
            display: 'flex',
            alignItems: 'center',
            padding: '48px 0 72px',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(340px, 1fr))',
              gap: 64,
              alignItems: 'center',
              width: '100%',
            }}
          >
            {/* Hero text */}
            <div
              style={{
                maxWidth: 610,
                position: 'relative',
                zIndex: 2,
              }}
            >
              <div
                style={{
                  marginBottom: 32,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <Image
                  src="/Brand/brainbase-logo-dark.svg"
                  alt="BrainBase"
                  width={500}
                  height={114}
                  priority
                  style={{
                    display: 'block',
                    width: 355,
                    maxWidth: '90vw',
                    height: 'auto',
                    transform:
                      'translateX(-3.5%)',
                  }}
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
                  background:
                    'rgba(255,255,255,.024)',
                  border:
                    '1px solid rgba(255,255,255,.085)',
                  backdropFilter:
                    'blur(6px)',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#22C55E',
                    boxShadow:
                      '0 0 7px rgba(34,197,94,.85)',
                    animation:
                      'pulse 2.5s ease-in-out infinite',
                  }}
                />

                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 650,
                    letterSpacing: '.11em',
                    textTransform: 'uppercase',
                    color:
                      'rgba(255,255,255,.52)',
                  }}
                >
                  Operational intelligence platform
                </span>
              </div>

              <h1
                style={{
                  margin: '0 0 24px',
                  maxWidth: 600,
                  fontSize:
                    'clamp(42px, 5.4vw, 68px)',
                  lineHeight: 1.02,
                  fontWeight: 650,
                  letterSpacing: '-.045em',
                  color: '#F5F7FA',
                }}
              >
                Operational intelligence,
                <br />

                <span
                  style={{
                    background:
                      'linear-gradient(100deg, #8A4DFF 0%, #A78BFA 46%, #5C7CFF 100%)',
                    WebkitBackgroundClip:
                      'text',
                    WebkitTextFillColor:
                      'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  insight and automation
                </span>

                <br />
                in one place.
              </h1>

              <p
                style={{
                  margin: '0 0 30px',
                  maxWidth: 520,
                  fontSize: 16,
                  lineHeight: 1.72,
                  color:
                    'rgba(226,232,240,.70)',
                }}
              >
                BrainBase connects your systems,
                information and workflows into one
                operational platform — giving you a
                clearer view of what is happening and
                helping you act on it faster.
              </p>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  flexWrap: 'wrap',
                  marginBottom: 32,
                }}
              >
                <button
                  onClick={() =>
                    setEnquiryOpen(true)
                  }
                  style={{
                    height: 46,
                    padding: '0 22px',
                    borderRadius: 9,
                    border: 'none',
                    background:
                      'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                    color: '#FFFFFF',
                    fontSize: 13,
                    fontWeight: 650,
                    fontFamily: FONT,
                    cursor: 'pointer',
                    boxShadow:
                      '0 8px 26px rgba(106,61,255,.22)',
                    transition:
                      'transform .15s, opacity .15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform =
                      'translateY(-1px)';

                    e.currentTarget.style.opacity =
                      '.94';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform =
                      'translateY(0)';

                    e.currentTarget.style.opacity =
                      '1';
                  }}
                >
                  Book a strategy call →
                </button>

                <Link
                  href="/web-systems"
                  style={{
                    height: 44,
                    padding: '0 20px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: 9,
                    border:
                      '1px solid rgba(255,255,255,.10)',
                    background:
                      'rgba(255,255,255,.025)',
                    color:
                      'rgba(245,247,250,.72)',
                    textDecoration: 'none',
                    fontSize: 13,
                    fontWeight: 550,
                  }}
                >
                  Explore Web Systems
                </Link>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    color:
                      'rgba(255,255,255,.34)',
                  }}
                >
                  Intelligence engine
                </span>

                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.10em',
                    color: '#F5F7FA',
                  }}
                >
                  HLN
                  <span
                    style={{
                      color: '#8A4DFF',
                    }}
                  >
                    Λ
                  </span>
                </span>

                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: '#22C55E',
                    boxShadow:
                      '0 0 5px rgba(34,197,94,.7)',
                  }}
                />
              </div>
            </div>

            {/* HLNA visual */}
            <div
              style={{
                minHeight: 600,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                transform: 'translateY(-18px)',
              }}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: 540,
                  position: 'relative',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform:
                      'translate(-50%, -50%)',
                    width: 620,
                    height: 620,
                    maxWidth: '90vw',
                    maxHeight: '90vw',
                    borderRadius: '50%',
                    background:
                      'radial-gradient(circle, rgba(138,77,255,.15) 0%, rgba(88,68,220,.06) 38%, transparent 68%)',
                    filter: 'blur(28px)',
                    animation:
                      'glowPulse 7s ease-in-out infinite',
                  }}
                />

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/hlna-orb-only.webp"
                  alt="HLNA intelligence engine"
                  style={{
                    width: '100%',
                    display: 'block',
                    objectFit: 'contain',
                    position: 'relative',
                    zIndex: 1,
                    animation:
                      'orbFloat 6s ease-in-out infinite',
                    opacity: 0.94,
                    filter:
                      'drop-shadow(0 0 38px rgba(120,80,255,.45)) drop-shadow(0 0 100px rgba(70,100,255,.22))',
                  }}
                />
              </div>

              <div
                style={{
                  width: 'min(410px, 92%)',
                  marginTop: 32,
                  padding: '14px 15px',
                  borderRadius: 12,
                  background:
                    'rgba(7,8,11,.42)',
                  border:
                    '1px solid rgba(255,255,255,.085)',
                  backdropFilter:
                    'blur(9px)',
                  WebkitBackdropFilter:
                    'blur(9px)',
                  boxShadow:
                    '0 18px 50px rgba(0,0,0,.24)',
                  position: 'relative',
                  zIndex: 2,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    marginBottom: 9,
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: '#8A4DFF',
                      boxShadow:
                        '0 0 7px rgba(138,77,255,.9)',
                    }}
                  />

                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 650,
                      letterSpacing: '.10em',
                      textTransform: 'uppercase',
                      color:
                        'rgba(167,139,250,.82)',
                    }}
                  >
                    HLNΛ · Operational intelligence
                  </span>
                </div>

                <CommandDemo placeholder="Ask BrainBase what's happening across your operation..." />
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            WEB SYSTEMS
        ================================================================= */}
        <section
          id="web-systems"
          style={{
            marginBottom: 42,
          }}
        >
          <div
            style={{
              padding: '54px 48px 46px',
              borderRadius: 22,
              position: 'relative',
              overflow: 'hidden',
              background:
                'linear-gradient(135deg, rgba(99,102,241,.085), rgba(138,77,255,.042) 54%, rgba(255,255,255,.012))',
              border:
                '1px solid rgba(99,102,241,.17)',
              boxShadow:
                '0 28px 90px rgba(0,0,0,.18)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                width: 520,
                height: 520,
                left: -210,
                top: -250,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(99,102,241,.14), transparent 68%)',
                pointerEvents: 'none',
              }}
            />

            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                width: 380,
                height: 380,
                right: -180,
                bottom: -210,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(138,77,255,.08), transparent 70%)',
                pointerEvents: 'none',
              }}
            />

            <div
              style={{
                position: 'relative',
                maxWidth: 780,
                marginBottom: 40,
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 10,
                  fontWeight: 650,
                  letterSpacing: '.13em',
                  textTransform: 'uppercase',
                  color:
                    'rgba(129,140,248,.84)',
                  marginBottom: 13,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#6366F1',
                    boxShadow:
                      '0 0 7px rgba(99,102,241,.75)',
                  }}
                />

                Start with Web Systems
              </div>

              <h2
                style={{
                  margin: '0 0 17px',
                  fontSize:
                    'clamp(31px, 4.2vw, 48px)',
                  lineHeight: 1.06,
                  letterSpacing: '-.04em',
                  fontWeight: 650,
                  color: '#F5F7FA',
                }}
              >
                Start with your website.
                <br />

                <span
                  style={{
                    background:
                      'linear-gradient(100deg, #8A4DFF 0%, #A78BFA 65%, #6C7CFF 100%)',
                    WebkitBackgroundClip:
                      'text',
                    WebkitTextFillColor:
                      'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  Build the system behind it.
                </span>
              </h2>

              <p
                style={{
                  margin: 0,
                  maxWidth: 670,
                  fontSize: 15,
                  lineHeight: 1.72,
                  color:
                    'rgba(226,232,240,.64)',
                }}
              >
                BrainBase Web Systems turn your
                website into part of your operation
                — connecting enquiries, bookings,
                CRM, workflows and business
                information instead of leaving your
                website isolated from everything
                behind it.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(230px, 1fr))',
                gap: 12,
                marginBottom: 32,
                position: 'relative',
              }}
            >
              {WEBSITE_SERVICES.map(
                (item, index) => {
                  const active =
                    hoveredWeb === index;

                  return (
                    <div
                      key={item.title}
                      onMouseEnter={() =>
                        setHoveredWeb(index)
                      }
                      onMouseLeave={() =>
                        setHoveredWeb(null)
                      }
                      style={{
                        minHeight: 150,
                        padding: '23px',
                        borderRadius: 14,
                        background: active
                          ? `rgba(${hexToRgbStr(
                              item.color,
                            )}, .065)`
                          : 'rgba(7,8,11,.28)',
                        border: active
                          ? `1px solid ${item.color}38`
                          : '1px solid rgba(255,255,255,.065)',
                        transform: active
                          ? 'translateY(-3px)'
                          : 'translateY(0)',
                        transition: 'all .17s',
                        backdropFilter:
                          'blur(4px)',
                        position: 'relative',
                        overflow: 'hidden',
                        boxShadow: active
                          ? `0 14px 36px ${item.color}10`
                          : 'none',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          height: 1,
                          background:
                            `linear-gradient(90deg, ${item.color}90, transparent)`,
                          opacity: active ? 1 : 0.4,
                        }}
                      />

                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginBottom: 17,
                          background:
                            `${item.color}12`,
                          border:
                            `1px solid ${item.color}24`,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: item.color,
                            boxShadow:
                              `0 0 8px ${item.color}`,
                          }}
                        />
                      </div>

                      <h3
                        style={{
                          margin: '0 0 8px',
                          fontSize: 14,
                          fontWeight: 650,
                          color: '#F5F7FA',
                        }}
                      >
                        {item.title}
                      </h3>

                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          lineHeight: 1.65,
                          color:
                            'rgba(226,232,240,.59)',
                        }}
                      >
                        {item.body}
                      </p>
                    </div>
                  );
                },
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 22,
                flexWrap: 'wrap',
                paddingTop: 4,
                position: 'relative',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color:
                      'rgba(245,247,250,.60)',
                    marginBottom: 3,
                  }}
                >
                  Website first. Build from there.
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color:
                      'rgba(226,232,240,.42)',
                  }}
                >
                  CRM, automation, dashboards and
                  intelligence can follow as your
                  operation grows.
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 9,
                  flexWrap: 'wrap',
                }}
              >
                <button
                  onClick={() =>
                    setEnquiryOpen(true)
                  }
                  style={{
                    height: 42,
                    padding: '0 19px',
                    borderRadius: 8,
                    border: 'none',
                    background:
                      'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                    color: '#FFFFFF',
                    fontSize: 12,
                    fontWeight: 650,
                    fontFamily: FONT,
                    cursor: 'pointer',
                    boxShadow:
                      '0 7px 20px rgba(106,61,255,.17)',
                  }}
                >
                  Discuss your website →
                </button>

                <Link
                  href="/web-systems"
                  style={{
                    height: 40,
                    padding: '0 18px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: 8,
                    background:
                      'rgba(255,255,255,.025)',
                    border:
                      '1px solid rgba(255,255,255,.09)',
                    color:
                      'rgba(245,247,250,.70)',
                    textDecoration: 'none',
                    fontSize: 12,
                    fontWeight: 550,
                  }}
                >
                  Explore Web Systems
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            LIVE DEPLOYMENT — DIRECTLY CONNECTED TO WEB SYSTEMS
        ================================================================= */}
        <section
          style={{
            marginBottom: 108,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(330px, 1fr))',
              gap: 50,
              padding: '48px',
              borderRadius: 20,
              position: 'relative',
              overflow: 'hidden',
              background:
                'linear-gradient(135deg, rgba(16,185,129,.055), rgba(138,77,255,.025) 60%, rgba(255,255,255,.012))',
              border:
                '1px solid rgba(16,185,129,.16)',
              boxShadow:
                '0 28px 80px rgba(0,0,0,.14)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                width: 420,
                height: 420,
                right: -180,
                bottom: -220,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(16,185,129,.09), transparent 68%)',
                pointerEvents: 'none',
              }}
            />

            <div
              style={{
                position: 'relative',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 13,
                  fontSize: 10,
                  fontWeight: 650,
                  letterSpacing: '.13em',
                  textTransform: 'uppercase',
                  color:
                    'rgba(52,211,153,.78)',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#22C55E',
                    boxShadow:
                      '0 0 7px rgba(34,197,94,.75)',
                  }}
                />

                Live Deployment
              </div>

              <h2
                style={{
                  margin: '0 0 16px',
                  fontSize:
                    'clamp(28px, 3.8vw, 42px)',
                  lineHeight: 1.08,
                  letterSpacing: '-.038em',
                  fontWeight: 650,
                  color: '#F5F7FA',
                }}
              >
                From website enquiry
                <br />

                <span
                  style={{
                    color: '#6EE7B7',
                  }}
                >
                  to organised client operation.
                </span>
              </h2>

              <p
                style={{
                  maxWidth: 560,
                  margin: '0 0 25px',
                  fontSize: 14,
                  lineHeight: 1.72,
                  color:
                    'rgba(226,232,240,.62)',
                }}
              >
                Our coaching and service-business
                deployment shows how a BrainBase Web
                System can grow beyond the website.
                Enquiries, clients, bookings and
                operational workflows are connected
                into one working environment.
              </p>

              <div
                style={{
                  padding: '15px 16px',
                  marginBottom: 24,
                  borderRadius: 11,
                  background:
                    'rgba(7,8,11,.25)',
                  border:
                    '1px solid rgba(255,255,255,.055)',
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 650,
                    letterSpacing: '.09em',
                    textTransform: 'uppercase',
                    color:
                      'rgba(255,255,255,.35)',
                    marginBottom: 8,
                  }}
                >
                  What this demonstrates
                </div>

                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    lineHeight: 1.65,
                    color:
                      'rgba(226,232,240,.55)',
                  }}
                >
                  The website is not the end product.
                  It can become the entry point into
                  client organisation, scheduling,
                  follow-up and the wider BrainBase
                  operational environment.
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <Link
                  href="/for-coaches"
                  style={{
                    height: 42,
                    padding: '0 19px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    background:
                      'rgba(16,185,129,.11)',
                    border:
                      '1px solid rgba(16,185,129,.27)',
                    color: '#6EE7B7',
                    textDecoration: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  View live deployment →
                </Link>

                <Link
                  href="/request-demo"
                  style={{
                    height: 40,
                    padding: '0 18px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    background:
                      'rgba(255,255,255,.025)',
                    border:
                      '1px solid rgba(255,255,255,.08)',
                    color:
                      'rgba(245,247,250,.65)',
                    textDecoration: 'none',
                    fontSize: 12,
                    fontWeight: 550,
                  }}
                >
                  Request a demo
                </Link>
              </div>
            </div>

            {/* Connected journey */}
            <div
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 650,
                  letterSpacing: '.11em',
                  textTransform: 'uppercase',
                  color:
                    'rgba(255,255,255,.30)',
                  marginBottom: 5,
                }}
              >
                Example connected journey
              </div>

              {DEPLOYMENT_FLOW.map(
                (step, index) => (
                  <div
                    key={step.number}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '14px 16px',
                      borderRadius: 11,
                      background:
                        'rgba(7,8,11,.32)',
                      border:
                        '1px solid rgba(255,255,255,.065)',
                      backdropFilter:
                        'blur(4px)',
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background:
                          `${step.color}12`,
                        border:
                          `1px solid ${step.color}28`,
                        color: step.color,
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '.06em',
                      }}
                    >
                      {step.number}
                    </div>

                    <div
                      style={{
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          marginBottom: 3,
                          fontSize: 12,
                          fontWeight: 650,
                          color: '#F5F7FA',
                        }}
                      >
                        {step.title}
                      </div>

                      <div
                        style={{
                          fontSize: 10,
                          lineHeight: 1.5,
                          color:
                            'rgba(226,232,240,.52)',
                        }}
                      >
                        {step.body}
                      </div>
                    </div>

                    {index <
                      DEPLOYMENT_FLOW.length - 1 && (
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          left: 30,
                          bottom: -9,
                          width: 1,
                          height: 9,
                          background:
                            'rgba(255,255,255,.10)',
                        }}
                      />
                    )}
                  </div>
                ),
              )}

              <div
                style={{
                  marginTop: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  paddingLeft: 4,
                  fontSize: 9,
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                  color:
                    'rgba(255,255,255,.30)',
                }}
              >
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: '#8A4DFF',
                    boxShadow:
                      '0 0 5px rgba(138,77,255,.7)',
                  }}
                />

                Connected through BrainBase
              </div>
            </div>
          </div>
        </section>

        {/* Platform statement */}
        <section
          style={{
            marginBottom: 100,
            padding: '32px 34px',
            borderRadius: 18,
            background:
              'linear-gradient(135deg, rgba(138,77,255,.055), rgba(255,255,255,.018))',
            border:
              '1px solid rgba(255,255,255,.07)',
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 1,
            overflow: 'hidden',
          }}
        >
          {[
            ['One platform', 'Connected operations'],
            ['HLNΛ', 'Intelligence engine'],
            ['Modular', 'Built around your operation'],
            ['Live', 'Information where it matters'],
          ].map(([value, label], i) => (
            <div
              key={value}
              style={{
                padding: '12px 24px',
                textAlign: 'center',
                borderRight:
                  i < 3
                    ? '1px solid rgba(255,255,255,.055)'
                    : 'none',
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 650,
                  letterSpacing: '-.02em',
                  color: '#F5F7FA',
                  marginBottom: 5,
                }}
              >
                {value}
              </div>

              <div
                style={{
                  fontSize: 10,
                  color:
                    'rgba(255,255,255,.38)',
                  letterSpacing: '.04em',
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </section>

        {/* ================================================================
            WIDER PLATFORM
        ================================================================= */}
        <section
          id="product"
          style={{
            marginBottom: 110,
            scrollMarginTop: 110,
          }}
        >
          <SectionHeading
            eyebrow="Beyond the website"
            title="One place to run the work that matters."
            description="Web Systems can be the starting point. BrainBase expands from there into the wider systems, information and workflows your operation needs."
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(290px, 1fr))',
              gap: 12,
            }}
          >
            {PLATFORM_MODULES.map(
              (module, index) => {
                const active =
                  hoveredModule === index;

                return (
                  <div
                    key={module.title}
                    onMouseEnter={() =>
                      setHoveredModule(index)
                    }
                    onMouseLeave={() =>
                      setHoveredModule(null)
                    }
                    style={{
                      minHeight: 170,
                      padding: '24px',
                      borderRadius: 14,
                      position: 'relative',
                      overflow: 'hidden',
                      background: active
                        ? `rgba(${hexToRgbStr(
                            module.color,
                          )}, .055)`
                        : 'rgba(255,255,255,.018)',
                      border: active
                        ? `1px solid ${module.color}32`
                        : '1px solid rgba(255,255,255,.065)',
                      transform: active
                        ? 'translateY(-2px)'
                        : 'translateY(0)',
                      transition: 'all .17s',
                      boxShadow: active
                        ? `0 16px 42px ${module.color}0E`
                        : 'none',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 1,
                        background: active
                          ? `linear-gradient(90deg, ${module.color}A0, transparent)`
                          : `linear-gradient(90deg, ${module.color}32, transparent)`,
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
                        justifyContent:
                          'center',
                        color: module.color,
                        background:
                          `${module.color}10`,
                        border:
                          `1px solid ${module.color}22`,
                      }}
                    >
                      {module.icon}
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
                      {module.title}
                    </h3>

                    <p
                      style={{
                        margin: 0,
                        fontSize: 12,
                        lineHeight: 1.65,
                        color:
                          'rgba(226,232,240,.58)',
                      }}
                    >
                      {module.description}
                    </p>
                  </div>
                );
              },
            )}
          </div>
        </section>

        {/* ================================================================
            OUTCOMES
        ================================================================= */}
        <section
          style={{
            marginBottom: 110,
          }}
        >
          <SectionHeading
            eyebrow="Operational Clarity"
            title="Less friction. More visibility."
            description="The value is not another dashboard or another application. It is having the information and workflows you need connected in one operational environment."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12,
            }}
          >
            {OUTCOMES.map(
              (item, index) => {
                const active =
                  hoveredOutcome === index;

                return (
                  <div
                    key={item.title}
                    onMouseEnter={() =>
                      setHoveredOutcome(index)
                    }
                    onMouseLeave={() =>
                      setHoveredOutcome(null)
                    }
                    style={{
                      padding: '24px',
                      borderRadius: 14,
                      background: active
                        ? 'rgba(255,255,255,.03)'
                        : 'rgba(255,255,255,.016)',
                      border:
                        '1px solid rgba(255,255,255,.06)',
                      transition: 'all .16s',
                      transform: active
                        ? 'translateY(-2px)'
                        : 'translateY(0)',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: item.color,
                        boxShadow: active
                          ? `0 0 12px ${item.color}`
                          : `0 0 6px ${item.color}70`,
                        marginBottom: 20,
                      }}
                    />

                    <h3
                      style={{
                        margin: '0 0 8px',
                        fontSize: 15,
                        fontWeight: 650,
                        color: '#F5F7FA',
                      }}
                    >
                      {item.title}
                    </h3>

                    <p
                      style={{
                        margin: 0,
                        fontSize: 12,
                        lineHeight: 1.65,
                        color:
                          'rgba(226,232,240,.58)',
                      }}
                    >
                      {item.body}
                    </p>
                  </div>
                );
              },
            )}
          </div>
        </section>

        {/* ================================================================
            HLNA INTELLIGENCE
        ================================================================= */}
        <section
          style={{
            marginBottom: 110,
            padding: '54px 50px',
            borderRadius: 22,
            border:
              '1px solid rgba(138,77,255,.17)',
            background:
              'linear-gradient(135deg, rgba(138,77,255,.085), rgba(56,189,248,.022) 68%, rgba(255,255,255,.012))',
            position: 'relative',
            overflow: 'hidden',
            boxShadow:
              '0 30px 90px rgba(0,0,0,.16)',
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
              background:
                'radial-gradient(circle, rgba(138,77,255,.13), transparent 68%)',
            }}
          />

          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              width: 320,
              height: 320,
              left: -160,
              bottom: -180,
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(56,189,248,.045), transparent 70%)',
            }}
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 58,
              alignItems: 'center',
              position: 'relative',
            }}
          >
            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 10,
                  fontWeight: 650,
                  letterSpacing: '.13em',
                  color:
                    'rgba(167,139,250,.80)',
                  textTransform: 'uppercase',
                  marginBottom: 14,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#8A4DFF',
                    boxShadow:
                      '0 0 8px rgba(138,77,255,.8)',
                  }}
                />

                Intelligence Engine
              </div>

              <h2
                style={{
                  margin: '0 0 18px',
                  fontSize:
                    'clamp(29px, 3.8vw, 44px)',
                  lineHeight: 1.07,
                  letterSpacing: '-.038em',
                  fontWeight: 650,
                  color: '#F5F7FA',
                }}
              >
                BR
                <span
                  style={{
                    color: '#8A4DFF',
                  }}
                >
                  Λ
                </span>
                INB
                <span
                  style={{
                    color: '#8A4DFF',
                  }}
                >
                  Λ
                </span>
                SE thinks
                <br />
                through HLN
                <span
                  style={{
                    color: '#8A4DFF',
                  }}
                >
                  Λ
                </span>
                .
              </h2>

              <p
                style={{
                  margin: 0,
                  maxWidth: 440,
                  fontSize: 14,
                  lineHeight: 1.72,
                  color:
                    'rgba(226,232,240,.63)',
                }}
              >
                HLNΛ is the intelligence layer
                inside BrainBase. It connects your
                operational information with the
                questions, decisions and actions that
                happen every day.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(2, minmax(0, 1fr))',
                gap: 12,
              }}
            >
              {INTELLIGENCE.map(
                (item, index) => (
                  <div
                    key={item.title}
                    style={{
                      padding: '20px',
                      minHeight: 118,
                      borderRadius: 13,
                      background:
                        'rgba(7,8,11,.34)',
                      border:
                        '1px solid rgba(255,255,255,.07)',
                      backdropFilter:
                        'blur(5px)',
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

                    <h3
                      style={{
                        margin: '0 0 7px',
                        fontSize: 13,
                        fontWeight: 650,
                        color: '#F5F7FA',
                      }}
                    >
                      {item.title}
                    </h3>

                    <p
                      style={{
                        margin: 0,
                        fontSize: 11,
                        lineHeight: 1.62,
                        color:
                          'rgba(226,232,240,.57)',
                      }}
                    >
                      {item.body}
                    </p>
                  </div>
                ),
              )}
            </div>
          </div>
        </section>

        {/* ================================================================
            HOW IT WORKS
        ================================================================= */}
        <section
          style={{
            marginBottom: 110,
          }}
        >
          <SectionHeading
            eyebrow="How BrainBase Works"
            title="Connect. Understand. Act."
            description="BrainBase sits between the systems you already use and the decisions your people need to make."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(250px, 1fr))',
              gap: 12,
            }}
          >
            {[
              {
                n: '01',
                title: 'Connect',
                body: 'Bring together the information, systems and workflows relevant to your operation.',
              },
              {
                n: '02',
                title: 'Understand',
                body: 'Use dashboards and HLNΛ to turn connected information into operational context.',
              },
              {
                n: '03',
                title: 'Act',
                body: 'Move from insight to action through workflows, decisions and automation inside the platform.',
              },
            ].map(step => (
              <div
                key={step.n}
                style={{
                  padding: '26px',
                  borderRadius: 14,
                  background:
                    'rgba(255,255,255,.017)',
                  border:
                    '1px solid rgba(255,255,255,.06)',
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
                    background:
                      'linear-gradient(90deg, rgba(138,77,255,.62), transparent)',
                  }}
                />

                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.10em',
                    color:
                      'rgba(167,139,250,.65)',
                    marginBottom: 24,
                  }}
                >
                  {step.n}
                </div>

                <h3
                  style={{
                    margin: '0 0 8px',
                    fontSize: 17,
                    fontWeight: 650,
                    color: '#F5F7FA',
                  }}
                >
                  {step.title}
                </h3>

                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    lineHeight: 1.65,
                    color:
                      'rgba(226,232,240,.58)',
                  }}
                >
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ================================================================
            FINAL CTA
        ================================================================= */}
        <section
          style={{
            padding: '52px 46px',
            borderRadius: 20,
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
            background:
              'linear-gradient(135deg, rgba(138,77,255,.08), rgba(86,119,255,.035))',
            border:
              '1px solid rgba(138,77,255,.16)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '50%',
              top: '-180px',
              transform:
                'translateX(-50%)',
              width: 520,
              height: 420,
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(138,77,255,.12), transparent 68%)',
              pointerEvents: 'none',
            }}
          />

          <div
            style={{
              position: 'relative',
              maxWidth: 650,
              margin: '0 auto',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 650,
                textTransform: 'uppercase',
                letterSpacing: '.13em',
                color:
                  'rgba(167,139,250,.67)',
                marginBottom: 13,
              }}
            >
              Start the conversation
            </div>

            <h2
              style={{
                margin: '0 0 15px',
                fontSize:
                  'clamp(28px, 4vw, 40px)',
                lineHeight: 1.1,
                letterSpacing: '-.035em',
                fontWeight: 650,
                color: '#F5F7FA',
              }}
            >
              Start with the system you need today.
              Build from there.
            </h2>

            <p
              style={{
                margin: '0 auto 28px',
                maxWidth: 560,
                fontSize: 14,
                lineHeight: 1.7,
                color:
                  'rgba(226,232,240,.60)',
              }}
            >
              That might begin with a new website,
              CRM or workflow. BrainBase gives you a
              platform that can grow as more of your
              operation becomes connected.
            </p>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={() =>
                  setEnquiryOpen(true)
                }
                style={{
                  height: 44,
                  padding: '0 22px',
                  borderRadius: 9,
                  border: 'none',
                  background:
                    'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 650,
                  fontFamily: FONT,
                  cursor: 'pointer',
                  boxShadow:
                    '0 8px 24px rgba(106,61,255,.18)',
                }}
              >
                Book a strategy call →
              </button>

              <Link
                href="/web-systems"
                style={{
                  height: 42,
                  padding: '0 20px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: 9,
                  border:
                    '1px solid rgba(255,255,255,.09)',
                  background:
                    'rgba(255,255,255,.025)',
                  color:
                    'rgba(245,247,250,.68)',
                  textDecoration: 'none',
                  fontSize: 12,
                  fontWeight: 550,
                }}
              >
                Explore Web Systems
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* ================================================================
          FOOTER
      ================================================================= */}
      <footer
        style={{
          borderTop:
            '1px solid rgba(255,255,255,.05)',
          marginTop: 72,
        }}
      >
        <div
          style={{
            maxWidth: 1220,
            margin: '0 auto',
            padding: '26px 32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent:
              'space-between',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              flexWrap: 'wrap',
            }}
          >
            <Image
              src="/Brand/brainbase-logo-dark.svg"
              alt="BrainBase"
              width={180}
              height={42}
              style={{
                display: 'block',
                width: 125,
                height: 'auto',
                opacity: 0.70,
                transform:
                  'translateX(-3.5%)',
              }}
            />

            <span
              style={{
                fontSize: 10,
                color:
                  'rgba(255,255,255,.30)',
              }}
            >
              Operational intelligence, insight and
              automation.
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
            }}
          >
            <Link
              href="/terms"
              style={{
                fontSize: 10,
                color:
                  'rgba(255,255,255,.30)',
                textDecoration: 'none',
              }}
            >
              Terms
            </Link>

            <Link
              href="/privacy"
              style={{
                fontSize: 10,
                color:
                  'rgba(255,255,255,.30)',
                textDecoration: 'none',
              }}
            >
              Privacy
            </Link>

            <span
              style={{
                fontSize: 10,
                color:
                  'rgba(255,255,255,.20)',
              }}
            >
              © 2026 BrainBase
            </span>
          </div>
        </div>
      </footer>

      <EnquiryModal
        open={enquiryOpen}
        onClose={() =>
          setEnquiryOpen(false)
        }
      />
    </main>
  );
}

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
        maxWidth: centred ? 650 : 620,
        margin: centred
          ? '0 auto 38px'
          : '0 0 38px',
        textAlign: centred
          ? 'center'
          : 'left',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 650,
          letterSpacing: '.13em',
          textTransform: 'uppercase',
          color:
            'rgba(167,139,250,.68)',
          marginBottom: 10,
        }}
      >
        {eyebrow}
      </div>

      <h2
        style={{
          margin: '0 0 13px',
          fontSize:
            'clamp(27px, 4vw, 38px)',
          lineHeight: 1.1,
          letterSpacing: '-.035em',
          fontWeight: 650,
          color: '#F5F7FA',
        }}
      >
        {title}
      </h2>

      <p
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.7,
          color:
            'rgba(226,232,240,.60)',
        }}
      >
        {description}
      </p>
    </div>
  );
}

function hexToRgbStr(
  hex: string,
): string {
  const r = parseInt(
    hex.slice(1, 3),
    16,
  );

  const g = parseInt(
    hex.slice(3, 5),
    16,
  );

  const b = parseInt(
    hex.slice(5, 7),
    16,
  );

  return `${r},${g},${b}`;
}
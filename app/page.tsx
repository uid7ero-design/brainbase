'use client';

import {
  useEffect,
  useState,
} from 'react';
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
      transform: translateY(-9px) scale(1.016);
    }
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .bb-home-hlna-grid {
    display: grid;
    grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr);
    gap: 56px;
    align-items: center;
  }

  @media (max-width: 920px) {
    .bb-home-path-grid,
    .bb-home-module-grid {
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
    .bb-home-shell {
      padding-left: 18px !important;
      padding-right: 18px !important;
    }

    .bb-home-hero {
      min-height: auto !important;
      padding-top: 62px !important;
      padding-bottom: 72px !important;
    }

    .bb-home-path-grid,
    .bb-home-module-grid,
    .bb-home-outcome-grid,
    .bb-home-how-grid {
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

const PATHS = [
  {
    eyebrow: 'Client Operations',
    title:
      'Run clients, bookings and follow-up in one place.',
    body:
      'A connected operating system for businesses built around leads, clients, appointments, sessions and ongoing service delivery.',
    href: '/client-operations',
    action: 'Explore Client Operations',
    color: '#8A4DFF',
    number: '01',
  },
  {
    eyebrow: 'Web Systems',
    title:
      'Turn your website into part of the operation.',
    body:
      'Modern websites connected to enquiries, CRM, workflows, bookings, reporting and the wider BRΛINBΛSE platform.',
    href: '/web-systems',
    action: 'Explore Web Systems',
    color: '#6366F1',
    number: '02',
  },
  {
    eyebrow: 'Platform Demo',
    title:
      'See the wider BRΛINBΛSE platform in action.',
    body:
      'Explore an interactive example showing how operational information, workflows, dashboards and intelligence come together.',
    href: '/demo',
    action: 'Explore BRΛINBΛSE Demo',
    color: '#38BDF8',
    number: '03',
  },
];

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
      'Manage appointments, sessions, programs and capacity with less manual coordination.',
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
        <rect
          x="3"
          y="4"
          width="18"
          height="18"
          rx="2"
        />
        <line
          x1="16"
          y1="2"
          x2="16"
          y2="6"
        />
        <line
          x1="8"
          y1="2"
          x2="8"
          y2="6"
        />
        <line
          x1="3"
          y1="10"
          x2="21"
          y2="10"
        />
      </svg>
    ),
  },
  {
    title: 'Dashboards & Reporting',
    description:
      'Operational KPIs, trends and reporting brought together in a clear visual layer.',
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
        <rect
          x="3"
          y="3"
          width="7"
          height="7"
          rx="1"
        />
        <rect
          x="14"
          y="3"
          width="7"
          height="7"
          rx="1"
        />
        <rect
          x="3"
          y="14"
          width="7"
          height="7"
          rx="1"
        />
        <rect
          x="14"
          y="14"
          width="7"
          height="7"
          rx="1"
        />
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
    title: 'Intelligent Web Systems',
    description:
      'Websites that capture enquiries and connect directly into your wider operational environment.',
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
        <circle
          cx="12"
          cy="12"
          r="10"
        />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    title: 'Portals & Workspaces',
    description:
      'Give clients, teams or stakeholders controlled access to the information and services relevant to them.',
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
        <rect
          x="3"
          y="11"
          width="18"
          height="11"
          rx="2"
        />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
];

const OUTCOMES = [
  {
    title: 'One operational view',
    body:
      'Bring disconnected information, systems and workflows into one environment.',
    color: '#8A4DFF',
  },
  {
    title: 'Less manual admin',
    body:
      'Reduce repetitive work, duplicated entry and time spent moving between tools.',
    color: '#38BDF8',
  },
  {
    title: 'Faster decisions',
    body:
      'Surface the information that matters without manually searching across systems.',
    color: '#A78BFA',
  },
  {
    title: 'Better visibility',
    body:
      'Understand activity, performance and priorities from a clearer operational picture.',
    color: '#22C55E',
  },
];

const INTELLIGENCE = [
  {
    title: 'Ask your operation',
    body:
      'Use natural language to interrogate the information available inside BRΛINBΛSE.',
  },
  {
    title: 'Surface what matters',
    body:
      'HLNΛ helps identify important activity, changes and operational signals.',
  },
  {
    title: 'Connected context',
    body:
      'Bring information from across the platform together around the question being asked.',
  },
  {
    title: 'Move toward action',
    body:
      'Use intelligence to help navigate priorities, workflows and decisions.',
  },
];

export default function Home() {
  const [enquiryOpen, setEnquiryOpen] =
    useState(false);

  const [
    hoveredModule,
    setHoveredModule,
  ] = useState<number | null>(null);

  const [
    hoveredOutcome,
    setHoveredOutcome,
  ] = useState<number | null>(null);

  const [
    hoveredPath,
    setHoveredPath,
  ] = useState<number | null>(null);

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

    const frame =
      window.requestAnimationFrame(
        scrollToTop,
      );

    const timer =
      window.setTimeout(
        scrollToTop,
        50,
      );

    return () => {
      window.cancelAnimationFrame(
        frame,
      );

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

      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          background: `
            radial-gradient(
              ellipse 72% 48% at 50% -5%,
              rgba(138,77,255,.13) 0%,
              rgba(74,54,180,.045) 38%,
              transparent 72%
            )
          `,
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
        {/* HERO */}

        <section
          className="bb-home-hero"
          style={{
            minHeight:
              'calc(100vh - 52px)',
            display: 'flex',
            alignItems: 'center',
            padding: '50px 0 78px',
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
            <div
              style={{
                maxWidth: 620,
                position: 'relative',
                zIndex: 2,
              }}
            >
              <div
                style={{
                  marginBottom: 31,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <Image
                  src="/Brand/brainbase-logo-dark.svg"
                  alt="BRΛINBΛSE"
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
                  Operational intelligence
                  platform
                </span>
              </div>

              <h1
                style={{
                  margin: '0 0 24px',
                  maxWidth: 610,
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
                  maxWidth: 535,
                  fontSize: 16,
                  lineHeight: 1.72,
                  color:
                    'rgba(226,232,240,.70)',
                }}
              >
                BRΛINBΛSE connects your
                systems, information and
                workflows into one operational
                platform — helping you see
                what is happening, understand
                what matters and act faster.
              </p>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginBottom: 32,
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
                    background:
                      'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                    color: '#FFFFFF',
                    fontSize: 13,
                    fontWeight: 650,
                    textDecoration: 'none',
                    boxShadow:
                      '0 8px 26px rgba(106,61,255,.22)',
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
                  Request a demo
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

            <div
              style={{
                minHeight: 590,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                transform:
                  'translateY(-10px)',
              }}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: 530,
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
                  alt="HLNΛ intelligence engine"
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
                  width: 'min(420px, 92%)',
                  marginTop: 28,
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

                <CommandDemo placeholder="Ask BRΛINBΛSE what's happening across your operation..." />
              </div>
            </div>
          </div>
        </section>

        {/* PLATFORM STATEMENT */}

        <section
          style={{
            marginBottom: 104,
            padding: '28px 30px',
            borderRadius: 17,
            background:
              'linear-gradient(135deg, rgba(138,77,255,.05), rgba(255,255,255,.015))',
            border:
              '1px solid rgba(255,255,255,.065)',
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 1,
            overflow: 'hidden',
          }}
        >
          {[
            [
              'One platform',
              'Connected operations',
            ],
            [
              'HLNΛ',
              'Intelligence engine',
            ],
            [
              'Modular',
              'Built around your operation',
            ],
            [
              'Flexible',
              'Start where you need it',
            ],
          ].map(
            ([value, label], index) => (
              <div
                key={value}
                style={{
                  padding: '13px 22px',
                  textAlign: 'center',
                  borderRight:
                    index < 3
                      ? '1px solid rgba(255,255,255,.05)'
                      : 'none',
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

                <div
                  style={{
                    fontSize: 10,
                    color:
                      'rgba(255,255,255,.36)',
                  }}
                >
                  {label}
                </div>
              </div>
            ),
          )}
        </section>

        {/* WHY */}

        <section
          style={{
            marginBottom: 112,
          }}
        >
          <SectionHeading
            eyebrow="Why BRΛINBΛSE"
            title="Your operation should not live across disconnected tools."
            description="BRΛINBΛSE brings the information, workflows and operational context you need into one environment instead of forcing people to piece the picture together manually."
            centred
          />

          <div className="bb-home-outcome-grid">
            {OUTCOMES.map(
              (item, index) => {
                const active =
                  hoveredOutcome === index;

                return (
                  <div
                    key={item.title}
                    onMouseEnter={() =>
                      setHoveredOutcome(
                        index,
                      )
                    }
                    onMouseLeave={() =>
                      setHoveredOutcome(
                        null,
                      )
                    }
                    style={{
                      minHeight: 175,
                      padding: '24px',
                      borderRadius: 14,
                      background: active
                        ? 'rgba(255,255,255,.03)'
                        : 'rgba(255,255,255,.016)',
                      border:
                        '1px solid rgba(255,255,255,.06)',
                      transition:
                        'all .16s',
                      transform: active
                        ? 'translateY(-2px)'
                        : 'translateY(0)',
                    }}
                  >
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background:
                          item.color,
                        boxShadow: active
                          ? `0 0 12px ${item.color}`
                          : `0 0 6px ${item.color}70`,
                        marginBottom: 21,
                      }}
                    />

                    <h3
                      style={{
                        margin:
                          '0 0 8px',
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

        {/* PATHS */}

        <section
          style={{
            marginBottom: 112,
          }}
        >
          <SectionHeading
            eyebrow="Start Where It Makes Sense"
            title="There is more than one way into BRΛINBΛSE."
            description="Start with the part of your operation that needs attention today. The platform can expand as more of your systems, information and workflows become connected."
            centred
          />

          <div className="bb-home-path-grid">
            {PATHS.map(
              (path, index) => {
                const active =
                  hoveredPath === index;

                return (
                  <Link
                    key={path.title}
                    href={path.href}
                    onMouseEnter={() =>
                      setHoveredPath(index)
                    }
                    onMouseLeave={() =>
                      setHoveredPath(null)
                    }
                    style={{
                      minHeight: 310,
                      padding: '27px',
                      display: 'flex',
                      flexDirection:
                        'column',
                      borderRadius: 16,
                      position: 'relative',
                      overflow: 'hidden',
                      textDecoration: 'none',
                      background: active
                        ? `rgba(${hexToRgbStr(
                            path.color,
                          )}, .055)`
                        : 'rgba(255,255,255,.017)',
                      border: active
                        ? `1px solid ${path.color}34`
                        : '1px solid rgba(255,255,255,.065)',
                      transform: active
                        ? 'translateY(-3px)'
                        : 'translateY(0)',
                      transition:
                        'all .18s',
                      boxShadow: active
                        ? `0 18px 45px ${path.color}0E`
                        : 'none',
                    }}
                  >
                    <div
                      style={{
                        position:
                          'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 1,
                        background:
                          `linear-gradient(90deg, ${path.color}90, transparent)`,
                      }}
                    />

                    <div
                      style={{
                        display: 'flex',
                        alignItems:
                          'center',
                        justifyContent:
                          'space-between',
                        gap: 12,
                        marginBottom: 38,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing:
                            '.11em',
                          textTransform:
                            'uppercase',
                          color:
                            path.color,
                        }}
                      >
                        {path.eyebrow}
                      </div>

                      <div
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color:
                            'rgba(255,255,255,.22)',
                        }}
                      >
                        {path.number}
                      </div>
                    </div>

                    <h3
                      style={{
                        margin:
                          '0 0 13px',
                        fontSize: 21,
                        lineHeight: 1.18,
                        fontWeight: 650,
                        letterSpacing:
                          '-.028em',
                        color: '#F5F7FA',
                      }}
                    >
                      {path.title}
                    </h3>

                    <p
                      style={{
                        margin:
                          '0 0 28px',
                        fontSize: 12,
                        lineHeight: 1.7,
                        color:
                          'rgba(226,232,240,.57)',
                      }}
                    >
                      {path.body}
                    </p>

                    <div
                      style={{
                        marginTop: 'auto',
                        paddingTop: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        color:
                          path.color,
                      }}
                    >
                      {path.action} →
                    </div>
                  </Link>
                );
              },
            )}
          </div>
        </section>

        {/* PRODUCT */}

        <section
          id="product"
          style={{
            marginBottom: 112,
            scrollMarginTop: 100,
          }}
        >
          <SectionHeading
            eyebrow="The Platform"
            title="One place to run the work that matters."
            description="BRΛINBΛSE is modular. Use the capabilities that fit your operation and connect more over time."
          />

          <div className="bb-home-module-grid">
            {PLATFORM_MODULES.map(
              (module, index) => {
                const active =
                  hoveredModule === index;

                return (
                  <div
                    key={module.title}
                    onMouseEnter={() =>
                      setHoveredModule(
                        index,
                      )
                    }
                    onMouseLeave={() =>
                      setHoveredModule(
                        null,
                      )
                    }
                    style={{
                      minHeight: 185,
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
                      transition:
                        'all .17s',
                    }}
                  >
                    <div
                      style={{
                        position:
                          'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 1,
                        background:
                          `linear-gradient(90deg, ${module.color}76, transparent)`,
                      }}
                    />

                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 9,
                        marginBottom: 18,
                        display: 'flex',
                        alignItems:
                          'center',
                        justifyContent:
                          'center',
                        color:
                          module.color,
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
                        margin:
                          '0 0 8px',
                        fontSize: 15,
                        fontWeight: 650,
                        letterSpacing:
                          '-.015em',
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

        {/* HLNA */}

        <section
          className="bb-home-section-card"
          style={{
            marginBottom: 112,
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

          <div className="bb-home-hlna-grid">
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
                  marginBottom: 14,
                  fontSize: 10,
                  fontWeight: 650,
                  letterSpacing: '.13em',
                  color:
                    'rgba(167,139,250,.80)',
                  textTransform: 'uppercase',
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
                    'clamp(30px, 3.8vw, 44px)',
                  lineHeight: 1.07,
                  letterSpacing: '-.038em',
                  fontWeight: 650,
                  color: '#F5F7FA',
                }}
              >
                BRΛINBΛSE thinks
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
                  margin: '0 0 26px',
                  maxWidth: 450,
                  fontSize: 14,
                  lineHeight: 1.72,
                  color:
                    'rgba(226,232,240,.63)',
                }}
              >
                HLNΛ is the intelligence
                layer inside BRΛINBΛSE. It
                connects operational
                information with the
                questions, decisions and
                actions that happen every
                day.
              </p>

              <Link
                href="/demo"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#C4B5FD',
                  textDecoration: 'none',
                }}
              >
                Experience HLNΛ in the
                platform demo →
              </Link>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(2, minmax(0, 1fr))',
                gap: 12,
                position: 'relative',
              }}
            >
              {INTELLIGENCE.map(
                (item, index) => (
                  <div
                    key={item.title}
                    style={{
                      minHeight: 126,
                      padding: '20px',
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
                        position:
                          'absolute',
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
                        margin:
                          '0 0 7px',
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

        {/* HOW IT WORKS */}

        <section
          style={{
            marginBottom: 112,
          }}
        >
          <SectionHeading
            eyebrow="How BRΛINBΛSE Works"
            title="Connect. Understand. Act."
            description="BRΛINBΛSE sits between the systems and information you already have and the decisions your people need to make."
            centred
          />

          <div className="bb-home-how-grid">
            {[
              {
                n: '01',
                title: 'Connect',
                body:
                  'Bring together the information, systems and workflows relevant to your operation.',
              },
              {
                n: '02',
                title: 'Understand',
                body:
                  'Use dashboards and HLNΛ to turn connected information into useful operational context.',
              },
              {
                n: '03',
                title: 'Act',
                body:
                  'Move from insight to action through workflows, decisions and automation inside the platform.',
              },
            ].map(step => (
              <div
                key={step.n}
                style={{
                  padding: '27px',
                  minHeight: 205,
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
                    marginBottom: 27,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.10em',
                    color:
                      'rgba(167,139,250,.65)',
                  }}
                >
                  {step.n}
                </div>

                <h3
                  style={{
                    margin: '0 0 8px',
                    fontSize: 18,
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

        {/* START SMALL */}

        <section
          className="bb-home-section-card"
          style={{
            marginBottom: 112,
            padding: '44px 46px',
            borderRadius: 20,
            background:
              'linear-gradient(135deg, rgba(99,102,241,.065), rgba(138,77,255,.025))',
            border:
              '1px solid rgba(99,102,241,.13)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 44,
              alignItems: 'center',
            }}
          >
            <div>
              <div
                style={{
                  marginBottom: 11,
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '.12em',
                  color:
                    'rgba(167,139,250,.70)',
                }}
              >
                Start small. Connect more.
              </div>

              <h2
                style={{
                  margin: '0 0 14px',
                  fontSize:
                    'clamp(27px, 4vw, 38px)',
                  lineHeight: 1.1,
                  letterSpacing: '-.035em',
                  fontWeight: 650,
                  color: '#F5F7FA',
                }}
              >
                BRΛINBΛSE does not have to
                replace everything at once.
              </h2>

              <p
                style={{
                  margin: 0,
                  maxWidth: 550,
                  fontSize: 13,
                  lineHeight: 1.7,
                  color:
                    'rgba(226,232,240,.58)',
                }}
              >
                Start with the problem that
                matters now — a website,
                client workflow, dashboard,
                reporting process or
                operational system — and
                build from there.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 9,
              }}
            >
              {[
                [
                  '01',
                  'Start with one real problem',
                ],
                [
                  '02',
                  'Build the workflow around it',
                ],
                [
                  '03',
                  'Connect more as value grows',
                ],
              ].map(([number, text]) => (
                <div
                  key={number}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 13,
                    padding: '14px 16px',
                    borderRadius: 11,
                    background:
                      'rgba(7,8,11,.28)',
                    border:
                      '1px solid rgba(255,255,255,.06)',
                  }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent:
                        'center',
                      flexShrink: 0,
                      color: '#A78BFA',
                      background:
                        'rgba(138,77,255,.08)',
                      border:
                        '1px solid rgba(138,77,255,.16)',
                      fontSize: 9,
                      fontWeight: 700,
                    }}
                  >
                    {number}
                  </div>

                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 550,
                      color:
                        'rgba(245,247,250,.70)',
                    }}
                  >
                    {text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}

        <section
          className="bb-home-cta"
          style={{
            padding: '54px 46px',
            borderRadius: 20,
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
            background:
              'linear-gradient(135deg, rgba(138,77,255,.085), rgba(86,119,255,.035))',
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
              width: 540,
              height: 420,
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(138,77,255,.13), transparent 68%)',
              pointerEvents: 'none',
            }}
          />

          <div
            style={{
              position: 'relative',
              maxWidth: 680,
              margin: '0 auto',
            }}
          >
            <div
              style={{
                marginBottom: 13,
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '.13em',
                color:
                  'rgba(167,139,250,.70)',
              }}
            >
              Your operation
            </div>

            <h2
              style={{
                margin: '0 0 15px',
                fontSize:
                  'clamp(29px, 4vw, 42px)',
                lineHeight: 1.09,
                letterSpacing: '-.038em',
                fontWeight: 650,
                color: '#F5F7FA',
              }}
            >
              Start with what you need
              today.
              <br />
              Build from there.
            </h2>

            <p
              style={{
                margin: '0 auto 28px',
                maxWidth: 570,
                fontSize: 14,
                lineHeight: 1.7,
                color:
                  'rgba(226,232,240,.60)',
              }}
            >
              Tell us what is creating
              friction in your operation and
              we can explore where BRΛINBΛSE
              could fit.
            </p>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <Link
                href="/request-demo"
                style={{
                  height: 45,
                  padding: '0 22px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 9,
                  background:
                    'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 650,
                  textDecoration: 'none',
                  boxShadow:
                    '0 8px 24px rgba(106,61,255,.18)',
                }}
              >
                Request a demo →
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
                Explore the platform
              </Link>

              <button
                onClick={() =>
                  setEnquiryOpen(true)
                }
                style={{
                  height: 43,
                  padding: '0 20px',
                  borderRadius: 9,
                  border:
                    '1px solid rgba(255,255,255,.07)',
                  background: 'transparent',
                  color:
                    'rgba(245,247,250,.48)',
                  fontSize: 12,
                  fontWeight: 550,
                  fontFamily: FONT,
                  cursor: 'pointer',
                }}
              >
                Discuss your operation
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* FOOTER */}

      <footer
        style={{
          borderTop:
            '1px solid rgba(255,255,255,.05)',
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
            justifyContent:
              'space-between',
            gap: 22,
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
              alt="BRΛINBΛSE"
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
              Operational intelligence,
              insight and automation in one place.
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              flexWrap: 'wrap',
            }}
          >
            <Link
              href="/client-operations"
              style={footerLinkStyle}
            >
              Client Operations
            </Link>

            <Link
              href="/web-systems"
              style={footerLinkStyle}
            >
              Web Systems
            </Link>

            <Link
              href="/pricing"
              style={footerLinkStyle}
            >
              Pricing
            </Link>

            <Link
              href="/demo"
              style={footerLinkStyle}
            >
              Demo
            </Link>

            <Link
              href="/terms"
              style={footerLinkStyle}
            >
              Terms
            </Link>

            <Link
              href="/privacy"
              style={footerLinkStyle}
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
              © 2026 BRΛINBΛSE
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
        maxWidth: centred
          ? 700
          : 650,
        margin: centred
          ? '0 auto 39px'
          : '0 0 39px',
        textAlign: centred
          ? 'center'
          : 'left',
      }}
    >
      <div
        style={{
          marginBottom: 10,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '.13em',
          textTransform: 'uppercase',
          color:
            'rgba(167,139,250,.68)',
        }}
      >
        {eyebrow}
      </div>

      <h2
        style={{
          margin: '0 0 13px',
          fontSize:
            'clamp(28px, 4vw, 40px)',
          lineHeight: 1.09,
          letterSpacing: '-.037em',
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
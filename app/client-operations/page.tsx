'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

const FONT =
  'var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const BG = '#07080B';

const KEYFRAMES = `
  @keyframes clientOpsPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .4; }
  }

  @media (max-width: 760px) {
    .client-ops-shell {
      padding-left: 18px !important;
      padding-right: 18px !important;
    }

    .client-ops-feature-panel {
      padding-left: 24px !important;
      padding-right: 24px !important;
    }

    .client-ops-live-body {
      padding: 20px !important;
    }

    .client-ops-final-cta {
      padding-left: 24px !important;
      padding-right: 24px !important;
    }
  }
`;

const WHO_FOR = [
  'Coaches & Trainers',
  'Consultants',
  'Tutors & Educators',
  'Clinics & Practitioners',
  'Clubs & Academies',
  'Service Businesses',
];

const OUTCOMES = [
  {
    title: 'Never lose an enquiry',
    description:
      'New leads enter one organised pipeline instead of disappearing across forms, messages and inboxes.',
    color: '#8A4DFF',
  },
  {
    title: 'Organised client records',
    description:
      'Contacts, history, activity and follow-up remain connected around each client.',
    color: '#38BDF8',
  },
  {
    title: 'Clear scheduling',
    description:
      'See sessions, appointments, capacity and upcoming commitments in one operational view.',
    color: '#A78BFA',
  },
  {
    title: 'Follow-up visibility',
    description:
      'Know who needs a call, email or response before opportunities go cold.',
    color: '#F59E0B',
  },
  {
    title: 'Revenue visibility',
    description:
      'Understand the commercial value of your schedule, bookings and client activity.',
    color: '#22C55E',
  },
  {
    title: 'Operational clarity',
    description:
      'See the health of the business without manually piecing together separate tools.',
    color: '#34D399',
  },
];

const JOURNEY = [
  {
    number: '01',
    title: 'Enquiry captured',
    body:
      'A prospect enters through your website, referral or enquiry channel.',
    color: '#6366F1',
  },
  {
    number: '02',
    title: 'Lead organised',
    body:
      'The enquiry appears in BRΛINBΛSE with contact information and follow-up status.',
    color: '#8A4DFF',
  },
  {
    number: '03',
    title: 'Client created',
    body:
      'When the relationship progresses, the lead becomes an organised client record.',
    color: '#38BDF8',
  },
  {
    number: '04',
    title: 'Service scheduled',
    body:
      'Sessions, appointments or service delivery are managed from the same environment.',
    color: '#22C55E',
  },
  {
    number: '05',
    title: 'Follow-up managed',
    body:
      'Calls, emails, requests and next actions stay visible to the business.',
    color: '#F59E0B',
  },
  {
    number: '06',
    title: 'Business understood',
    body:
      'Dashboards and HLNΛ turn connected activity into operational visibility.',
    color: '#A78BFA',
  },
];

const MODULES = [
  {
    title: 'Intelligent Website',
    description:
      'Capture enquiries and connect your public website directly to the operational system.',
    color: '#6366F1',
  },
  {
    title: 'CRM & Clients',
    description:
      'Manage leads, contacts, clients and communication activity.',
    color: '#8A4DFF',
  },
  {
    title: 'Scheduling & Sessions',
    description:
      'Manage appointments, sessions, programs and availability.',
    color: '#22C55E',
  },
  {
    title: 'Requests & Follow-up',
    description:
      'Keep incoming work, enquiries and required actions visible.',
    color: '#F59E0B',
  },
  {
    title: 'Dashboards & Reporting',
    description:
      'Bring operational activity and business indicators into one view.',
    color: '#A78BFA',
  },
  {
    title: 'HLNΛ Intelligence',
    description:
      'Surface context, risks, priorities and operational insight across the system.',
    color: '#38BDF8',
  },
];

type ClientOperationsPlan = {
  name: string;
  tagline: string;
  price: number | null;
  priceLabel?: string;
  color: string;
  features: string[];
  popular: boolean;
  enterprise?: boolean;
  cta: string;
};

const PRICING: ClientOperationsPlan[] = [
  {
    name: 'Foundation',
    tagline: 'Get your operation organised',
    price: 29,
    color: '#8A4DFF',
    features: [
      'Client management',
      'Lead tracking',
      'Scheduling',
      'Core operational view',
    ],
    popular: false,
    cta: 'Discuss Foundation',
  },
  {
    name: 'Operations',
    tagline: 'Run the day-to-day work',
    price: 59,
    color: '#22C55E',
    features: [
      'Everything in Foundation',
      'Follow-up workflows',
      'Revenue visibility',
      'Operational dashboards',
    ],
    popular: true,
    cta: 'Discuss Operations',
  },
  {
    name: 'Business System',
    tagline: 'Connect the broader business',
    price: 99,
    color: '#A78BFA',
    features: [
      'Everything in Operations',
      'HLNΛ intelligence',
      'Advanced reporting',
      'Business integrations',
    ],
    popular: false,
    cta: 'Discuss Business System',
  },
  {
    name: 'Enterprise',
    tagline: 'Tailored deployment at scale',
    price: null,
    priceLabel: 'Custom',
    color: '#38BDF8',
    features: [
      'Tailored BRΛINBΛSE deployment',
      'Multiple teams or business units',
      'Advanced permissions & governance',
      'Custom integrations & workflows',
    ],
    popular: false,
    enterprise: true,
    cta: 'Talk to us',
  },
];

export default function ClientOperations() {
  const [hoveredOutcome, setHoveredOutcome] =
    useState<number | null>(null);

  const [hoveredJourney, setHoveredJourney] =
    useState<number | null>(null);

  const [hoveredModule, setHoveredModule] =
    useState<number | null>(null);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: BG,
        color: '#F5F7FA',
        fontFamily: FONT,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>{KEYFRAMES}</style>

      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: `
            radial-gradient(
              ellipse 68% 40% at 50% 0%,
              rgba(138,77,255,.12) 0%,
              rgba(56,189,248,.025) 45%,
              transparent 72%
            )
          `,
        }}
      />

      <div
        className="client-ops-shell"
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '0 32px 100px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            paddingTop: 28,
          }}
        >
          <Link
            href="/"
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,.34)',
              textDecoration: 'none',
            }}
          >
            ← Back to BRΛINBΛSE
          </Link>
        </div>

        {/* ================================================================
            HERO
        ================================================================= */}

        <section
          style={{
            padding: '64px 0 78px',
            textAlign: 'center',
            maxWidth: 900,
            margin: '0 auto',
          }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 28,
            }}
          >
            <div
              style={{
                width: 430,
                maxWidth: '90vw',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'visible',
              }}
            >
              <Image
                src="/Brand/brainbase-logo-dark.svg"
                alt="BRΛINBΛSE"
                width={760}
                height={170}
                priority
                style={{
                  display: 'block',
                  width: 395,
                  maxWidth: '112%',
                  height: 'auto',
                  transform: 'translateX(-3.5%)',
                }}
              />
            </div>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 11px',
              marginBottom: 27,
              borderRadius: 999,
              background:
                'rgba(138,77,255,.06)',
              border:
                '1px solid rgba(138,77,255,.17)',
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: '#22C55E',
                boxShadow:
                  '0 0 7px rgba(34,197,94,.8)',
                animation:
                  'clientOpsPulse 2.5s ease-in-out infinite',
              }}
            />

            <span
              style={{
                fontSize: 9,
                fontWeight: 650,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color:
                  'rgba(167,139,250,.80)',
              }}
            >
              Client Operations
            </span>
          </div>

          <h1
            style={{
              margin: '0 auto 24px',
              maxWidth: 830,
              fontSize:
                'clamp(42px, 5.4vw, 64px)',
              lineHeight: 1.035,
              letterSpacing: '-.046em',
              fontWeight: 650,
              color: '#F5F7FA',
            }}
          >
            Run your clients.
            <br />

            <span
              style={{
                background:
                  'linear-gradient(100deg, #8A4DFF 0%, #A78BFA 50%, #5C7CFF 100%)',
                WebkitBackgroundClip:
                  'text',
                WebkitTextFillColor:
                  'transparent',
                backgroundClip: 'text',
              }}
            >
              Run your schedule.
            </span>

            <br />

            Run your business.
          </h1>

          <p
            style={{
              maxWidth: 640,
              margin: '0 auto 30px',
              fontSize: 15,
              lineHeight: 1.7,
              color:
                'rgba(226,232,240,.61)',
            }}
          >
            Leads, clients, bookings and follow-up —
            connected in one operational system.
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
              href="/client-operations/demo"
              style={{
                height: 44,
                padding: '0 22px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 9,
                background:
                  'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                color: '#FFFFFF',
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 650,
                boxShadow:
                  '0 8px 24px rgba(106,61,255,.18)',
              }}
            >
              Explore Client Operations →
            </Link>

            <Link
              href="/request-demo"
              style={{
                height: 42,
                padding: '0 20px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 9,
                background:
                  'rgba(255,255,255,.025)',
                border:
                  '1px solid rgba(255,255,255,.09)',
                color:
                  'rgba(245,247,250,.68)',
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 550,
              }}
            >
              Request a demo
            </Link>
          </div>

          <div
            style={{
              marginTop: 58,
            }}
          >
            <div
              style={{
                marginBottom: 14,
                fontSize: 8,
                fontWeight: 650,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color:
                  'rgba(255,255,255,.24)',
              }}
            >
              Designed for client & service businesses
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              {WHO_FOR.map(item => (
                <div
                  key={item}
                  style={{
                    padding: '6px 13px',
                    borderRadius: 999,
                    background:
                      'rgba(255,255,255,.022)',
                    border:
                      '1px solid rgba(255,255,255,.065)',
                    color:
                      'rgba(226,232,240,.45)',
                    fontSize: 10,
                    fontWeight: 500,
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================
            BEFORE / AFTER
        ================================================================= */}

        <section
          style={{
            marginBottom: 96,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(280px, 1fr))',
              borderRadius: 15,
              overflow: 'hidden',
              border:
                '1px solid rgba(255,255,255,.07)',
            }}
          >
            <div
              style={{
                padding: '28px 30px',
                background:
                  'rgba(239,68,68,.025)',
              }}
            >
              <div
                style={{
                  marginBottom: 10,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '.11em',
                  textTransform: 'uppercase',
                  color:
                    'rgba(248,113,113,.50)',
                }}
              >
                Before
              </div>

              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.55,
                  color:
                    'rgba(226,232,240,.45)',
                }}
              >
                Forms, inboxes, spreadsheets,
                calendars and follow-up scattered
                everywhere.
              </div>
            </div>

            <div
              style={{
                padding: '28px 30px',
                background:
                  'rgba(138,77,255,.035)',
                borderLeft:
                  '1px solid rgba(255,255,255,.07)',
              }}
            >
              <div
                style={{
                  marginBottom: 10,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '.11em',
                  textTransform: 'uppercase',
                  color:
                    'rgba(167,139,250,.68)',
                }}
              >
                With BRΛINBΛSE
              </div>

              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.55,
                  color:
                    'rgba(226,232,240,.72)',
                }}
              >
                Leads, clients, scheduling,
                follow-up and operational context in
                one connected environment.
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            LIVE SYSTEM
        ================================================================= */}

        <section
          style={{
            marginBottom: 100,
          }}
        >
          <SectionHeading
            eyebrow="Client Operations"
            title="One operational view of the business."
            description="Bring leads, clients, scheduling, follow-up and operational intelligence into one working environment."
            centred
          />

          <div
            style={{
              borderRadius: 18,
              overflow: 'hidden',
              background:
                'rgba(255,255,255,.018)',
              border:
                '1px solid rgba(255,255,255,.075)',
              boxShadow:
                '0 30px 90px rgba(0,0,0,.20)',
            }}
          >
            <div
              style={{
                minHeight: 48,
                padding: '0 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent:
                  'space-between',
                gap: 12,
                flexWrap: 'wrap',
                background:
                  'rgba(4,5,8,.82)',
                borderBottom:
                  '1px solid rgba(255,255,255,.06)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color:
                      'rgba(167,139,250,.85)',
                    letterSpacing: '.10em',
                  }}
                >
                  HLNΛ
                </span>

                {[
                  'Leads',
                  'Clients',
                  'Scheduling',
                  'Requests',
                  'Reporting',
                ].map(item => (
                  <span
                    key={item}
                    style={{
                      fontSize: 10,
                      color:
                        item === 'Scheduling'
                          ? '#C4B5FD'
                          : 'rgba(255,255,255,.34)',
                      padding: '5px 7px',
                      borderRadius: 6,
                      background:
                        item === 'Scheduling'
                          ? 'rgba(138,77,255,.09)'
                          : 'transparent',
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#22C55E',
                    boxShadow:
                      '0 0 6px rgba(34,197,94,.8)',
                  }}
                />

                <span
                  style={{
                    fontSize: 9,
                    color:
                      'rgba(255,255,255,.30)',
                  }}
                >
                  OPERATIONAL VIEW
                </span>
              </div>
            </div>

            <div
              className="client-ops-live-body"
              style={{
                padding: 30,
              }}
            >
              <div
                style={{
                  marginBottom: 22,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color:
                      'rgba(167,139,250,.72)',
                    fontWeight: 650,
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    marginBottom: 7,
                  }}
                >
                  HLNΛ · Client Operations
                </div>

                <h3
                  style={{
                    margin: '0 0 4px',
                    fontSize: 23,
                    fontWeight: 650,
                    letterSpacing: '-.025em',
                    color: '#F5F7FA',
                  }}
                >
                  Operational Dashboard
                </h3>

                <p
                  style={{
                    margin: 0,
                    fontSize: 11,
                    color:
                      'rgba(226,232,240,.40)',
                  }}
                >
                  Leads, clients, sessions and
                  follow-up activity
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                {[
                  {
                    label: "Today's Sessions",
                    value: '6',
                    sub: 'Scheduled today',
                    color: '#8A4DFF',
                  },
                  {
                    label: 'New Leads',
                    value: '6',
                    sub: 'Last 7 days',
                    color: '#22C55E',
                  },
                  {
                    label: 'Follow-ups',
                    value: '5',
                    sub: 'Awaiting response',
                    color: '#F59E0B',
                  },
                  {
                    label: 'Open Leads',
                    value: '7',
                    sub: 'New or contacted',
                    color: '#3B82F6',
                  },
                ].map(card => (
                  <div
                    key={card.label}
                    style={{
                      padding: 17,
                      borderRadius: 11,
                      background:
                        'rgba(255,255,255,.025)',
                      border:
                        '1px solid rgba(255,255,255,.065)',
                    }}
                  >
                    <div
                      style={{
                        marginBottom: 8,
                        fontSize: 8,
                        fontWeight: 700,
                        letterSpacing: '.10em',
                        textTransform:
                          'uppercase',
                        color:
                          'rgba(255,255,255,.33)',
                      }}
                    >
                      {card.label}
                    </div>

                    <div
                      style={{
                        fontSize: 28,
                        lineHeight: 1,
                        fontWeight: 700,
                        color: card.color,
                        marginBottom: 6,
                      }}
                    >
                      {card.value}
                    </div>

                    <div
                      style={{
                        fontSize: 9,
                        color:
                          'rgba(255,255,255,.28)',
                      }}
                    >
                      {card.sub}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    minHeight: 240,
                    borderRadius: 12,
                    background:
                      'rgba(255,255,255,.02)',
                    border:
                      '1px solid rgba(255,255,255,.065)',
                  }}
                >
                  <PanelHeader
                    title="Today's Schedule"
                    action="View Schedule →"
                  />

                  <div
                    style={{
                      padding: 14,
                    }}
                  >
                    {[
                      {
                        name: 'Client Session',
                        time: '09:00–10:00',
                        location: 'Location A',
                        color: '#8A4DFF',
                      },
                      {
                        name: 'Group Program',
                        time: '14:30–15:30',
                        location: 'Location B',
                        color: '#22C55E',
                      },
                      {
                        name:
                          'Private Appointment',
                        time: '17:00–18:00',
                        location: 'Location A',
                        color: '#F59E0B',
                      },
                    ].map(session => (
                      <div
                        key={session.name}
                        style={{
                          padding: '10px 11px',
                          marginBottom: 7,
                          borderRadius: 8,
                          background:
                            'rgba(255,255,255,.025)',
                          border:
                            '1px solid rgba(255,255,255,.055)',
                          borderLeft:
                            `3px solid ${session.color}`,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 650,
                            color: '#F5F7FA',
                            marginBottom: 3,
                          }}
                        >
                          {session.name}
                        </div>

                        <div
                          style={{
                            fontSize: 9,
                            color:
                              'rgba(255,255,255,.34)',
                          }}
                        >
                          {session.time} ·{' '}
                          {session.location}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    minHeight: 240,
                    borderRadius: 12,
                    background:
                      'rgba(255,255,255,.02)',
                    border:
                      '1px solid rgba(255,255,255,.065)',
                  }}
                >
                  <PanelHeader
                    title="Needs Attention"
                    action="All Clients →"
                  />

                  {[
                    {
                      name:
                        'New website enquiry',
                      status:
                        'Never contacted',
                    },
                    {
                      name:
                        'Existing client',
                      status:
                        'Follow-up due',
                    },
                    {
                      name: 'New lead',
                      status:
                        'Awaiting response',
                    },
                  ].map((client, index) => (
                    <div
                      key={client.name}
                      style={{
                        padding: '14px 15px',
                        borderBottom:
                          index < 2
                            ? '1px solid rgba(255,255,255,.045)'
                            : 'none',
                        display: 'flex',
                        justifyContent:
                          'space-between',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 650,
                            color: '#F5F7FA',
                            marginBottom: 3,
                          }}
                        >
                          {client.name}
                        </div>

                        <div
                          style={{
                            fontSize: 9,
                            color:
                              'rgba(255,255,255,.30)',
                          }}
                        >
                          {client.status}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: 5,
                        }}
                      >
                        <span
                          style={{
                            padding: '3px 7px',
                            borderRadius: 999,
                            background:
                              'rgba(34,197,94,.08)',
                            border:
                              '1px solid rgba(34,197,94,.17)',
                            fontSize: 8,
                            color: '#6EE7B7',
                          }}
                        >
                          Call
                        </span>

                        <span
                          style={{
                            padding: '3px 7px',
                            borderRadius: 999,
                            background:
                              'rgba(59,130,246,.08)',
                            border:
                              '1px solid rgba(59,130,246,.17)',
                            fontSize: 8,
                            color: '#93C5FD',
                          }}
                        >
                          Email
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            CONNECTED JOURNEY
        ================================================================= */}

        <section
          style={{
            marginBottom: 100,
          }}
        >
          <SectionHeading
            eyebrow="Connected Journey"
            title="From first enquiry to ongoing client."
            description="The value is not one feature. Each stage of the client journey remains connected to the next."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 10,
            }}
          >
            {JOURNEY.map(
              (step, index) => {
                const active =
                  hoveredJourney === index;

                return (
                  <div
                    key={step.number}
                    onMouseEnter={() =>
                      setHoveredJourney(
                        index,
                      )
                    }
                    onMouseLeave={() =>
                      setHoveredJourney(
                        null,
                      )
                    }
                    style={{
                      padding: 20,
                      display: 'flex',
                      gap: 15,
                      alignItems:
                        'flex-start',
                      borderRadius: 13,
                      background: active
                        ? `rgba(${hexToRgbStr(
                            step.color,
                          )}, .055)`
                        : 'rgba(255,255,255,.018)',
                      border: active
                        ? `1px solid ${step.color}30`
                        : '1px solid rgba(255,255,255,.06)',
                      transform: active
                        ? 'translateY(-2px)'
                        : 'translateY(0)',
                      transition:
                        'all .16s',
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        display: 'flex',
                        alignItems:
                          'center',
                        justifyContent:
                          'center',
                        flexShrink: 0,
                        background:
                          `${step.color}12`,
                        border:
                          `1px solid ${step.color}28`,
                        color: step.color,
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    >
                      {step.number}
                    </div>

                    <div>
                      <h3
                        style={{
                          margin:
                            '0 0 5px',
                          fontSize: 13,
                          fontWeight: 650,
                          color:
                            '#F5F7FA',
                        }}
                      >
                        {step.title}
                      </h3>

                      <p
                        style={{
                          margin: 0,
                          fontSize: 11,
                          lineHeight: 1.6,
                          color:
                            'rgba(226,232,240,.53)',
                        }}
                      >
                        {step.body}
                      </p>
                    </div>
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
            marginBottom: 100,
          }}
        >
          <SectionHeading
            eyebrow="Operational Impact"
            title="Less admin. More control."
            description="BRΛINBΛSE removes operational friction around the work a client-based business already does every day."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 12,
            }}
          >
            {OUTCOMES.map(
              (outcome, index) => {
                const active =
                  hoveredOutcome === index;

                return (
                  <div
                    key={outcome.title}
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
                      padding: 22,
                      borderRadius: 13,
                      position: 'relative',
                      overflow: 'hidden',

                      background: active
                        ? `rgba(${hexToRgbStr(
                            outcome.color,
                          )}, .05)`
                        : 'rgba(255,255,255,.018)',

                      border: active
                        ? `1px solid ${outcome.color}30`
                        : '1px solid rgba(255,255,255,.06)',

                      transform: active
                        ? 'translateY(-2px)'
                        : 'translateY(0)',

                      transition:
                        'all .17s',
                    }}
                  >
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius:
                          '50%',
                        background:
                          outcome.color,
                        boxShadow:
                          `0 0 8px ${outcome.color}80`,
                        marginBottom: 17,
                      }}
                    />

                    <h3
                      style={{
                        margin:
                          '0 0 7px',
                        fontSize: 14,
                        fontWeight: 650,
                        color: '#F5F7FA',
                      }}
                    >
                      {outcome.title}
                    </h3>

                    <p
                      style={{
                        margin: 0,
                        fontSize: 11,
                        lineHeight: 1.62,
                        color:
                          'rgba(226,232,240,.55)',
                      }}
                    >
                      {
                        outcome.description
                      }
                    </p>
                  </div>
                );
              },
            )}
          </div>
        </section>

        {/* ================================================================
            MODULES
        ================================================================= */}

        <section
          className="client-ops-feature-panel"
          style={{
            marginBottom: 100,
            padding: 42,
            borderRadius: 18,
            background:
              'linear-gradient(135deg, rgba(138,77,255,.06), rgba(56,189,248,.015))',
            border:
              '1px solid rgba(138,77,255,.14)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              marginBottom: 30,
            }}
          >
            <div
              style={{
                marginBottom: 9,
                fontSize: 9,
                fontWeight: 650,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color:
                  'rgba(167,139,250,.70)',
              }}
            >
              BRΛINBΛSE Platform
            </div>

            <h2
              style={{
                margin: '0 0 10px',
                fontSize: 28,
                fontWeight: 650,
                letterSpacing: '-.03em',
                color: '#F5F7FA',
              }}
            >
              Powered by connected BRΛINBΛSE modules.
            </h2>

            <p
              style={{
                margin: 0,
                maxWidth: 650,
                fontSize: 13,
                lineHeight: 1.65,
                color:
                  'rgba(226,232,240,.53)',
              }}
            >
              Different businesses can use the same
              BRΛINBΛSE foundation, with workflows,
              configuration and terminology adapted
              to how they operate.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 10,
            }}
          >
            {MODULES.map(
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
                      padding: 18,
                      borderRadius: 12,

                      background: active
                        ? `rgba(${hexToRgbStr(
                            module.color,
                          )}, .055)`
                        : 'rgba(7,8,11,.26)',

                      border: active
                        ? `1px solid ${module.color}30`
                        : '1px solid rgba(255,255,255,.06)',

                      transition:
                        'all .16s',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent:
                          'space-between',
                        alignItems:
                          'center',
                        gap: 10,
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems:
                            'center',
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius:
                              '50%',
                            background:
                              module.color,
                            boxShadow:
                              `0 0 7px ${module.color}80`,
                          }}
                        />

                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 650,
                            color:
                              '#F5F7FA',
                          }}
                        >
                          {module.title}
                        </span>
                      </div>

                      <span
                        style={{
                          fontSize: 7,
                          fontWeight: 700,
                          letterSpacing:
                            '.08em',
                          color:
                            module.color,
                        }}
                      >
                        LIVE
                      </span>
                    </div>

                    <p
                      style={{
                        margin: 0,
                        fontSize: 10,
                        lineHeight: 1.55,
                        color:
                          'rgba(226,232,240,.47)',
                      }}
                    >
                      {
                        module.description
                      }
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
              gap: 8,
              marginTop: 24,
              paddingTop: 18,
              borderTop:
                '1px solid rgba(255,255,255,.055)',
            }}
          >
            <span
              style={{
                fontSize: 9,
                textTransform: 'uppercase',
                letterSpacing: '.08em',
                color:
                  'rgba(255,255,255,.27)',
              }}
            >
              Intelligence layer
            </span>

            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
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
                  '0 0 5px rgba(34,197,94,.8)',
              }}
            />
          </div>
        </section>

        {/* ================================================================
            REAL DEPLOYMENT
        ================================================================= */}

        <section
          style={{
            marginBottom: 100,
          }}
        >
          <div
            style={{
              padding: '38px 40px',
              borderRadius: 17,
              position: 'relative',
              overflow: 'hidden',
              background:
                'linear-gradient(135deg, rgba(16,185,129,.045), rgba(138,77,255,.018))',
              border:
                '1px solid rgba(16,185,129,.15)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(280px, 1fr))',
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
                      background:
                        'rgba(16,185,129,.09)',
                      border:
                        '1px solid rgba(16,185,129,.22)',
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
                      boxShadow:
                        '0 0 6px #22C55E',
                      animation:
                        'clientOpsPulse 2.5s ease-in-out infinite',
                    }}
                  />
                </div>

                <h2
                  style={{
                    margin: '0 0 11px',
                    fontSize: 27,
                    fontWeight: 650,
                    letterSpacing: '-.03em',
                    color: '#F5F7FA',
                  }}
                >
                  LD Tennis
                </h2>

                <p
                  style={{
                    margin: 0,
                    maxWidth: 560,
                    fontSize: 13,
                    lineHeight: 1.7,
                    color:
                      'rgba(226,232,240,.56)',
                  }}
                >
                  BRΛINBΛSE&apos;s first live Client
                  Operations deployment runs inside a
                  coaching business. It connects leads,
                  contacts, sessions, follow-up and
                  operational visibility through the
                  same platform.
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

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 9,
                }}
              >
                {[
                  'Website enquiries → leads',
                  'Leads → organised clients',
                  'Clients → scheduled sessions',
                  'Follow-up → visible actions',
                  'Activity → operational dashboard',
                ].map(item => (
                  <div
                    key={item}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '10px 12px',
                      borderRadius: 9,
                      background:
                        'rgba(7,8,11,.28)',
                      border:
                        '1px solid rgba(255,255,255,.055)',
                      fontSize: 10,
                      color:
                        'rgba(226,232,240,.54)',
                    }}
                  >
                    <span
                      style={{
                        color: '#22C55E',
                        fontSize: 10,
                      }}
                    >
                      ✓
                    </span>

                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            PRICING
        ================================================================= */}

        <section
          style={{
            marginBottom: 100,
          }}
        >
          <SectionHeading
            eyebrow="BRΛINBΛSE Pricing"
            title="Start small. Expand as you connect more."
            description="Client Operations can begin as a focused workspace and expand into a broader BRΛINBΛSE deployment as your workflows, reporting and intelligence requirements grow."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(245px, 1fr))',
              gap: 12,
              marginBottom: 22,
            }}
          >
            {PRICING.map(plan => (
              <div
                key={plan.name}
                style={{
                  minHeight: 430,
                  padding: '27px 24px 24px',
                  borderRadius: 16,
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',

                  background: plan.popular
                    ? 'linear-gradient(160deg, rgba(34,197,94,.055), rgba(255,255,255,.02) 48%, rgba(138,77,255,.02))'
                    : plan.enterprise
                      ? 'linear-gradient(160deg, rgba(56,189,248,.045), rgba(255,255,255,.018))'
                      : 'rgba(255,255,255,.02)',

                  border: plan.popular
                    ? '1px solid rgba(34,197,94,.24)'
                    : plan.enterprise
                      ? '1px solid rgba(56,189,248,.18)'
                      : '1px solid rgba(255,255,255,.075)',

                  boxShadow: plan.popular
                    ? '0 20px 60px rgba(34,197,94,.055)'
                    : 'none',
                }}
              >
                {plan.popular && (
                  <span
                    style={{
                      position: 'absolute',
                      right: 14,
                      top: 14,
                      padding: '4px 8px',
                      borderRadius: 999,
                      background:
                        'rgba(34,197,94,.09)',
                      border:
                        '1px solid rgba(34,197,94,.20)',
                      color: '#86EFAC',
                      fontSize: 7,
                      fontWeight: 700,
                      letterSpacing: '.08em',
                    }}
                  >
                    MOST POPULAR
                  </span>
                )}

                {plan.enterprise && (
                  <span
                    style={{
                      position: 'absolute',
                      right: 14,
                      top: 14,
                      padding: '4px 8px',
                      borderRadius: 999,
                      background:
                        'rgba(56,189,248,.08)',
                      border:
                        '1px solid rgba(56,189,248,.18)',
                      color: '#7DD3FC',
                      fontSize: 7,
                      fontWeight: 700,
                      letterSpacing: '.08em',
                    }}
                  >
                    TAILORED
                  </span>
                )}

                <div
                  style={{
                    marginBottom: 7,
                    fontSize: 12,
                    fontWeight: 650,
                    color: plan.color,
                  }}
                >
                  {plan.name}
                </div>

                <div
                  style={{
                    minHeight: 48,
                    paddingRight:
                      plan.popular ||
                      plan.enterprise
                        ? 68
                        : 0,
                    marginBottom: 18,
                    fontSize: 15,
                    lineHeight: 1.3,
                    fontWeight: 650,
                    color: '#F5F7FA',
                  }}
                >
                  {plan.tagline}
                </div>

                <div
                  style={{
                    minHeight: 48,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 4,
                    marginBottom: 5,
                  }}
                >
                  {plan.price !== null ? (
                    <>
                      <span
                        style={{
                          fontSize: 38,
                          lineHeight: 1,
                          fontWeight: 700,
                          letterSpacing:
                            '-.04em',
                          color: '#F5F7FA',
                        }}
                      >
                        ${plan.price}
                      </span>

                      <span
                        style={{
                          paddingTop: 23,
                          fontSize: 11,
                          lineHeight: 1,
                          color:
                            'rgba(255,255,255,.30)',
                        }}
                      >
                        / month
                      </span>
                    </>
                  ) : (
                    <span
                      style={{
                        fontSize: 38,
                        lineHeight: 1,
                        fontWeight: 700,
                        letterSpacing:
                          '-.04em',
                        color: '#F5F7FA',
                      }}
                    >
                      {plan.priceLabel}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    marginBottom: 22,
                    fontSize: 9,
                    color:
                      'rgba(255,255,255,.25)',
                  }}
                >
                  {plan.enterprise
                    ? 'Scoped to your organisation'
                    : 'Platform subscription'}
                </div>

                <div
                  style={{
                    height: 1,
                    background:
                      'rgba(255,255,255,.055)',
                    marginBottom: 20,
                  }}
                />

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    marginBottom: 26,
                    flex: 1,
                  }}
                >
                  {plan.features.map(
                    feature => (
                      <div
                        key={feature}
                        style={{
                          display: 'flex',
                          alignItems:
                            'flex-start',
                          gap: 9,
                        }}
                      >
                        <span
                          style={{
                            color:
                              plan.color,
                            fontSize: 10,
                            lineHeight: 1.5,
                          }}
                        >
                          ✓
                        </span>

                        <span
                          style={{
                            fontSize: 11,
                            lineHeight: 1.5,
                            color:
                              'rgba(226,232,240,.58)',
                          }}
                        >
                          {feature}
                        </span>
                      </div>
                    ),
                  )}
                </div>

                <Link
                  href="/request-demo"
                  style={{
                    height: 40,
                    width: '100%',
                    boxSizing:
                      'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent:
                      'center',
                    borderRadius: 8,

                    background:
                      plan.popular
                        ? 'rgba(34,197,94,.13)'
                        : `${plan.color}10`,

                    border: plan.popular
                      ? '1px solid rgba(34,197,94,.30)'
                      : `1px solid ${plan.color}30`,

                    color: plan.popular
                      ? '#86EFAC'
                      : plan.color,

                    textDecoration: 'none',
                    fontSize: 11,
                    fontWeight: 650,
                  }}
                >
                  {plan.cta} →
                </Link>
              </div>
            ))}
          </div>

          <div
            style={{
              maxWidth: 820,
              margin: '0 auto',
              padding: '18px 20px',
              borderRadius: 12,
              background:
                'rgba(255,255,255,.015)',
              border:
                '1px solid rgba(255,255,255,.055)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                marginBottom: 6,
                fontSize: 10,
                fontWeight: 650,
                color:
                  'rgba(245,247,250,.58)',
              }}
            >
              Platform subscription + implementation where required.
            </div>

            <p
              style={{
                margin: '0 auto 12px',
                maxWidth: 720,
                fontSize: 10,
                lineHeight: 1.65,
                color:
                  'rgba(226,232,240,.38)',
              }}
            >
              Monthly pricing covers the BRΛINBΛSE
              platform subscription. Initial
              configuration, data migration, website
              work and custom integrations may involve
              separate implementation costs depending
              on your requirements. Any additional costs
              are scoped and quoted before work begins.
            </p>

            <Link
              href="/pricing"
              style={{
                fontSize: 10,
                fontWeight: 650,
                color: '#A78BFA',
                textDecoration: 'none',
              }}
            >
              View full BRΛINBΛSE pricing →
            </Link>
          </div>
        </section>

        {/* ================================================================
            FINAL CTA
        ================================================================= */}

        <section
          className="client-ops-final-cta"
          style={{
            padding: '50px 42px',
            borderRadius: 19,
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
            background:
              'linear-gradient(135deg, rgba(138,77,255,.075), rgba(56,189,248,.025))',
            border:
              '1px solid rgba(138,77,255,.16)',
          }}
        >
          <div
            style={{
              maxWidth: 670,
              margin: '0 auto',
              position: 'relative',
            }}
          >
            <div
              style={{
                marginBottom: 11,
                fontSize: 9,
                fontWeight: 650,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color:
                  'rgba(167,139,250,.70)',
              }}
            >
              Build your client operation
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
              Know your clients. Know your schedule.
              <br />
              Know what needs attention.
            </h2>

            <p
              style={{
                margin: '0 auto 26px',
                maxWidth: 590,
                fontSize: 13,
                lineHeight: 1.7,
                color:
                  'rgba(226,232,240,.56)',
              }}
            >
              Whether you run coaching sessions,
              consultations, appointments, programs or
              another client-based service, BRΛINBΛSE
              can provide the operational system behind
              the work.
            </p>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 9,
                flexWrap: 'wrap',
              }}
            >
              <Link
                href="/request-demo"
                style={{
                  height: 43,
                  padding: '0 21px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: 9,
                  background:
                    'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                  color: '#FFFFFF',
                  textDecoration: 'none',
                  fontSize: 12,
                  fontWeight: 650,
                }}
              >
                Request a demo →
              </Link>

              <Link
                href="/client-operations/demo"
                style={{
                  height: 41,
                  padding: '0 19px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: 9,
                  background:
                    'rgba(255,255,255,.025)',
                  border:
                    '1px solid rgba(255,255,255,.08)',
                  color:
                    'rgba(245,247,250,.64)',
                  textDecoration: 'none',
                  fontSize: 12,
                  fontWeight: 550,
                }}
              >
                Explore Client Operations
              </Link>

              <Link
                href="/web-systems"
                style={{
                  height: 41,
                  padding: '0 19px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: 9,
                  background:
                    'rgba(255,255,255,.025)',
                  border:
                    '1px solid rgba(255,255,255,.08)',
                  color:
                    'rgba(245,247,250,.64)',
                  textDecoration: 'none',
                  fontSize: 12,
                  fontWeight: 550,
                }}
              >
                Web Systems
              </Link>
            </div>
          </div>
        </section>
      </div>
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
        maxWidth: centred ? 700 : 620,
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
          marginBottom: 10,
          fontSize: 9,
          fontWeight: 650,
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
          fontSize: 13,
          lineHeight: 1.7,
          color:
            'rgba(226,232,240,.57)',
        }}
      >
        {description}
      </p>
    </div>
  );
}

function PanelHeader({
  title,
  action,
}: {
  title: string;
  action: string;
}) {
  return (
    <div
      style={{
        padding: '12px 15px',
        borderBottom:
          '1px solid rgba(255,255,255,.055)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '.08em',
          color:
            'rgba(255,255,255,.38)',
        }}
      >
        {title}
      </span>

      <span
        style={{
          fontSize: 9,
          color: '#8A4DFF',
        }}
      >
        {action}
      </span>
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
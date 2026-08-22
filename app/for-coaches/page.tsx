'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

const FONT =
  'var(--font-inter), "Inter", -apple-system, sans-serif';

const BG = '#07080B';

const KEYFRAMES = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .40; }
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
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

const MODULES = [
  {
    title: 'Intelligent Website',
    description:
      'Capture enquiries and connect your public website directly to the operational system.',
    color: '#6366F1',
    status: 'LIVE',
  },
  {
    title: 'CRM & Clients',
    description:
      'Manage leads, contacts, clients and communication activity.',
    color: '#8A4DFF',
    status: 'LIVE',
  },
  {
    title: 'Scheduling & Sessions',
    description:
      'Manage appointments, sessions, programs and availability.',
    color: '#22C55E',
    status: 'LIVE',
  },
  {
    title: 'Requests & Follow-up',
    description:
      'Keep incoming work, enquiries and required actions visible.',
    color: '#F59E0B',
    status: 'LIVE',
  },
  {
    title: 'Dashboards & Reporting',
    description:
      'Bring operational activity and business indicators into one view.',
    color: '#A78BFA',
    status: 'LIVE',
  },
  {
    title: 'HLNΛ Intelligence',
    description:
      'Surface context, risks, priorities and operational insight across the system.',
    color: '#38BDF8',
    status: 'LIVE',
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
      'The enquiry appears in BrainBase with contact information and follow-up status.',
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
      'Dashboards and HLNΛ turn the connected activity into operational visibility.',
    color: '#A78BFA',
  },
];

const PRICING = [
  {
    name: 'Foundation',
    tagline: 'Organise your client operation',
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
    tagline: 'Connect your day-to-day operation',
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
    tagline: 'Run a connected business platform',
    price: 99,
    color: '#A78BFA',
    features: [
      'Everything in Operations',
      'HLNΛ intelligence',
      'Advanced reporting',
      'Priority support',
    ],
    popular: false,
    cta: 'Discuss Full System',
  },
];

export default function ForCoaches() {
  const [hoveredOutcome, setHoveredOutcome] =
    useState<number | null>(null);

  const [hoveredModule, setHoveredModule] =
    useState<number | null>(null);

  const [hoveredJourney, setHoveredJourney] =
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
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '0 32px 96px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div style={{ paddingTop: 28 }}>
          <Link
            href="/"
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,.34)',
              textDecoration: 'none',
            }}
          >
            ← Back to BrainBase
          </Link>
        </div>

        {/* HERO */}
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
                alt="BrainBase"
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
              background: 'rgba(138,77,255,.06)',
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
                  'pulse 2.5s ease-in-out infinite',
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
              Client Operations Deployment
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
                WebkitBackgroundClip: 'text',
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
              maxWidth: 620,
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
              href="/for-coaches/demo"
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
              View the live system →
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

          <div style={{ marginTop: 58 }}>
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

        {/* BEFORE / AFTER */}
        <section style={{ marginBottom: 92 }}>
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
                With BrainBase
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

        {/* LIVE SYSTEM */}
        <section style={{ marginBottom: 100 }}>
          <SectionHeading
            eyebrow="Live System"
            title="One operational view of the business."
            description="The current BrainBase client operations deployment connects leads, clients, scheduling, follow-up and operational intelligence in one interface."
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
                justifyContent: 'space-between',
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
                  'SquΛd',
                  'Sessions',
                  'Requests',
                  'Blog',
                ].map(item => (
                  <span
                    key={item}
                    style={{
                      fontSize: 10,
                      color:
                        item === 'Sessions'
                          ? '#C4B5FD'
                          : 'rgba(255,255,255,.34)',
                      padding: '5px 7px',
                      borderRadius: 6,
                      background:
                        item === 'Sessions'
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
                  LIVE DEPLOYMENT
                </span>
              </div>
            </div>

            <div style={{ padding: '30px' }}>
              <div style={{ marginBottom: 22 }}>
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
                      padding: '17px',
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
                        textTransform: 'uppercase',
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
                    'repeat(auto-fit, minmax(320px, 1fr))',
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
                  <div
                    style={{
                      padding: '12px 15px',
                      borderBottom:
                        '1px solid rgba(255,255,255,.055)',
                      display: 'flex',
                      justifyContent:
                        'space-between',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform:
                          'uppercase',
                        letterSpacing: '.08em',
                        color:
                          'rgba(255,255,255,.38)',
                      }}
                    >
                      Today&apos;s Schedule
                    </span>

                    <span
                      style={{
                        fontSize: 9,
                        color: '#8A4DFF',
                      }}
                    >
                      View Sessions →
                    </span>
                  </div>

                  <div style={{ padding: '14px' }}>
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
                        name: 'Private Appointment',
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
                  <div
                    style={{
                      padding: '12px 15px',
                      borderBottom:
                        '1px solid rgba(255,255,255,.055)',
                      display: 'flex',
                      justifyContent:
                        'space-between',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform:
                          'uppercase',
                        letterSpacing: '.08em',
                        color:
                          'rgba(255,255,255,.38)',
                      }}
                    >
                      Needs Attention
                    </span>

                    <span
                      style={{
                        fontSize: 9,
                        color: '#8A4DFF',
                      }}
                    >
                      All Clients →
                    </span>
                  </div>

                  {[
                    {
                      name: 'New website enquiry',
                      status: 'Never contacted',
                    },
                    {
                      name: 'Existing client',
                      status: 'Follow-up due',
                    },
                    {
                      name: 'New lead',
                      status: 'Awaiting response',
                    },
                  ].map((client, i) => (
                    <div
                      key={client.name}
                      style={{
                        padding: '14px 15px',
                        borderBottom:
                          i < 2
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

        {/* CONNECTED JOURNEY */}
        <section style={{ marginBottom: 100 }}>
          <SectionHeading
            eyebrow="Connected Journey"
            title="From first enquiry to ongoing client."
            description="The value of the deployment is not one feature. Each stage of the client journey remains connected."
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
            {JOURNEY.map((step, index) => {
              const active =
                hoveredJourney === index;

              return (
                <div
                  key={step.number}
                  onMouseEnter={() =>
                    setHoveredJourney(index)
                  }
                  onMouseLeave={() =>
                    setHoveredJourney(null)
                  }
                  style={{
                    padding: '20px',
                    display: 'flex',
                    gap: 15,
                    alignItems: 'flex-start',
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
                    transition: 'all .16s',
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 9,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
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
                        margin: '0 0 5px',
                        fontSize: 13,
                        fontWeight: 650,
                        color: '#F5F7FA',
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
            })}
          </div>
        </section>

        {/* OUTCOMES */}
        <section style={{ marginBottom: 100 }}>
          <SectionHeading
            eyebrow="Operational Impact"
            title="Less admin. More control."
            description="BrainBase removes operational friction around the work a client-based business already does every day."
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
            {OUTCOMES.map((outcome, index) => {
              const active =
                hoveredOutcome === index;

              return (
                <div
                  key={outcome.title}
                  onMouseEnter={() =>
                    setHoveredOutcome(index)
                  }
                  onMouseLeave={() =>
                    setHoveredOutcome(null)
                  }
                  style={{
                    padding: '22px',
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
                    transition: 'all .17s',
                  }}
                >
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: outcome.color,
                      boxShadow:
                        `0 0 8px ${outcome.color}80`,
                      marginBottom: 17,
                    }}
                  />

                  <h3
                    style={{
                      margin: '0 0 7px',
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
                    {outcome.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* MODULES */}
        <section
          style={{
            marginBottom: 100,
            padding: '42px',
            borderRadius: 18,
            background:
              'linear-gradient(135deg, rgba(138,77,255,.06), rgba(56,189,248,.015))',
            border:
              '1px solid rgba(138,77,255,.14)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ marginBottom: 30 }}>
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
              BrainBase Platform
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
              Powered by connected BrainBase modules.
            </h2>

            <p
              style={{
                margin: 0,
                maxWidth: 620,
                fontSize: 13,
                lineHeight: 1.65,
                color:
                  'rgba(226,232,240,.53)',
              }}
            >
              Different businesses can use the same
              BrainBase foundation, with workflows,
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
            {MODULES.map((module, index) => {
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
                    padding: '18px',
                    borderRadius: 12,
                    background: active
                      ? `rgba(${hexToRgbStr(
                          module.color,
                        )}, .055)`
                      : 'rgba(7,8,11,.26)',
                    border: active
                      ? `1px solid ${module.color}30`
                      : '1px solid rgba(255,255,255,.06)',
                    transition: 'all .16s',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent:
                        'space-between',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: module.color,
                          boxShadow:
                            `0 0 7px ${module.color}80`,
                        }}
                      />

                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 650,
                          color: '#F5F7FA',
                        }}
                      >
                        {module.title}
                      </span>
                    </div>

                    <span
                      style={{
                        fontSize: 7,
                        fontWeight: 700,
                        letterSpacing: '.08em',
                        color: module.color,
                      }}
                    >
                      {module.status}
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
                    {module.description}
                  </p>
                </div>
              );
            })}
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
              <span style={{ color: '#8A4DFF' }}>
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

        {/* REAL DEPLOYMENT EXAMPLE */}
        <section style={{ marginBottom: 100 }}>
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
                    FIRST LIVE DEPLOYMENT
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
                        'pulse 2.5s ease-in-out infinite',
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
                  BrainBase&apos;s first live
                  client-operations deployment is
                  running inside a coaching business.
                  It manages leads, contacts,
                  sessions, follow-up and operational
                  visibility through the same
                  platform.
                </p>
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

        {/* PRICING */}
        <section style={{ marginBottom: 100 }}>
          <SectionHeading
            eyebrow="Early Access Pricing"
            title="Start small. Expand as you connect more."
            description="Choose the operational foundation you need today. BrainBase can expand as more of your client journey, workflows and business systems become connected."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 14,
              marginBottom: 22,
            }}
          >
            {PRICING.map(plan => (
              <div
                key={plan.name}
                style={{
                  padding: '30px 27px',
                  borderRadius: 16,
                  position: 'relative',
                  background: plan.popular
                    ? 'rgba(138,77,255,.055)'
                    : 'rgba(255,255,255,.02)',
                  border: plan.popular
                    ? '1px solid rgba(138,77,255,.28)'
                    : '1px solid rgba(255,255,255,.075)',
                  boxShadow: plan.popular
                    ? '0 20px 60px rgba(138,77,255,.07)'
                    : 'none',
                }}
              >
                {plan.popular && (
                  <span
                    style={{
                      position: 'absolute',
                      right: 16,
                      top: 16,
                      padding: '3px 8px',
                      borderRadius: 999,
                      background:
                        'rgba(138,77,255,.10)',
                      border:
                        '1px solid rgba(138,77,255,.25)',
                      color: '#C4B5FD',
                      fontSize: 7,
                      fontWeight: 700,
                      letterSpacing: '.08em',
                    }}
                  >
                    MOST POPULAR
                  </span>
                )}

                <div
                  style={{
                    marginBottom: 5,
                    fontSize: 12,
                    fontWeight: 650,
                    color: plan.color,
                  }}
                >
                  {plan.name}
                </div>

                <div
                  style={{
                    marginBottom: 19,
                    fontSize: 11,
                    color:
                      'rgba(255,255,255,.40)',
                  }}
                >
                  {plan.tagline}
                </div>

                <div
                  style={{
                    marginBottom: 5,
                    fontSize: 8,
                    fontWeight: 650,
                    letterSpacing: '.09em',
                    textTransform: 'uppercase',
                    color:
                      'rgba(255,255,255,.28)',
                  }}
                >
                  From
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 4,
                    marginBottom: 5,
                  }}
                >
                  <span
                    style={{
                      fontSize: 38,
                      fontWeight: 700,
                      letterSpacing: '-.04em',
                      color: '#F5F7FA',
                    }}
                  >
                    ${plan.price}
                  </span>

                  <span
                    style={{
                      fontSize: 11,
                      color:
                        'rgba(255,255,255,.30)',
                    }}
                  >
                    / month
                  </span>
                </div>

                <div
                  style={{
                    marginBottom: 25,
                    fontSize: 9,
                    color:
                      'rgba(255,255,255,.25)',
                  }}
                >
                  Platform subscription
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    marginBottom: 28,
                  }}
                >
                  {plan.features.map(feature => (
                    <div
                      key={feature}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                      }}
                    >
                      <span
                        style={{
                          color: plan.color,
                          fontSize: 10,
                        }}
                      >
                        ✓
                      </span>

                      <span
                        style={{
                          fontSize: 11,
                          color:
                            'rgba(226,232,240,.58)',
                        }}
                      >
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>

                <Link
                  href="/request-demo"
                  style={{
                    height: 40,
                    width: '100%',
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    background:
                      `${plan.color}12`,
                    border:
                      `1px solid ${plan.color}30`,
                    color: plan.color,
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

          {/* Pricing clarification */}
          <div
            style={{
              maxWidth: 760,
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
              Every deployment is different.
            </div>

            <p
              style={{
                margin: 0,
                fontSize: 10,
                lineHeight: 1.65,
                color:
                  'rgba(226,232,240,.38)',
              }}
            >
              Monthly pricing covers the BrainBase
              platform subscription. Website builds,
              initial configuration, data migration
              and custom integrations may involve
              separate setup or project costs
              depending on your requirements.
            </p>
          </div>

          <p
            style={{
              margin: '14px 0 0',
              textAlign: 'center',
              fontSize: 9,
              color:
                'rgba(255,255,255,.22)',
            }}
          >
            Early access pricing · No long-term
            contracts · Plans can grow with your
            operation
          </p>
        </section>

        {/* FINAL CTA */}
        <section
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
              Know what needs attention.
            </h2>

            <p
              style={{
                margin: '0 auto 26px',
                maxWidth: 580,
                fontSize: 13,
                lineHeight: 1.7,
                color:
                  'rgba(226,232,240,.56)',
              }}
            >
              Whether you run coaching sessions,
              consultations, appointments, programs
              or another client-based service,
              BrainBase can provide the operational
              system behind the work.
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
                Explore Web Systems
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
        maxWidth: centred ? 690 : 620,
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

function hexToRgbStr(hex: string): string {
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
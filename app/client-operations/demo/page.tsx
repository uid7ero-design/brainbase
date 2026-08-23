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

  @keyframes glowPulse {
    0%, 100% { opacity: .45; }
    50% { opacity: .82; }
  }
`;

const KPI_CARDS = [
  {
    label: "Today's Bookings",
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
    sub: 'Awaiting action',
    color: '#F59E0B',
  },
  {
    label: 'Open Leads',
    value: '7',
    sub: 'New or contacted',
    color: '#3B82F6',
  },
];

const ATTENTION = [
  {
    name: 'New website enquiry',
    status: 'Never contacted',
    type: 'Lead',
    color: '#22C55E',
  },
  {
    name: 'Existing client',
    status: 'Follow-up due',
    type: 'Client',
    color: '#3B82F6',
  },
  {
    name: 'Service enquiry',
    status: 'Awaiting response',
    type: 'Lead',
    color: '#22C55E',
  },
];

const SESSIONS = [
  {
    day: 'Mon 24',
    title: 'Client Appointment',
    program: 'Initial Consultation',
    time: '09:00–10:00',
    venue: 'Main Office',
    capacity: '1/1',
    color: '#D946EF',
  },
  {
    day: 'Mon 24',
    title: 'Group Program',
    program: 'Weekly Session',
    time: '14:30–15:30',
    venue: 'Studio A',
    capacity: '8/12',
    color: '#22C55E',
  },
  {
    day: 'Wed 26',
    title: 'Client Session',
    program: 'Ongoing Service',
    time: '11:00–12:00',
    venue: 'Online',
    capacity: '1/1',
    color: '#F59E0B',
  },
  {
    day: 'Thu 27',
    title: 'Workshop',
    program: 'Client Program',
    time: '17:00–18:00',
    venue: 'Location B',
    capacity: '9/16',
    color: '#8A4DFF',
  },
];

const FLOW = [
  {
    number: '01',
    title: 'Enquiry arrives',
    body:
      'Website, referral and other enquiries enter the same client operations system.',
    color: '#6366F1',
  },
  {
    number: '02',
    title: 'Lead becomes visible',
    body:
      'The business can immediately see who is new, contacted or awaiting follow-up.',
    color: '#8A4DFF',
  },
  {
    number: '03',
    title: 'Client is organised',
    body:
      'Contact details, relationship status and activity stay connected around one client record.',
    color: '#38BDF8',
  },
  {
    number: '04',
    title: 'Service is scheduled',
    body:
      'Appointments, sessions, programs, locations and capacity are managed inside the same system.',
    color: '#22C55E',
  },
  {
    number: '05',
    title: 'Follow-up stays visible',
    body:
      'Calls, emails, requests and outstanding actions remain visible until resolved.',
    color: '#F59E0B',
  },
  {
    number: '06',
    title: 'HLNΛ adds context',
    body:
      'The intelligence layer surfaces priorities, activity and operational signals across the business.',
    color: '#A78BFA',
  },
];

const MODULES = [
  {
    title: 'Leads',
    body:
      'See new enquiries, status and follow-up requirements.',
    color: '#22C55E',
  },
  {
    title: 'Clients',
    body:
      'Keep contacts, records and relationship activity organised.',
    color: '#38BDF8',
  },
  {
    title: 'Scheduling',
    body:
      'Manage appointments, sessions, programs, locations and capacity.',
    color: '#8A4DFF',
  },
  {
    title: 'Requests',
    body:
      'Keep incoming work and outstanding actions visible.',
    color: '#F59E0B',
  },
  {
    title: 'Dashboards',
    body:
      'Bring the most important operational indicators into one view.',
    color: '#A78BFA',
  },
  {
    title: 'HLNΛ',
    body:
      'Provide intelligence and context across the connected platform.',
    color: '#6366F1',
  },
];

export default function ClientOperationsDemoPage() {
  const [hoveredFlow, setHoveredFlow] =
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
              ellipse 65% 42% at 50% 0%,
              rgba(138,77,255,.11) 0%,
              rgba(56,189,248,.025) 44%,
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
        {/* Back */}
        <div
          style={{
            paddingTop: 28,
          }}
        >
          <Link
            href="/client-operations"
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,.34)',
              textDecoration: 'none',
            }}
          >
            ← Back to Client Operations
          </Link>
        </div>

        {/* HERO */}
        <section
          style={{
            padding: '58px 0 72px',
            textAlign: 'center',
            maxWidth: 880,
            margin: '0 auto',
          }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 27,
            }}
          >
            <div
              style={{
                width: 420,
                maxWidth: '90vw',
                display: 'flex',
                justifyContent: 'center',
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
                  width: 385,
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
              marginBottom: 24,
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
              Client Operations Demo
            </span>
          </div>

          <h1
            style={{
              margin: '0 auto 20px',
              maxWidth: 820,
              fontSize:
                'clamp(38px, 5vw, 58px)',
              lineHeight: 1.04,
              letterSpacing: '-.045em',
              fontWeight: 650,
              color: '#F5F7FA',
            }}
          >
            See the system
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
              behind the business.
            </span>
          </h1>

          <p
            style={{
              margin: '0 auto',
              maxWidth: 650,
              fontSize: 15,
              lineHeight: 1.7,
              color:
                'rgba(226,232,240,.60)',
            }}
          >
            Explore how BRΛINBΛSE connects leads,
            clients, bookings, follow-up and operational
            visibility for businesses built around
            customer relationships and service delivery.
          </p>
        </section>

        {/* LIVE DASHBOARD PREVIEW */}
        <section
          style={{
            marginBottom: 94,
          }}
        >
          <SectionHeading
            eyebrow="Operational Dashboard"
            title="Start with what needs attention."
            description="The dashboard gives the business a quick operational picture before anyone has to dig through separate systems."
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
                '0 30px 90px rgba(0,0,0,.22)',
            }}
          >
            {/* Dashboard nav */}
            <div
              style={{
                minHeight: 50,
                padding: '0 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                flexWrap: 'wrap',
                background:
                  'rgba(4,5,8,.86)',
                borderBottom:
                  '1px solid rgba(255,255,255,.06)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.10em',
                    color:
                      'rgba(167,139,250,.88)',
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

                {[
                  'Leads',
                  'Clients',
                  'Bookings',
                  'Requests',
                  'Activity',
                ].map(item => (
                  <span
                    key={item}
                    style={{
                      padding: '5px 8px',
                      borderRadius: 6,
                      fontSize: 10,
                      color:
                        'rgba(255,255,255,.37)',
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
                    fontSize: 8,
                    fontWeight: 650,
                    letterSpacing: '.08em',
                    color:
                      'rgba(255,255,255,.28)',
                  }}
                >
                  DEMO
                </span>
              </div>
            </div>

            <div
              style={{
                padding: '28px',
              }}
            >
              <div
                style={{
                  marginBottom: 24,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 7,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 650,
                      letterSpacing: '.10em',
                      textTransform: 'uppercase',
                      color:
                        'rgba(167,139,250,.72)',
                    }}
                  >
                    HLNΛ · Client Operations
                  </span>
                </div>

                <h2
                  style={{
                    margin: '0 0 5px',
                    fontSize: 25,
                    fontWeight: 650,
                    letterSpacing: '-.03em',
                    color: '#F5F7FA',
                  }}
                >
                  Client Operations Dashboard
                </h2>

                <p
                  style={{
                    margin: 0,
                    fontSize: 11,
                    color:
                      'rgba(226,232,240,.38)',
                  }}
                >
                  Leads, clients, bookings and follow-up
                  activity
                </p>
              </div>

              {/* KPI Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(165px, 1fr))',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                {KPI_CARDS.map(card => (
                  <div
                    key={card.label}
                    style={{
                      padding: '18px',
                      minHeight: 115,
                      borderRadius: 12,
                      background:
                        'rgba(255,255,255,.025)',
                      border:
                        '1px solid rgba(255,255,255,.065)',
                    }}
                  >
                    <div
                      style={{
                        marginBottom: 10,
                        fontSize: 8,
                        fontWeight: 700,
                        letterSpacing: '.10em',
                        textTransform: 'uppercase',
                        color:
                          'rgba(255,255,255,.34)',
                      }}
                    >
                      {card.label}
                    </div>

                    <div
                      style={{
                        marginBottom: 7,
                        fontSize: 32,
                        lineHeight: 1,
                        fontWeight: 700,
                        color: card.color,
                      }}
                    >
                      {card.value}
                    </div>

                    <div
                      style={{
                        fontSize: 9,
                        color:
                          'rgba(255,255,255,.30)',
                      }}
                    >
                      {card.sub}
                    </div>
                  </div>
                ))}
              </div>

              {/* Main panels */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(330px, 1fr))',
                  gap: 10,
                }}
              >
                {/* Today Schedule */}
                <div
                  style={{
                    minHeight: 260,
                    borderRadius: 12,
                    background:
                      'rgba(255,255,255,.018)',
                    border:
                      '1px solid rgba(255,255,255,.065)',
                  }}
                >
                  <PanelHeader
                    title="Today's Schedule"
                    action="View Bookings →"
                  />

                  <div
                    style={{
                      padding: '15px',
                    }}
                  >
                    {[
                      {
                        name: 'Client Appointment',
                        detail:
                          '09:00–10:00 · Main Office',
                        color: '#D946EF',
                      },
                      {
                        name: 'Group Program',
                        detail:
                          '14:30–15:30 · Studio A',
                        color: '#22C55E',
                      },
                      {
                        name: 'Private Session',
                        detail:
                          '17:00–18:00 · Online',
                        color: '#8A4DFF',
                      },
                    ].map(item => (
                      <div
                        key={item.name}
                        style={{
                          padding: '11px 12px',
                          marginBottom: 8,
                          borderRadius: 9,
                          background:
                            'rgba(255,255,255,.024)',
                          border:
                            '1px solid rgba(255,255,255,.055)',
                          borderLeft:
                            `3px solid ${item.color}`,
                        }}
                      >
                        <div
                          style={{
                            marginBottom: 3,
                            fontSize: 10,
                            fontWeight: 650,
                            color: '#F5F7FA',
                          }}
                        >
                          {item.name}
                        </div>

                        <div
                          style={{
                            fontSize: 9,
                            color:
                              'rgba(255,255,255,.34)',
                          }}
                        >
                          {item.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Attention */}
                <div
                  style={{
                    minHeight: 260,
                    borderRadius: 12,
                    background:
                      'rgba(255,255,255,.018)',
                    border:
                      '1px solid rgba(255,255,255,.065)',
                  }}
                >
                  <PanelHeader
                    title="Needs Attention"
                    action="All Clients →"
                  />

                  {ATTENTION.map(
                    (item, index) => (
                      <div
                        key={item.name}
                        style={{
                          padding: '15px',
                          borderBottom:
                            index <
                            ATTENTION.length - 1
                              ? '1px solid rgba(255,255,255,.045)'
                              : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent:
                            'space-between',
                          gap: 12,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              marginBottom: 3,
                              fontSize: 10,
                              fontWeight: 650,
                              color: '#F5F7FA',
                            }}
                          >
                            {item.name}
                          </div>

                          <div
                            style={{
                              fontSize: 9,
                              color:
                                'rgba(255,255,255,.30)',
                            }}
                          >
                            {item.status}
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            flexWrap: 'wrap',
                            justifyContent:
                              'flex-end',
                          }}
                        >
                          <span
                            style={{
                              padding: '3px 7px',
                              borderRadius: 999,
                              background:
                                `${item.color}12`,
                              border:
                                `1px solid ${item.color}25`,
                              color: item.color,
                              fontSize: 8,
                            }}
                          >
                            {item.type}
                          </span>

                          <span
                            style={{
                              padding: '3px 7px',
                              borderRadius: 6,
                              border:
                                '1px solid rgba(34,197,94,.20)',
                              background:
                                'rgba(34,197,94,.07)',
                              color: '#6EE7B7',
                              fontSize: 8,
                            }}
                          >
                            Call
                          </span>

                          <span
                            style={{
                              padding: '3px 7px',
                              borderRadius: 6,
                              border:
                                '1px solid rgba(59,130,246,.20)',
                              background:
                                'rgba(59,130,246,.07)',
                              color: '#93C5FD',
                              fontSize: 8,
                            }}
                          >
                            Email
                          </span>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SCHEDULING VIEW */}
        <section
          style={{
            marginBottom: 94,
          }}
        >
          <SectionHeading
            eyebrow="Scheduling"
            title="See the week clearly."
            description="The scheduling layer shows when services are running, where they are happening and how much capacity remains."
            centred
          />

          <div
            style={{
              padding: '28px',
              borderRadius: 18,
              background:
                'rgba(255,255,255,.017)',
              border:
                '1px solid rgba(255,255,255,.07)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent:
                  'space-between',
                alignItems: 'flex-start',
                gap: 16,
                flexWrap: 'wrap',
                marginBottom: 22,
              }}
            >
              <div>
                <h3
                  style={{
                    margin: '0 0 4px',
                    fontSize: 20,
                    fontWeight: 650,
                    color: '#F5F7FA',
                  }}
                >
                  Bookings & Sessions
                </h3>

                <p
                  style={{
                    margin: 0,
                    fontSize: 10,
                    color:
                      'rgba(255,255,255,.30)',
                  }}
                >
                  Week of 24–30 August
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 7,
                }}
              >
                <span
                  style={{
                    padding: '6px 11px',
                    borderRadius: 999,
                    background:
                      'rgba(255,255,255,.025)',
                    border:
                      '1px solid rgba(255,255,255,.07)',
                    fontSize: 9,
                    color:
                      'rgba(255,255,255,.42)',
                  }}
                >
                  Week
                </span>

                <span
                  style={{
                    padding: '6px 11px',
                    borderRadius: 999,
                    background:
                      'rgba(138,77,255,.09)',
                    border:
                      '1px solid rgba(138,77,255,.20)',
                    fontSize: 9,
                    color: '#C4B5FD',
                  }}
                >
                  + New Booking
                </span>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
              }}
            >
              {SESSIONS.map(
                (session, index) => (
                  <div
                    key={`${session.day}-${index}`}
                    style={{
                      padding: '14px',
                      borderRadius: 11,
                      background:
                        'rgba(255,255,255,.022)',
                      border:
                        '1px solid rgba(255,255,255,.06)',
                      borderLeft:
                        `3px solid ${session.color}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent:
                          'space-between',
                        gap: 8,
                        marginBottom: 7,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 8,
                          textTransform:
                            'uppercase',
                          letterSpacing: '.08em',
                          color:
                            'rgba(255,255,255,.30)',
                        }}
                      >
                        {session.day}
                      </div>

                      <div
                        style={{
                          fontSize: 8,
                          fontWeight: 700,
                          color: '#22C55E',
                        }}
                      >
                        {session.capacity}
                      </div>
                    </div>

                    <div
                      style={{
                        marginBottom: 3,
                        fontSize: 11,
                        fontWeight: 650,
                        color: '#F5F7FA',
                      }}
                    >
                      {session.title}
                    </div>

                    <div
                      style={{
                        marginBottom: 7,
                        fontSize: 9,
                        color:
                          'rgba(226,232,240,.46)',
                      }}
                    >
                      {session.program}
                    </div>

                    <div
                      style={{
                        fontSize: 9,
                        lineHeight: 1.55,
                        color:
                          'rgba(255,255,255,.32)',
                      }}
                    >
                      {session.time}
                      <br />
                      {session.venue}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        </section>

        {/* CONNECTED FLOW */}
        <section
          style={{
            marginBottom: 94,
          }}
        >
          <SectionHeading
            eyebrow="Connected Workflow"
            title="The value is what happens between the screens."
            description="BRΛINBΛSE keeps each stage of the client journey connected instead of treating leads, clients, bookings and follow-up as separate jobs."
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
            {FLOW.map((step, index) => {
              const active =
                hoveredFlow === index;

              return (
                <div
                  key={step.number}
                  onMouseEnter={() =>
                    setHoveredFlow(index)
                  }
                  onMouseLeave={() =>
                    setHoveredFlow(null)
                  }
                  style={{
                    padding: '20px',
                    display: 'flex',
                    gap: 15,
                    borderRadius: 13,
                    background: active
                      ? `rgba(${hexToRgbStr(
                          step.color,
                        )}, .055)`
                      : 'rgba(255,255,255,.017)',
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
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent:
                        'center',
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

        {/* MODULES */}
        <section
          style={{
            marginBottom: 94,
            padding: '42px',
            borderRadius: 18,
            background:
              'linear-gradient(135deg, rgba(138,77,255,.06), rgba(56,189,248,.015))',
            border:
              '1px solid rgba(138,77,255,.14)',
          }}
        >
          <div
            style={{
              marginBottom: 28,
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
                fontSize: 29,
                fontWeight: 650,
                letterSpacing: '-.03em',
                color: '#F5F7FA',
              }}
            >
              One operation. Multiple connected
              modules.
            </h2>

            <p
              style={{
                margin: 0,
                maxWidth: 670,
                fontSize: 13,
                lineHeight: 1.65,
                color:
                  'rgba(226,232,240,.53)',
              }}
            >
              Client Operations is one configuration
              of BRΛINBΛSE. Modules, terminology and
              workflows can be adapted around the way
              each business manages its clients and
              delivers its services.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(250px, 1fr))',
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
                      transform: active
                        ? 'translateY(-2px)'
                        : 'translateY(0)',
                      transition: 'all .16s',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
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
                          color: '#F5F7FA',
                        }}
                      >
                        {module.title}
                      </span>
                    </div>

                    <p
                      style={{
                        margin: 0,
                        fontSize: 10,
                        lineHeight: 1.55,
                        color:
                          'rgba(226,232,240,.48)',
                      }}
                    >
                      {module.body}
                    </p>
                  </div>
                );
              },
            )}
          </div>
        </section>

        {/* LD TENNIS DEPLOYMENT */}
        <section
          style={{
            marginBottom: 94,
          }}
        >
          <SectionHeading
            eyebrow="Real Deployment Example"
            title="The same platform, configured around a real business."
            description="Client Operations is designed to adapt to the terminology, workflow and service model of each organisation."
            centred
          />

          <div
            style={{
              padding: '38px 40px',
              borderRadius: 17,
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
                gap: 34,
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
                    LIVE DEPLOYMENT
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
                    fontSize: 28,
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
                  LD Tennis is the first live
                  Client Operations deployment built
                  on BRΛINBΛSE. The same platform is
                  configured around a coaching business,
                  connecting website enquiries, leads,
                  clients, sessions, follow-up and
                  day-to-day operational visibility.
                </p>
              </div>

              <div
                style={{
                  padding: '22px',
                  borderRadius: 13,
                  background:
                    'rgba(7,8,11,.25)',
                  border:
                    '1px solid rgba(255,255,255,.06)',
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 650,
                    letterSpacing: '.10em',
                    textTransform: 'uppercase',
                    color:
                      'rgba(255,255,255,.28)',
                    marginBottom: 14,
                  }}
                >
                  Current deployment includes
                </div>

                {[
                  'Website enquiry capture',
                  'Lead and enquiry management',
                  'Client records',
                  'Session scheduling',
                  'Follow-up actions',
                  'Operational dashboard',
                  'HLNΛ intelligence layer',
                ].map(item => (
                  <div
                    key={item}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 9,
                      fontSize: 10,
                      color:
                        'rgba(226,232,240,.54)',
                    }}
                  >
                    <span
                      style={{
                        color: '#22C55E',
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

        {/* FINAL CTA */}
        <section
          style={{
            padding: '48px 42px',
            borderRadius: 19,
            textAlign: 'center',
            background:
              'linear-gradient(135deg, rgba(138,77,255,.075), rgba(56,189,248,.025))',
            border:
              '1px solid rgba(138,77,255,.16)',
          }}
        >
          <div
            style={{
              maxWidth: 660,
              margin: '0 auto',
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
              Your deployment
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
              The same foundation can be built
              around your operation.
            </h2>

            <p
              style={{
                margin: '0 auto 25px',
                maxWidth: 590,
                fontSize: 13,
                lineHeight: 1.7,
                color:
                  'rgba(226,232,240,.56)',
              }}
            >
              Whether your business runs appointments,
              consultations, coaching sessions, programs
              or other client services, BRΛINBΛSE can be
              configured around your terminology,
              workflows and day-to-day operation.
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
                Build this for my business →
              </Link>

              <Link
                href="/client-operations"
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
                Back to Client Operations
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
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
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        borderBottom:
          '1px solid rgba(255,255,255,.055)',
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
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
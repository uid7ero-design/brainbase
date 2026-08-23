'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

import EnquiryModal from '@/components/web-services/EnquiryModal';

const FONT =
  'var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const BG = '#07080B';

const KEYFRAMES = `
  @keyframes webPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .42; }
  }

  @keyframes webHeroGlow {
    0%, 100% {
      opacity: .46;
      transform: scale(1);
    }

    50% {
      opacity: .78;
      transform: scale(1.04);
    }
  }

  @media (max-width: 760px) {
    .web-systems-shell {
      padding-left: 18px !important;
      padding-right: 18px !important;
    }

    .web-systems-panel {
      padding-left: 24px !important;
      padding-right: 24px !important;
    }

    .web-systems-footer {
      padding-left: 18px !important;
      padding-right: 18px !important;
    }
  }
`;

const SERVICES = [
  {
    title: 'Web Design & Development',
    description:
      'Modern, responsive websites built around your business, your customers and the actions you want visitors to take.',
    tags: [
      'Business websites',
      'Landing pages',
      'Responsive design',
      'Custom development',
    ],
    color: '#8A4DFF',
  },
  {
    title: 'Lead Capture & Automation',
    description:
      'Turn website enquiries into organised leads with automated routing, follow-up and clear visibility from the moment someone gets in touch.',
    tags: [
      'Smart forms',
      'Lead routing',
      'Follow-up',
      'Notifications',
    ],
    color: '#22C55E',
  },
  {
    title: 'Business Integrations',
    description:
      'Connect your website with CRM, scheduling, client records, dashboards and the systems your operation already relies on.',
    tags: [
      'CRM',
      'Bookings',
      'Client systems',
      'APIs',
    ],
    color: '#38BDF8',
  },
  {
    title: 'Managed Infrastructure',
    description:
      'Hosting, deployment, updates, security, monitoring and ongoing technical management without having to coordinate multiple providers.',
    tags: [
      'Hosting',
      'SSL',
      'Monitoring',
      'Maintenance',
    ],
    color: '#A78BFA',
  },
];

const OUTCOMES = [
  {
    title: 'Capture more opportunities',
    body:
      'Every website enquiry can move directly into a structured follow-up process instead of disappearing into an inbox.',
    color: '#22C55E',
  },
  {
    title: 'Reduce manual admin',
    body:
      'Remove repetitive copying, notifications and hand-offs by connecting the website directly to the systems behind it.',
    color: '#38BDF8',
  },
  {
    title: 'Know what is happening',
    body:
      'See leads, customer activity and operational information in a clearer connected view.',
    color: '#8A4DFF',
  },
  {
    title: 'Create a better customer journey',
    body:
      'Give customers a faster and more professional path from first visit through enquiry, booking and service.',
    color: '#F59E0B',
  },
];

const FLOW = [
  {
    number: '01',
    title: 'Someone finds you',
    body:
      'Your website gives them a clear, fast and professional first experience.',
    color: '#8A4DFF',
  },
  {
    number: '02',
    title: 'They make contact',
    body:
      'Enquiries and forms capture the information your business actually needs.',
    color: '#A78BFA',
  },
  {
    number: '03',
    title: 'The lead is organised',
    body:
      'The enquiry can flow into your CRM or operational system without manual re-entry.',
    color: '#38BDF8',
  },
  {
    number: '04',
    title: 'Follow-up begins',
    body:
      'Notifications, tasks and communication workflows can happen automatically.',
    color: '#22C55E',
  },
  {
    number: '05',
    title: 'The customer moves forward',
    body:
      'Bookings, client records or the next stage of your service stay connected.',
    color: '#F59E0B',
  },
  {
    number: '06',
    title: 'You see the operation',
    body:
      'BRΛINBΛSE can bring activity, priorities and operational context into one place.',
    color: '#6366F1',
  },
];

const DEPLOYMENTS = [
  {
    label: 'Website Foundation',
    title: 'Start with the website.',
    description:
      'A professionally designed and managed website with lead capture, hosting and the foundations needed to connect more later.',
    includes: [
      'Custom website design & build',
      'Responsive development',
      'Managed hosting & SSL',
      'Contact and enquiry capture',
      'Ongoing maintenance',
    ],
    color: '#8A4DFF',
    action: 'Discuss your website',
    featured: false,
  },
  {
    label: 'Connected Web System',
    title: 'Connect the customer journey.',
    description:
      'Extend your website into the business with lead management, booking, integrations and automated workflow.',
    includes: [
      'Everything in Website Foundation',
      'CRM or lead integration',
      'Booking and scheduling connections',
      'Workflow automation',
      'Operational visibility',
    ],
    color: '#22C55E',
    action: 'Discuss your system',
    featured: true,
  },
  {
    label: 'BRΛINBΛSE Deployment',
    title: 'Build the system behind it.',
    description:
      'For businesses ready to move beyond the website into a broader connected operational platform.',
    includes: [
      'Everything in Connected Web System',
      'BRΛINBΛSE platform deployment',
      'Dashboards and reporting',
      'Custom operational workflows',
      'HLNΛ intelligence capability',
    ],
    color: '#A78BFA',
    action: 'Request deployment review',
    featured: false,
  },
];

const PROCESS = [
  {
    number: '01',
    title: 'Understand',
    body:
      'We look at your website, customer journey and the systems already used behind the scenes.',
  },
  {
    number: '02',
    title: 'Design',
    body:
      'We design the website and decide what should connect, automate or remain intentionally simple.',
  },
  {
    number: '03',
    title: 'Build',
    body:
      'The website and required system connections are developed and tested together.',
  },
  {
    number: '04',
    title: 'Launch',
    body:
      'Your new system goes live with hosting, monitoring and the required operational workflows in place.',
  },
  {
    number: '05',
    title: 'Improve',
    body:
      'The system can continue to expand as your business, services and operational requirements change.',
  },
];

const MANAGED = [
  {
    title: 'Hosting',
    body:
      'Managed deployment and infrastructure for the website and connected services.',
    color: '#8A4DFF',
  },
  {
    title: 'Security & SSL',
    body:
      'Secure HTTPS, platform updates and ongoing infrastructure management.',
    color: '#EC4899',
  },
  {
    title: 'Monitoring',
    body:
      'Website availability and core infrastructure can be monitored after launch.',
    color: '#22C55E',
  },
  {
    title: 'Performance',
    body:
      'Ongoing attention to loading speed, responsiveness and user experience.',
    color: '#38BDF8',
  },
  {
    title: 'Updates',
    body:
      'Content, workflow and system improvements can continue after deployment.',
    color: '#F59E0B',
  },
  {
    title: 'Support',
    body:
      'One point of contact across the website and connected BRΛINBΛSE environment.',
    color: '#A78BFA',
  },
];

export default function WebSystemsPage() {
  const [enquiryOpen, setEnquiryOpen] =
    useState(false);

  const [hoveredService, setHoveredService] =
    useState<number | null>(null);

  const [hoveredOutcome, setHoveredOutcome] =
    useState<number | null>(null);

  const [hoveredFlow, setHoveredFlow] =
    useState<number | null>(null);

  const [
    hoveredDeployment,
    setHoveredDeployment,
  ] = useState<number | null>(null);

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

      {/* ================================================================
          BACKGROUND
      ================================================================= */}

      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: `
            radial-gradient(
              ellipse 65% 42% at 52% 0%,
              rgba(138,77,255,.11) 0%,
              rgba(92,124,255,.025) 45%,
              transparent 72%
            )
          `,
        }}
      />

      <div
        className="web-systems-shell"
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
            minHeight: 630,
            padding: '60px 0 76px',
            display: 'flex',
            alignItems: 'center',
            gap: 70,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              flex: '1 1 470px',
              maxWidth: 600,
            }}
          >
            <div
              style={{
                width: 330,
                maxWidth: '86vw',
                marginBottom: 29,
              }}
            >
              <Image
                src="/Brand/brainbase-logo-dark.svg"
                alt="BRΛINBΛSE"
                width={720}
                height={150}
                priority
                style={{
                  display: 'block',
                  width: '100%',
                  height: 'auto',
                }}
              />
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 24,
                padding: '5px 11px',
                borderRadius: 999,
                background:
                  'rgba(138,77,255,.065)',
                border:
                  '1px solid rgba(138,77,255,.18)',
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: '#8A4DFF',
                  boxShadow:
                    '0 0 8px rgba(138,77,255,.85)',
                  animation:
                    'webPulse 2.5s ease-in-out infinite',
                }}
              />

              <span
                style={{
                  fontSize: 9,
                  fontWeight: 650,
                  letterSpacing: '.13em',
                  textTransform: 'uppercase',
                  color:
                    'rgba(167,139,250,.78)',
                }}
              >
                BRΛINBΛSE Web Systems
              </span>
            </div>

            <h1
              style={{
                margin: '0 0 23px',
                fontSize:
                  'clamp(40px, 5vw, 62px)',
                lineHeight: 1.02,
                letterSpacing: '-.047em',
                fontWeight: 650,
                color: '#F5F7FA',
              }}
            >
              Start with your website.
              <br />

              <span
                style={{
                  background:
                    'linear-gradient(100deg, #8A4DFF 0%, #A78BFA 48%, #5C7CFF 100%)',
                  WebkitBackgroundClip:
                    'text',
                  WebkitTextFillColor:
                    'transparent',
                  backgroundClip: 'text',
                }}
              >
                Build the system behind it.
              </span>
            </h1>

            <p
              style={{
                margin: '0 0 31px',
                maxWidth: 550,
                fontSize: 16,
                lineHeight: 1.72,
                color:
                  'rgba(226,232,240,.62)',
              }}
            >
              BRΛINBΛSE designs and builds modern
              websites that can connect directly to
              your leads, bookings, customer
              workflows and business systems.
            </p>

            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={() =>
                  setEnquiryOpen(true)
                }
                style={{
                  minHeight: 44,
                  padding: '0 22px',
                  borderRadius: 9,
                  border: 'none',
                  background:
                    'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                  color: '#FFFFFF',
                  cursor: 'pointer',
                  fontFamily: FONT,
                  fontSize: 12,
                  fontWeight: 650,
                }}
              >
                Discuss your website →
              </button>

              <button
                onClick={() =>
                  document
                    .getElementById(
                      'what-we-build',
                    )
                    ?.scrollIntoView({
                      behavior: 'smooth',
                    })
                }
                style={{
                  minHeight: 44,
                  padding: '0 20px',
                  borderRadius: 9,
                  background:
                    'rgba(255,255,255,.025)',
                  border:
                    '1px solid rgba(255,255,255,.09)',
                  color:
                    'rgba(245,247,250,.63)',
                  cursor: 'pointer',
                  fontFamily: FONT,
                  fontSize: 12,
                  fontWeight: 550,
                }}
              >
                See what we build
              </button>
            </div>

            <div
              style={{
                marginTop: 31,
                display: 'flex',
                gap: 21,
                flexWrap: 'wrap',
              }}
            >
              {[
                'Custom built',
                'Connected systems',
                'Managed infrastructure',
              ].map(item => (
                <div
                  key={item}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    fontSize: 9,
                    color:
                      'rgba(255,255,255,.30)',
                  }}
                >
                  <span
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      background: '#22C55E',
                      boxShadow:
                        '0 0 5px rgba(34,197,94,.6)',
                    }}
                  />

                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* SYSTEM VISUAL */}

          <div
            style={{
              flex: '1 1 400px',
              maxWidth: 490,
              position: 'relative',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: -55,
                background:
                  'radial-gradient(circle, rgba(138,77,255,.14) 0%, transparent 70%)',
                filter: 'blur(32px)',
                animation:
                  'webHeroGlow 6s ease-in-out infinite',
                pointerEvents: 'none',
              }}
            />

            <div
              style={{
                position: 'relative',
                padding: 24,
                borderRadius: 20,
                background:
                  'rgba(255,255,255,.021)',
                border:
                  '1px solid rgba(138,77,255,.16)',
                boxShadow:
                  '0 35px 100px rgba(0,0,0,.25)',
              }}
            >
              <div
                style={{
                  paddingBottom: 15,
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent:
                    'space-between',
                  gap: 10,
                  borderBottom:
                    '1px solid rgba(255,255,255,.055)',
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 650,
                    letterSpacing: '.10em',
                    color:
                      'rgba(167,139,250,.70)',
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
                  SE WEB SYSTEM
                </span>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: '#22C55E',
                      boxShadow:
                        '0 0 6px #22C55E',
                    }}
                  />

                  <span
                    style={{
                      fontSize: 8,
                      color:
                        'rgba(34,197,94,.65)',
                    }}
                  >
                    Connected
                  </span>
                </div>
              </div>

              <SystemLayer
                title="Website"
                detail="Design · Content · Customer experience"
                color="#8A4DFF"
              />

              <Connector />

              <SystemLayer
                title="Lead Capture"
                detail="Forms · Enquiries · Conversion"
                color="#A78BFA"
              />

              <Connector />

              <div
                style={{
                  padding: 14,
                  borderRadius: 11,
                  background:
                    'rgba(255,255,255,.019)',
                  border:
                    '1px solid rgba(255,255,255,.06)',
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
                      'rgba(255,255,255,.27)',
                  }}
                >
                  Connected to
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(2, minmax(0, 1fr))',
                    gap: 7,
                  }}
                >
                  {[
                    {
                      label: 'CRM',
                      color: '#8A4DFF',
                    },
                    {
                      label: 'Bookings',
                      color: '#22C55E',
                    },
                    {
                      label: 'Automation',
                      color: '#F59E0B',
                    },
                    {
                      label: 'Dashboards',
                      color: '#38BDF8',
                    },
                  ].map(item => (
                    <div
                      key={item.label}
                      style={{
                        padding: '9px 10px',
                        borderRadius: 8,
                        background:
                          `${item.color}0D`,
                        border:
                          `1px solid ${item.color}20`,
                        fontSize: 9,
                        color: item.color,
                      }}
                    >
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>

              <Connector />

              <SystemLayer
                title="BRΛINBΛSE"
                detail="Operations · Insight · Intelligence"
                color="#6366F1"
              />

              <div
                style={{
                  marginTop: 16,
                  paddingTop: 13,
                  borderTop:
                    '1px solid rgba(255,255,255,.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent:
                    'space-between',
                  gap: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    color:
                      'rgba(255,255,255,.24)',
                  }}
                >
                  Managed infrastructure
                </span>

                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 650,
                    color:
                      'rgba(167,139,250,.66)',
                  }}
                >
                  HLNΛ ready
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            SERVICES
        ================================================================= */}

        <section
          id="what-we-build"
          style={{
            marginBottom: 96,
          }}
        >
          <SectionHeading
            eyebrow="What We Build"
            title="More than a website."
            description="Start with the digital presence you need today, then connect more of the business as the value becomes clear."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(245px, 1fr))',
              gap: 11,
            }}
          >
            {SERVICES.map(
              (service, index) => {
                const active =
                  hoveredService === index;

                return (
                  <div
                    key={service.title}
                    onMouseEnter={() =>
                      setHoveredService(
                        index,
                      )
                    }
                    onMouseLeave={() =>
                      setHoveredService(
                        null,
                      )
                    }
                    style={{
                      minHeight: 255,
                      padding: 23,
                      borderRadius: 14,

                      background: active
                        ? `rgba(${hexToRgbStr(
                            service.color,
                          )}, .055)`
                        : 'rgba(255,255,255,.018)',

                      border: active
                        ? `1px solid ${service.color}2C`
                        : '1px solid rgba(255,255,255,.062)',

                      transform: active
                        ? 'translateY(-3px)'
                        : 'translateY(0)',

                      transition:
                        'all .17s',
                    }}
                  >
                    <div
                      style={{
                        width: 35,
                        height: 35,
                        marginBottom: 18,
                        borderRadius: 9,
                        display: 'flex',
                        alignItems:
                          'center',
                        justifyContent:
                          'center',
                        background:
                          `${service.color}10`,
                        border:
                          `1px solid ${service.color}25`,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius:
                            '50%',
                          background:
                            service.color,
                          boxShadow:
                            `0 0 8px ${service.color}80`,
                        }}
                      />
                    </div>

                    <h3
                      style={{
                        margin:
                          '0 0 9px',
                        fontSize: 14,
                        fontWeight: 650,
                        letterSpacing:
                          '-.015em',
                        color: '#F5F7FA',
                      }}
                    >
                      {service.title}
                    </h3>

                    <p
                      style={{
                        minHeight: 76,
                        margin:
                          '0 0 17px',
                        fontSize: 11,
                        lineHeight: 1.65,
                        color:
                          'rgba(226,232,240,.51)',
                      }}
                    >
                      {
                        service.description
                      }
                    </p>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 5,
                      }}
                    >
                      {service.tags.map(
                        tag => (
                          <span
                            key={tag}
                            style={{
                              padding:
                                '3px 8px',
                              borderRadius:
                                999,
                              fontSize: 8,
                              color: active
                                ? service.color
                                : 'rgba(255,255,255,.31)',
                              background:
                                'rgba(255,255,255,.025)',
                              border:
                                '1px solid rgba(255,255,255,.055)',
                            }}
                          >
                            {tag}
                          </span>
                        ),
                      )}
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
            marginBottom: 96,
          }}
        >
          <SectionHeading
            eyebrow="Why Connect It"
            title="Make the website useful after the form is submitted."
            description="The biggest improvement often happens behind the website — where enquiries, follow-up and operational work begin."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 10,
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
                      padding: 20,
                      borderRadius: 12,

                      background: active
                        ? `rgba(${hexToRgbStr(
                            item.color,
                          )}, .045)`
                        : 'rgba(255,255,255,.017)',

                      border: active
                        ? `1px solid ${item.color}25`
                        : '1px solid rgba(255,255,255,.06)',

                      transition:
                        'all .16s',
                    }}
                  >
                    <div
                      style={{
                        marginBottom: 12,
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
                            item.color,
                          boxShadow:
                            `0 0 7px ${item.color}70`,
                        }}
                      />

                      <h3
                        style={{
                          margin: 0,
                          fontSize: 12,
                          fontWeight: 650,
                          color:
                            '#F5F7FA',
                        }}
                      >
                        {item.title}
                      </h3>
                    </div>

                    <p
                      style={{
                        margin: 0,
                        fontSize: 10,
                        lineHeight: 1.65,
                        color:
                          'rgba(226,232,240,.50)',
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
            CONNECTED FLOW
        ================================================================= */}

        <section
          style={{
            marginBottom: 96,
          }}
        >
          <SectionHeading
            eyebrow="Connected Journey"
            title="From website visitor to organised operation."
            description="A connected web system keeps information moving instead of forcing your team to rebuild the customer journey manually."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(310px, 1fr))',
              gap: 10,
            }}
          >
            {FLOW.map(
              (step, index) => {
                const active =
                  hoveredFlow === index;

                return (
                  <div
                    key={step.number}
                    onMouseEnter={() =>
                      setHoveredFlow(
                        index,
                      )
                    }
                    onMouseLeave={() =>
                      setHoveredFlow(
                        null,
                      )
                    }
                    style={{
                      padding: 20,
                      display: 'flex',
                      gap: 15,
                      borderRadius: 13,

                      background: active
                        ? `rgba(${hexToRgbStr(
                            step.color,
                          )}, .05)`
                        : 'rgba(255,255,255,.017)',

                      border: active
                        ? `1px solid ${step.color}28`
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
                        flexShrink: 0,
                        borderRadius: 9,
                        display: 'flex',
                        alignItems:
                          'center',
                        justifyContent:
                          'center',
                        background:
                          `${step.color}10`,
                        border:
                          `1px solid ${step.color}25`,
                        fontSize: 8,
                        fontWeight: 700,
                        color: step.color,
                      }}
                    >
                      {step.number}
                    </div>

                    <div>
                      <h3
                        style={{
                          margin:
                            '0 0 5px',
                          fontSize: 12,
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
                          fontSize: 10,
                          lineHeight: 1.6,
                          color:
                            'rgba(226,232,240,.49)',
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
            REAL DEPLOYMENT
        ================================================================= */}

        <section
          style={{
            marginBottom: 96,
          }}
        >
          <div
            className="web-systems-panel"
            style={{
              padding: 42,
              borderRadius: 18,
              background:
                'linear-gradient(135deg, rgba(34,197,94,.045), rgba(138,77,255,.02))',
              border:
                '1px solid rgba(34,197,94,.14)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(300px, 1fr))',
                gap: 40,
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    marginBottom: 14,
                    padding: '4px 9px',
                    borderRadius: 999,
                    background:
                      'rgba(34,197,94,.07)',
                    border:
                      '1px solid rgba(34,197,94,.18)',
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: '#22C55E',
                      boxShadow:
                        '0 0 6px #22C55E',
                      animation:
                        'webPulse 2.5s ease-in-out infinite',
                    }}
                  />

                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: '.10em',
                      textTransform: 'uppercase',
                      color: '#6EE7B7',
                    }}
                  >
                    Real Deployment Example
                  </span>
                </div>

                <h2
                  style={{
                    margin: '0 0 11px',
                    fontSize: 29,
                    fontWeight: 650,
                    letterSpacing: '-.03em',
                    color: '#F5F7FA',
                  }}
                >
                  LD Tennis
                </h2>

                <p
                  style={{
                    margin: '0 0 23px',
                    maxWidth: 535,
                    fontSize: 13,
                    lineHeight: 1.7,
                    color:
                      'rgba(226,232,240,.56)',
                  }}
                >
                  A real example of a website extending
                  into a connected Client Operations
                  deployment. Enquiries, leads, clients,
                  sessions and follow-up work together
                  through BRΛINBΛSE.
                </p>

                <div
                  style={{
                    display: 'flex',
                    gap: 9,
                    flexWrap: 'wrap',
                  }}
                >
                  <a
                    href="https://ldtennis.com.au"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      minHeight: 40,
                      padding: '0 16px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      borderRadius: 8,
                      background:
                        'rgba(34,197,94,.09)',
                      border:
                        '1px solid rgba(34,197,94,.22)',
                      color: '#6EE7B7',
                      textDecoration: 'none',
                      fontSize: 10,
                      fontWeight: 650,
                    }}
                  >
                    View LD Tennis →
                  </a>

                  <Link
                    href="/client-operations/demo"
                    style={{
                      minHeight: 40,
                      padding: '0 16px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      borderRadius: 8,
                      background:
                        'rgba(255,255,255,.025)',
                      border:
                        '1px solid rgba(255,255,255,.075)',
                      color:
                        'rgba(245,247,250,.57)',
                      textDecoration: 'none',
                      fontSize: 10,
                      fontWeight: 550,
                    }}
                  >
                    Explore the deployment →
                  </Link>
                </div>
              </div>

              <div
                style={{
                  padding: 22,
                  borderRadius: 14,
                  background:
                    'rgba(7,8,11,.34)',
                  border:
                    '1px solid rgba(255,255,255,.06)',
                }}
              >
                <div
                  style={{
                    marginBottom: 15,
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: '.10em',
                    textTransform: 'uppercase',
                    color:
                      'rgba(255,255,255,.28)',
                  }}
                >
                  Connected deployment
                </div>

                {[
                  {
                    name: 'Public Website',
                    detail:
                      'Customer-facing experience',
                    color: '#22C55E',
                  },
                  {
                    name: 'Lead Management',
                    detail:
                      'Enquiries and follow-up',
                    color: '#38BDF8',
                  },
                  {
                    name: 'Client Operations',
                    detail:
                      'Clients and activity',
                    color: '#8A4DFF',
                  },
                  {
                    name: 'Session Management',
                    detail:
                      'Programs and scheduling',
                    color: '#F59E0B',
                  },
                  {
                    name: 'BRΛINBΛSE',
                    detail:
                      'Operational platform',
                    color: '#A78BFA',
                  },
                ].map((item, index) => (
                  <div
                    key={item.name}
                    style={{
                      padding: '10px 11px',
                      marginBottom:
                        index === 4
                          ? 0
                          : 7,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      borderRadius: 8,
                      background:
                        `${item.color}08`,
                      border:
                        `1px solid ${item.color}18`,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background:
                          item.color,
                        boxShadow:
                          `0 0 5px ${item.color}60`,
                      }}
                    />

                    <div>
                      <div
                        style={{
                          marginBottom: 1,
                          fontSize: 9,
                          fontWeight: 650,
                          color:
                            '#F5F7FA',
                        }}
                      >
                        {item.name}
                      </div>

                      <div
                        style={{
                          fontSize: 8,
                          color:
                            'rgba(255,255,255,.29)',
                        }}
                      >
                        {item.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================
            DEPLOYMENT OPTIONS
        ================================================================= */}

        <section
          style={{
            marginBottom: 96,
          }}
        >
          <SectionHeading
            eyebrow="Deployment Options"
            title="Start where it makes sense."
            description="Not every business needs the full BRΛINBΛSE platform on day one. The website can be the foundation and the connected system can grow from there."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(285px, 1fr))',
              gap: 12,
            }}
          >
            {DEPLOYMENTS.map(
              (deployment, index) => {
                const active =
                  hoveredDeployment ===
                  index;

                return (
                  <div
                    key={deployment.title}
                    onMouseEnter={() =>
                      setHoveredDeployment(
                        index,
                      )
                    }
                    onMouseLeave={() =>
                      setHoveredDeployment(
                        null,
                      )
                    }
                    style={{
                      position: 'relative',
                      padding:
                        '28px 25px',
                      borderRadius: 15,
                      display: 'flex',
                      flexDirection:
                        'column',

                      background:
                        deployment.featured
                          ? `rgba(${hexToRgbStr(
                              deployment.color,
                            )}, .045)`
                          : active
                            ? `rgba(${hexToRgbStr(
                                deployment.color,
                              )}, .035)`
                            : 'rgba(255,255,255,.018)',

                      border:
                        deployment.featured
                          ? `1px solid ${deployment.color}35`
                          : active
                            ? `1px solid ${deployment.color}28`
                            : '1px solid rgba(255,255,255,.065)',

                      transform: active
                        ? 'translateY(-3px)'
                        : 'translateY(0)',

                      transition:
                        'all .17s',
                    }}
                  >
                    {deployment.featured && (
                      <div
                        style={{
                          position:
                            'absolute',
                          top: 15,
                          right: 15,
                          padding:
                            '3px 8px',
                          borderRadius:
                            999,
                          background:
                            'rgba(34,197,94,.08)',
                          border:
                            '1px solid rgba(34,197,94,.18)',
                          fontSize: 7,
                          fontWeight: 700,
                          letterSpacing:
                            '.09em',
                          textTransform:
                            'uppercase',
                          color:
                            '#6EE7B7',
                        }}
                      >
                        Recommended
                      </div>
                    )}

                    <div
                      style={{
                        marginBottom: 8,
                        fontSize: 8,
                        fontWeight: 700,
                        letterSpacing:
                          '.10em',
                        textTransform:
                          'uppercase',
                        color:
                          deployment.color,
                      }}
                    >
                      {deployment.label}
                    </div>

                    <h3
                      style={{
                        margin:
                          '0 0 9px',
                        paddingRight:
                          deployment.featured
                            ? 85
                            : 0,
                        fontSize: 18,
                        fontWeight: 650,
                        letterSpacing:
                          '-.02em',
                        color: '#F5F7FA',
                      }}
                    >
                      {deployment.title}
                    </h3>

                    <p
                      style={{
                        minHeight: 67,
                        margin:
                          '0 0 21px',
                        fontSize: 11,
                        lineHeight: 1.6,
                        color:
                          'rgba(226,232,240,.49)',
                      }}
                    >
                      {
                        deployment.description
                      }
                    </p>

                    <div
                      style={{
                        marginBottom: 22,
                        display: 'flex',
                        flexDirection:
                          'column',
                        gap: 8,
                        flex: 1,
                      }}
                    >
                      {deployment.includes.map(
                        item => (
                          <div
                            key={item}
                            style={{
                              display:
                                'flex',
                              gap: 8,
                              alignItems:
                                'flex-start',
                              fontSize: 10,
                              lineHeight:
                                1.45,
                              color:
                                'rgba(226,232,240,.56)',
                            }}
                          >
                            <span
                              style={{
                                color:
                                  deployment.color,
                              }}
                            >
                              ✓
                            </span>

                            {item}
                          </div>
                        ),
                      )}
                    </div>

                    <button
                      onClick={() =>
                        setEnquiryOpen(true)
                      }
                      style={{
                        width: '100%',
                        minHeight: 40,
                        borderRadius: 8,
                        background:
                          `${deployment.color}10`,
                        border:
                          `1px solid ${deployment.color}28`,
                        color:
                          deployment.color,
                        cursor: 'pointer',
                        fontFamily: FONT,
                        fontSize: 10,
                        fontWeight: 650,
                      }}
                    >
                      {deployment.action} →
                    </button>
                  </div>
                );
              },
            )}
          </div>

          <p
            style={{
              margin: '18px auto 0',
              textAlign: 'center',
              fontSize: 9,
              color:
                'rgba(255,255,255,.23)',
            }}
          >
            Project scope and investment depend on
            the website, integrations and operational
            requirements involved. Any project costs
            are scoped and quoted before work begins.
          </p>
        </section>

        {/* ================================================================
            PROCESS
        ================================================================= */}

        <section
          style={{
            marginBottom: 96,
          }}
        >
          <SectionHeading
            eyebrow="How It Works"
            title="From idea to live system."
            description="The work starts with the business requirement rather than forcing your operation into a predetermined website template."
            centred
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(185px, 1fr))',
              gap: 9,
            }}
          >
            {PROCESS.map(step => (
              <div
                key={step.number}
                style={{
                  padding: 20,
                  borderRadius: 12,
                  background:
                    'rgba(255,255,255,.017)',
                  border:
                    '1px solid rgba(255,255,255,.06)',
                }}
              >
                <div
                  style={{
                    marginBottom: 13,
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: '.09em',
                    color:
                      'rgba(167,139,250,.58)',
                  }}
                >
                  {step.number}
                </div>

                <h3
                  style={{
                    margin: '0 0 7px',
                    fontSize: 12,
                    fontWeight: 650,
                    color: '#F5F7FA',
                  }}
                >
                  {step.title}
                </h3>

                <p
                  style={{
                    margin: 0,
                    fontSize: 9,
                    lineHeight: 1.6,
                    color:
                      'rgba(226,232,240,.45)',
                  }}
                >
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ================================================================
            MANAGED
        ================================================================= */}

        <section
          className="web-systems-panel"
          style={{
            marginBottom: 96,
            padding: 42,
            borderRadius: 18,
            background:
              'linear-gradient(135deg, rgba(138,77,255,.045), rgba(92,124,255,.012))',
            border:
              '1px solid rgba(138,77,255,.12)',
          }}
        >
          <div
            style={{
              marginBottom: 29,
              maxWidth: 630,
            }}
          >
            <div
              style={{
                marginBottom: 9,
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '.11em',
                textTransform: 'uppercase',
                color:
                  'rgba(167,139,250,.66)',
              }}
            >
              Managed by BRΛINBΛSE
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
              We can stay responsible after launch.
            </h2>

            <p
              style={{
                margin: 0,
                fontSize: 12,
                lineHeight: 1.68,
                color:
                  'rgba(226,232,240,.52)',
              }}
            >
              A website should not become another
              system your business has to maintain.
              BRΛINBΛSE can manage the technical
              environment and continue improving the
              connected system over time.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(230px, 1fr))',
              gap: 9,
            }}
          >
            {MANAGED.map(item => (
              <div
                key={item.title}
                style={{
                  padding: 17,
                  borderRadius: 10,
                  background:
                    'rgba(7,8,11,.25)',
                  border:
                    '1px solid rgba(255,255,255,.055)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: item.color,
                    }}
                  />

                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 650,
                      color: '#F5F7FA',
                    }}
                  >
                    {item.title}
                  </span>
                </div>

                <p
                  style={{
                    margin: 0,
                    fontSize: 9,
                    lineHeight: 1.55,
                    color:
                      'rgba(226,232,240,.43)',
                  }}
                >
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ================================================================
            PLATFORM CONNECTION
        ================================================================= */}

        <section
          className="web-systems-panel"
          style={{
            marginBottom: 96,
            padding: '42px',
            borderRadius: 18,
            background:
              'linear-gradient(135deg, rgba(86,119,255,.045), rgba(138,77,255,.045))',
            border:
              '1px solid rgba(138,77,255,.13)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 36,
              alignItems: 'center',
            }}
          >
            <div>
              <div
                style={{
                  marginBottom: 10,
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '.11em',
                  textTransform: 'uppercase',
                  color:
                    'rgba(167,139,250,.68)',
                }}
              >
                Part of BRΛINBΛSE
              </div>

              <h2
                style={{
                  margin: '0 0 12px',
                  fontSize:
                    'clamp(26px, 4vw, 36px)',
                  lineHeight: 1.1,
                  letterSpacing: '-.035em',
                  fontWeight: 650,
                  color: '#F5F7FA',
                }}
              >
                The website does not have to be the
                end of the project.
              </h2>

              <p
                style={{
                  margin: 0,
                  maxWidth: 560,
                  fontSize: 12,
                  lineHeight: 1.7,
                  color:
                    'rgba(226,232,240,.54)',
                }}
              >
                BRΛINBΛSE Web Systems can become the
                customer-facing layer of a broader
                operational platform — connecting
                enquiries, clients, workflows,
                dashboards, reporting and HLNΛ
                intelligence where appropriate.
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent:
                  'flex-end',
                gap: 9,
                flexWrap: 'wrap',
              }}
            >
              <Link
                href="/demo"
                style={{
                  minHeight: 41,
                  padding: '0 18px',
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
                  fontSize: 11,
                  fontWeight: 550,
                }}
              >
                Explore BRΛINBΛSE
              </Link>

              <Link
                href="/client-operations"
                style={{
                  minHeight: 41,
                  padding: '0 18px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: 9,
                  background:
                    'rgba(138,77,255,.07)',
                  border:
                    '1px solid rgba(138,77,255,.18)',
                  color: '#C4B5FD',
                  textDecoration: 'none',
                  fontSize: 11,
                  fontWeight: 650,
                }}
              >
                Client Operations →
              </Link>
            </div>
          </div>
        </section>

        {/* ================================================================
            FINAL CTA
        ================================================================= */}

        <section
          className="web-systems-panel"
          style={{
            padding: '50px 42px',
            borderRadius: 19,
            textAlign: 'center',
            background:
              'linear-gradient(135deg, rgba(138,77,255,.075), rgba(92,124,255,.025))',
            border:
              '1px solid rgba(138,77,255,.16)',
          }}
        >
          <div
            style={{
              maxWidth: 680,
              margin: '0 auto',
            }}
          >
            <div
              style={{
                marginBottom: 11,
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color:
                  'rgba(167,139,250,.70)',
              }}
            >
              Start with the website
            </div>

            <h2
              style={{
                margin: '0 0 14px',
                fontSize:
                  'clamp(28px, 4vw, 39px)',
                lineHeight: 1.1,
                letterSpacing: '-.038em',
                fontWeight: 650,
                color: '#F5F7FA',
              }}
            >
              Build something that can grow with the
              business.
            </h2>

            <p
              style={{
                margin: '0 auto 25px',
                maxWidth: 570,
                fontSize: 12,
                lineHeight: 1.72,
                color:
                  'rgba(226,232,240,.54)',
              }}
            >
              Whether you need a better website or
              want to connect the systems behind it,
              we can work out the right starting
              point.
            </p>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 9,
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={() =>
                  setEnquiryOpen(true)
                }
                style={{
                  minHeight: 43,
                  padding: '0 21px',
                  borderRadius: 9,
                  border: 'none',
                  background:
                    'linear-gradient(100deg, #6A3DFF 0%, #8A4DFF 55%, #5677FF 100%)',
                  color: '#FFFFFF',
                  cursor: 'pointer',
                  fontFamily: FONT,
                  fontSize: 11,
                  fontWeight: 650,
                }}
              >
                Discuss your website →
              </button>

              <Link
                href="/demo"
                style={{
                  minHeight: 41,
                  padding: '0 19px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: 9,
                  background:
                    'rgba(255,255,255,.025)',
                  border:
                    '1px solid rgba(255,255,255,.08)',
                  color:
                    'rgba(245,247,250,.61)',
                  textDecoration: 'none',
                  fontSize: 11,
                  fontWeight: 550,
                }}
              >
                Explore BRΛINBΛSE
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* ================================================================
          FOOTER
      ================================================================= */}

      <footer
        className="web-systems-footer"
        style={{
          marginTop: 55,
          padding: '22px 32px',
          borderTop:
            '1px solid rgba(255,255,255,.05)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent:
              'space-between',
            gap: 18,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 9,
              color:
                'rgba(255,255,255,.20)',
            }}
          >
            © 2026 BRΛINBΛSE
          </span>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
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

const footerLinkStyle = {
  fontSize: 9,
  color: 'rgba(255,255,255,.28)',
  textDecoration: 'none',
};

function SystemLayer({
  title,
  detail,
  color,
}: {
  title: string;
  detail: string;
  color: string;
}) {
  return (
    <div
      style={{
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        borderRadius: 10,
        background: `${color}0C`,
        border: `1px solid ${color}20`,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          flexShrink: 0,
          borderRadius: '50%',
          background: color,
          boxShadow:
            `0 0 7px ${color}70`,
        }}
      />

      <div>
        <div
          style={{
            marginBottom: 2,
            fontSize: 10,
            fontWeight: 650,
            color: '#F5F7FA',
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontSize: 8,
            color:
              'rgba(226,232,240,.38)',
          }}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}

function Connector() {
  return (
    <div
      style={{
        height: 19,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 1,
          height: '100%',
          background:
            'linear-gradient(180deg, rgba(138,77,255,.34), rgba(92,124,255,.17))',
        }}
      />
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
        maxWidth: centred ? 710 : 620,
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
          fontSize: 8,
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
            'clamp(28px, 4vw, 39px)',
          lineHeight: 1.1,
          letterSpacing: '-.038em',
          fontWeight: 650,
          color: '#F5F7FA',
        }}
      >
        {title}
      </h2>

      <p
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.7,
          color:
            'rgba(226,232,240,.55)',
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
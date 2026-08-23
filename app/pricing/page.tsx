'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';

const FONT =
  'var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const BG = '#07080B';

type Plan = {
  name: string;
  price: number | null;
  priceLabel?: string;
  tagline: string;
  description: string;
  color: string;
  popular: boolean;
  enterprise?: boolean;
  features: string[];
  cta: string;
};

const PLANS: Plan[] = [
  {
    name: 'Foundation',
    price: 29,
    tagline: 'Get your operation organised',
    description:
      'A simple operational foundation for businesses ready to organise clients, leads and scheduling in one connected workspace.',
    color: '#8A4DFF',
    popular: false,
    features: [
      'Client management',
      'Lead tracking',
      'Scheduling',
      'Core operational view',
      'BRΛINBΛSE workspace',
      'Standard support',
    ],
    cta: 'Discuss Foundation',
  },
  {
    name: 'Operations',
    price: 59,
    tagline: 'Run the day-to-day work',
    description:
      'For businesses that want leads, clients, workflows and operational visibility connected in one working system.',
    color: '#22C55E',
    popular: true,
    features: [
      'Everything in Foundation',
      'Follow-up workflows',
      'Revenue visibility',
      'Operational dashboards',
      'Workflow automation',
      'Priority operational support',
    ],
    cta: 'Discuss Operations',
  },
  {
    name: 'Business System',
    price: 99,
    tagline: 'Connect the broader business',
    description:
      'For businesses ready to connect more of their operation and introduce deeper reporting, integrations and intelligence.',
    color: '#A78BFA',
    popular: false,
    features: [
      'Everything in Operations',
      'HLNΛ intelligence',
      'Advanced reporting',
      'Expanded workflows',
      'Business integrations',
      'Priority support',
    ],
    cta: 'Discuss Business System',
  },
  {
    name: 'Enterprise',
    price: null,
    priceLabel: 'Custom',
    tagline: 'Tailored deployment at scale',
    description:
      'For larger organisations, multi-team environments and operations requiring tailored architecture, governance and implementation.',
    color: '#38BDF8',
    popular: false,
    enterprise: true,
    features: [
      'Tailored BRΛINBΛSE deployment',
      'Multiple teams or business units',
      'Advanced permissions & governance',
      'Custom integrations & workflows',
      'Tailored dashboards & reporting',
      'Dedicated implementation support',
    ],
    cta: 'Talk to us',
  },
];

const COMPARISON = [
  {
    feature: 'Client management',
    foundation: true,
    operations: true,
    business: true,
    enterprise: true,
  },
  {
    feature: 'Lead tracking',
    foundation: true,
    operations: true,
    business: true,
    enterprise: true,
  },
  {
    feature: 'Scheduling',
    foundation: true,
    operations: true,
    business: true,
    enterprise: true,
  },
  {
    feature: 'Operational workspace',
    foundation: true,
    operations: true,
    business: true,
    enterprise: true,
  },
  {
    feature: 'Follow-up workflows',
    foundation: false,
    operations: true,
    business: true,
    enterprise: true,
  },
  {
    feature: 'Revenue visibility',
    foundation: false,
    operations: true,
    business: true,
    enterprise: true,
  },
  {
    feature: 'Operational dashboards',
    foundation: false,
    operations: true,
    business: true,
    enterprise: true,
  },
  {
    feature: 'Workflow automation',
    foundation: false,
    operations: true,
    business: true,
    enterprise: true,
  },
  {
    feature: 'HLNΛ intelligence',
    foundation: false,
    operations: false,
    business: true,
    enterprise: true,
  },
  {
    feature: 'Advanced reporting',
    foundation: false,
    operations: false,
    business: true,
    enterprise: true,
  },
  {
    feature: 'Business integrations',
    foundation: false,
    operations: false,
    business: true,
    enterprise: true,
  },
  {
    feature: 'Multi-team deployment',
    foundation: false,
    operations: false,
    business: false,
    enterprise: true,
  },
  {
    feature: 'Advanced permissions',
    foundation: false,
    operations: false,
    business: false,
    enterprise: true,
  },
  {
    feature: 'Tailored implementation',
    foundation: false,
    operations: false,
    business: false,
    enterprise: true,
  },
];

const EXTRAS = [
  {
    title: 'Setup & configuration',
    description:
      'Initial setup can include workspace configuration, workflows, forms, permissions and business-specific operating structure. A one-off setup fee may apply depending on requirements.',
  },
  {
    title: 'Website builds',
    description:
      'A new BRΛINBΛSE website or redesign is separate from the monthly platform subscription and can be scoped and quoted based on the project.',
  },
  {
    title: 'Data migration',
    description:
      'Existing contacts, client information and operational records can be assessed and migrated where appropriate. Migration work may be quoted separately.',
  },
  {
    title: 'Custom integrations',
    description:
      'Connections to external systems, specialist software or custom workflows can be quoted separately based on complexity.',
  },
];

export default function PricingPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: BG,
        color: '#F5F7FA',
        fontFamily: FONT,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <style>
        {`
          @keyframes pricingPulse {
            0%, 100% {
              opacity: .65;
            }

            50% {
              opacity: 1;
            }
          }

          .pricing-plan-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            align-items: stretch;
          }

          .pricing-choice-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
          }

          .pricing-extra-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
          }

          @media (max-width: 1080px) {
            .pricing-plan-grid,
            .pricing-choice-grid,
            .pricing-extra-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 760px) {
            .pricing-table-wrap {
              overflow-x: auto;
            }

            .pricing-plan-grid,
            .pricing-choice-grid,
            .pricing-extra-grid {
              grid-template-columns: 1fr;
            }

            .pricing-shell {
              padding-left: 18px !important;
              padding-right: 18px !important;
            }

            .pricing-large-card {
              padding-left: 24px !important;
              padding-right: 24px !important;
            }
          }
        `}
      </style>

      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background: `
            radial-gradient(
              ellipse 70% 42% at 50% -4%,
              rgba(138,77,255,.14),
              rgba(86,119,255,.04) 42%,
              transparent 72%
            )
          `,
        }}
      />

      <div
        className="pricing-shell"
        style={{
          maxWidth: 1220,
          margin: '0 auto',
          padding: '88px 32px 110px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* HERO */}

        <section
          style={{
            textAlign: 'center',
            maxWidth: 790,
            margin: '0 auto 64px',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 999,
              background: 'rgba(138,77,255,.08)',
              border: '1px solid rgba(138,77,255,.20)',
              color: 'rgba(196,181,253,.86)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '.13em',
              textTransform: 'uppercase',
              marginBottom: 22,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: '#8A4DFF',
                boxShadow: '0 0 8px rgba(138,77,255,.85)',
                animation: 'pricingPulse 2.4s ease-in-out infinite',
              }}
            />

            BRΛINBΛSE Pricing
          </div>

          <h1
            style={{
              margin: '0 0 20px',
              fontSize: 'clamp(38px, 6vw, 62px)',
              lineHeight: 1.02,
              letterSpacing: '-.052em',
              fontWeight: 650,
              color: '#F5F7FA',
            }}
          >
            Start where you are.
            <br />

            <span
              style={{
                background:
                  'linear-gradient(90deg, #A78BFA, #8A4DFF 48%, #5677FF)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Expand as you connect more.
            </span>
          </h1>

          <p
            style={{
              maxWidth: 660,
              margin: '0 auto',
              fontSize: 15,
              lineHeight: 1.75,
              color: 'rgba(226,232,240,.60)',
            }}
          >
            BRΛINBΛSE can begin with a focused operational need and grow into a
            broader connected system as your workflows, reporting and
            intelligence requirements develop.
          </p>
        </section>

        {/* PRICING CARDS */}

        <section
          style={{
            marginBottom: 30,
          }}
        >
          <div className="pricing-plan-grid">
            {PLANS.map(plan => (
              <div
                key={plan.name}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 550,
                  padding: '30px 24px 25px',
                  borderRadius: 18,
                  overflow: 'hidden',

                  background: plan.popular
                    ? 'linear-gradient(160deg, rgba(34,197,94,.065), rgba(255,255,255,.022) 45%, rgba(138,77,255,.025))'
                    : plan.enterprise
                      ? 'linear-gradient(160deg, rgba(56,189,248,.055), rgba(255,255,255,.018) 48%, rgba(138,77,255,.022))'
                      : 'rgba(255,255,255,.018)',

                  border: plan.popular
                    ? '1px solid rgba(34,197,94,.27)'
                    : plan.enterprise
                      ? '1px solid rgba(56,189,248,.20)'
                      : '1px solid rgba(255,255,255,.075)',

                  boxShadow: plan.popular
                    ? '0 26px 70px rgba(0,0,0,.22), 0 0 38px rgba(34,197,94,.035)'
                    : '0 20px 60px rgba(0,0,0,.14)',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: 110,
                    height: 1,
                    background: `linear-gradient(90deg, ${plan.color}, transparent)`,
                  }}
                />

                {plan.popular && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 16,
                      top: 17,
                      padding: '5px 8px',
                      borderRadius: 999,
                      fontSize: 8,
                      fontWeight: 750,
                      letterSpacing: '.09em',
                      textTransform: 'uppercase',
                      color: '#86EFAC',
                      background: 'rgba(34,197,94,.10)',
                      border: '1px solid rgba(34,197,94,.22)',
                    }}
                  >
                    Most Popular
                  </div>
                )}

                {plan.enterprise && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 16,
                      top: 17,
                      padding: '5px 8px',
                      borderRadius: 999,
                      fontSize: 8,
                      fontWeight: 750,
                      letterSpacing: '.09em',
                      textTransform: 'uppercase',
                      color: '#7DD3FC',
                      background: 'rgba(56,189,248,.08)',
                      border: '1px solid rgba(56,189,248,.18)',
                    }}
                  >
                    Tailored
                  </div>
                )}

                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 650,
                    color: plan.color,
                    marginBottom: 8,
                  }}
                >
                  {plan.name}
                </div>

                {/* Equal-height title zone */}
                <h2
                  style={{
                    margin: '0 0 10px',
                    paddingRight:
                      plan.popular || plan.enterprise
                        ? 68
                        : 0,
                    minHeight: 78,
                    fontSize: 20,
                    lineHeight: 1.22,
                    fontWeight: 650,
                    letterSpacing: '-.025em',
                    color: '#F5F7FA',
                  }}
                >
                  {plan.tagline}
                </h2>

                {/* Equal-height description zone */}
                <p
                  style={{
                    margin: '0 0 26px',
                    minHeight: 86,
                    fontSize: 12,
                    lineHeight: 1.65,
                    color: 'rgba(226,232,240,.48)',
                  }}
                >
                  {plan.description}
                </p>

                {/* Equal-height price zone */}
                <div
                  style={{
                    height: 58,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 5,
                    marginBottom: 7,
                  }}
                >
                  {plan.price !== null ? (
                    <>
                      <span
                        style={{
                          fontSize: 43,
                          fontWeight: 650,
                          lineHeight: 1,
                          letterSpacing: '-.045em',
                          color: '#F5F7FA',
                        }}
                      >
                        ${plan.price}
                      </span>

                      <span
                        style={{
                          fontSize: 12,
                          lineHeight: 1,
                          paddingTop: 27,
                          color: 'rgba(226,232,240,.38)',
                        }}
                      >
                        / month
                      </span>
                    </>
                  ) : (
                    <span
                      style={{
                        fontSize: 43,
                        fontWeight: 650,
                        lineHeight: 1,
                        letterSpacing: '-.045em',
                        color: '#F5F7FA',
                      }}
                    >
                      {plan.priceLabel}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    fontSize: 10,
                    color: 'rgba(226,232,240,.30)',
                    marginBottom: 25,
                  }}
                >
                  {plan.enterprise
                    ? 'Scoped to your organisation'
                    : 'Platform subscription'}
                </div>

                <div
                  style={{
                    height: 1,
                    background: 'rgba(255,255,255,.06)',
                    marginBottom: 23,
                  }}
                />

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 13,
                    marginBottom: 30,
                    flex: 1,
                  }}
                >
                  {plan.features.map(feature => (
                    <div
                      key={feature}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 9,
                      }}
                    >
                      <div
                        style={{
                          width: 17,
                          height: 17,
                          borderRadius: '50%',
                          background: `${plan.color}12`,
                          border: `1px solid ${plan.color}30`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          marginTop: 1,
                        }}
                      >
                        <svg
                          width="9"
                          height="7"
                          viewBox="0 0 9 7"
                          fill="none"
                        >
                          <path
                            d="M1 3.4L3.4 5.8L8 1"
                            stroke={plan.color}
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>

                      <span
                        style={{
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: 'rgba(226,232,240,.62)',
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
                    width: '100%',
                    height: 42,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 9,
                    boxSizing: 'border-box',
                    textDecoration: 'none',
                    fontSize: 12,
                    fontWeight: 650,

                    color: plan.popular
                      ? '#FFFFFF'
                      : '#F5F7FA',

                    background: plan.popular
                      ? 'linear-gradient(100deg, #16A34A, #22C55E)'
                      : plan.enterprise
                        ? 'rgba(56,189,248,.08)'
                        : 'rgba(255,255,255,.035)',

                    border: plan.popular
                      ? '1px solid rgba(74,222,128,.30)'
                      : plan.enterprise
                        ? '1px solid rgba(56,189,248,.20)'
                        : '1px solid rgba(255,255,255,.09)',

                    boxShadow: plan.popular
                      ? '0 8px 24px rgba(34,197,94,.11)'
                      : 'none',
                  }}
                >
                  {plan.cta} →
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* SETUP NOTICE */}

        <section
          style={{
            maxWidth: 900,
            margin: '0 auto 102px',
            padding: '22px 26px',
            borderRadius: 13,
            background:
              'linear-gradient(135deg, rgba(138,77,255,.04), rgba(255,255,255,.014))',
            border: '1px solid rgba(138,77,255,.12)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 650,
              color: 'rgba(196,181,253,.82)',
              marginBottom: 7,
            }}
          >
            Setup and implementation may be quoted separately
          </div>

          <p
            style={{
              margin: '0 auto 8px',
              maxWidth: 750,
              fontSize: 12,
              lineHeight: 1.7,
              color: 'rgba(226,232,240,.54)',
            }}
          >
            Monthly pricing covers the BRΛINBΛSE platform subscription.
            Initial setup, configuration, data migration, website work and
            custom integrations may involve a separate implementation cost
            depending on your requirements.
          </p>

          <p
            style={{
              margin: 0,
              fontSize: 10,
              lineHeight: 1.6,
              color: 'rgba(226,232,240,.28)',
            }}
          >
            Any additional implementation costs will be discussed and quoted
            before work begins.
          </p>
        </section>

        {/* CHOOSING A PLAN */}

        <section
          style={{
            marginBottom: 102,
          }}
        >
          <SectionHeading
            eyebrow="Choosing a plan"
            title="Start where your operation is today."
            description="You do not need to deploy everything at once. Choose the level that fits your current operation and expand when it makes sense."
          />

          <div className="pricing-choice-grid">
            <ChoiceCard
              number="01"
              title="Foundation"
              body="You mainly need to organise leads, clients and scheduling and create one reliable operational workspace."
              color="#8A4DFF"
            />

            <ChoiceCard
              number="02"
              title="Operations"
              body="You want BRΛINBΛSE actively supporting daily workflows, follow-up, visibility, dashboards and automation."
              color="#22C55E"
            />

            <ChoiceCard
              number="03"
              title="Business System"
              body="You are ready for deeper reporting, integrations and HLNΛ intelligence across a more connected business."
              color="#A78BFA"
            />

            <ChoiceCard
              number="04"
              title="Enterprise"
              body="You need a tailored deployment across teams, business units or a more complex organisational environment."
              color="#38BDF8"
            />
          </div>
        </section>

        {/* COMPARISON */}

        <section
          style={{
            marginBottom: 102,
          }}
        >
          <SectionHeading
            eyebrow="Compare"
            title="What is included?"
            description="A high-level view of how BRΛINBΛSE capability expands from a focused workspace through to a tailored enterprise deployment."
          />

          <div
            className="pricing-table-wrap"
            style={{
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,.07)',
              background: 'rgba(255,255,255,.014)',
            }}
          >
            <div
              style={{
                minWidth: 850,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    '1.8fr repeat(4, 1fr)',
                  borderBottom:
                    '1px solid rgba(255,255,255,.07)',
                  background:
                    'rgba(255,255,255,.018)',
                }}
              >
                <div
                  style={{
                    padding: '17px 20px',
                    fontSize: 10,
                    fontWeight: 650,
                    textTransform: 'uppercase',
                    letterSpacing: '.10em',
                    color:
                      'rgba(226,232,240,.32)',
                  }}
                >
                  Capability
                </div>

                {PLANS.map(plan => (
                  <div
                    key={plan.name}
                    style={{
                      padding: '17px 10px',
                      textAlign: 'center',
                      fontSize: 11,
                      fontWeight: 650,
                      color: plan.color,
                    }}
                  >
                    {plan.name}
                  </div>
                ))}
              </div>

              {COMPARISON.map(
                (row, index) => (
                  <div
                    key={row.feature}
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        '1.8fr repeat(4, 1fr)',

                      borderBottom:
                        index ===
                        COMPARISON.length - 1
                          ? 'none'
                          : '1px solid rgba(255,255,255,.05)',
                    }}
                  >
                    <div
                      style={{
                        padding: '15px 20px',
                        fontSize: 12,
                        color:
                          'rgba(226,232,240,.57)',
                      }}
                    >
                      {row.feature}
                    </div>

                    <ComparisonCell
                      available={row.foundation}
                      color="#8A4DFF"
                    />

                    <ComparisonCell
                      available={row.operations}
                      color="#22C55E"
                    />

                    <ComparisonCell
                      available={row.business}
                      color="#A78BFA"
                    />

                    <ComparisonCell
                      available={row.enterprise}
                      color="#38BDF8"
                    />
                  </div>
                ),
              )}
            </div>
          </div>
        </section>

        {/* ENTERPRISE */}

        <section
          className="pricing-large-card"
          style={{
            marginBottom: 102,
            padding: '46px 48px',
            borderRadius: 20,
            position: 'relative',
            overflow: 'hidden',
            background:
              'linear-gradient(135deg, rgba(56,189,248,.065), rgba(138,77,255,.045) 58%, rgba(255,255,255,.012))',
            border:
              '1px solid rgba(56,189,248,.16)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              width: 460,
              height: 460,
              right: -180,
              top: -230,
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(56,189,248,.10), transparent 68%)',
            }}
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 46,
              alignItems: 'center',
              position: 'relative',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '.12em',
                  color:
                    'rgba(125,211,252,.78)',
                  marginBottom: 12,
                }}
              >
                Enterprise
              </div>

              <h2
                style={{
                  margin: '0 0 15px',
                  fontSize:
                    'clamp(27px, 4vw, 39px)',
                  lineHeight: 1.08,
                  letterSpacing: '-.038em',
                  fontWeight: 650,
                  color: '#F5F7FA',
                }}
              >
                Some operations need a system built around them.
              </h2>

              <p
                style={{
                  margin: 0,
                  maxWidth: 560,
                  fontSize: 13,
                  lineHeight: 1.72,
                  color:
                    'rgba(226,232,240,.58)',
                }}
              >
                Enterprise is for organisations where a standard subscription
                is not enough. Deployment can be tailored around organisational
                structure, permissions, workflows, reporting, integrations and
                operational requirements.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 8,
              }}
            >
              {[
                'Multiple teams or business units',
                'Custom operational workflows',
                'Advanced access and permissions',
                'Tailored integrations',
                'Organisation-specific reporting',
                'Dedicated implementation planning',
              ].map(item => (
                <div
                  key={item}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '12px 14px',
                    borderRadius: 10,
                    background:
                      'rgba(7,8,11,.28)',
                    border:
                      '1px solid rgba(255,255,255,.06)',
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: '#38BDF8',
                      boxShadow:
                        '0 0 7px rgba(56,189,248,.65)',
                      flexShrink: 0,
                    }}
                  />

                  <span
                    style={{
                      fontSize: 11,
                      color:
                        'rgba(226,232,240,.63)',
                    }}
                  >
                    {item}
                  </span>
                </div>
              ))}

              <Link
                href="/request-demo"
                style={{
                  height: 42,
                  marginTop: 5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 9,
                  background:
                    'rgba(56,189,248,.09)',
                  border:
                    '1px solid rgba(56,189,248,.22)',
                  color: '#BAE6FD',
                  textDecoration: 'none',
                  fontSize: 12,
                  fontWeight: 650,
                }}
              >
                Discuss Enterprise →
              </Link>
            </div>
          </div>
        </section>

        {/* IMPLEMENTATION */}

        <section
          style={{
            marginBottom: 102,
          }}
        >
          <SectionHeading
            eyebrow="Implementation"
            title="Some businesses need more than a subscription."
            description="Implementation depends on what you want connected, how much configuration is required and what systems or information you already have in place."
          />

          <div className="pricing-extra-grid">
            {EXTRAS.map(
              (item, index) => (
                <div
                  key={item.title}
                  style={{
                    padding: '24px',
                    borderRadius: 14,
                    background:
                      'rgba(255,255,255,.017)',
                    border:
                      '1px solid rgba(255,255,255,.06)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '.10em',
                      color:
                        'rgba(167,139,250,.55)',
                      marginBottom: 18,
                    }}
                  >
                    0{index + 1}
                  </div>

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
                        'rgba(226,232,240,.48)',
                    }}
                  >
                    {item.description}
                  </p>
                </div>
              ),
            )}
          </div>

          <div
            style={{
              marginTop: 18,
              padding: '18px 22px',
              borderRadius: 12,
              background:
                'rgba(255,255,255,.014)',
              border:
                '1px solid rgba(255,255,255,.055)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 11,
                lineHeight: 1.7,
                color:
                  'rgba(226,232,240,.42)',
              }}
            >
              Simple deployments may require little or no additional setup.
              More complex deployments involving migration, workflow
              configuration, integrations, website work or enterprise
              requirements will be scoped and quoted before commencement.
            </p>
          </div>
        </section>

        {/* WEB SYSTEMS */}

        <section
          className="pricing-large-card"
          style={{
            marginBottom: 102,
            padding: '40px 42px',
            borderRadius: 18,
            background:
              'linear-gradient(135deg, rgba(86,119,255,.055), rgba(138,77,255,.05))',
            border:
              '1px solid rgba(138,77,255,.13)',
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 38,
            alignItems: 'center',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 650,
                textTransform: 'uppercase',
                letterSpacing: '.12em',
                color:
                  'rgba(167,139,250,.67)',
                marginBottom: 12,
              }}
            >
              Web Systems
            </div>

            <h2
              style={{
                margin: '0 0 13px',
                fontSize:
                  'clamp(25px, 3.6vw, 35px)',
                lineHeight: 1.1,
                letterSpacing: '-.035em',
                fontWeight: 650,
              }}
            >
              Your website can become part of the system.
            </h2>

            <p
              style={{
                margin: 0,
                maxWidth: 520,
                fontSize: 13,
                lineHeight: 1.7,
                color:
                  'rgba(226,232,240,.55)',
              }}
            >
              BRΛINBΛSE Web Systems can connect your public website to
              enquiries, CRM, bookings, workflows and the operational platform
              behind your business.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <Link
              href="/web-systems"
              style={{
                height: 42,
                padding: '0 18px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 9,
                border:
                  '1px solid rgba(255,255,255,.09)',
                background:
                  'rgba(255,255,255,.025)',
                color:
                  'rgba(245,247,250,.72)',
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Explore Web Systems
            </Link>

            <Link
              href="/request-demo"
              style={{
                height: 42,
                padding: '0 18px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 9,
                background:
                  'linear-gradient(100deg, #6A3DFF, #8A4DFF, #5677FF)',
                border: 'none',
                color: '#FFFFFF',
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 650,
              }}
            >
              Discuss your project →
            </Link>
          </div>
        </section>

        {/* FINAL CTA */}

        <section
          className="pricing-large-card"
          style={{
            padding: '54px 40px',
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
              width: 500,
              height: 360,
              left: '50%',
              top: -210,
              transform: 'translateX(-50%)',
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(138,77,255,.14), transparent 68%)',
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
                marginBottom: 12,
              }}
            >
              Not sure which plan?
            </div>

            <h2
              style={{
                margin: '0 0 15px',
                fontSize:
                  'clamp(27px, 4vw, 40px)',
                lineHeight: 1.08,
                letterSpacing: '-.04em',
                fontWeight: 650,
              }}
            >
              Start with the operation.
              <br />
              We&apos;ll work out the system.
            </h2>

            <p
              style={{
                margin: '0 auto 27px',
                maxWidth: 535,
                fontSize: 14,
                lineHeight: 1.7,
                color:
                  'rgba(226,232,240,.58)',
              }}
            >
              Tell us what you are trying to organise, connect, improve or
              automate. We&apos;ll help identify the right place to begin.
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
                Talk to BRΛINBΛSE →
              </Link>

              <Link
                href="/demo"
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
                Explore BRΛINBΛSE
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* FOOTER */}

      <footer
        style={{
          borderTop:
            '1px solid rgba(255,255,255,.05)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            maxWidth: 1220,
            margin: '0 auto',
            padding: '26px 32px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 10,
              color:
                'rgba(255,255,255,.25)',
            }}
          >
            © 2026 BRΛINBΛSE
          </span>

          <div
            style={{
              display: 'flex',
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
    </main>
  );
}

const footerLinkStyle: CSSProperties = {
  fontSize: 10,
  color: 'rgba(255,255,255,.30)',
  textDecoration: 'none',
};

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div
      style={{
        maxWidth: 675,
        margin: '0 0 36px',
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
          margin: '0 0 12px',
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
            'rgba(226,232,240,.56)',
        }}
      >
        {description}
      </p>
    </div>
  );
}

function ChoiceCard({
  number,
  title,
  body,
  color,
}: {
  number: string;
  title: string;
  body: string;
  color: string;
}) {
  return (
    <div
      style={{
        minHeight: 190,
        padding: '25px',
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
          width: 60,
          height: 1,
          background: `linear-gradient(90deg, ${color}, transparent)`,
        }}
      />

      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color,
          letterSpacing: '.10em',
          marginBottom: 20,
        }}
      >
        {number}
      </div>

      <h3
        style={{
          margin: '0 0 9px',
          fontSize: 16,
          fontWeight: 650,
          color: '#F5F7FA',
        }}
      >
        {title}
      </h3>

      <p
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.68,
          color:
            'rgba(226,232,240,.50)',
        }}
      >
        {body}
      </p>
    </div>
  );
}

function ComparisonCell({
  available,
  color,
}: {
  available: boolean;
  color: string;
}) {
  return (
    <div
      style={{
        padding: '15px 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {available ? (
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `${color}12`,
            border: `1px solid ${color}30`,
          }}
        >
          <svg
            width="10"
            height="8"
            viewBox="0 0 10 8"
            fill="none"
          >
            <path
              d="M1 4L4 7L9 1"
              stroke={color}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : (
        <span
          style={{
            color:
              'rgba(255,255,255,.16)',
            fontSize: 14,
          }}
        >
          —
        </span>
      )}
    </div>
  );
}
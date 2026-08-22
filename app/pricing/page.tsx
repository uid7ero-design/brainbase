'use client';

import Link from 'next/link';

const FONT =
  'var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const BG = '#07080B';

const PLANS = [
  {
    name: 'Foundation',
    price: 29,
    tagline: 'Organise your client operation',
    description:
      'A simple operational foundation for businesses ready to organise clients, leads and scheduling in one connected workspace.',
    color: '#8A4DFF',
    popular: false,
    features: [
      'Client management',
      'Lead tracking',
      'Scheduling',
      'Core operational view',
      'BrainBase workspace',
      'Standard support',
    ],
    cta: 'Discuss Foundation',
  },
  {
    name: 'Operations',
    price: 59,
    tagline: 'Connect your day-to-day operation',
    description:
      'For businesses that want leads, clients, workflows and operational visibility connected in one system.',
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
    tagline: 'Run a connected business platform',
    description:
      'For businesses ready to connect more of their operation and introduce intelligence across the platform.',
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
    cta: 'Discuss Full System',
  },
];

const COMPARISON = [
  {
    feature: 'Client management',
    foundation: true,
    operations: true,
    business: true,
  },
  {
    feature: 'Lead tracking',
    foundation: true,
    operations: true,
    business: true,
  },
  {
    feature: 'Scheduling',
    foundation: true,
    operations: true,
    business: true,
  },
  {
    feature: 'Operational workspace',
    foundation: true,
    operations: true,
    business: true,
  },
  {
    feature: 'Follow-up workflows',
    foundation: false,
    operations: true,
    business: true,
  },
  {
    feature: 'Revenue visibility',
    foundation: false,
    operations: true,
    business: true,
  },
  {
    feature: 'Operational dashboards',
    foundation: false,
    operations: true,
    business: true,
  },
  {
    feature: 'Workflow automation',
    foundation: false,
    operations: true,
    business: true,
  },
  {
    feature: 'HLNΛ intelligence',
    foundation: false,
    operations: false,
    business: true,
  },
  {
    feature: 'Advanced reporting',
    foundation: false,
    operations: false,
    business: true,
  },
  {
    feature: 'Business integrations',
    foundation: false,
    operations: false,
    business: true,
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
      'A new BrainBase website or redesign is separate from the monthly platform subscription and can be scoped and quoted based on the project.',
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

          @media (max-width: 760px) {
            .pricing-table-wrap {
              overflow-x: auto;
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
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '88px 32px 110px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* ================================================================
            HERO
        ================================================================= */}
        <section
          style={{
            textAlign: 'center',
            maxWidth: 780,
            margin: '0 auto 62px',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 999,
              background:
                'rgba(138,77,255,.08)',
              border:
                '1px solid rgba(138,77,255,.20)',
              color:
                'rgba(196,181,253,.86)',
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
                boxShadow:
                  '0 0 8px rgba(138,77,255,.85)',
                animation:
                  'pricingPulse 2.4s ease-in-out infinite',
              }}
            />

            Early Access Pricing
          </div>

          <h1
            style={{
              margin: '0 0 20px',
              fontSize:
                'clamp(38px, 6vw, 62px)',
              lineHeight: 1.02,
              letterSpacing: '-.052em',
              fontWeight: 650,
              color: '#F5F7FA',
            }}
          >
            Start small.
            <br />

            <span
              style={{
                background:
                  'linear-gradient(90deg, #A78BFA, #8A4DFF 48%, #5677FF)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor:
                  'transparent',
                backgroundClip: 'text',
              }}
            >
              Expand as you connect more.
            </span>
          </h1>

          <p
            style={{
              maxWidth: 650,
              margin: '0 auto',
              fontSize: 15,
              lineHeight: 1.75,
              color:
                'rgba(226,232,240,.60)',
            }}
          >
            BrainBase grows with your operation.
            Begin with the tools you need today,
            then introduce more workflows,
            automation and intelligence as your
            business develops.
          </p>
        </section>

        {/* ================================================================
            PRICING CARDS
        ================================================================= */}
        <section
          style={{
            marginBottom: 30,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 14,
              alignItems: 'stretch',
            }}
          >
            {PLANS.map(plan => (
              <div
                key={plan.name}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 530,
                  padding: '32px 28px 28px',
                  borderRadius: 18,
                  overflow: 'hidden',

                  background: plan.popular
                    ? 'linear-gradient(160deg, rgba(34,197,94,.065), rgba(255,255,255,.022) 45%, rgba(138,77,255,.025))'
                    : 'rgba(255,255,255,.018)',

                  border: plan.popular
                    ? '1px solid rgba(34,197,94,.27)'
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
                    width: 100,
                    height: 1,
                    background: `linear-gradient(90deg, ${plan.color}, transparent)`,
                  }}
                />

                {plan.popular && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 18,
                      top: 18,
                      padding: '5px 9px',
                      borderRadius: 999,
                      fontSize: 9,
                      fontWeight: 750,
                      letterSpacing: '.10em',
                      textTransform: 'uppercase',
                      color: '#86EFAC',
                      background:
                        'rgba(34,197,94,.10)',
                      border:
                        '1px solid rgba(34,197,94,.22)',
                    }}
                  >
                    Most Popular
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

                <h2
                  style={{
                    margin: '0 0 10px',
                    paddingRight:
                      plan.popular
                        ? 90
                        : 0,
                    minHeight: 52,
                    fontSize: 21,
                    lineHeight: 1.22,
                    fontWeight: 650,
                    letterSpacing: '-.025em',
                    color: '#F5F7FA',
                  }}
                >
                  {plan.tagline}
                </h2>

                <p
                  style={{
                    margin: '0 0 28px',
                    minHeight: 68,
                    fontSize: 12,
                    lineHeight: 1.65,
                    color:
                      'rgba(226,232,240,.48)',
                  }}
                >
                  {plan.description}
                </p>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 5,
                    marginBottom: 7,
                  }}
                >
                  <span
                    style={{
                      fontSize: 44,
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
                      color:
                        'rgba(226,232,240,.38)',
                    }}
                  >
                    / month
                  </span>
                </div>

                <div
                  style={{
                    fontSize: 10,
                    color:
                      'rgba(226,232,240,.30)',
                    marginBottom: 26,
                  }}
                >
                  Platform subscription
                </div>

                <div
                  style={{
                    height: 1,
                    background:
                      'rgba(255,255,255,.06)',
                    marginBottom: 24,
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
                        alignItems:
                          'flex-start',
                        gap: 10,
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
                          alignItems:
                            'center',
                          justifyContent:
                            'center',
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
                            stroke={
                              plan.color
                            }
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
                          color:
                            'rgba(226,232,240,.62)',
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
                    justifyContent:
                      'center',
                    borderRadius: 9,
                    boxSizing:
                      'border-box',
                    textDecoration:
                      'none',
                    fontSize: 12,
                    fontWeight: 650,

                    color: plan.popular
                      ? '#FFFFFF'
                      : '#F5F7FA',

                    background: plan.popular
                      ? 'linear-gradient(100deg, #16A34A, #22C55E)'
                      : 'rgba(255,255,255,.035)',

                    border: plan.popular
                      ? '1px solid rgba(74,222,128,.30)'
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

        {/* ================================================================
            SETUP / IMPLEMENTATION NOTICE
        ================================================================= */}
        <section
          style={{
            maxWidth: 860,
            margin: '0 auto 100px',
            padding: '22px 26px',
            borderRadius: 13,
            background:
              'linear-gradient(135deg, rgba(138,77,255,.04), rgba(255,255,255,.014))',
            border:
              '1px solid rgba(138,77,255,.12)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 650,
              color:
                'rgba(196,181,253,.82)',
              marginBottom: 7,
            }}
          >
            One-off setup may apply
          </div>

          <p
            style={{
              margin: '0 auto 8px',
              maxWidth: 720,
              fontSize: 12,
              lineHeight: 1.7,
              color:
                'rgba(226,232,240,.54)',
            }}
          >
            Monthly pricing covers the BrainBase
            platform subscription. Initial setup,
            configuration, data migration, website
            work and custom integrations may incur
            a separate one-off implementation fee
            depending on your requirements.
          </p>

          <p
            style={{
              margin: 0,
              fontSize: 10,
              lineHeight: 1.6,
              color:
                'rgba(226,232,240,.28)',
            }}
          >
            Any implementation costs will be
            discussed and quoted before work
            begins.
          </p>
        </section>

        {/* ================================================================
            WHICH PLAN
        ================================================================= */}
        <section
          style={{
            marginBottom: 100,
          }}
        >
          <SectionHeading
            eyebrow="Choosing a plan"
            title="Start where your operation is today."
            description="You do not need to deploy everything at once. BrainBase can begin with a focused operational need and expand as the value becomes clear."
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 12,
            }}
          >
            <ChoiceCard
              number="01"
              title="Choose Foundation"
              body="You mainly need to organise leads, clients and scheduling and create one reliable operational workspace."
              color="#8A4DFF"
            />

            <ChoiceCard
              number="02"
              title="Choose Operations"
              body="You want the system to actively connect your daily workflows, follow-up, visibility and reporting."
              color="#22C55E"
            />

            <ChoiceCard
              number="03"
              title="Choose Business System"
              body="You are ready for deeper reporting, integrations and HLNΛ intelligence across a more connected operation."
              color="#A78BFA"
            />
          </div>
        </section>

        {/* ================================================================
            COMPARISON
        ================================================================= */}
        <section
          style={{
            marginBottom: 100,
          }}
        >
          <SectionHeading
            eyebrow="Compare"
            title="What is included?"
            description="A simple view of how capability expands as you move through the BrainBase platform."
          />

          <div
            className="pricing-table-wrap"
            style={{
              borderRadius: 16,
              border:
                '1px solid rgba(255,255,255,.07)',
              background:
                'rgba(255,255,255,.014)',
            }}
          >
            <div
              style={{
                minWidth: 680,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    '1.7fr repeat(3, 1fr)',
                  borderBottom:
                    '1px solid rgba(255,255,255,.07)',
                  background:
                    'rgba(255,255,255,.018)',
                }}
              >
                <div
                  style={{
                    padding:
                      '17px 20px',
                    fontSize: 10,
                    fontWeight: 650,
                    textTransform:
                      'uppercase',
                    letterSpacing:
                      '.10em',
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
                      padding:
                        '17px 14px',
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
                        '1.7fr repeat(3, 1fr)',

                      borderBottom:
                        index ===
                        COMPARISON.length -
                          1
                          ? 'none'
                          : '1px solid rgba(255,255,255,.05)',
                    }}
                  >
                    <div
                      style={{
                        padding:
                          '15px 20px',
                        fontSize: 12,
                        color:
                          'rgba(226,232,240,.57)',
                      }}
                    >
                      {row.feature}
                    </div>

                    <ComparisonCell
                      available={
                        row.foundation
                      }
                      color="#8A4DFF"
                    />

                    <ComparisonCell
                      available={
                        row.operations
                      }
                      color="#22C55E"
                    />

                    <ComparisonCell
                      available={
                        row.business
                      }
                      color="#A78BFA"
                    />
                  </div>
                ),
              )}
            </div>
          </div>
        </section>

        {/* ================================================================
            IMPLEMENTATION
        ================================================================= */}
        <section
          style={{
            marginBottom: 100,
          }}
        >
          <SectionHeading
            eyebrow="Implementation"
            title="Some businesses need more than a subscription."
            description="Implementation depends on what you want connected, how much configuration is required and what systems or information you already have in place."
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12,
            }}
          >
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
                      letterSpacing:
                        '.10em',
                      color:
                        'rgba(167,139,250,.55)',
                      marginBottom: 18,
                    }}
                  >
                    0{index + 1}
                  </div>

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
              Simple deployments may require
              little or no additional setup.
              More complex deployments involving
              migration, workflow configuration,
              integrations or website work will
              be scoped and quoted before
              commencement.
            </p>
          </div>
        </section>

        {/* ================================================================
            WEB SYSTEMS
        ================================================================= */}
        <section
          style={{
            marginBottom: 100,
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
                textTransform:
                  'uppercase',
                letterSpacing: '.12em',
                color:
                  'rgba(167,139,250,.67)',
                marginBottom: 12,
              }}
            >
              Need a website too?
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
              Your website can become part of
              the system.
            </h2>

            <p
              style={{
                margin: 0,
                maxWidth: 510,
                fontSize: 13,
                lineHeight: 1.7,
                color:
                  'rgba(226,232,240,.55)',
              }}
            >
              BrainBase Web Systems can connect
              your public website directly to
              lead capture, client workflows,
              bookings and the operational
              platform behind your business.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent:
                'flex-end',
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

        {/* ================================================================
            FINAL CTA
        ================================================================= */}
        <section
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
              transform:
                'translateX(-50%)',
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(138,77,255,.14), transparent 68%)',
            }}
          />

          <div
            style={{
              position: 'relative',
              maxWidth: 630,
              margin: '0 auto',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 650,
                textTransform:
                  'uppercase',
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
                margin:
                  '0 auto 27px',
                maxWidth: 520,
                fontSize: 14,
                lineHeight: 1.7,
                color:
                  'rgba(226,232,240,.58)',
              }}
            >
              Tell us what you are trying to
              organise, improve or automate.
              We&apos;ll help identify the right
              place to begin.
            </p>

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
              Talk to BrainBase →
            </Link>
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
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            padding: '26px 32px',
            display: 'flex',
            justifyContent:
              'space-between',
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
            © 2026 BrainBase
          </span>

          <div
            style={{
              display: 'flex',
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
          </div>
        </div>
      </footer>
    </main>
  );
}

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
        maxWidth: 650,
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
        padding: '15px 14px',
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
'use client'

import { useState } from 'react'
import {
  Check,
  ChevronDown,
  Zap,
  Shield,
  BarChart3,
  Clock,
  Lock,
  Server,
  ArrowRight,
  Sparkles,
  TrendingUp,
  FileText,
  Brain,
  Database,
  Users,
  Globe,
  CheckCircle2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PricingTier {
  name: string
  price: string
  period: string
  annualPrice?: string
  description: string
  features: string[]
  cta: string
  highlighted: boolean
  badge?: string
}

interface Addon {
  name: string
  price: string
  description: string
}

interface Metric {
  icon: React.ReactNode
  value: string
  label: string
  sub: string
}

interface Step {
  number: string
  icon: React.ReactNode
  title: string
  description: string
}

interface TrustItem {
  icon: React.ReactNode
  title: string
  description: string
}

interface FAQ {
  question: string
  answer: string
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const tiers: PricingTier[] = [
  {
    name: 'Pilot',
    price: '$500',
    period: '/month',
    annualPrice: '$450',
    description: 'Structured entry point for councils exploring AI-assisted decision workflows.',
    features: [
      'HLNA Decision Intelligence (read-only mode)',
      'Up to 3 active modules',
      '5 user seats',
      'Pre-built dashboard templates',
      'Email support (48h SLA)',
      'Monthly briefing reports',
      'Standard data connectors',
    ],
    cta: 'Start Pilot',
    highlighted: false,
  },
  {
    name: 'Core',
    price: '$1,800',
    period: '/month',
    annualPrice: '$1,620',
    description: 'Full decision intelligence suite for operational councils ready to move fast.',
    features: [
      'HLNA full interactive mode',
      'Unlimited modules',
      '25 user seats',
      'Custom dashboards + white-label',
      'Priority support (4h SLA)',
      'Weekly briefings + what-changed summaries',
      'Advanced data connectors (API, CSV, DB)',
      'Role-based access control',
      'Audit trail + version history',
    ],
    cta: 'Start with Core',
    highlighted: true,
    badge: 'Most Popular',
  },
  {
    name: 'Enterprise',
    price: '$6,000+',
    period: '/month',
    annualPrice: '$5,400+',
    description: 'Bespoke deployments for large councils and multi-region government bodies.',
    features: [
      'Everything in Core',
      'Dedicated HLNA instance',
      'Unlimited seats',
      'On-premise or private cloud option',
      'Dedicated success manager',
      'Custom integrations & SLAs',
      'Compliance-ready (SOC 2, ISO 27001)',
      'Executive briefing cadence',
      'Data residency options',
    ],
    cta: 'Contact Sales',
    highlighted: false,
  },
]

const addons: Addon[] = [
  {
    name: 'Additional Seats',
    price: '$45/seat/month',
    description: "Scale user access beyond your tier's included seats.",
  },
  {
    name: 'Custom Module Development',
    price: '$2,000 – $8,000',
    description: "Purpose-built intelligence modules tailored to your council's workflows.",
  },
  {
    name: 'Data Integration Services',
    price: '$1,500 – $5,000',
    description: 'Professional services to connect proprietary data sources and legacy systems.',
  },
  {
    name: 'Executive Briefing Package',
    price: '$800/month',
    description: 'Dedicated weekly HLNA briefings formatted for C-suite and board-level review.',
  },
  {
    name: 'Training & Onboarding',
    price: '$3,500 one-time',
    description: 'Full onboarding for your team including live sessions and documentation.',
  },
  {
    name: 'Enhanced SLA',
    price: '$1,200/month',
    description: '1-hour response SLA with 99.99% uptime guarantee and dedicated on-call engineer.',
  },
]

const metrics: Metric[] = [
  {
    icon: <Clock size={22} />,
    value: '14hrs',
    label: 'Saved per council session',
    sub: 'Average across 12 pilot deployments',
  },
  {
    icon: <TrendingUp size={22} />,
    value: '3.2×',
    label: 'Faster decision turnaround',
    sub: 'From brief to resolution',
  },
  {
    icon: <BarChart3 size={22} />,
    value: '68%',
    label: 'Reduction in report preparation',
    sub: 'Automated via HLNA briefing layer',
  },
  {
    icon: <Shield size={22} />,
    value: '94%',
    label: 'Risk flag accuracy',
    sub: 'Validated against post-decision outcomes',
  },
]

const steps: Step[] = [
  {
    number: '01',
    icon: <Database size={20} />,
    title: 'Connect Your Data',
    description: 'Plug in your existing sources — council systems, reports, spreadsheets, or APIs. HLNA ingests and normalises everything in minutes.',
  },
  {
    number: '02',
    icon: <Brain size={20} />,
    title: 'HLNA Analyses & Briefs',
    description: 'Our decision intelligence engine processes your data, surfaces risks, flags changes, and prepares structured briefings aligned to your agenda.',
  },
  {
    number: '03',
    icon: <FileText size={20} />,
    title: 'Decisions, Delivered',
    description: 'Leadership receives clean, confidence-graded recommendations. Audit trails and version history keep every decision accountable.',
  },
]

const trust: TrustItem[] = [
  {
    icon: <Shield size={20} />,
    title: 'SOC 2 Type II',
    description: 'Independently audited security controls across availability, confidentiality, and processing integrity.',
  },
  {
    icon: <Lock size={20} />,
    title: 'End-to-End Encryption',
    description: 'All data encrypted in transit (TLS 1.3) and at rest (AES-256). Zero access by Brainbase staff to council data.',
  },
  {
    icon: <Server size={20} />,
    title: 'Private Deployment Options',
    description: 'Run HLNA inside your own cloud environment or on-premise. We support AWS, Azure, GCP, and private data centres.',
  },
  {
    icon: <Globe size={20} />,
    title: 'Data Residency',
    description: 'Choose where your data lives. Full compliance with GDPR, Australian Privacy Act, and sector-specific requirements.',
  },
]

const faqs: FAQ[] = [
  {
    question: 'How long does onboarding take?',
    answer: 'Most councils are fully operational within 2–3 weeks. The Pilot tier can go live in as little as 5 business days with standard data connectors. Enterprise deployments with custom integrations typically take 4–6 weeks.',
  },
  {
    question: 'Can we migrate from Pilot to Core mid-cycle?',
    answer: 'Yes. You can upgrade at any time and we\'ll prorate the difference. There\'s no lock-in at the Pilot tier — the upgrade path is designed to be frictionless.',
  },
  {
    question: 'Does HLNA train on our council\'s data?',
    answer: 'No. Your data is never used to train shared models. HLNA operates on isolated inference — your council\'s data stays within your environment and is only used to serve your queries.',
  },
  {
    question: 'What data sources does HLNA connect to?',
    answer: 'HLNA supports REST APIs, CSV/Excel uploads, PostgreSQL, MySQL, SharePoint, Google Workspace, and several council-specific management systems. Custom connectors are available on Core and Enterprise.',
  },
  {
    question: 'Is there a minimum contract length?',
    answer: 'Pilot is month-to-month with no lock-in. Core and Enterprise are available on monthly or annual billing — annual saves 10% and includes priority onboarding.',
  },
  {
    question: 'How is HLNA different from generic AI tools?',
    answer: 'HLNA is purpose-built for council and government decision workflows. It understands agenda structures, regulatory context, and the specific cadence of council operations — not a general chatbot retrofitted to the public sector.',
  },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function BillingToggle({ annual, onChange }: { annual: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'center' }}>
      <span style={{ color: !annual ? '#F4F4F5' : '#52525B', fontSize: '14px', fontWeight: 500, transition: 'color .2s' }}>
        Monthly
      </span>
      <button
        onClick={() => onChange(!annual)}
        style={{
          width: '48px',
          height: '26px',
          borderRadius: '13px',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          background: annual ? 'linear-gradient(135deg, #6D28D9, #7C3AED)' : 'rgba(255,255,255,0.1)',
          transition: 'background .25s',
          flexShrink: 0,
        }}
        aria-label="Toggle billing period"
      >
        <span
          style={{
            position: 'absolute',
            top: '3px',
            left: annual ? '25px' : '3px',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: '#fff',
            transition: 'left .25s cubic-bezier(.4,0,.2,1)',
          }}
        />
      </button>
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: annual ? '#F4F4F5' : '#52525B', fontSize: '14px', fontWeight: 500, transition: 'color .2s' }}>
          Annual
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: '20px',
            background: 'rgba(109, 40, 217, 0.25)',
            color: '#C4B5FD',
            border: '1px solid rgba(124, 58, 237, 0.3)',
            letterSpacing: '0.04em',
          }}
        >
          SAVE 10%
        </span>
      </span>
    </div>
  )
}

function PricingCard({ tier, annual }: { tier: PricingTier; annual: boolean }) {
  const [hovered, setHovered] = useState(false)

  const price = annual && tier.annualPrice ? tier.annualPrice : tier.price

  const cardStyle: React.CSSProperties = tier.highlighted
    ? {
        position: 'relative',
        borderRadius: '20px',
        padding: '2px',
        background: 'linear-gradient(135deg, rgba(109,40,217,0.8) 0%, rgba(124,58,237,0.5) 50%, rgba(167,139,250,0.3) 100%)',
        boxShadow: hovered
          ? '0 0 60px rgba(124,58,237,0.3), 0 20px 60px rgba(0,0,0,0.5)'
          : '0 0 40px rgba(124,58,237,0.18), 0 20px 40px rgba(0,0,0,0.4)',
        transform: hovered ? 'translateY(-6px) scale(1.01)' : 'translateY(-2px)',
        transition: 'all .25s cubic-bezier(.4,0,.2,1)',
        zIndex: 2,
      }
    : {
        position: 'relative',
        borderRadius: '20px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: hovered
          ? '0 20px 60px rgba(0,0,0,0.5)'
          : '0 4px 24px rgba(0,0,0,0.3)',
        transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'all .25s cubic-bezier(.4,0,.2,1)',
      }

  const innerStyle: React.CSSProperties = tier.highlighted
    ? {
        borderRadius: '18px',
        background: 'linear-gradient(160deg, #12121C 0%, #0D0D15 60%, #0f0a1a 100%)',
        padding: '36px 32px 32px',
        height: '100%',
      }
    : {
        padding: '36px 32px 32px',
        height: '100%',
      }

  return (
    <div
      style={cardStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={innerStyle}>
        {tier.badge && (
          <div style={{ marginBottom: '20px' }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                padding: '4px 12px',
                borderRadius: '20px',
                background: 'linear-gradient(135deg, rgba(109,40,217,0.4), rgba(124,58,237,0.2))',
                border: '1px solid rgba(167,139,250,0.4)',
                color: '#C4B5FD',
                textTransform: 'uppercase',
              }}
            >
              {tier.badge}
            </span>
          </div>
        )}

        <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3
            style={{
              fontSize: '20px',
              fontWeight: 600,
              color: tier.highlighted ? '#E9D5FF' : '#F4F4F5',
              margin: 0,
            }}
          >
            {tier.name}
          </h3>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            <span
              style={{
                fontSize: '42px',
                fontWeight: 700,
                color: tier.highlighted ? '#E9D5FF' : '#F4F4F5',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {price}
            </span>
            <span style={{ fontSize: '14px', color: '#52525B', fontWeight: 400 }}>
              {tier.period}
            </span>
          </div>
          {annual && tier.annualPrice && (
            <p style={{ fontSize: '12px', color: '#A1A1AA', margin: '4px 0 0' }}>
              Billed annually · save 10%
            </p>
          )}
        </div>

        <p
          style={{
            fontSize: '14px',
            color: '#A1A1AA',
            lineHeight: 1.6,
            marginBottom: '28px',
            minHeight: '48px',
          }}
        >
          {tier.description}
        </p>

        <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', marginBottom: '24px' }} />

        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {tier.features.map((feature) => (
            <li key={feature} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <CheckCircle2
                size={16}
                style={{
                  color: tier.highlighted ? '#A78BFA' : '#6D28D9',
                  flexShrink: 0,
                  marginTop: '2px',
                }}
              />
              <span style={{ fontSize: '14px', color: '#A1A1AA', lineHeight: 1.5 }}>{feature}</span>
            </li>
          ))}
        </ul>

        <button
          style={{
            width: '100%',
            padding: '14px 24px',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            letterSpacing: '0.02em',
            transition: 'all .2s',
            background: tier.highlighted
              ? 'linear-gradient(135deg, #6D28D9, #7C3AED)'
              : 'rgba(255,255,255,0.06)',
            color: tier.highlighted ? '#fff' : '#C4B5FD',
            border: tier.highlighted ? 'none' : '1px solid rgba(109,40,217,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
          onMouseEnter={(e) => {
            if (tier.highlighted) {
              (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #7C3AED, #8B5CF6)'
            } else {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(109,40,217,0.15)'
            }
          }}
          onMouseLeave={(e) => {
            if (tier.highlighted) {
              (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #6D28D9, #7C3AED)'
            } else {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'
            }
          }}
        >
          {tier.cta}
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

function FAQItem({ faq }: { faq: FAQ }) {
  const [open, setOpen] = useState(false)

  return (
    <div
      style={{
        borderRadius: '14px',
        background: open ? 'rgba(109,40,217,0.06)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${open ? 'rgba(109,40,217,0.25)' : 'rgba(255,255,255,0.06)'}`,
        overflow: 'hidden',
        transition: 'all .2s',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          padding: '20px 24px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '15px', fontWeight: 500, color: '#F4F4F5', lineHeight: 1.4 }}>
          {faq.question}
        </span>
        <ChevronDown
          size={18}
          style={{
            color: '#6D28D9',
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform .25s cubic-bezier(.4,0,.2,1)',
          }}
        />
      </button>
      <div
        style={{
          maxHeight: open ? '300px' : '0',
          overflow: 'hidden',
          transition: 'max-height .3s cubic-bezier(.4,0,.2,1)',
        }}
      >
        <p
          style={{
            padding: '0 24px 20px',
            fontSize: '14px',
            color: '#A1A1AA',
            lineHeight: 1.7,
            margin: 0,
          }}
        >
          {faq.answer}
        </p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [annual, setAnnual] = useState(false)

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#08090C',
        fontFamily: 'var(--font-geist-sans), var(--font-inter), system-ui, sans-serif',
        color: '#F4F4F5',
        overflowX: 'hidden',
      }}
    >
      {/* Ambient background blobs */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '-200px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '900px',
            height: '600px',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(109,40,217,0.12) 0%, transparent 70%)',
            filter: 'blur(40px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '40%',
            right: '-300px',
            width: '700px',
            height: '700px',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(79,27,175,0.08) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section style={{ padding: '100px 24px 80px', textAlign: 'center', maxWidth: '860px', margin: '0 auto' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: 'rgba(109,40,217,0.15)',
              border: '1px solid rgba(109,40,217,0.3)',
              marginBottom: '32px',
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: '#C4B5FD',
              textTransform: 'uppercase',
            }}
          >
            <Sparkles size={12} />
            HLNA Decision Intelligence
          </div>

          <h1
            style={{
              fontSize: 'clamp(36px, 5vw, 62px)',
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              marginBottom: '24px',
              color: '#F4F4F5',
            }}
          >
            AI Decision Intelligence
            <br />
            <span
              style={{
                background: 'linear-gradient(135deg, #A78BFA 0%, #7C3AED 50%, #C4B5FD 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              for Council Operations
            </span>
          </h1>

          <p
            style={{
              fontSize: '18px',
              color: '#A1A1AA',
              lineHeight: 1.7,
              maxWidth: '600px',
              margin: '0 auto 48px',
            }}
          >
            HLNA synthesises your council's data into structured, confidence-graded briefings — so leadership spends less time on preparation and more time on decisions that matter.
          </p>

          <BillingToggle annual={annual} onChange={setAnnual} />
        </section>

        {/* ── Pricing Cards ───────────────────────────────────────────────── */}
        <section style={{ padding: '0 24px 100px', maxWidth: '1200px', margin: '0 auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '24px',
              alignItems: 'start',
            }}
          >
            {tiers.map((tier) => (
              <PricingCard key={tier.name} tier={tier} annual={annual} />
            ))}
          </div>

          <p
            style={{
              textAlign: 'center',
              marginTop: '32px',
              fontSize: '13px',
              color: '#52525B',
            }}
          >
            All plans include 14-day free trial · No credit card required
          </p>
        </section>

        {/* ── Add-ons ─────────────────────────────────────────────────────── */}
        <section style={{ padding: '80px 24px', maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <h2
              style={{
                fontSize: 'clamp(26px, 3vw, 40px)',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                marginBottom: '12px',
              }}
            >
              Add-ons & Extensions
            </h2>
            <p style={{ fontSize: '16px', color: '#A1A1AA' }}>
              Extend your plan with professional services and enhanced capabilities.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '16px',
            }}
          >
            {addons.map((addon) => (
              <div
                key={addon.name}
                style={{
                  padding: '24px',
                  borderRadius: '16px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  transition: 'border-color .2s, background .2s',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement
                  el.style.borderColor = 'rgba(109,40,217,0.25)'
                  el.style.background = 'rgba(109,40,217,0.04)'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement
                  el.style.borderColor = 'rgba(255,255,255,0.06)'
                  el.style.background = 'rgba(255,255,255,0.02)'
                }}
              >
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 600,
                    color: '#C4B5FD',
                    marginBottom: '6px',
                  }}
                >
                  {addon.price}
                </div>
                <div style={{ fontSize: '15px', fontWeight: 500, color: '#F4F4F5', marginBottom: '8px' }}>
                  {addon.name}
                </div>
                <div style={{ fontSize: '13px', color: '#52525B', lineHeight: 1.5 }}>
                  {addon.description}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── ROI Metrics ─────────────────────────────────────────────────── */}
        <section
          style={{
            padding: '80px 24px',
            background: 'rgba(109,40,217,0.04)',
            borderTop: '1px solid rgba(109,40,217,0.1)',
            borderBottom: '1px solid rgba(109,40,217,0.1)',
          }}
        >
          <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: '56px' }}>
              <h2
                style={{
                  fontSize: 'clamp(26px, 3vw, 40px)',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  marginBottom: '12px',
                }}
              >
                Measurable Impact
              </h2>
              <p style={{ fontSize: '16px', color: '#A1A1AA' }}>
                Outcomes from councils currently running HLNA in production.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '24px',
              }}
            >
              {metrics.map((metric) => (
                <div
                  key={metric.label}
                  style={{
                    textAlign: 'center',
                    padding: '36px 24px',
                    borderRadius: '16px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '48px',
                      height: '48px',
                      borderRadius: '14px',
                      background: 'rgba(109,40,217,0.15)',
                      color: '#A78BFA',
                      marginBottom: '20px',
                    }}
                  >
                    {metric.icon}
                  </div>
                  <div
                    style={{
                      fontSize: '42px',
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                      color: '#E9D5FF',
                      lineHeight: 1,
                      marginBottom: '8px',
                    }}
                  >
                    {metric.value}
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 500, color: '#F4F4F5', marginBottom: '6px' }}>
                    {metric.label}
                  </div>
                  <div style={{ fontSize: '12px', color: '#52525B' }}>{metric.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ────────────────────────────────────────────────── */}
        <section style={{ padding: '100px 24px', maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '64px' }}>
            <h2
              style={{
                fontSize: 'clamp(26px, 3vw, 40px)',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                marginBottom: '12px',
              }}
            >
              Up and running in days,
              <br />
              <span style={{ color: '#A78BFA' }}>not months</span>
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '24px',
              position: 'relative',
            }}
          >
            {steps.map((step, i) => (
              <div
                key={step.title}
                style={{
                  padding: '36px 32px',
                  borderRadius: '20px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    color: '#4B2D8F',
                    marginBottom: '20px',
                    textTransform: 'uppercase',
                  }}
                >
                  {step.number}
                </div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    background: 'rgba(109,40,217,0.15)',
                    color: '#A78BFA',
                    marginBottom: '20px',
                  }}
                >
                  {step.icon}
                </div>
                <h3
                  style={{
                    fontSize: '18px',
                    fontWeight: 600,
                    color: '#F4F4F5',
                    marginBottom: '12px',
                  }}
                >
                  {step.title}
                </h3>
                <p style={{ fontSize: '14px', color: '#A1A1AA', lineHeight: 1.7, margin: 0 }}>
                  {step.description}
                </p>

                {i < steps.length - 1 && (
                  <div
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: '50%',
                      right: '-13px',
                      width: '24px',
                      height: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#4B2D8F',
                      zIndex: 2,
                    }}
                  >
                    <ArrowRight size={16} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Trust & Security ────────────────────────────────────────────── */}
        <section
          style={{
            padding: '80px 24px',
            background: 'linear-gradient(180deg, transparent, rgba(109,40,217,0.04) 50%, transparent)',
          }}
        >
          <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: '56px' }}>
              <h2
                style={{
                  fontSize: 'clamp(26px, 3vw, 40px)',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  marginBottom: '12px',
                }}
              >
                Enterprise-grade security
              </h2>
              <p style={{ fontSize: '16px', color: '#A1A1AA' }}>
                Built for the security standards that government and regulated sectors demand.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '20px',
              }}
            >
              {trust.map((item) => (
                <div
                  key={item.title}
                  style={{
                    padding: '28px 24px',
                    borderRadius: '16px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(109,40,217,0.12)',
                      color: '#A78BFA',
                    }}
                  >
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#F4F4F5', marginBottom: '6px' }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: '13px', color: '#52525B', lineHeight: 1.6 }}>
                      {item.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Compliance badges */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                justifyContent: 'center',
                marginTop: '40px',
              }}
            >
              {['SOC 2 Type II', 'ISO 27001', 'GDPR Compliant', 'Australian Privacy Act', '99.9% Uptime SLA'].map((badge) => (
                <span
                  key={badge}
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    padding: '6px 14px',
                    borderRadius: '20px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#A1A1AA',
                  }}
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        <section style={{ padding: '80px 24px 100px', maxWidth: '760px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <h2
              style={{
                fontSize: 'clamp(26px, 3vw, 40px)',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                marginBottom: '12px',
              }}
            >
              Frequently asked
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {faqs.map((faq) => (
              <FAQItem key={faq.question} faq={faq} />
            ))}
          </div>
        </section>

        {/* ── Final CTA ───────────────────────────────────────────────────── */}
        <section style={{ padding: '80px 24px 120px' }}>
          <div
            style={{
              maxWidth: '900px',
              margin: '0 auto',
              textAlign: 'center',
              padding: '72px 48px',
              borderRadius: '24px',
              background: 'linear-gradient(160deg, rgba(109,40,217,0.12) 0%, rgba(17,17,30,0.8) 60%)',
              border: '1px solid rgba(109,40,217,0.2)',
              boxShadow: '0 0 80px rgba(109,40,217,0.08)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Inner glow */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                top: '-100px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '600px',
                height: '300px',
                borderRadius: '50%',
                background: 'radial-gradient(ellipse, rgba(109,40,217,0.15) 0%, transparent 70%)',
                filter: 'blur(30px)',
              }}
            />

            <div style={{ position: 'relative' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 14px',
                  borderRadius: '20px',
                  background: 'rgba(109,40,217,0.2)',
                  border: '1px solid rgba(109,40,217,0.35)',
                  marginBottom: '28px',
                  fontSize: '12px',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  color: '#C4B5FD',
                  textTransform: 'uppercase',
                }}
              >
                <Zap size={12} />
                Ready when you are
              </div>

              <h2
                style={{
                  fontSize: 'clamp(28px, 4vw, 50px)',
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.1,
                  marginBottom: '20px',
                }}
              >
                Your council's intelligence layer
                <br />
                <span
                  style={{
                    background: 'linear-gradient(135deg, #A78BFA, #C4B5FD)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  starts here.
                </span>
              </h2>

              <p
                style={{
                  fontSize: '17px',
                  color: '#A1A1AA',
                  lineHeight: 1.7,
                  maxWidth: '520px',
                  margin: '0 auto 40px',
                }}
              >
                Join councils already using HLNA to compress decision cycles, surface risk earlier, and brief leadership with confidence.
              </p>

              <div
                style={{
                  display: 'flex',
                  gap: '14px',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  style={{
                    padding: '16px 36px',
                    borderRadius: '14px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '15px',
                    fontWeight: 600,
                    background: 'linear-gradient(135deg, #6D28D9, #7C3AED)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'opacity .2s, transform .2s',
                    letterSpacing: '0.01em',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = '0.9'
                    ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = '1'
                    ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'
                  }}
                >
                  Start free trial
                  <ArrowRight size={15} />
                </button>

                <button
                  style={{
                    padding: '16px 36px',
                    borderRadius: '14px',
                    cursor: 'pointer',
                    fontSize: '15px',
                    fontWeight: 600,
                    background: 'rgba(255,255,255,0.04)',
                    color: '#C4B5FD',
                    border: '1px solid rgba(109,40,217,0.3)',
                    transition: 'background .2s',
                    letterSpacing: '0.01em',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(109,40,217,0.1)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
                  }}
                >
                  Talk to sales
                </button>
              </div>

              <p style={{ marginTop: '24px', fontSize: '13px', color: '#52525B' }}>
                No credit card · 14-day trial · Cancel anytime
              </p>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}

"use client";

import { useState } from "react";
import Link from "next/link";
import EnquiryModal from "@/components/web-services/EnquiryModal";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#08090C';

const KEYFRAMES = `
  @keyframes pulse    { 0%, 100% { opacity: 1; }   50% { opacity: .4; }              }
  @keyframes heroGlow { 0%, 100% { opacity: .50; }  50% { opacity: .90; }             }
  @keyframes gridFlow { 0% { transform: translateY(0); } 100% { transform: translateY(-50%); } }
`;

// ── Data ───────────────────────────────────────────────────────────────────────

const OUTCOMES = [
  {
    color: '#10B981',
    title: 'Fewer missed enquiries',
    body: 'Every lead captured, automatically routed, and followed up — nothing falls through the cracks.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.72 16z"/>
      </svg>
    ),
  },
  {
    color: '#F59E0B',
    title: 'Automated follow-ups',
    body: 'Prospects hear from you at the right moment without any manual effort — powered by workflow triggers.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    ),
  },
  {
    color: '#6366F1',
    title: 'Clear lead visibility',
    body: 'See exactly who enquired, when, what they need, and where they are in your pipeline — in real time.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    color: '#8B5CF6',
    title: 'Connected business systems',
    body: 'Your website feeds directly into your CRM, booking system, and dashboards — no copy-pasting required.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
    ),
  },
  {
    color: '#38BDF8',
    title: 'Reduced admin overhead',
    body: 'Bookings, enquiries, and client intake handled automatically — your team focuses on delivery.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
  },
  {
    color: '#22C55E',
    title: 'Better customer experience',
    body: 'Fast, modern, and intelligent — your website reflects the quality of your business from the first visit.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    ),
  },
];

const MODULES = [
  {
    color: '#6366F1',
    title: 'Website Design & Development',
    description: 'Modern, responsive websites engineered for performance, conversion, and direct integration with your operational systems.',
    tags: ['Responsive design', 'Landing pages', 'Multi-page sites', 'eCommerce'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18"/><path d="M9 21V9"/>
      </svg>
    ),
  },
  {
    color: '#38BDF8',
    title: 'AI-Powered Website Systems',
    description: 'Transform your website into an intelligent business tool — AI assistants, automated routing, smart lead capture, and HLNΛ integration.',
    tags: ['AI chat', 'Smart lead capture', 'Enquiry routing', 'HLNΛ integrated'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="9" y="2" width="6" height="12" rx="3"/>
        <path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>
      </svg>
    ),
  },
  {
    color: '#8B5CF6',
    title: 'CRM Integrations',
    description: 'Every website enquiry flows directly into your CRM pipeline — contacts created, tagged, and ready for follow-up without manual entry.',
    tags: ['Pipeline sync', 'Auto contacts', 'Deal tracking', 'Lead scoring'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    color: '#10B981',
    title: 'Booking & Scheduling Systems',
    description: 'Live booking functionality embedded directly into your website — connected to your operational calendar and capacity management.',
    tags: ['Live availability', 'Automated confirmations', 'Calendar sync', 'Capacity management'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <path d="M8 14h.01M12 14h.01M16 14h.01"/>
      </svg>
    ),
  },
  {
    color: '#F59E0B',
    title: 'Workflow Automation',
    description: 'Automated triggers that handle follow-ups, notifications, task creation, and operational hand-offs from the moment a form is submitted.',
    tags: ['Email sequences', 'Task automation', 'Notification routing', 'Operational triggers'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    ),
  },
  {
    color: '#A78BFA',
    title: 'Dashboards & Reporting',
    description: 'Website performance, lead volume, conversion metrics, and operational KPIs surfaced in real-time operational dashboards.',
    tags: ['Lead analytics', 'Conversion tracking', 'Traffic reporting', 'Live KPIs'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    color: '#64748B',
    title: 'Hosting & Maintenance',
    description: 'Fully managed hosting infrastructure — backups, updates, security patching, uptime monitoring, and performance management included.',
    tags: ['Managed hosting', 'Security patching', 'Daily backups', 'Uptime monitoring'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="2" y="2" width="20" height="8" rx="2"/>
        <rect x="2" y="14" width="20" height="8" rx="2"/>
        <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
      </svg>
    ),
  },
  {
    color: '#EC4899',
    title: 'Client Portals',
    description: 'Branded portals giving your clients secure visibility into their bookings, invoices, communications, and project progress.',
    tags: ['Secure access', 'Booking history', 'Invoice visibility', 'Document sharing'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
  },
];

const PACKAGES = [
  {
    name: 'Starter Presence',
    overline: 'Foundation',
    tagline: 'A connected website that works while you do.',
    color: '#6366F1',
    cardBg: 'rgba(255,255,255,.025)',
    cardBorder: 'rgba(255,255,255,.08)',
    accentBg: 'rgba(99,102,241,.16)',
    accentBorder: 'rgba(99,102,241,.36)',
    popular: false,
    cta: 'Book Strategy Call',
    includes: [
      'Custom website design & development',
      'Managed hosting & SSL',
      'Contact & enquiry forms',
      'Basic CRM integration',
      'Monthly maintenance & updates',
    ],
    note: 'Ideal for new or early-stage businesses entering the ecosystem.',
  },
  {
    name: 'Growth Operations',
    overline: 'Recommended',
    tagline: 'A fully operational website infrastructure.',
    color: '#10B981',
    cardBg: 'rgba(16,185,129,.04)',
    cardBorder: 'rgba(16,185,129,.24)',
    accentBg: 'rgba(16,185,129,.20)',
    accentBorder: 'rgba(16,185,129,.48)',
    popular: true,
    cta: 'Book Strategy Call',
    includes: [
      'Everything in Starter Presence',
      'Full CRM pipeline integration',
      'Lead automation & follow-ups',
      'Booking system integration',
      'Analytics dashboard',
      'Workflow automations',
    ],
    note: 'Best for growing businesses ready to systematise lead generation.',
  },
  {
    name: 'Full Business System',
    overline: 'Enterprise',
    tagline: 'Complete BrainBase ecosystem deployment.',
    color: '#A78BFA',
    cardBg: 'rgba(255,255,255,.025)',
    cardBorder: 'rgba(99,102,241,.16)',
    accentBg: 'rgba(139,92,246,.18)',
    accentBorder: 'rgba(139,92,246,.40)',
    popular: false,
    cta: 'Request Deployment Review',
    includes: [
      'Everything in Growth Operations',
      'Full BrainBase platform deployment',
      'AI-powered website & HLNΛ integration',
      'Advanced operational dashboards',
      'Custom workflow automations',
      'Client portal infrastructure',
      'Ongoing strategic support',
    ],
    note: 'For businesses building scalable operational infrastructure.',
  },
];

const PROCESS_STEPS = [
  {
    n: '01',
    title: 'Strategy & Operations Review',
    body: 'We map your current workflows, identify friction points, and design the operational architecture your website needs to support.',
    color: '#6366F1',
  },
  {
    n: '02',
    title: 'System Design',
    body: 'Information architecture, integration blueprints, and automation flows planned before a single line of code is written.',
    color: '#8B5CF6',
  },
  {
    n: '03',
    title: 'Website & Infrastructure Build',
    body: 'Your website is built as an operational system — fast, responsive, and engineered to connect with your business layer from day one.',
    color: '#A78BFA',
  },
  {
    n: '04',
    title: 'Automation & Integration',
    body: 'CRM connections, workflow triggers, booking flows, and lead routing configured and tested against your real operational scenarios.',
    color: '#38BDF8',
  },
  {
    n: '05',
    title: 'Deployment & Optimisation',
    body: 'Live deployment with performance monitoring, conversion testing, and operational hand-off to your team with full system documentation.',
    color: '#10B981',
  },
  {
    n: '06',
    title: 'Ongoing Management',
    body: 'Your infrastructure continues to evolve — hosting, updates, new automations, and system expansions as your business grows.',
    color: '#22C55E',
  },
];

const MANAGEMENT_FEATURES = [
  {
    color: '#6366F1',
    title: 'Managed Hosting',
    body: 'Enterprise-grade hosting with automatic scaling, global CDN, and zero-downtime deployments.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>,
  },
  {
    color: '#EC4899',
    title: 'Security Monitoring',
    body: 'Continuous vulnerability scanning, SSL management, and proactive patching keep your infrastructure protected.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>,
  },
  {
    color: '#10B981',
    title: 'Performance Optimisation',
    body: 'Regular performance audits, Core Web Vitals monitoring, and speed optimisations that protect your search ranking.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  },
  {
    color: '#F59E0B',
    title: 'Monthly Updates',
    body: 'Content updates, feature additions, and operational improvements handled as part of your ongoing management plan.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  },
  {
    color: '#38BDF8',
    title: 'Uptime Monitoring',
    body: '24/7 infrastructure monitoring with instant alerting — issues identified and resolved before they impact your business.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  },
  {
    color: '#A78BFA',
    title: 'Operational Support',
    body: 'Direct access to BrainBase infrastructure support — no ticket queues, no outsourced helpdesks.',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  },
];

const LD_TENNIS_FEATURES = [
  { label: 'Coaching website', color: '#10B981', active: true },
  { label: 'Session scheduling', color: '#38BDF8', active: true },
  { label: 'Client management', color: '#6366F1', active: true },
  { label: 'Player & guardian records', color: '#A78BFA', active: true },
  { label: 'Weekly revenue visibility', color: '#22C55E', active: true },
  { label: 'Operational dashboards', color: '#F59E0B', active: true },
  { label: 'Automated follow-ups', color: '#EC4899', active: false },
  { label: 'Client portal', color: '#64748B', active: false },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function WebSystems() {
  const [hoveredOutcome,  setHoveredOutcome]  = useState<number | null>(null);
  const [hoveredModule,   setHoveredModule]   = useState<number | null>(null);
  const [hoveredPackage,  setHoveredPackage]  = useState<number | null>(null);
  const [hoveredStep,     setHoveredStep]     = useState<number | null>(null);
  const [hoveredMgmt,     setHoveredMgmt]     = useState<number | null>(null);
  const [enquiryOpen,     setEnquiryOpen]     = useState(false);
  const [heroPrimaryhov,  setHeroPrimaryHov]  = useState(false);
  const [heroSecHov,      setHeroSecHov]      = useState(false);
  const [ctaPrimaryHov,   setCtaPrimaryHov]   = useState(false);
  const [ctaSecHov,       setCtaSecHov]       = useState(false);

  return (
    <main style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT }}>
      <style>{KEYFRAMES}</style>

      {/* Ambient backdrop */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(99,102,241,.10) 0%, transparent 65%)',
      }} />

      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 32px 96px', position: 'relative', zIndex: 1 }}>

        {/* Back link */}
        <div style={{ paddingTop: 28 }}>
          <Link href="/" style={{
            fontSize: 13, color: 'rgba(255,255,255,.35)', textDecoration: 'none',
            letterSpacing: '.01em', transition: 'color .15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,.60)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,.35)')}>
            ← Back to home
          </Link>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            1. HERO
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ padding: '80px 0 72px', display: 'flex', alignItems: 'center', gap: 64, flexWrap: 'wrap' }}>

          {/* Left — text */}
          <div style={{ flex: '1 1 420px', maxWidth: 580 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 12px', borderRadius: 20, marginBottom: 28,
              background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.20)',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#818CF8', boxShadow: '0 0 6px #818CF8', animation: 'pulse 2.5s ease-in-out infinite' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(129,140,248,.85)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Operational Website Infrastructure</span>
            </div>

            <h1 style={{
              fontSize: 'clamp(36px, 4.5vw, 58px)', fontWeight: 700,
              letterSpacing: '-.03em', lineHeight: 1.06,
              color: '#F1F5F9', margin: '0 0 22px',
            }}>
              Your Website Should<br />
              Operate Like Part Of<br />
              <span style={{
                background: 'linear-gradient(135deg, #818CF8 0%, #A78BFA 55%, #C084FC 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>Your Business</span>
            </h1>

            <p style={{
              fontSize: 17, lineHeight: 1.75, margin: '0 0 36px',
              color: 'rgba(226,232,240,.68)', maxWidth: 480,
            }}>
              We design, build, automate, host, and maintain intelligent website systems
              connected directly to your operations.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={() => setEnquiryOpen(true)}
                onMouseEnter={() => setHeroPrimaryHov(true)}
                onMouseLeave={() => setHeroPrimaryHov(false)}
                style={{
                  padding: '13px 28px', borderRadius: 9, fontSize: 15, fontWeight: 700,
                  background: heroPrimaryhov
                    ? 'linear-gradient(135deg, rgba(99,102,241,.42) 0%, rgba(139,92,246,.32) 100%)'
                    : 'linear-gradient(135deg, rgba(99,102,241,.30) 0%, rgba(139,92,246,.22) 100%)',
                  border: '1px solid rgba(99,102,241,.50)',
                  color: '#F1F5F9', letterSpacing: '.01em', cursor: 'pointer',
                  fontFamily: FONT,
                  boxShadow: heroPrimaryhov
                    ? '0 0 32px rgba(99,102,241,.28), inset 0 1px 0 rgba(255,255,255,.10)'
                    : '0 0 24px rgba(99,102,241,.18), inset 0 1px 0 rgba(255,255,255,.08)',
                  transition: 'all .18s',
                }}>
                Book Strategy Call →
              </button>
              <button
                onClick={() => { document.getElementById('deployments')?.scrollIntoView({ behavior: 'smooth' }); }}
                onMouseEnter={() => setHeroSecHov(true)}
                onMouseLeave={() => setHeroSecHov(false)}
                style={{
                  padding: '13px 24px', borderRadius: 9, fontSize: 14, fontWeight: 600,
                  background: 'transparent',
                  border: heroSecHov ? '1px solid rgba(255,255,255,.22)' : '1px solid rgba(255,255,255,.11)',
                  color: heroSecHov ? 'rgba(226,232,240,.90)' : 'rgba(226,232,240,.65)',
                  cursor: 'pointer', fontFamily: FONT, letterSpacing: '.01em',
                  transition: 'all .15s',
                }}>
                Explore Deployments
              </button>
            </div>

            {/* Trust signals */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 32, flexWrap: 'wrap' }}>
              {[
                { value: 'Live', label: 'LD Tennis deployment' },
                { value: '100%', label: 'Managed infrastructure' },
                { value: 'HLNΛ', label: 'AI integration ready' },
              ].map((stat, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {i > 0 && <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.08)' }} />}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.01em' }}>{stat.value}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.28)', letterSpacing: '.04em' }}>{stat.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — system diagram */}
          <div style={{ flex: '0 1 480px', minWidth: 280, position: 'relative' }}>
            {/* Ambient glow */}
            <div style={{
              position: 'absolute', inset: -40,
              background: 'radial-gradient(circle at 50% 50%, rgba(99,102,241,.14) 0%, transparent 70%)',
              filter: 'blur(30px)',
              animation: 'heroGlow 6s ease-in-out infinite',
              pointerEvents: 'none',
            }} />
            <div style={{
              position: 'relative',
              padding: '28px', borderRadius: 20,
              background: 'rgba(255,255,255,.025)',
              border: '1px solid rgba(99,102,241,.18)',
              boxShadow: '0 0 60px rgba(99,102,241,.08)',
            }}>
              {/* System header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(239,68,68,.50)' }} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(245,158,11,.50)' }} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(16,185,129,.50)' }} />
                <span style={{ marginLeft: 6, fontSize: 10, color: 'rgba(255,255,255,.22)', letterSpacing: '.06em' }}>BRAИНBASE WEBSITE SYSTEM</span>
              </div>

              {/* Central node */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Website layer */}
                <div style={{
                  padding: '12px 16px', borderRadius: 10,
                  background: 'rgba(99,102,241,.10)', border: '1px solid rgba(99,102,241,.28)',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(99,102,241,.20)', border: '1px solid rgba(99,102,241,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#818CF8', flexShrink: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#F5F7FA', marginBottom: 1 }}>Intelligent Website</div>
                    <div style={{ fontSize: 10, color: 'rgba(129,140,248,.60)' }}>Lead capture · Booking · AI workflows</div>
                  </div>
                  <div style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: '#818CF8', boxShadow: '0 0 8px #818CF8' }} />
                </div>

                {/* Connector */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: 1, height: 16, background: 'linear-gradient(180deg, rgba(99,102,241,.50), rgba(139,92,246,.50))' }} />
                </div>

                {/* Integration layer */}
                <div style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  flexWrap: 'wrap',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.30)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Connected To</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[
                      { label: 'CRM', color: '#8B5CF6' },
                      { label: 'Bookings', color: '#10B981' },
                      { label: 'Automation', color: '#F59E0B' },
                      { label: 'Dashboards', color: '#38BDF8' },
                    ].map((item, i) => (
                      <div key={i} style={{
                        fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                        background: `${item.color}12`, border: `1px solid ${item.color}28`,
                        color: item.color, whiteSpace: 'nowrap',
                      }}>{item.label}</div>
                    ))}
                  </div>
                </div>

                {/* Connector */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: 1, height: 16, background: 'linear-gradient(180deg, rgba(139,92,246,.50), rgba(16,185,129,.30))' }} />
                </div>

                {/* HLNA layer */}
                <div style={{
                  padding: '12px 16px', borderRadius: 10,
                  background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.18)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#A78BFA', boxShadow: '0 0 6px #A78BFA', animation: 'pulse 2.5s ease-in-out infinite' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(167,139,250,.80)', letterSpacing: '.08em' }}>HLNΛ</span>
                  </div>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,.28)' }}>Intelligence layer — always on</span>
                </div>
              </div>

              {/* Hosted label */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,.22)', letterSpacing: '.04em' }}>Fully managed infrastructure</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 5px #22C55E', animation: 'pulse 2.5s ease-in-out infinite' }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(34,197,94,.60)' }}>Online</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            2. BUSINESS OUTCOMES
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 80 }}>
          <SectionBridge label="Business Impact · What Changes" color="rgba(99,102,241,.18)" />

          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(129,140,248,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Business Outcomes</div>
            <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 12px' }}>
              What changes when your website operates as infrastructure
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(226,232,240,.48)', margin: '0 auto', maxWidth: 500, lineHeight: 1.65 }}>
              These aren't features. These are the operational improvements that happen when your digital systems are actually connected.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
            {OUTCOMES.map((outcome, i) => {
              const isHov = hoveredOutcome === i;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredOutcome(i)}
                  onMouseLeave={() => setHoveredOutcome(null)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 16,
                    padding: '20px 20px 20px 0', borderRadius: 12,
                    background: isHov ? `rgba(${hexToRgbStr(outcome.color)}, .05)` : 'rgba(255,255,255,.02)',
                    border: isHov ? `1px solid ${outcome.color}28` : '1px solid rgba(255,255,255,.06)',
                    transform: isHov ? 'translateY(-2px)' : 'translateY(0)',
                    transition: 'all .18s', overflow: 'hidden', cursor: 'default',
                  }}>
                  {/* Left accent bar */}
                  <div style={{
                    width: 3, alignSelf: 'stretch', flexShrink: 0, borderRadius: '0 2px 2px 0',
                    background: isHov ? outcome.color : `${outcome.color}40`,
                    transition: 'background .18s',
                  }} />
                  <div style={{
                    width: 34, height: 34, borderRadius: 9, flexShrink: 0, marginTop: 2,
                    background: `${outcome.color}12`, border: `1px solid ${outcome.color}25`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: outcome.color,
                  }}>
                    {outcome.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F7FA', marginBottom: 5, letterSpacing: '-.01em' }}>{outcome.title}</div>
                    <p style={{ fontSize: 13, color: 'rgba(226,232,240,.55)', lineHeight: 1.6, margin: 0 }}>{outcome.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            3. WEBSITE SYSTEMS MODULES
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 80 }}>
          <SectionBridge label="Modular Systems · Operational Layers" color="rgba(139,92,246,.18)" />

          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(167,139,250,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Website Systems</div>
            <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 12px' }}>
              Modular operational layers
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(226,232,240,.48)', margin: '0 auto', maxWidth: 500, lineHeight: 1.65 }}>
              Each system is a modular layer — deployable individually or stacked into a complete operational infrastructure.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: 14 }}>
            {MODULES.map((mod, i) => {
              const isHov = hoveredModule === i;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredModule(i)}
                  onMouseLeave={() => setHoveredModule(null)}
                  style={{
                    padding: '26px 28px', borderRadius: 14, cursor: 'default',
                    background: isHov ? `rgba(${hexToRgbStr(mod.color)}, .06)` : 'rgba(255,255,255,.025)',
                    border: isHov ? `1px solid ${mod.color}30` : '1px solid rgba(255,255,255,.07)',
                    transform: isHov ? 'translateY(-2px)' : 'translateY(0)',
                    transition: 'all .18s', position: 'relative', overflow: 'hidden',
                    boxShadow: isHov ? `0 10px 36px ${mod.color}10` : 'none',
                  }}>
                  {/* Top accent line */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: isHov
                      ? `linear-gradient(90deg, ${mod.color}90, ${mod.color}18)`
                      : `linear-gradient(90deg, ${mod.color}28, transparent)`,
                    transition: 'background .18s', borderRadius: '14px 14px 0 0',
                  }} />
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16, position: 'relative' }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 11, flexShrink: 0,
                      background: `${mod.color}12`, border: `1px solid ${mod.color}25`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: mod.color,
                    }}>
                      {mod.icon}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', margin: '0 0 5px', letterSpacing: '-.01em', lineHeight: 1.2 }}>{mod.title}</h3>
                      <p style={{ fontSize: 13, color: 'rgba(226,232,240,.52)', lineHeight: 1.55, margin: 0 }}>{mod.description}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {mod.tags.map((tag, j) => (
                      <span key={j} style={{
                        fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20,
                        color: isHov ? mod.color : 'rgba(226,232,240,.40)',
                        background: isHov ? `${mod.color}10` : 'rgba(255,255,255,.04)',
                        border: isHov ? `1px solid ${mod.color}22` : '1px solid rgba(255,255,255,.07)',
                        transition: 'all .18s',
                      }}>{tag}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            4. DEPLOYMENT PACKAGES
        ══════════════════════════════════════════════════════════════ */}
        <section id="deployments" style={{ marginBottom: 80 }}>
          <SectionBridge label="Deployment Tiers · Operational Investment" color="rgba(16,185,129,.16)" />

          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(52,211,153,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Deployment Packages</div>
            <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 12px' }}>
              Choose your operational layer
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(226,232,240,.48)', margin: '0 auto', maxWidth: 480, lineHeight: 1.65 }}>
              Each package is a deployment of BrainBase website infrastructure — not a template, not a theme.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {PACKAGES.map((pkg, i) => {
              const isHov = hoveredPackage === i;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredPackage(i)}
                  onMouseLeave={() => setHoveredPackage(null)}
                  style={{
                    padding: '32px 28px', borderRadius: 16, position: 'relative', overflow: 'hidden',
                    background: isHov
                      ? (pkg.popular ? `rgba(${hexToRgbStr(pkg.color)}, .08)` : 'rgba(255,255,255,.04)')
                      : pkg.cardBg,
                    border: `1px solid ${isHov ? pkg.accentBorder : pkg.cardBorder}`,
                    boxShadow: pkg.popular
                      ? `0 0 40px ${pkg.color}10${isHov ? ', 0 20px 60px rgba(0,0,0,.3)' : ''}`
                      : (isHov ? '0 16px 48px rgba(0,0,0,.25)' : 'none'),
                    transform: isHov ? 'translateY(-4px)' : 'translateY(0)',
                    transition: 'all .20s', cursor: 'default',
                  }}>
                  {/* Top glow line */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: `linear-gradient(90deg, ${pkg.color}80, ${pkg.color}18)`,
                    borderRadius: '16px 16px 0 0',
                  }} />

                  {pkg.popular && (
                    <div style={{
                      position: 'absolute', top: 16, right: 16,
                      fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                      padding: '3px 10px', borderRadius: 20,
                      background: `${pkg.color}18`, border: `1px solid ${pkg.color}40`,
                      color: pkg.color,
                    }}>Recommended</div>
                  )}

                  <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.10em', textTransform: 'uppercase', color: `${pkg.color}99`, marginBottom: 6 }}>{pkg.overline}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', marginBottom: 6 }}>{pkg.name}</div>
                  <div style={{ fontSize: 13, color: 'rgba(226,232,240,.50)', marginBottom: 24, lineHeight: 1.45 }}>{pkg.tagline}</div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                    {pkg.includes.map((item, j) => (
                      <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ marginTop: 3, flexShrink: 0 }}>
                          <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                            <path d="M1 4.5L4.5 8L11 1" stroke={pkg.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                        <span style={{ fontSize: 13, color: 'rgba(226,232,240,.65)', lineHeight: 1.45 }}>{item}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{
                    marginBottom: 20, padding: '10px 14px', borderRadius: 8,
                    background: `${pkg.color}08`, border: `1px solid ${pkg.color}18`,
                    fontSize: 12, color: 'rgba(226,232,240,.40)', lineHeight: 1.5, fontStyle: 'italic',
                  }}>
                    {pkg.note}
                  </div>

                  <button
                    onClick={() => setEnquiryOpen(true)}
                    style={{
                      width: '100%', padding: '11px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
                      background: pkg.accentBg, border: `1px solid ${pkg.accentBorder}`,
                      color: pkg.popular ? '#F5F7FA' : pkg.color,
                      cursor: 'pointer', fontFamily: FONT, letterSpacing: '.01em',
                      transition: 'opacity .15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '.80')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                  >
                    {pkg.cta}
                  </button>
                </div>
              );
            })}
          </div>

          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.22)', marginTop: 20 }}>
            Investment varies by scope. Book a strategy call for an operational assessment and tailored proposal.
          </p>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            5. REAL DEPLOYMENT EXAMPLE — LD Tennis
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 80 }}>
          <SectionBridge label="Live Deployment · LD Tennis" color="rgba(16,185,129,.18)" />

          <div style={{
            padding: '44px 48px', borderRadius: 20,
            background: 'rgba(16,185,129,.04)', border: '1px solid rgba(16,185,129,.16)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', right: -80, top: -80, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,.09) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: -40, bottom: -60, width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(52,211,153,.06) 0%, transparent 70%)', pointerEvents: 'none' }} />

            <div style={{ position: 'relative', display: 'flex', gap: 56, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {/* Left — deployment info */}
              <div style={{ flex: '1 1 320px', maxWidth: 480 }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '4px 12px', borderRadius: 20, marginBottom: 20,
                  background: 'rgba(16,185,129,.10)', border: '1px solid rgba(16,185,129,.28)',
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E', animation: 'pulse 2.5s ease-in-out infinite' }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(52,211,153,.85)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Live BrainBase Deployment</span>
                </div>

                <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 10px', lineHeight: 1.2 }}>
                  LD Tennis — operational from day one.
                </h2>
                <p style={{ fontSize: 15, color: 'rgba(226,232,240,.55)', margin: '0 0 24px', lineHeight: 1.65 }}>
                  LD Tennis is not a portfolio item. It&apos;s a live deployment of BrainBase website infrastructure —
                  a complete coaching operation built on the same modular systems available to every client.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(52,211,153,.55)', textTransform: 'uppercase' }}>Deployed systems</div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {LD_TENNIS_FEATURES.map((feat, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                        background: feat.active ? `${feat.color}10` : 'rgba(255,255,255,.03)',
                        border: feat.active ? `1px solid ${feat.color}28` : '1px solid rgba(255,255,255,.07)',
                        color: feat.active ? feat.color : 'rgba(255,255,255,.25)',
                        opacity: feat.active ? 1 : 0.50,
                      }}>
                        {feat.active && (
                          <div style={{ width: 5, height: 5, borderRadius: '50%', background: feat.color, boxShadow: `0 0 5px ${feat.color}` }} />
                        )}
                        {feat.label}
                        {!feat.active && (
                          <span style={{ fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.70 }}>Soon</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <a
                  href="https://ldtennis.com.au"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '10px 20px', borderRadius: 9, fontSize: 13, fontWeight: 600,
                    background: 'rgba(16,185,129,.14)', border: '1px solid rgba(16,185,129,.32)',
                    color: '#34D399', textDecoration: 'none', transition: 'all .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(16,185,129,.22)'; e.currentTarget.style.borderColor = 'rgba(16,185,129,.50)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16,185,129,.14)'; e.currentTarget.style.borderColor = 'rgba(16,185,129,.32)'; }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  View live deployment →
                </a>
              </div>

              {/* Right — system preview */}
              <div style={{ flex: '1 1 260px' }}>
                <div style={{
                  borderRadius: 16, overflow: 'hidden',
                  background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.08)',
                }}>
                  {/* Window chrome */}
                  <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,.03)', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(239,68,68,.50)' }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(245,158,11,.50)' }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(16,185,129,.50)' }} />
                    <div style={{ flex: 1, marginLeft: 8, background: 'rgba(255,255,255,.06)', borderRadius: 4, padding: '3px 10px' }}>
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,.25)', letterSpacing: '.02em' }}>ldtennis.com.au</span>
                    </div>
                  </div>
                  {/* Mock dashboard content */}
                  <div style={{ padding: '18px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(52,211,153,.55)', textTransform: 'uppercase', marginBottom: 12 }}>Weekly Overview</div>
                    {/* Stats row */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                      {[
                        { label: 'Sessions', value: '12', color: '#34D399' },
                        { label: 'Players', value: '34', color: '#38BDF8' },
                        { label: 'Revenue', value: '$1,420', color: '#A78BFA' },
                      ].map((stat, i) => (
                        <div key={i} style={{ flex: 1, padding: '10px 10px', borderRadius: 8, background: `${stat.color}09`, border: `1px solid ${stat.color}20`, textAlign: 'center' }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: stat.color, letterSpacing: '-.02em', marginBottom: 2 }}>{stat.value}</div>
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,.30)', letterSpacing: '.04em' }}>{stat.label}</div>
                        </div>
                      ))}
                    </div>
                    {/* Sessions list */}
                    {[
                      { day: 'Mon', type: 'Hot Shots', players: 3, color: '#34D399' },
                      { day: 'Tue', type: 'Private 60', players: 1, color: '#38BDF8' },
                      { day: 'Wed', type: 'Group Program', players: 6, color: '#A78BFA' },
                    ].map((session, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < 2 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
                        <span style={{ fontSize: 10, color: session.color, fontWeight: 600, width: 30 }}>{session.day}</span>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', flex: 1 }}>{session.type}</span>
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.30)' }}>{session.players} players</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 7, background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.14)', fontSize: 11, color: 'rgba(52,211,153,.65)' }}>
                      Powered by BrainBase · LD Tennis deployment
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            6. HOW THE PROCESS WORKS
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 80 }}>
          <SectionBridge label="Implementation · From Strategy To Live" color="rgba(139,92,246,.18)" />

          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(167,139,250,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Process</div>
            <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 12px' }}>
              From strategy to live operation
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(226,232,240,.48)', margin: '0 auto', maxWidth: 480, lineHeight: 1.65 }}>
              A structured implementation process — every deployment follows the same rigorous operational framework.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
            {PROCESS_STEPS.map((step, i) => {
              const isHov = hoveredStep === i;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredStep(i)}
                  onMouseLeave={() => setHoveredStep(null)}
                  style={{
                    padding: '24px 26px', borderRadius: 14,
                    background: isHov ? `rgba(${hexToRgbStr(step.color)}, .05)` : 'rgba(255,255,255,.025)',
                    border: isHov ? `1px solid ${step.color}28` : '1px solid rgba(255,255,255,.07)',
                    transform: isHov ? 'translateY(-2px)' : 'translateY(0)',
                    transition: 'all .18s', cursor: 'default',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 800, letterSpacing: '.06em',
                      color: isHov ? step.color : 'rgba(255,255,255,.20)',
                      fontFamily: '"JetBrains Mono", monospace',
                      transition: 'color .18s',
                    }}>{step.n}</div>
                    <div style={{ flex: 1, height: 1, background: isHov ? `${step.color}30` : 'rgba(255,255,255,.06)', transition: 'background .18s' }} />
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', margin: '0 0 8px', letterSpacing: '-.01em' }}>{step.title}</h3>
                  <p style={{ fontSize: 13, color: 'rgba(226,232,240,.52)', lineHeight: 1.6, margin: 0 }}>{step.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            7. ONGOING MANAGEMENT & HOSTING
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 80 }}>
          <SectionBridge label="Operational Continuity · Always Managed" color="rgba(99,102,241,.18)" />

          <div style={{
            padding: '48px 52px', borderRadius: 20,
            background: 'rgba(99,102,241,.04)', border: '1px solid rgba(99,102,241,.14)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', right: -100, top: -100, width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,.08) 0%, transparent 70%)', pointerEvents: 'none' }} />

            <div style={{ position: 'relative' }}>
              <div style={{ marginBottom: 40, maxWidth: 580 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(129,140,248,.65)', textTransform: 'uppercase', marginBottom: 10 }}>Ongoing Management</div>
                <h2 style={{ fontSize: 28, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.03em', margin: '0 0 12px', lineHeight: 1.2 }}>
                  Your systems continue evolving as your business grows.
                </h2>
                <p style={{ fontSize: 15, color: 'rgba(226,232,240,.50)', margin: 0, lineHeight: 1.65 }}>
                  BrainBase provides ongoing operational infrastructure — not just a hosted website. Your systems are
                  actively managed, monitored, and expanded as your business requirements change.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 36 }}>
                {MANAGEMENT_FEATURES.map((feat, i) => {
                  const isHov = hoveredMgmt === i;
                  return (
                    <div
                      key={i}
                      onMouseEnter={() => setHoveredMgmt(i)}
                      onMouseLeave={() => setHoveredMgmt(null)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 14,
                        padding: '18px 18px 18px 0', borderRadius: 10,
                        background: isHov ? `rgba(${hexToRgbStr(feat.color)}, .05)` : 'rgba(255,255,255,.02)',
                        border: isHov ? `1px solid ${feat.color}25` : '1px solid rgba(255,255,255,.06)',
                        transform: isHov ? 'translateY(-1px)' : 'translateY(0)',
                        transition: 'all .15s', cursor: 'default', overflow: 'hidden',
                      }}>
                      <div style={{
                        width: 3, alignSelf: 'stretch', flexShrink: 0, borderRadius: '0 2px 2px 0',
                        background: isHov ? feat.color : `${feat.color}35`,
                        transition: 'background .15s',
                      }} />
                      <div style={{
                        width: 32, height: 32, borderRadius: 8, flexShrink: 0, marginTop: 1,
                        background: `${feat.color}12`, border: `1px solid ${feat.color}22`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: feat.color,
                      }}>
                        {feat.icon}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F7FA', marginBottom: 4 }}>{feat.title}</div>
                        <p style={{ fontSize: 12, color: 'rgba(226,232,240,.50)', lineHeight: 1.55, margin: 0 }}>{feat.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Uptime / SLA callout */}
              <div style={{
                display: 'flex', gap: 20, flexWrap: 'wrap',
                padding: '20px 24px', borderRadius: 12,
                background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.08)',
              }}>
                {[
                  { value: '99.9%', label: 'Target uptime', color: '#22C55E' },
                  { value: '24/7', label: 'Infrastructure monitoring', color: '#38BDF8' },
                  { value: 'Managed', label: 'All hosting & SSL included', color: '#A78BFA' },
                  { value: 'Ongoing', label: 'Monthly improvements', color: '#F59E0B' },
                ].map((stat, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 160px' }}>
                    {i > 0 && <div style={{ display: 'none' }} />}
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: stat.color, boxShadow: `0 0 8px ${stat.color}`, flexShrink: 0, animation: 'pulse 2.5s ease-in-out infinite' }} />
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em' }}>{stat.value}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', letterSpacing: '.02em' }}>{stat.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            8. FINAL CTA
        ══════════════════════════════════════════════════════════════ */}
        <div style={{
          padding: '52px 52px', borderRadius: 20,
          background: 'linear-gradient(135deg, rgba(99,102,241,.08) 0%, rgba(139,92,246,.06) 100%)',
          border: '1px solid rgba(99,102,241,.22)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 32, position: 'relative', overflow: 'hidden',
          textAlign: 'left',
        }}>
          <div style={{ position: 'absolute', right: -80, top: -80, width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,.12) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: -40, bottom: -60, width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,.07) 0%, transparent 70%)', pointerEvents: 'none' }} />

          <div style={{ position: 'relative', flex: '1 1 360px', maxWidth: 560 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(167,139,250,.65)', textTransform: 'uppercase', marginBottom: 12 }}>Ready to begin</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.03em', margin: '0 0 12px', lineHeight: 1.2 }}>
              Connected systems scale better businesses.
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(230,237,243,.45)', margin: 0, lineHeight: 1.6, maxWidth: 480 }}>
              BrainBase helps businesses move beyond disconnected tools and operate through
              intelligent connected systems — starting with your website.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, flexShrink: 0, flexWrap: 'wrap', position: 'relative' }}>
            <button
              onClick={() => setEnquiryOpen(true)}
              onMouseEnter={() => setCtaPrimaryHov(true)}
              onMouseLeave={() => setCtaPrimaryHov(false)}
              style={{
                padding: '13px 28px', borderRadius: 9, fontWeight: 700, fontSize: 14,
                background: ctaPrimaryHov
                  ? 'rgba(139,92,246,.38)'
                  : 'rgba(139,92,246,.26)',
                border: '1px solid rgba(139,92,246,.52)',
                color: '#F5F7FA', cursor: 'pointer', fontFamily: FONT,
                letterSpacing: '.01em', transition: 'background .15s',
                boxShadow: ctaPrimaryHov ? '0 0 28px rgba(139,92,246,.25)' : 'none',
              }}>
              Book Strategy Call →
            </button>
            <button
              onClick={() => setEnquiryOpen(true)}
              onMouseEnter={() => setCtaSecHov(true)}
              onMouseLeave={() => setCtaSecHov(false)}
              style={{
                padding: '13px 24px', borderRadius: 9, fontWeight: 600, fontSize: 14,
                background: 'rgba(255,255,255,.05)',
                border: ctaSecHov ? '1px solid rgba(255,255,255,.20)' : '1px solid rgba(255,255,255,.10)',
                color: ctaSecHov ? 'rgba(226,232,240,.90)' : 'rgba(226,232,240,.65)',
                cursor: 'pointer', fontFamily: FONT, letterSpacing: '.01em',
                transition: 'all .15s',
              }}>
              Request Deployment Review
            </button>
          </div>
        </div>

      </div>

      <EnquiryModal open={enquiryOpen} onClose={() => setEnquiryOpen(false)} />
    </main>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function SectionBridge({ label, color = 'rgba(99,102,241,.18)' }: { label: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', margin: '0 0 48px' }}>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${color})` }} />
      <div style={{
        padding: '3px 14px', borderRadius: 20, fontSize: 10, fontWeight: 700,
        letterSpacing: '.10em', color: 'rgba(129,140,248,.35)', textTransform: 'uppercase',
        background: 'rgba(99,102,241,.04)', border: '1px solid rgba(99,102,241,.10)',
        whiteSpace: 'nowrap', margin: '0 14px',
      }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${color}, transparent)` }} />
    </div>
  );
}

function hexToRgbStr(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

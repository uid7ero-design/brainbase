"use client";

import { useState } from "react";
import Link from "next/link";
import CommandDemo from "@/components/CommandDemo";
import EnquiryModal from "@/components/web-services/EnquiryModal";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#08090C';

const KEYFRAMES = `
  html { scroll-behavior: smooth; }
  @keyframes orbFloat   { 0%, 100% { transform: translateY(0px) scale(1); }       50% { transform: translateY(-12px) scale(1.022); } }
  @keyframes heroGlow   { 0%, 100% { opacity: .55; }              50% { opacity: 1; }              }
  @keyframes pulse      { 0%, 100% { opacity: 1; }                50% { opacity: .4; }             }
`;

const BUSINESS_MODULES = [
  {
    color: '#6366F1',
    title: 'Intelligent Websites',
    description: 'Smart web presence that captures leads and connects directly to your CRM and booking system.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
  },
  {
    color: '#8B5CF6',
    title: 'CRM & Client Management',
    description: 'A complete client relationship system — contacts, pipelines, communication history, and deal tracking.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    color: '#10B981',
    title: 'Scheduling & Bookings',
    description: 'Session, appointment, and booking management with automated reminders and live capacity tracking.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <path d="M8 14h.01M12 14h.01M16 14h.01"/>
      </svg>
    ),
  },
  {
    color: '#38BDF8',
    title: 'AI Assistants',
    description: 'HLNΛ-powered intelligence embedded across every module — answering questions and surfacing operational insights.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="9" y="2" width="6" height="12" rx="3"/>
        <path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>
      </svg>
    ),
  },
  {
    color: '#A78BFA',
    title: 'Dashboards & Reporting',
    description: 'Real-time operational dashboards with live KPIs, trend analysis, and executive summaries built from your data.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    color: '#F59E0B',
    title: 'Workflow Automation',
    description: 'Automated triggers, follow-ups, and processes that keep your operations moving without manual effort.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    ),
  },
  {
    color: '#EC4899',
    title: 'Client Portals',
    description: 'Branded portals giving clients visibility into their bookings, invoices, communications, and progress.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
  },
  {
    color: '#22C55E',
    title: 'Revenue Intelligence',
    description: 'Real-time revenue tracking, forecasting, and margin insights across every part of your business.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
  },
];

const WEBSITE_SERVICES = [
  {
    color: '#6366F1',
    title: 'Website Design & Development',
    description: 'Modern responsive websites designed for performance, lead generation, and operational connectivity.',
    features: ['Responsive design', 'Landing pages', 'Booking systems', 'eCommerce', 'CRM integrations'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18"/><path d="M9 21V9"/>
      </svg>
    ),
  },
  {
    color: '#38BDF8',
    title: 'AI-Powered Websites',
    description: 'Transform your website into an intelligent business tool using automation and AI workflows.',
    features: ['AI assistants', 'Automated lead capture', 'Enquiry routing', 'Smart workflows', 'Dashboard integrations'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 2a10 10 0 1 0 10 10"/>
        <path d="M12 8v4l3 3"/>
        <path d="M18 2v4h4"/>
        <path d="M22 2l-4 4"/>
      </svg>
    ),
  },
  {
    color: '#10B981',
    title: 'Website Management & Maintenance',
    description: 'Ongoing hosting, optimisation, security, updates, and monitoring — fully managed.',
    features: ['Hosting', 'Backups', 'SEO optimisation', 'Security monitoring', 'Performance management'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="M9 12l2 2 4-4"/>
      </svg>
    ),
  },
  {
    color: '#A78BFA',
    title: 'Business System Integrations',
    description: 'Connect websites directly into your operational ecosystem — CRM, dashboards, portals, and more.',
    features: ['CRM syncing', 'Internal dashboards', 'Staff portals', 'Workflow automation', 'Reporting systems', 'API integrations'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
    ),
  },
];

// Outcome-focused — deliberately non-technical
const BUSINESS_OUTCOMES = [
  {
    color: '#10B981',
    title: 'Fewer missed enquiries',
    body: 'Every lead captured, automatically routed, and followed up — nothing falls through the cracks.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.72 16z"/>
      </svg>
    ),
  },
  {
    color: '#6366F1',
    title: 'Centralised operations',
    body: 'Every system connected into one platform. No more jumping between tools or losing data between apps.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
      </svg>
    ),
  },
  {
    color: '#F59E0B',
    title: 'Automated follow-ups',
    body: 'Clients and prospects hear from you at the right moment — without adding to your admin workload.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    ),
  },
  {
    color: '#22C55E',
    title: 'Clear revenue visibility',
    body: 'Know exactly what you\'re earning, where growth is coming from, and what\'s underperforming.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
        <polyline points="17 6 23 6 23 12"/>
      </svg>
    ),
  },
  {
    color: '#A78BFA',
    title: 'Less admin overhead',
    body: 'Reclaim hours lost to manual tasks, spreadsheets, and chasing — handed back to the work that matters.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
  },
  {
    color: '#38BDF8',
    title: 'Faster decisions',
    body: 'Ask a question about your business. Get a live, accurate answer from your actual operational data.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
  },
];

// Descriptions trimmed to one punchy line — section is about capabilities, not education
const CAPABILITIES = [
  {
    color: '#38BDF8',
    title: 'Voice-First AI',
    description: 'Talk to HLNΛ — ask questions, request reports, or navigate the platform without a keyboard.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="9" y="2" width="6" height="12" rx="3"/>
        <path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>
      </svg>
    ),
  },
  {
    color: '#A78BFA',
    title: '12 Intelligence Modules',
    description: 'Fleet, waste, water, roads, parks, labour, facilities, logistics, supply, depot, construction, and environment.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    color: '#10B981',
    title: 'Real Data, Real Answers',
    description: 'Upload your data and HLNΛ answers questions about cost, performance, compliance, and risk instantly.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    ),
  },
  {
    color: '#F59E0B',
    title: 'Smart Memory',
    description: 'HLNΛ learns your preferences and context — every session more relevant than the last.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>
        <path d="M12 6v6l4 2"/>
      </svg>
    ),
  },
  {
    color: '#EC4899',
    title: 'Navigate by Voice',
    description: 'One spoken command routes you instantly to any dashboard or module across the platform.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11"/>
      </svg>
    ),
  },
  {
    color: '#06B6D4',
    title: 'Integrated Operations',
    description: 'Connect Calendar, Gmail, and more — HLNΛ understands your full operational day, not just the platform.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
    ),
  },
];

const DASHBOARDS = [
  { title: 'Fleet Management',       color: '#3B82F6', category: 'Operations',     href: '/dashboard/fleet',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
  { title: 'Waste & Recycling',      color: '#10B981', category: 'Operations',     href: '/dashboard/waste',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg> },
  { title: 'Water & Utilities',      color: '#06B6D4', category: 'Infrastructure', href: '/dashboard/water',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2C6 8 4 12 4 16a8 8 0 0 0 16 0c0-4-2-8-8-14z"/></svg> },
  { title: 'Roads & Infrastructure', color: '#64748B', category: 'Infrastructure', href: '/dashboard/roads',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 17l3-10 3 4 3-8 3 4 3-8"/><path d="M3 21h18"/></svg> },
  { title: 'Parks & Open Spaces',    color: '#22C55E', category: 'Environment',    href: '/dashboard/parks',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 22V12"/><path d="M5 9l7-7 7 7"/><path d="M5 22h14"/><path d="M5 16l7-4 7 4"/></svg> },
  { title: 'Environmental & ESG',    color: '#16A34A', category: 'Environment',    href: '/dashboard/environment',  icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg> },
  { title: 'Labour & Workforce',     color: '#A855F7', category: 'People',         href: '/dashboard/labour',       icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  { title: 'Facilities Management',  color: '#8B5CF6', category: 'Operations',     href: '/dashboard/facilities',   icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h6"/><path d="M3 15h6"/></svg> },
  { title: 'Construction Projects',  color: '#F97316', category: 'Capital Works',  href: '/dashboard/construction', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 21h18"/><path d="M9 21V7l3-4 3 4v14"/><path d="M9 11h6"/><rect x="2" y="14" width="5" height="7"/><rect x="17" y="14" width="5" height="7"/></svg> },
  { title: 'Supply Chain',           color: '#0EA5E9', category: 'Logistics',      href: '/dashboard/supply',       icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="5" cy="6" r="3"/><circle cx="19" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M5 9v3l7 4 7-4V9"/><path d="M12 13V7"/></svg> },
  { title: 'Logistics & Freight',    color: '#F59E0B', category: 'Logistics',      href: '/dashboard/logistics',    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14"/><path d="M3 20h18"/><circle cx="17" cy="17" r="3"/></svg> },
  { title: 'Depot Operations',       color: '#EC4899', category: 'Logistics',      href: '/dashboard/depot',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="7" width="20" height="15" rx="1"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg> },
];

const STEPS = [
  { n: '01', title: 'Connect your data',    body: 'Upload Excel files, link your calendar, email, and operational systems. BrainBase structures it automatically.' },
  { n: '02', title: 'Ask HLNΛ anything',    body: 'Speak or type. "Which clients haven\'t responded this week?" "Show me revenue by service line." HLNΛ answers from your data.' },
  { n: '03', title: 'Operate with clarity', body: 'Navigate dashboards by voice, automate workflows, and brief your team — in seconds, not hours.' },
];

const COACH_BULLETS = [
  'Organise sessions and weekly schedules',
  'Manage players, clients, and contacts',
  'Track attendance, safety, and guardian details',
  'Understand your weekly revenue (coming soon)',
];

export default function Home() {
  const [hoveredDash,       setHoveredDash]       = useState<string | null>(null);
  const [hoveredCap,        setHoveredCap]        = useState<number | null>(null);
  const [hoveredModule,     setHoveredModule]     = useState<number | null>(null);
  const [hoveredWebService, setHoveredWebService] = useState<number | null>(null);
  const [hoveredOutcome,    setHoveredOutcome]    = useState<number | null>(null);
  const [enquiryOpen,       setEnquiryOpen]       = useState(false);
  const [coachHov,          setCoachHov]          = useState(false);
  const [coachDemoHov,      setCoachDemoHov]      = useState(false);
  const [useCaseHov,        setUseCaseHov]        = useState(false);

  return (
    <main style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT }}>
      <style>{KEYFRAMES}</style>

      {/* ── Ambient backdrop ──────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(79,70,229,.12) 0%, transparent 65%)',
      }} />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 32px 96px', position: 'relative', zIndex: 1 }}>

        {/* ══════════════════════════════════════════════════════════════
            1. HERO — Business operating system, not AI demo
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ padding: '96px 0 80px', display: 'flex', alignItems: 'center', gap: 72, flexWrap: 'wrap' }}>

          {/* Left — text */}
          <div style={{ flex: '1 1 400px', maxWidth: 560 }}>

            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 12px', borderRadius: 20, marginBottom: 28,
              background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.18)',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 6px #22C55E', animation: 'pulse 2.5s ease-in-out infinite' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(167,139,250,.82)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Business Operating System</span>
            </div>

            <h1 style={{
              fontSize: 'clamp(40px, 5vw, 62px)', fontWeight: 700,
              letterSpacing: '-.03em', lineHeight: 1.06,
              color: '#F1F5F9', margin: '0 0 22px',
            }}>
              Connected systems that<br />
              <span style={{
                background: 'linear-gradient(135deg, #818CF8 0%, #A78BFA 55%, #C084FC 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>run your business.</span>
            </h1>

            <p style={{
              fontSize: 17, lineHeight: 1.75, margin: '0 0 32px',
              color: 'rgba(226,232,240,.72)', maxWidth: 460,
            }}>
              BrainBase connects every part of your operation — CRM, scheduling, websites, reporting, and automation —
              into one intelligent platform. Less admin. Better decisions. Faster growth.
            </p>

            {/* ── Primary CTAs — commercial conversion first ── */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 32 }}>
              <button
                onClick={() => setEnquiryOpen(true)}
                style={{
                  padding: '13px 28px', borderRadius: 9, fontSize: 15, fontWeight: 700,
                  background: 'linear-gradient(135deg, rgba(99,102,241,.30) 0%, rgba(139,92,246,.22) 100%)',
                  border: '1px solid rgba(99,102,241,.50)',
                  color: '#F1F5F9', letterSpacing: '.01em', cursor: 'pointer',
                  fontFamily: FONT,
                  boxShadow: '0 0 24px rgba(99,102,241,.18), inset 0 1px 0 rgba(255,255,255,.08)',
                  transition: 'all .18s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99,102,241,.42) 0%, rgba(139,92,246,.32) 100%)'; e.currentTarget.style.boxShadow = '0 0 32px rgba(99,102,241,.28), inset 0 1px 0 rgba(255,255,255,.10)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99,102,241,.30) 0%, rgba(139,92,246,.22) 100%)'; e.currentTarget.style.boxShadow = '0 0 24px rgba(99,102,241,.18), inset 0 1px 0 rgba(255,255,255,.08)'; }}
              >
                Book Strategy Call →
              </button>
              <Link href="/dashboards" style={{
                padding: '13px 24px', borderRadius: 9, fontSize: 14, fontWeight: 600,
                background: 'transparent', border: '1px solid rgba(255,255,255,.11)',
                color: 'rgba(226,232,240,.65)', textDecoration: 'none', letterSpacing: '.01em',
                transition: 'color .15s, border-color .15s, background .15s',
                display: 'inline-flex', alignItems: 'center',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = 'rgba(226,232,240,.90)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.22)'; e.currentTarget.style.background = 'rgba(255,255,255,.03)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(226,232,240,.65)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.11)'; e.currentTarget.style.background = 'transparent'; }}>
                Explore the Platform →
              </Link>
            </div>

            {/* ── HLNΛ demo — supporting interaction ── */}
            <div style={{
              padding: '14px 16px', borderRadius: 10,
              background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
              }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#38BDF8', boxShadow: '0 0 5px #38BDF8', animation: 'pulse 2.5s ease-in-out infinite' }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(56,189,248,.55)', letterSpacing: '.10em', textTransform: 'uppercase' }}>HLNΛ · Ask anything</span>
              </div>
              <CommandDemo placeholder="e.g. What's my projected revenue this month?" />
            </div>

          </div>

          {/* Right — orb */}
          <div style={{ flex: '0 1 580px', minWidth: 320, display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
            <div style={{
              position: 'absolute', inset: -60,
              background: 'radial-gradient(circle at 50% 48%, rgba(79,70,229,.22) 0%, rgba(99,102,241,.10) 45%, transparent 70%)',
              filter: 'blur(40px)',
              animation: 'heroGlow 7s ease-in-out infinite',
              pointerEvents: 'none',
            }} />
            <div style={{ position: 'relative', width: '100%', maxWidth: 520 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hlna-orb-only.webp"
                alt="HLNA"
                style={{
                  width: '100%', display: 'block', objectFit: 'contain',
                  animation: 'orbFloat 6s ease-in-out infinite',
                  filter: 'drop-shadow(0 0 40px rgba(120,80,255,.65)) drop-shadow(0 0 100px rgba(80,120,255,.45))',
                }}
              />
            </div>
          </div>
        </section>

        {/* ── Stats bar ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 0,
          borderRadius: 12, overflow: 'hidden',
          border: '1px solid rgba(255,255,255,.07)',
          marginBottom: 80,
        }}>
          {[
            { value: '8',    label: 'Business infrastructure modules' },
            { value: 'HLNΛ', label: 'AI intelligence layer' },
            { value: '12',   label: 'Operational dashboards' },
            { value: 'Live', label: 'Real-time data analysis' },
          ].map((s, i) => (
            <div key={i} style={{
              flex: 1, padding: '20px 24px', textAlign: 'center',
              borderRight: i < 3 ? '1px solid rgba(255,255,255,.07)' : 'none',
              background: 'rgba(255,255,255,.02)',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', marginBottom: 4 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', letterSpacing: '.04em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════
            2. BUSINESS INFRASTRUCTURE MODULES — What systems exist
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(139,92,246,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Platform Architecture</div>
            <h2 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 12px' }}>
              Business Infrastructure Modules
            </h2>
            <p style={{ fontSize: 16, color: 'rgba(226,232,240,.50)', margin: '0 auto', maxWidth: 520, lineHeight: 1.65 }}>
              Eight connected operational systems — each a module in the BrainBase ecosystem, each powered by HLNΛ.
            </p>
          </div>

          <div style={{
            position: 'relative', marginBottom: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ height: 1, flex: 1, background: 'linear-gradient(90deg, transparent, rgba(139,92,246,.20))' }} />
            <div style={{
              padding: '4px 16px', borderRadius: 20, fontSize: 11, fontWeight: 600,
              letterSpacing: '.08em', color: 'rgba(167,139,250,.45)', textTransform: 'uppercase',
              background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.14)',
              whiteSpace: 'nowrap',
            }}>
              One ecosystem · Modular by design
            </div>
            <div style={{ height: 1, flex: 1, background: 'linear-gradient(90deg, rgba(139,92,246,.20), transparent)' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {BUSINESS_MODULES.map((mod, i) => {
              const isHov = hoveredModule === i;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredModule(i)}
                  onMouseLeave={() => setHoveredModule(null)}
                  style={{
                    padding: '24px', borderRadius: 14, cursor: 'default',
                    background: isHov ? `rgba(${hexToRgbStr(mod.color)}, .07)` : 'rgba(255,255,255,.025)',
                    border: isHov ? `1px solid ${mod.color}35` : '1px solid rgba(255,255,255,.07)',
                    transform: isHov ? 'translateY(-3px)' : 'translateY(0)',
                    transition: 'all .18s', position: 'relative', overflow: 'hidden',
                    boxShadow: isHov ? `0 8px 32px ${mod.color}12` : 'none',
                  }}>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: isHov ? `linear-gradient(90deg, ${mod.color}90, ${mod.color}20)` : `linear-gradient(90deg, ${mod.color}22, transparent)`,
                    transition: 'background .18s', borderRadius: '14px 14px 0 0',
                  }} />
                  {isHov && (
                    <div style={{
                      position: 'absolute', top: -30, right: -30,
                      width: 100, height: 100, borderRadius: '50%',
                      background: `radial-gradient(circle, ${mod.color}14 0%, transparent 70%)`,
                      pointerEvents: 'none',
                    }} />
                  )}
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, marginBottom: 16,
                    background: `${mod.color}12`, border: `1px solid ${mod.color}25`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: mod.color,
                  }}>
                    {mod.icon}
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', margin: '0 0 8px', letterSpacing: '-.01em' }}>{mod.title}</h3>
                  <p style={{ fontSize: 13, color: 'rgba(226,232,240,.58)', lineHeight: 1.65, margin: 0 }}>{mod.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Bridge: Ecosystem Entry ───────────────────────────────────── */}
        <SectionBridge label="Ecosystem Entry · Infrastructure Implementation" color="rgba(99,102,241,.18)" />

        {/* ══════════════════════════════════════════════════════════════
            3. WEBSITE SYSTEMS — How businesses enter the ecosystem
        ══════════════════════════════════════════════════════════════ */}
        <section id="web-systems" style={{ marginBottom: 56 }}>

          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(99,102,241,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Implementation Layer</div>
            <h2 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 12px' }}>
              Intelligent Website Systems
            </h2>
            <p style={{ fontSize: 16, color: 'rgba(226,232,240,.50)', margin: '0 auto', maxWidth: 580, lineHeight: 1.65 }}>
              Purpose-built website infrastructure that connects directly into your BrainBase ecosystem —
              capturing leads, automating workflows, and integrating your entire operation from day one.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))', gap: 16, marginBottom: 16 }}>
            {WEBSITE_SERVICES.map((svc, i) => {
              const isHov = hoveredWebService === i;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredWebService(i)}
                  onMouseLeave={() => setHoveredWebService(null)}
                  style={{
                    padding: '28px 28px 26px', borderRadius: 16, cursor: 'default',
                    background: isHov ? `${svc.color}09` : 'rgba(255,255,255,.025)',
                    border: isHov ? `1px solid ${svc.color}30` : '1px solid rgba(255,255,255,.08)',
                    transform: isHov ? 'translateY(-2px)' : 'translateY(0)',
                    transition: 'all .18s', position: 'relative', overflow: 'hidden',
                    boxShadow: isHov ? `0 12px 40px ${svc.color}10` : 'none',
                  }}>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: isHov ? `linear-gradient(90deg, ${svc.color}99, ${svc.color}18)` : `linear-gradient(90deg, ${svc.color}28, transparent)`,
                    transition: 'background .18s', borderRadius: '16px 16px 0 0',
                  }} />
                  <div style={{
                    position: 'absolute', top: -40, right: -40, width: 140, height: 140, borderRadius: '50%',
                    background: `radial-gradient(circle, ${svc.color}${isHov ? '10' : '06'} 0%, transparent 70%)`,
                    transition: 'all .18s', pointerEvents: 'none',
                  }} />
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20, position: 'relative' }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 11, flexShrink: 0,
                      background: `${svc.color}12`, border: `1px solid ${svc.color}25`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: svc.color,
                    }}>
                      {svc.icon}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#F5F7FA', margin: '0 0 6px', letterSpacing: '-.01em', lineHeight: 1.2 }}>{svc.title}</h3>
                      <p style={{ fontSize: 13, color: 'rgba(226,232,240,.55)', lineHeight: 1.55, margin: 0 }}>{svc.description}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, position: 'relative' }}>
                    {svc.features.map((feat, j) => (
                      <span key={j} style={{
                        display: 'inline-flex', alignItems: 'center',
                        fontSize: 11, fontWeight: 500, letterSpacing: '.01em',
                        padding: '4px 10px', borderRadius: 20,
                        color: isHov ? svc.color : 'rgba(226,232,240,.42)',
                        background: isHov ? `${svc.color}10` : 'rgba(255,255,255,.04)',
                        border: isHov ? `1px solid ${svc.color}22` : '1px solid rgba(255,255,255,.07)',
                        transition: 'all .18s',
                      }}>{feat}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* CTA panel */}
          <div style={{
            padding: '40px 44px', borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(99,102,241,.07) 0%, rgba(139,92,246,.05) 100%)',
            border: '1px solid rgba(99,102,241,.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap' as const, gap: 28, position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', left: -60, bottom: -60, width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,.09) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', flex: '1 1 320px', maxWidth: 520 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(129,140,248,.65)', textTransform: 'uppercase' as const, marginBottom: 10 }}>Website Systems</div>
              <h3 style={{ fontSize: 22, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', margin: '0 0 10px', lineHeight: 1.25 }}>Your Website Should Work Like Part Of Your Business</h3>
              <p style={{ fontSize: 14, color: 'rgba(230,237,243,.45)', margin: 0, lineHeight: 1.6 }}>We build intelligent digital systems designed to attract customers, automate workflows, and scale operations.</p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexShrink: 0, flexWrap: 'wrap' as const, position: 'relative' }}>
              <button
                onClick={() => setEnquiryOpen(true)}
                style={{
                  padding: '12px 24px', borderRadius: 9, fontWeight: 600, fontSize: 14,
                  background: 'rgba(99,102,241,.22)', border: '1px solid rgba(99,102,241,.42)',
                  color: '#F5F7FA', letterSpacing: '.01em', cursor: 'pointer',
                  fontFamily: FONT, transition: 'background .15s, border-color .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,.34)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,.60)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,.22)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,.42)'; }}
              >
                Book Strategy Call →
              </button>
              <Link href="/web-systems" style={{
                padding: '12px 24px', borderRadius: 9, fontWeight: 600, fontSize: 14,
                background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)',
                color: 'rgba(226,232,240,.65)', textDecoration: 'none', letterSpacing: '.01em',
                transition: 'background .15s, color .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.09)'; e.currentTarget.style.color = 'rgba(226,232,240,.88)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.color = 'rgba(226,232,240,.65)'; }}>
                Explore Web Systems →
              </Link>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            4. BUSINESS OUTCOMES — What actually improves
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(34,197,94,.65)', textTransform: 'uppercase', marginBottom: 8 }}>Business Outcomes</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 12px' }}>
              Built to reduce operational friction.
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(226,232,240,.48)', margin: '0 auto', maxWidth: 500, lineHeight: 1.65 }}>
              BrainBase helps businesses operate with more clarity, less admin, and better visibility across every part of their operation.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {BUSINESS_OUTCOMES.map((outcome, i) => {
              const isHov = hoveredOutcome === i;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredOutcome(i)}
                  onMouseLeave={() => setHoveredOutcome(null)}
                  style={{
                    padding: '20px 22px', borderRadius: 12, cursor: 'default',
                    background: isHov ? `rgba(${hexToRgbStr(outcome.color)}, .06)` : 'rgba(255,255,255,.02)',
                    border: isHov ? `1px solid ${outcome.color}28` : '1px solid rgba(255,255,255,.06)',
                    transform: isHov ? 'translateY(-2px)' : 'translateY(0)',
                    transition: 'all .16s', position: 'relative', overflow: 'hidden',
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                  }}>
                  {/* Accent line */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, bottom: 0, width: 2,
                    background: isHov ? `linear-gradient(180deg, ${outcome.color}70, ${outcome.color}10)` : `linear-gradient(180deg, ${outcome.color}20, transparent)`,
                    transition: 'background .16s', borderRadius: '12px 0 0 12px',
                  }} />
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0, marginLeft: 4,
                    background: `${outcome.color}12`, border: `1px solid ${outcome.color}22`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: isHov ? outcome.color : `${outcome.color}90`,
                    transition: 'color .16s, background .16s',
                  }}>
                    {outcome.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#F5F7FA', margin: '0 0 5px', letterSpacing: '-.01em', lineHeight: 1.3 }}>{outcome.title}</h3>
                    <p style={{ fontSize: 12, color: 'rgba(226,232,240,.50)', lineHeight: 1.6, margin: 0 }}>{outcome.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Bridge: First Vertical Deployment ────────────────────────── */}
        <SectionBridge label="First Vertical Deployment · Live in Production" color="rgba(16,185,129,.18)" />

        {/* ══════════════════════════════════════════════════════════════
            5. COACHES & SERVICE BUSINESSES — Real-world deployment proof
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 56 }}>
          <div style={{
            padding: '48px', borderRadius: 16,
            background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 40, position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', right: -80, bottom: -80, width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,.10) 0%, transparent 70%)', pointerEvents: 'none' }} />

            <div style={{ flex: '1 1 320px', maxWidth: 500 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(52,211,153,.70)', textTransform: 'uppercase', marginBottom: 10 }}>First Vertical Deployment</div>
              <h2 style={{ fontSize: 26, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', margin: '0 0 12px', lineHeight: 1.2 }}>
                BrainBase deployed for<br />Coaches &amp; Service Businesses
              </h2>
              <p style={{ fontSize: 15, color: 'rgba(230,237,243,.55)', margin: '0 0 24px', lineHeight: 1.65 }}>
                The full BrainBase ecosystem — configured, deployed, and operating inside a real coaching business.
                This is what the platform looks like in production.
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {COACH_BULLETS.map((item, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.30)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="9" height="9" viewBox="0 0 12 9" fill="none">
                        <path d="M1 4.5L4.5 8L11 1" stroke="#34D399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <span style={{ fontSize: 14, color: 'rgba(226,232,240,.72)' }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Link
                href="/for-coaches"
                onMouseEnter={() => setCoachHov(true)}
                onMouseLeave={() => setCoachHov(false)}
                style={{
                  display: 'inline-block',
                  padding: '13px 28px', borderRadius: 9, fontWeight: 600, fontSize: 14,
                  background: coachHov ? 'rgba(16,185,129,.28)' : 'rgba(16,185,129,.18)',
                  border: coachHov ? '1px solid rgba(16,185,129,.55)' : '1px solid rgba(16,185,129,.36)',
                  color: '#F5F7FA', textDecoration: 'none', letterSpacing: '.02em',
                  transition: 'background .15s, border-color .15s',
                  boxShadow: coachHov ? '0 0 20px rgba(16,185,129,.12)' : 'none',
                }}>
                See the Deployment →
              </Link>
              <Link
                href="/request-demo"
                onMouseEnter={() => setCoachDemoHov(true)}
                onMouseLeave={() => setCoachDemoHov(false)}
                style={{
                  display: 'inline-block', textAlign: 'center',
                  padding: '11px 28px', borderRadius: 9, fontWeight: 600, fontSize: 14,
                  background: 'transparent',
                  border: coachDemoHov ? '1px solid rgba(255,255,255,.22)' : '1px solid rgba(255,255,255,.10)',
                  color: coachDemoHov ? 'rgba(226,232,240,.90)' : 'rgba(226,232,240,.55)',
                  textDecoration: 'none', letterSpacing: '.02em',
                  transition: 'border-color .15s, color .15s',
                }}>
                Request a Demo →
              </Link>
            </div>
          </div>
        </section>

        {/* ── Bridge: The Operating Model ───────────────────────────────── */}
        <SectionBridge label="The Operating Model · How BrainBase Works" color="rgba(139,92,246,.18)" />

        {/* ══════════════════════════════════════════════════════════════
            6. HOW IT WORKS — The operational process
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(139,92,246,.70)', textTransform: 'uppercase', marginBottom: 8 }}>How it works</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: 0 }}>
              From data to decision in three steps.
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{
                padding: '24px', borderRadius: 14,
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: 'linear-gradient(90deg, rgba(139,92,246,.50), transparent)',
                  borderRadius: '14px 14px 0 0',
                }} />
                <div style={{
                  width: 36, height: 36, borderRadius: 9, marginBottom: 16,
                  background: 'rgba(139,92,246,.12)', border: '1px solid rgba(139,92,246,.22)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: '#C4B5FD', letterSpacing: '.04em',
                }}>
                  {step.n}
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', margin: '0 0 8px', letterSpacing: '-.01em' }}>{step.title}</h3>
                <p style={{ fontSize: 13, color: 'rgba(226,232,240,.64)', lineHeight: 1.65, margin: 0 }}>{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bridge: Intelligence Layer ────────────────────────────────── */}
        <SectionBridge label="Intelligence Layer · HLNΛ AI Engine" color="rgba(56,189,248,.15)" />

        {/* ══════════════════════════════════════════════════════════════
            7. INTELLIGENCE LAYER — Capabilities + dashboards (lean)
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 56 }}>

          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(56,189,248,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Intelligence Layer</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 8px' }}>
              Advanced intelligence. Built into every module.
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(226,232,240,.42)', margin: 0, maxWidth: 480, lineHeight: 1.6 }}>
              HLNΛ sits at the centre of the platform — answering questions, navigating operations, and surfacing what matters.
            </p>
          </div>

          {/* AI Capabilities — compact 2-row grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, marginBottom: 36 }}>
            {CAPABILITIES.map((cap, i) => {
              const isHov = hoveredCap === i;
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredCap(i)}
                  onMouseLeave={() => setHoveredCap(null)}
                  style={{
                    padding: '16px 18px', borderRadius: 10, cursor: 'default',
                    background: isHov ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.025)',
                    border: isHov ? `1px solid ${cap.color}22` : '1px solid rgba(255,255,255,.06)',
                    transform: isHov ? 'translateY(-1px)' : 'translateY(0)',
                    transition: 'all .15s',
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                  }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 7, flexShrink: 0,
                    background: `${cap.color}12`, border: `1px solid ${cap.color}22`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: cap.color,
                  }}>
                    {cap.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F7FA', marginBottom: 3, letterSpacing: '-.01em' }}>{cap.title}</div>
                    <div style={{ fontSize: 12, color: 'rgba(226,232,240,.52)', lineHeight: 1.5 }}>{cap.description}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Dashboards — dense compact grid */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ height: 1, width: 24, background: 'rgba(56,189,248,.25)' }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', color: 'rgba(56,189,248,.40)', textTransform: 'uppercase' }}>12 Operational Dashboards</span>
            </div>
            <Link href="/dashboards" style={{
              padding: '6px 14px', borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)',
              color: 'rgba(230,237,243,.50)', textDecoration: 'none', whiteSpace: 'nowrap',
              transition: 'color .12s',
            }}>
              View all 12 →
            </Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {DASHBOARDS.map((d) => {
              const isHov = hoveredDash === d.title;
              return (
                <Link
                  key={d.title}
                  href={d.href}
                  style={{ textDecoration: 'none' }}
                  onMouseEnter={() => setHoveredDash(d.title)}
                  onMouseLeave={() => setHoveredDash(null)}
                >
                  <div style={{
                    padding: '10px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10,
                    background: isHov ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.025)',
                    border: isHov ? '1px solid rgba(255,255,255,.12)' : '1px solid rgba(255,255,255,.06)',
                    transform: isHov ? 'translateY(-1px)' : 'translateY(0)',
                    transition: 'all .13s', cursor: 'pointer',
                  }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                      background: `${d.color}12`, border: `1px solid ${d.color}22`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: d.color,
                    }}>
                      {d.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: isHov ? '#F5F7FA' : 'rgba(226,232,240,.75)', lineHeight: 1.3, transition: 'color .13s' }}>{d.title}</div>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,.22)', letterSpacing: '.04em', marginTop: 1 }}>{d.category}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── Bridge: Industry Deployments ──────────────────────────────── */}
        <SectionBridge label="Industry Deployments · Choose Your Vertical" color="rgba(139,92,246,.18)" />

        {/* ══════════════════════════════════════════════════════════════
            8. USE CASES — Deployment flexibility across industries
        ══════════════════════════════════════════════════════════════ */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ marginBottom: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(139,92,246,.70)', textTransform: 'uppercase', marginBottom: 10 }}>Use Cases</div>
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: '0 0 10px' }}>
              Built for real operations
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(226,232,240,.52)', margin: 0, lineHeight: 1.6 }}>
              BrainBase deploys across industries — start with your use case.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
            <Link href="/for-coaches" style={{ textDecoration: 'none' }} onMouseEnter={() => setUseCaseHov(true)} onMouseLeave={() => setUseCaseHov(false)}>
              <div style={{
                padding: '22px', borderRadius: 14, height: '100%', boxSizing: 'border-box',
                background: useCaseHov ? 'rgba(16,185,129,.10)' : 'rgba(16,185,129,.06)',
                border: useCaseHov ? '1px solid rgba(16,185,129,.40)' : '1px solid rgba(16,185,129,.22)',
                transform: useCaseHov ? 'translateY(-2px)' : 'translateY(0)',
                transition: 'all .18s', position: 'relative', overflow: 'hidden', cursor: 'pointer',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, rgba(16,185,129,.70), transparent)', borderRadius: '14px 14px 0 0' }} />
                <div style={{ width: 34, height: 34, borderRadius: 8, marginBottom: 14, background: 'rgba(16,185,129,.14)', border: '1px solid rgba(16,185,129,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34D399' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#F5F7FA', margin: '0 0 8px', letterSpacing: '-.01em', lineHeight: 1.3 }}>For Coaches &amp; Service Businesses</h3>
                <p style={{ fontSize: 13, color: 'rgba(226,232,240,.60)', lineHeight: 1.6, margin: '0 0 18px' }}>The first complete BrainBase deployment — fully operational for coaching and service businesses.</p>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#34D399' }}>Explore →</div>
              </div>
            </Link>

            {[
              { title: 'For Councils & Local Government', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 21h18"/><path d="M9 21V7l3-4 3 4v14"/><path d="M9 11h6"/><rect x="2" y="14" width="5" height="7"/><rect x="17" y="14" width="5" height="7"/></svg> },
              { title: 'For Fleet & Operations',          icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
              { title: 'For Facilities & Assets',         icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h6"/><path d="M3 15h6"/></svg> },
            ].map((card, i) => (
              <div key={i} style={{
                padding: '22px', borderRadius: 14, opacity: 0.40,
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
                position: 'relative', overflow: 'hidden', cursor: 'default',
              }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, marginBottom: 14, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.35)' }}>{card.icon}</div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#F5F7FA', margin: '0 0 12px', letterSpacing: '-.01em', lineHeight: 1.3 }}>{card.title}</h3>
                <div style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.35)', padding: '3px 8px', borderRadius: 4, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.09)' }}>Coming Soon</div>
              </div>
            ))}
          </div>

          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.28)', margin: 0, letterSpacing: '.01em' }}>
            Pricing varies by deployment — explore your industry to get started.
          </p>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            9. FINAL CTA — Book a call or explore
        ══════════════════════════════════════════════════════════════ */}
        <div style={{
          padding: '40px', borderRadius: 16,
          background: 'rgba(139,92,246,.08)', border: '1px solid rgba(139,92,246,.20)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 24, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', right: -60, top: -60, width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,.12) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(167,139,250,.70)', textTransform: 'uppercase', marginBottom: 8 }}>Ready to begin</div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', margin: '0 0 8px' }}>
              Start your first conversation.
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(230,237,243,.45)', margin: 0, maxWidth: 440, lineHeight: 1.5 }}>
              Book a strategy call to see what BrainBase can deploy for your business — or explore the platform and ask HLNΛ anything.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              onClick={() => setEnquiryOpen(true)}
              style={{
                padding: '12px 24px', borderRadius: 9, fontWeight: 600, fontSize: 14,
                background: 'rgba(139,92,246,.28)', border: '1px solid rgba(139,92,246,.50)',
                color: '#F5F7FA', cursor: 'pointer', fontFamily: FONT,
                letterSpacing: '.02em', transition: 'background .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,.40)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(139,92,246,.28)')}>
              Book Strategy Call →
            </button>
            <Link href="/app" style={{
              padding: '12px 24px', borderRadius: 9, fontWeight: 600, fontSize: 14,
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)',
              color: 'rgba(230,237,243,.75)', textDecoration: 'none', letterSpacing: '.02em',
              transition: 'background .15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.10)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.06)')}>
              Explore Platform →
            </Link>
          </div>
        </div>

      </div>

      <EnquiryModal open={enquiryOpen} onClose={() => setEnquiryOpen(false)} />
    </main>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function SectionBridge({ label, color = 'rgba(139,92,246,.18)' }: { label: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', margin: '0 0 56px' }}>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${color})` }} />
      <div style={{
        padding: '3px 14px', borderRadius: 20, fontSize: 10, fontWeight: 700,
        letterSpacing: '.10em', color: 'rgba(167,139,250,.35)', textTransform: 'uppercase',
        background: 'rgba(139,92,246,.04)', border: '1px solid rgba(139,92,246,.10)',
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

"use client";

import { useState } from "react";
import Link from "next/link";
import { CommandCentreHero } from "../../components/brand/CommandCentreHero";

const CATEGORIES = ["All", "Local Government", "Logistics & Transport", "Construction", "Utilities", "Commercial"];

const DASHBOARDS = [
  {
    id: "waste",
    title: "Waste & Recycling",
    category: "Local Government",
    description: "Zone-by-zone cost analysis, tonnage tracking, cost-per-household benchmarking, and recycling diversion rates.",
    status: "live",
    href: "/dashboard/waste",
    color: "#10b981",
    metrics: ["Cost per tonne", "Recycling rate", "Zone benchmarking", "Contract compliance"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
      </svg>
    ),
  },
  {
    id: "fleet",
    title: "Fleet Management",
    category: "Local Government",
    description: "Full asset lifecycle costing across departments. Track fuel, maintenance, rego, depreciation, defects, and driver allocation.",
    status: "live",
    href: "/dashboard/fleet",
    color: "#3b82f6",
    metrics: ["Cost per km", "Department allocation", "Defect tracking", "Maintenance schedules"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
    ),
  },
  {
    id: "logistics",
    title: "Logistics & Freight",
    category: "Logistics & Transport",
    description: "End-to-end shipment tracking, route optimisation, carrier performance, and freight cost analysis by lane and carrier.",
    status: "live",
    href: "/dashboard/logistics",
    color: "#f59e0b",
    metrics: ["On-time delivery", "Cost per lane", "Carrier scorecards", "Route efficiency"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14"/><path d="M3 20h18"/>
        <circle cx="17" cy="17" r="3"/><path d="M20 10v4"/>
      </svg>
    ),
  },
  {
    id: "construction",
    title: "Construction Projects",
    category: "Construction",
    description: "Project cost tracking, subcontractor management, milestone progress, variations, and budget vs actuals across active sites.",
    status: "live",
    href: "/dashboard/construction",
    color: "#f97316",
    metrics: ["Budget vs actuals", "Variation tracking", "Site progress", "Subcontractor costs"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 21h18"/><path d="M9 21V7l3-4 3 4v14"/><path d="M9 11h6"/>
        <rect x="2" y="14" width="5" height="7"/><rect x="17" y="14" width="5" height="7"/>
      </svg>
    ),
  },
  {
    id: "roads",
    title: "Roads & Infrastructure",
    category: "Local Government",
    description: "Asset condition ratings, maintenance schedules, capital works programme tracking, and annual renewal spend modelling.",
    status: "live",
    href: "/dashboard/roads",
    color: "#64748b",
    metrics: ["Condition ratings", "Renewal backlog", "Capex progress", "PCI scores"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 17l3-10 3 4 3-8 3 4 3-8"/><path d="M3 21h18"/>
      </svg>
    ),
  },
  {
    id: "water",
    title: "Water & Utilities",
    category: "Utilities",
    description: "Water network performance, leakage detection, consumption analytics, pump station monitoring, and compliance reporting.",
    status: "live",
    href: "/dashboard/water",
    color: "#06b6d4",
    metrics: ["Leakage rates", "Consumption trends", "Pump efficiency", "Compliance KPIs"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 2C6 8 4 12 4 16a8 8 0 0 0 16 0c0-4-2-8-8-14z"/>
      </svg>
    ),
  },
  {
    id: "parks",
    title: "Parks & Open Spaces",
    category: "Local Government",
    description: "Maintenance schedule tracking, contractor performance, mowing frequency, irrigation usage, and asset condition.",
    status: "live",
    href: "/dashboard/parks",
    color: "#22c55e",
    metrics: ["Contractor performance", "Mow frequency", "Irrigation spend", "Asset condition"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 22V12"/><path d="M5 9l7-7 7 7"/>
        <path d="M5 22h14"/><path d="M5 16l7-4 7 4"/>
      </svg>
    ),
  },
  {
    id: "facilities",
    title: "Facilities Management",
    category: "Commercial",
    description: "Building maintenance costs, reactive vs planned ratios, energy consumption, tenant requests, and lifecycle cost modelling.",
    status: "live",
    href: "/dashboard/facilities",
    color: "#8b5cf6",
    metrics: ["Reactive vs planned", "Energy per sqm", "Response times", "Lifecycle costs"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h6"/><path d="M3 15h6"/>
      </svg>
    ),
  },
  {
    id: "depot",
    title: "Depot & Yard Operations",
    category: "Logistics & Transport",
    description: "Vehicle turnaround times, bay utilisation, pre-start check compliance, defect rates, and daily throughput.",
    status: "live",
    href: "/dashboard/depot",
    color: "#ec4899",
    metrics: ["Bay utilisation", "Turnaround time", "Pre-start compliance", "Defect rates"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2" y="7" width="20" height="15" rx="1"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      </svg>
    ),
  },
  {
    id: "supply",
    title: "Supply Chain",
    category: "Logistics & Transport",
    description: "Supplier scorecards, procurement spend analytics, inventory turnover, lead time tracking, and contract management.",
    status: "live",
    href: "/dashboard/supply",
    color: "#0ea5e9",
    metrics: ["Supplier scores", "Lead times", "Inventory turnover", "Contract alerts"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="5" cy="6" r="3"/><circle cx="19" cy="6" r="3"/><circle cx="12" cy="18" r="3"/>
        <path d="M5 9v3l7 4 7-4V9"/><path d="M12 13V7"/>
      </svg>
    ),
  },
  {
    id: "labour",
    title: "Labour & Workforce",
    category: "Commercial",
    description: "Headcount analytics, overtime trends, leave liability, award compliance, rostering efficiency, and labour cost ratios.",
    status: "live",
    href: "/dashboard/labour",
    color: "#a855f7",
    metrics: ["Overtime trends", "Leave liability", "Award compliance", "Labour % revenue"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    id: "environment",
    title: "Environmental & ESG",
    category: "Utilities",
    description: "Carbon emissions tracking, energy consumption across sites, waste diversion rates, water usage, and ESG reporting.",
    status: "live",
    href: "/dashboard/environment",
    color: "#16a34a",
    metrics: ["Carbon intensity", "Energy per unit", "Diversion rate", "ESG score"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
      </svg>
    ),
  },
  {
    id: "wste",
    title: "WSTe — Waste Service Tracking",
    category: "Local Government",
    description: "Multi-stream waste service verification. GPS evidence, bin lift detection, RFID scanning, hard waste, street sweeping, and FOGO — all with property-level intelligence and exception management.",
    status: "live",
    href: "/dashboard/wste",
    color: "#2DD4BF",
    metrics: ["Service verification", "GPS evidence", "Bin lifts & RFID", "Exception management"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
      </svg>
    ),
  },
];

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#08090C';

export default function DashboardsPage() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [hovered, setHovered] = useState<string | null>(null);

  const filtered = activeCategory === "All"
    ? DASHBOARDS
    : DASHBOARDS.filter(d => d.category === activeCategory);

  return (
    <main style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT }}>

      {/* Ambient backdrop */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(139,92,246,.10) 0%, transparent 60%)',
      }} />


      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px 96px', position: 'relative', zIndex: 1 }}>

        {/* Command Centre Hero */}
        <CommandCentreHero />

        {/* Section label + filters */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(139,92,246,.70)', textTransform: 'uppercase', marginBottom: 8 }}>
                Intelligence Modules
              </div>
              <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: 0 }}>
                {filtered.length} dashboard{filtered.length !== 1 ? 's' : ''} available.
              </h2>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    padding: '6px 14px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                    cursor: 'pointer', letterSpacing: '.04em', transition: 'all .15s',
                    border: activeCategory === cat
                      ? '1px solid rgba(139,92,246,.60)'
                      : '1px solid rgba(255,255,255,.08)',
                    background: activeCategory === cat
                      ? 'rgba(139,92,246,.16)'
                      : 'rgba(255,255,255,.03)',
                    color: activeCategory === cat
                      ? '#C4B5FD'
                      : 'rgba(255,255,255,.45)',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Dashboard grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {filtered.map(dash => {
            const isHovered = hovered === dash.id;

            return (
              <Link
                key={dash.id}
                href={dash.href}
                style={{ textDecoration: 'none' }}
                onMouseEnter={() => setHovered(dash.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <div style={{
                  padding: '20px',
                  borderRadius: 14,
                  background: isHovered ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.03)',
                  border: isHovered
                    ? `1px solid rgba(255,255,255,.14)`
                    : '1px solid rgba(255,255,255,.07)',
                  transition: 'all .18s',
                  transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                  cursor: 'pointer',
                  height: '100%',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {/* Purple accent line on hover */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: isHovered
                      ? `linear-gradient(90deg, ${dash.color}80, rgba(139,92,246,.60))`
                      : 'transparent',
                    transition: 'background .18s',
                    borderRadius: '14px 14px 0 0',
                  }} />

                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 9,
                      background: `${dash.color}14`,
                      border: `1px solid ${dash.color}28`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: dash.color, flexShrink: 0,
                    }}>
                      {dash.icon}
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
                      padding: '3px 8px', borderRadius: 20,
                      background: 'rgba(34,197,94,.10)',
                      border: '1px solid rgba(34,197,94,.20)',
                      color: 'rgba(34,197,94,.80)',
                    }}>
                      LIVE
                    </span>
                  </div>

                  <div style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: '.10em',
                    color: isHovered ? dash.color : 'rgba(255,255,255,.25)',
                    textTransform: 'uppercase', marginBottom: 5,
                    transition: 'color .18s',
                  }}>
                    {dash.category}
                  </div>

                  <h3 style={{
                    fontSize: 15, fontWeight: 700, letterSpacing: '-.02em',
                    color: '#F5F7FA', margin: '0 0 8px', lineHeight: 1.3,
                  }}>
                    {dash.title}
                  </h3>

                  <p style={{
                    fontSize: 12, color: 'rgba(230,237,243,.42)', lineHeight: 1.6,
                    margin: '0 0 16px',
                  }}>
                    {dash.description}
                  </p>

                  {/* Metric pills */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {dash.metrics.map(m => (
                      <span key={m} style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 20,
                        background: 'rgba(255,255,255,.04)',
                        border: '1px solid rgba(255,255,255,.06)',
                        color: 'rgba(255,255,255,.40)', fontWeight: 500,
                      }}>
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Footer CTA */}
        <div style={{
          marginTop: 48, padding: '40px',
          borderRadius: 16,
          background: 'rgba(139,92,246,.08)', border: '1px solid rgba(139,92,246,.20)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 24, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', right: -60, top: -60,
            width: 240, height: 240, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(139,92,246,.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(167,139,250,.70)', textTransform: 'uppercase', marginBottom: 8 }}>
              Ready to begin
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', margin: '0 0 8px' }}>
              Ready for your shift?
            </h2>
            <p style={{ fontSize: 14, color: 'rgba(230,237,243,.45)', margin: 0, maxWidth: 440, lineHeight: 1.5 }}>
              HLNΛ is ready. Say "Hey Helena" or press Space to start. All 12 modules are live.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <Link href="/command" style={{
              padding: '12px 24px', borderRadius: 9, fontWeight: 600, fontSize: 14,
              background: 'rgba(139,92,246,.28)', border: '1px solid rgba(139,92,246,.50)',
              color: '#F5F7FA', textDecoration: 'none', letterSpacing: '.02em',
              transition: 'background .15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,.40)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(139,92,246,.28)')}>
              Open Command Centre
            </Link>
            <Link href="/" style={{
              padding: '12px 24px', borderRadius: 9, fontWeight: 600, fontSize: 14,
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)',
              color: 'rgba(230,237,243,.75)', textDecoration: 'none', letterSpacing: '.02em',
              transition: 'background .15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.10)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.06)')}>
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

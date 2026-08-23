"use client";

import { useState } from "react";
import Link from "next/link";
import { CommandCentreHero } from "../../components/brand/CommandCentreHero";

const CATEGORIES = [
  "All",
  "Local Government",
  "Logistics & Transport",
  "Construction",
  "Utilities",
  "Commercial",
];

const DASHBOARDS = [
  {
    id: "waste",
    title: "Waste & Recycling",
    category: "Local Government",
    description:
      "Zone-by-zone cost analysis, tonnage tracking, cost-per-household benchmarking, and recycling diversion rates.",
    status: "live",
    href: "/dashboard/waste",
    color: "#10b981",
    metrics: [
      "Cost per tonne",
      "Recycling rate",
      "Zone benchmarking",
      "Contract compliance",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14H6L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4h6v2" />
      </svg>
    ),
  },
  {
    id: "fleet",
    title: "Fleet Management",
    category: "Local Government",
    description:
      "Full asset lifecycle costing across departments. Track fuel, maintenance, rego, depreciation, defects, and driver allocation.",
    status: "live",
    href: "/dashboard/fleet",
    color: "#3b82f6",
    metrics: [
      "Cost per km",
      "Department allocation",
      "Defect tracking",
      "Maintenance schedules",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <rect x="1" y="3" width="15" height="13" rx="2" />
        <path d="M16 8h4l3 3v5h-7V8z" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    id: "logistics",
    title: "Logistics & Freight",
    category: "Logistics & Transport",
    description:
      "End-to-end shipment tracking, route optimisation, carrier performance, and freight cost analysis by lane and carrier.",
    status: "live",
    href: "/dashboard/logistics",
    color: "#f59e0b",
    metrics: [
      "On-time delivery",
      "Cost per lane",
      "Carrier scorecards",
      "Route efficiency",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14" />
        <path d="M3 20h18" />
        <circle cx="17" cy="17" r="3" />
        <path d="M20 10v4" />
      </svg>
    ),
  },
  {
    id: "construction",
    title: "Construction Projects",
    category: "Construction",
    description:
      "Project cost tracking, subcontractor management, milestone progress, variations, and budget vs actuals across active sites.",
    status: "live",
    href: "/dashboard/construction",
    color: "#f97316",
    metrics: [
      "Budget vs actuals",
      "Variation tracking",
      "Site progress",
      "Subcontractor costs",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M3 21h18" />
        <path d="M9 21V7l3-4 3 4v14" />
        <path d="M9 11h6" />
        <rect x="2" y="14" width="5" height="7" />
        <rect x="17" y="14" width="5" height="7" />
      </svg>
    ),
  },
  {
    id: "roads",
    title: "Roads & Infrastructure",
    category: "Local Government",
    description:
      "Asset condition ratings, maintenance schedules, capital works programme tracking, and annual renewal spend modelling.",
    status: "live",
    href: "/dashboard/roads",
    color: "#64748b",
    metrics: [
      "Condition ratings",
      "Renewal backlog",
      "Capex progress",
      "PCI scores",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M3 17l3-10 3 4 3-8 3 4 3-8" />
        <path d="M3 21h18" />
      </svg>
    ),
  },
  {
    id: "water",
    title: "Water & Utilities",
    category: "Utilities",
    description:
      "Water network performance, leakage detection, consumption analytics, pump station monitoring, and compliance reporting.",
    status: "live",
    href: "/dashboard/water",
    color: "#06b6d4",
    metrics: [
      "Leakage rates",
      "Consumption trends",
      "Pump efficiency",
      "Compliance KPIs",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M12 2C6 8 4 12 4 16a8 8 0 0 0 16 0c0-4-2-8-8-14z" />
      </svg>
    ),
  },
  {
    id: "parks",
    title: "Parks & Open Spaces",
    category: "Local Government",
    description:
      "Maintenance schedule tracking, contractor performance, mowing frequency, irrigation usage, and asset condition.",
    status: "live",
    href: "/dashboard/parks",
    color: "#22c55e",
    metrics: [
      "Contractor performance",
      "Mow frequency",
      "Irrigation spend",
      "Asset condition",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M12 22V12" />
        <path d="M5 9l7-7 7 7" />
        <path d="M5 22h14" />
        <path d="M5 16l7-4 7 4" />
      </svg>
    ),
  },
  {
    id: "facilities",
    title: "Facilities Management",
    category: "Commercial",
    description:
      "Building maintenance costs, reactive vs planned ratios, energy consumption, tenant requests, and lifecycle cost modelling.",
    status: "live",
    href: "/dashboard/facilities",
    color: "#8b5cf6",
    metrics: [
      "Reactive vs planned",
      "Energy per sqm",
      "Response times",
      "Lifecycle costs",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
        <path d="M3 9h6" />
        <path d="M3 15h6" />
      </svg>
    ),
  },
  {
    id: "depot",
    title: "Depot & Yard Operations",
    category: "Logistics & Transport",
    description:
      "Vehicle turnaround times, bay utilisation, pre-start check compliance, defect rates, and daily throughput.",
    status: "live",
    href: "/dashboard/depot",
    color: "#ec4899",
    metrics: [
      "Bay utilisation",
      "Turnaround time",
      "Pre-start compliance",
      "Defect rates",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <rect x="2" y="7" width="20" height="15" rx="1" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
    ),
  },
  {
    id: "supply",
    title: "Supply Chain",
    category: "Logistics & Transport",
    description:
      "Supplier scorecards, procurement spend analytics, inventory turnover, lead time tracking, and contract management.",
    status: "live",
    href: "/dashboard/supply",
    color: "#0ea5e9",
    metrics: [
      "Supplier scores",
      "Lead times",
      "Inventory turnover",
      "Contract alerts",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <circle cx="5" cy="6" r="3" />
        <circle cx="19" cy="6" r="3" />
        <circle cx="12" cy="18" r="3" />
        <path d="M5 9v3l7 4 7-4V9" />
        <path d="M12 13V7" />
      </svg>
    ),
  },
  {
    id: "labour",
    title: "Labour & Workforce",
    category: "Commercial",
    description:
      "Headcount analytics, overtime trends, leave liability, award compliance, rostering efficiency, and labour cost ratios.",
    status: "live",
    href: "/dashboard/labour",
    color: "#a855f7",
    metrics: [
      "Overtime trends",
      "Leave liability",
      "Award compliance",
      "Labour % revenue",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: "environment",
    title: "Environmental & ESG",
    category: "Utilities",
    description:
      "Carbon emissions tracking, energy consumption across sites, waste diversion rates, water usage, and ESG reporting.",
    status: "live",
    href: "/dashboard/environment",
    color: "#16a34a",
    metrics: [
      "Carbon intensity",
      "Energy per unit",
      "Diversion rate",
      "ESG score",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    id: "wste",
    title: "WSTe — Waste Service Tracking",
    category: "Local Government",
    description:
      "Multi-stream waste service verification. GPS evidence, bin lift detection, RFID scanning, hard waste, street sweeping, and FOGO — all with property-level intelligence and exception management.",
    status: "live",
    href: "/dashboard/wste",
    color: "#2DD4BF",
    metrics: [
      "Service verification",
      "GPS evidence",
      "Bin lifts & RFID",
      "Exception management",
    ],
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
];

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG = "#08090C";

export default function DashboardsPage() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [hovered, setHovered] = useState<string | null>(null);

  const filtered =
    activeCategory === "All"
      ? DASHBOARDS
      : DASHBOARDS.filter((dashboard) => dashboard.category === activeCategory);

  const categoryCount = (category: string) => {
    if (category === "All") return DASHBOARDS.length;

    return DASHBOARDS.filter(
      (dashboard) => dashboard.category === category
    ).length;
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: "#F5F7FA",
        fontFamily: FONT,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className="brainbase-dashboard-ambient brainbase-dashboard-ambient-one" />
      <div className="brainbase-dashboard-ambient brainbase-dashboard-ambient-two" />

      <div className="brainbase-dashboard-shell">
        <CommandCentreHero />

        <section className="brainbase-library-header">
          <div className="brainbase-library-heading">
            <div>
              <div className="brainbase-eyebrow">Intelligence Modules</div>

              <h2 className="brainbase-section-title">
                {activeCategory === "All"
                  ? "Your operational intelligence library."
                  : activeCategory}
              </h2>

              <p className="brainbase-section-copy">
                {filtered.length} dashboard
                {filtered.length !== 1 ? "s" : ""} available and ready to open.
              </p>
            </div>

            <div className="brainbase-library-status">
              <span className="brainbase-status-dot" />

              <div>
                <div className="brainbase-library-status-title">
                  HLNΛ connected
                </div>

                <div className="brainbase-library-status-copy">
                  {DASHBOARDS.length} modules online
                </div>
              </div>
            </div>
          </div>

          <div className="brainbase-filter-row">
            {CATEGORIES.map((category) => {
              const active = activeCategory === category;

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`brainbase-filter ${
                    active ? "brainbase-filter-active" : ""
                  }`}
                >
                  <span>{category}</span>

                  <span
                    className={`brainbase-filter-count ${
                      active ? "brainbase-filter-count-active" : ""
                    }`}
                  >
                    {categoryCount(category)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="brainbase-dashboard-grid">
          {filtered.map((dashboard, index) => {
            const isHovered = hovered === dashboard.id;

            return (
              <Link
                key={dashboard.id}
                href={dashboard.href}
                className="brainbase-dashboard-link"
                onMouseEnter={() => setHovered(dashboard.id)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  animationDelay: `${Math.min(index * 35, 280)}ms`,
                }}
              >
                <article
                  className={`brainbase-dashboard-card ${
                    isHovered ? "brainbase-dashboard-card-hovered" : ""
                  }`}
                >
                  <div
                    className="brainbase-card-glow"
                    style={{
                      background: `radial-gradient(circle, ${dashboard.color}22 0%, transparent 68%)`,
                      opacity: isHovered ? 1 : 0,
                    }}
                  />

                  <div
                    className="brainbase-card-accent"
                    style={{
                      background: `linear-gradient(90deg, ${dashboard.color}, rgba(139,92,246,.82))`,
                      opacity: isHovered ? 1 : 0,
                    }}
                  />

                  <div className="brainbase-card-header">
                    <div
                      className="brainbase-icon-box"
                      style={{
                        background: `${dashboard.color}12`,
                        borderColor: `${dashboard.color}2f`,
                        color: dashboard.color,
                        boxShadow: isHovered
                          ? `0 0 24px ${dashboard.color}18`
                          : "none",
                      }}
                    >
                      {dashboard.icon}
                    </div>

                    <div className="brainbase-live-pill">
                      <span className="brainbase-live-dot" />
                      LIVE
                    </div>
                  </div>

                  <div
                    className="brainbase-card-category"
                    style={{
                      color: isHovered
                        ? dashboard.color
                        : "rgba(255,255,255,.27)",
                    }}
                  >
                    {dashboard.category}
                  </div>

                  <div className="brainbase-card-title-row">
                    <h3 className="brainbase-card-title">
                      {dashboard.title}
                    </h3>

                    <span
                      className="brainbase-card-arrow"
                      style={{
                        transform: isHovered
                          ? "translate(2px, -2px)"
                          : "translate(0, 0)",
                        opacity: isHovered ? 1 : 0.35,
                      }}
                    >
                      ↗
                    </span>
                  </div>

                  <p className="brainbase-card-description">
                    {dashboard.description}
                  </p>

                  <div className="brainbase-metric-row">
                    {dashboard.metrics.map((metric) => (
                      <span key={metric} className="brainbase-metric-pill">
                        {metric}
                      </span>
                    ))}
                  </div>
                </article>
              </Link>
            );
          })}
        </section>

        <section className="brainbase-footer-cta">
          <div className="brainbase-footer-orb" />

          <div className="brainbase-footer-content">
            <div className="brainbase-eyebrow">Intelligence ready</div>

            <h2 className="brainbase-footer-title">
              Ready to work with HLNΛ?
            </h2>

            <p className="brainbase-footer-copy">
              Open the Command Centre to query your operational environment,
              explore insights and work across all {DASHBOARDS.length} live
              intelligence modules.
            </p>
          </div>

          <div className="brainbase-footer-actions">
            <Link
              href="/command"
              className="brainbase-button brainbase-button-primary"
            >
              <span>Open Command Centre</span>
              <span className="brainbase-button-arrow">→</span>
            </Link>

            <Link
              href="/"
              className="brainbase-button brainbase-button-secondary"
            >
              Back to Home
            </Link>
          </div>
        </section>
      </div>

      <style jsx global>{`
        @keyframes brainbaseCardIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes brainbaseStatusPulse {
          0%,
          100% {
            opacity: 0.7;
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.2);
          }

          50% {
            opacity: 1;
            box-shadow: 0 0 0 5px rgba(34, 197, 94, 0);
          }
        }

        .brainbase-dashboard-ambient {
          position: fixed;
          pointer-events: none;
          z-index: 0;
          border-radius: 999px;
          filter: blur(12px);
        }

        .brainbase-dashboard-ambient-one {
          width: 860px;
          height: 520px;
          left: 50%;
          top: -320px;
          transform: translateX(-50%);
          background: radial-gradient(
            ellipse,
            rgba(139, 92, 246, 0.15) 0%,
            rgba(83, 60, 167, 0.055) 42%,
            transparent 72%
          );
        }

        .brainbase-dashboard-ambient-two {
          width: 520px;
          height: 520px;
          right: -260px;
          top: 38%;
          background: radial-gradient(
            circle,
            rgba(69, 92, 246, 0.045) 0%,
            transparent 70%
          );
        }

        .brainbase-dashboard-shell {
          width: 100%;
          max-width: 1240px;
          margin: 0 auto;
          padding: 40px 32px 96px;
          position: relative;
          z-index: 1;
        }

        .brainbase-library-header {
          margin-bottom: 28px;
        }

        .brainbase-library-heading {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 28px;
          margin-bottom: 24px;
        }

        .brainbase-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(167, 139, 250, 0.72);
          margin-bottom: 9px;
        }

        .brainbase-section-title {
          font-size: clamp(25px, 3vw, 31px);
          line-height: 1.15;
          font-weight: 720;
          letter-spacing: -0.035em;
          color: #f5f7fa;
          margin: 0;
        }

        .brainbase-section-copy {
          margin: 8px 0 0;
          font-size: 13px;
          line-height: 1.5;
          color: rgba(230, 237, 243, 0.4);
        }

        .brainbase-library-status {
          display: flex;
          align-items: center;
          gap: 11px;
          min-width: 165px;
          padding: 10px 13px;
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 11px;
          background: rgba(255, 255, 255, 0.025);
          backdrop-filter: blur(12px);
        }

        .brainbase-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 12px rgba(34, 197, 94, 0.45);
          animation: brainbaseStatusPulse 2.4s ease-in-out infinite;
        }

        .brainbase-library-status-title {
          font-size: 11px;
          font-weight: 650;
          color: rgba(245, 247, 250, 0.82);
        }

        .brainbase-library-status-copy {
          font-size: 10px;
          color: rgba(230, 237, 243, 0.32);
          margin-top: 2px;
        }

        .brainbase-filter-row {
          display: flex;
          gap: 7px;
          overflow-x: auto;
          padding-bottom: 2px;
          scrollbar-width: none;
        }

        .brainbase-filter-row::-webkit-scrollbar {
          display: none;
        }

        .brainbase-filter {
          appearance: none;
          border: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(255, 255, 255, 0.022);
          color: rgba(255, 255, 255, 0.4);
          border-radius: 999px;
          padding: 7px 9px 7px 13px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
          font-family: inherit;
          font-size: 10px;
          line-height: 1;
          font-weight: 550;
          letter-spacing: 0.025em;
          cursor: pointer;
          transition:
            background 160ms ease,
            border-color 160ms ease,
            color 160ms ease,
            transform 160ms ease;
        }

        .brainbase-filter:hover {
          background: rgba(255, 255, 255, 0.045);
          border-color: rgba(255, 255, 255, 0.12);
          color: rgba(255, 255, 255, 0.66);
        }

        .brainbase-filter-active {
          border-color: rgba(139, 92, 246, 0.46);
          background: rgba(139, 92, 246, 0.13);
          color: #c4b5fd;
        }

        .brainbase-filter-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 19px;
          height: 19px;
          padding: 0 5px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.045);
          color: rgba(255, 255, 255, 0.3);
          font-size: 9px;
          font-weight: 700;
        }

        .brainbase-filter-count-active {
          background: rgba(139, 92, 246, 0.17);
          color: rgba(221, 214, 254, 0.9);
        }

        .brainbase-dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
          gap: 15px;
        }

        .brainbase-dashboard-link {
          display: block;
          height: 100%;
          text-decoration: none;
          outline: none;
          animation: brainbaseCardIn 420ms ease both;
        }

        .brainbase-dashboard-link:focus-visible .brainbase-dashboard-card {
          border-color: rgba(139, 92, 246, 0.55);
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.12);
        }

        .brainbase-dashboard-card {
          height: 100%;
          min-height: 270px;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          padding: 21px;
          border-radius: 15px;
          background: rgba(255, 255, 255, 0.026);
          border: 1px solid rgba(255, 255, 255, 0.065);
          transition:
            transform 180ms ease,
            background 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
          backdrop-filter: blur(10px);
        }

        .brainbase-dashboard-card-hovered {
          transform: translateY(-3px);
          background: rgba(255, 255, 255, 0.045);
          border-color: rgba(255, 255, 255, 0.125);
          box-shadow:
            0 18px 45px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.025);
        }

        .brainbase-card-glow {
          position: absolute;
          width: 210px;
          height: 210px;
          top: -105px;
          left: -95px;
          border-radius: 999px;
          pointer-events: none;
          transition: opacity 180ms ease;
        }

        .brainbase-card-accent {
          position: absolute;
          top: 0;
          left: 18px;
          right: 18px;
          height: 1px;
          pointer-events: none;
          transition: opacity 180ms ease;
        }

        .brainbase-card-header {
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .brainbase-icon-box {
          width: 39px;
          height: 39px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid;
          border-radius: 10px;
          transition: box-shadow 180ms ease;
        }

        .brainbase-live-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 7px;
          border-radius: 999px;
          border: 1px solid rgba(34, 197, 94, 0.15);
          background: rgba(34, 197, 94, 0.075);
          color: rgba(74, 222, 128, 0.72);
          font-size: 8px;
          line-height: 1;
          font-weight: 750;
          letter-spacing: 0.09em;
        }

        .brainbase-live-dot {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: rgba(74, 222, 128, 0.9);
          box-shadow: 0 0 7px rgba(34, 197, 94, 0.42);
        }

        .brainbase-card-category {
          position: relative;
          font-size: 8px;
          line-height: 1.4;
          font-weight: 700;
          letter-spacing: 0.115em;
          text-transform: uppercase;
          margin-bottom: 5px;
          transition: color 180ms ease;
        }

        .brainbase-card-title-row {
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 9px;
        }

        .brainbase-card-title {
          font-size: 15px;
          line-height: 1.3;
          font-weight: 700;
          letter-spacing: -0.018em;
          color: #f5f7fa;
          margin: 0;
        }

        .brainbase-card-arrow {
          flex-shrink: 0;
          color: rgba(196, 181, 253, 0.8);
          font-size: 15px;
          line-height: 1;
          transition:
            transform 180ms ease,
            opacity 180ms ease;
        }

        .brainbase-card-description {
          position: relative;
          min-height: 58px;
          margin: 0 0 18px;
          color: rgba(230, 237, 243, 0.4);
          font-size: 11.5px;
          line-height: 1.62;
        }

        .brainbase-metric-row {
          position: relative;
          margin-top: auto;
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }

        .brainbase-metric-pill {
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.055);
          background: rgba(255, 255, 255, 0.03);
          color: rgba(255, 255, 255, 0.36);
          font-size: 9px;
          line-height: 1.2;
          font-weight: 500;
        }

        .brainbase-footer-cta {
          position: relative;
          overflow: hidden;
          margin-top: 48px;
          padding: 38px 40px;
          border-radius: 17px;
          border: 1px solid rgba(139, 92, 246, 0.18);
          background:
            linear-gradient(
              120deg,
              rgba(139, 92, 246, 0.075),
              rgba(139, 92, 246, 0.025) 55%,
              rgba(255, 255, 255, 0.02)
            );
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 28px;
        }

        .brainbase-footer-orb {
          position: absolute;
          width: 320px;
          height: 320px;
          border-radius: 999px;
          right: -130px;
          top: -145px;
          background: radial-gradient(
            circle,
            rgba(139, 92, 246, 0.14) 0%,
            rgba(84, 61, 174, 0.045) 42%,
            transparent 70%
          );
          pointer-events: none;
        }

        .brainbase-footer-content {
          position: relative;
          z-index: 1;
        }

        .brainbase-footer-title {
          margin: 0 0 8px;
          font-size: 23px;
          line-height: 1.2;
          font-weight: 700;
          letter-spacing: -0.025em;
          color: #f5f7fa;
        }

        .brainbase-footer-copy {
          max-width: 590px;
          margin: 0;
          color: rgba(230, 237, 243, 0.42);
          font-size: 13px;
          line-height: 1.6;
        }

        .brainbase-footer-actions {
          position: relative;
          z-index: 1;
          display: flex;
          gap: 9px;
          flex-shrink: 0;
        }

        .brainbase-button {
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          padding: 0 18px;
          border-radius: 9px;
          font-size: 12px;
          line-height: 1;
          font-weight: 650;
          letter-spacing: 0.01em;
          text-decoration: none;
          transition:
            background 160ms ease,
            border-color 160ms ease,
            transform 160ms ease;
        }

        .brainbase-button:hover {
          transform: translateY(-1px);
        }

        .brainbase-button-primary {
          color: #f5f7fa;
          border: 1px solid rgba(139, 92, 246, 0.45);
          background: rgba(139, 92, 246, 0.24);
          box-shadow: 0 8px 30px rgba(76, 44, 150, 0.08);
        }

        .brainbase-button-primary:hover {
          background: rgba(139, 92, 246, 0.34);
          border-color: rgba(167, 139, 250, 0.58);
        }

        .brainbase-button-secondary {
          color: rgba(230, 237, 243, 0.67);
          border: 1px solid rgba(255, 255, 255, 0.085);
          background: rgba(255, 255, 255, 0.035);
        }

        .brainbase-button-secondary:hover {
          color: rgba(245, 247, 250, 0.86);
          background: rgba(255, 255, 255, 0.065);
        }

        .brainbase-button-arrow {
          font-size: 14px;
          opacity: 0.72;
        }

        @media (max-width: 820px) {
          .brainbase-dashboard-shell {
            padding: 30px 20px 72px;
          }

          .brainbase-library-heading {
            align-items: flex-start;
            flex-direction: column;
            gap: 17px;
          }

          .brainbase-library-status {
            min-width: 0;
          }

          .brainbase-dashboard-grid {
            grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
          }

          .brainbase-footer-cta {
            align-items: flex-start;
            flex-direction: column;
            padding: 30px;
          }

          .brainbase-footer-actions {
            width: 100%;
          }
        }

        @media (max-width: 560px) {
          .brainbase-dashboard-shell {
            padding: 24px 16px 56px;
          }

          .brainbase-section-title {
            font-size: 25px;
          }

          .brainbase-dashboard-grid {
            grid-template-columns: 1fr;
            gap: 11px;
          }

          .brainbase-dashboard-card {
            min-height: 0;
            padding: 19px;
          }

          .brainbase-card-description {
            min-height: 0;
          }

          .brainbase-footer-cta {
            margin-top: 34px;
            padding: 26px 22px;
          }

          .brainbase-footer-actions {
            flex-direction: column;
          }

          .brainbase-button {
            width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .brainbase-dashboard-link,
          .brainbase-status-dot {
            animation: none !important;
          }

          .brainbase-dashboard-card,
          .brainbase-filter,
          .brainbase-button,
          .brainbase-card-arrow {
            transition: none !important;
          }
        }
      `}</style>
    </main>
  );
}
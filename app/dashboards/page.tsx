"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { CommandCentreHero } from "../../components/brand/CommandCentreHero";
import { Badge, buttonProps } from "@/components/ui/app";
import styles from "./Dashboards.module.css";

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

// Visual (remaining visual islands pass): the dashboards library is a
// catalogue of module links, not a chart surface. Each module's `color` is a
// categorical identity and stays on the icon tile (mixed toward
// --text-primary so the glyph holds contrast in both themes); every text
// label sits on text tokens. Chrome (ambient blobs, glows, glass, gradients,
// violet pills) is replaced by flat token surfaces in Dashboards.module.css.

type ModuleStyle = CSSProperties & { "--module-color": string };

export default function DashboardsPage() {
  const [activeCategory, setActiveCategory] = useState("All");

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
    <main className={styles.page}>
      <div className={styles.shell}>
        <h1 className="bb-visually-hidden">Dashboards</h1>

        <CommandCentreHero />

        <section
          className={styles.libraryHeader}
          aria-labelledby="dashboards-library-title"
        >
          <div className={styles.libraryHeading}>
            <div>
              <p className={styles.eyebrow}>Intelligence Modules</p>

              <h2 id="dashboards-library-title" className={styles.sectionTitle}>
                {activeCategory === "All"
                  ? "Your operational intelligence library."
                  : activeCategory}
              </h2>

              <p className={styles.sectionCopy} aria-live="polite">
                {filtered.length} dashboard
                {filtered.length !== 1 ? "s" : ""} available and ready to open.
              </p>
            </div>

            <div className={styles.libraryStatus}>
              <span className={styles.statusDot} aria-hidden="true" />

              <div>
                <div className={styles.libraryStatusTitle}>
                  HLNΛ connected
                </div>

                <div className={styles.libraryStatusCopy}>
                  {DASHBOARDS.length} modules online
                </div>
              </div>
            </div>
          </div>

          <div
            className={styles.filterRow}
            role="group"
            aria-label="Filter dashboards by category"
          >
            {CATEGORIES.map((category) => {
              const active = activeCategory === category;

              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveCategory(category)}
                  className={styles.filter}
                >
                  <span>{category}</span>

                  <span className={styles.filterCount}>
                    {categoryCount(category)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={styles.grid} aria-label="Dashboards">
          {filtered.map((dashboard) => (
            <Link
              key={dashboard.id}
              href={dashboard.href}
              className={styles.cardLink}
              style={{ "--module-color": dashboard.color } as ModuleStyle}
            >
              <article className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.iconBox} aria-hidden="true">
                    {dashboard.icon}
                  </div>

                  <Badge state="success">LIVE</Badge>
                </div>

                <div className={styles.cardCategory}>{dashboard.category}</div>

                <div className={styles.cardTitleRow}>
                  <h3 className={styles.cardTitle}>{dashboard.title}</h3>

                  <span className={styles.cardArrow} aria-hidden="true">
                    ↗
                  </span>
                </div>

                <p className={styles.cardDescription}>
                  {dashboard.description}
                </p>

                <ul className={styles.metricRow}>
                  {dashboard.metrics.map((metric) => (
                    <li key={metric} className={styles.metric}>
                      {metric}
                    </li>
                  ))}
                </ul>
              </article>
            </Link>
          ))}
        </section>

        <section
          className={styles.footerCta}
          aria-labelledby="dashboards-footer-title"
        >
          <div className={styles.footerContent}>
            <p className={styles.eyebrow}>Intelligence ready</p>

            <h2 id="dashboards-footer-title" className={styles.footerTitle}>
              Ready to work with HLNΛ?
            </h2>

            <p className={styles.footerCopy}>
              Open the Command Centre to query your operational environment,
              explore insights and work across all {DASHBOARDS.length} live
              intelligence modules.
            </p>
          </div>

          <div className={styles.footerActions}>
            <Link href="/command" {...buttonProps("primary")}>
              <span>Open Command Centre</span>
              <span aria-hidden="true">→</span>
            </Link>

            <Link href="/" {...buttonProps("secondary")}>
              Back to Home
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
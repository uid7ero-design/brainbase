"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./WasteModule.module.css";

const TABS = [
  { label: "Overview",         href: "/dashboard/waste" },
  { label: "Bin Lifts",        href: "/dashboard/waste/bin-lifts" },
  { label: "Cost / HH",        href: "/dashboard/waste/cost-per-household" },
  { label: "Budgeting",        href: "/dashboard/waste/budgeting" },
  { label: "Diversion",        href: "/dashboard/waste/diversion" },
  { label: "Fleet",            href: "/dashboard/waste/fleet" },
  { label: "Complaints",       href: "/dashboard/waste/complaints" },
  { label: "Commodities",      href: "/dashboard/waste/commodities" },
  { label: "Community",        href: "/dashboard/waste/community" },
  { label: "Green Waste",      href: "/dashboard/waste/green-waste" },
  { label: "Compliance",       href: "/dashboard/waste/compliance" },
];

export default function NavTabs() {
  const pathname = usePathname();
  return (
    <nav className={styles.tabsNav} aria-label="Waste & Recycling sections">
      <ul className={styles.tabList}>
        {TABS.map(tab => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={styles.tab}
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

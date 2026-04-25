"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    <div className="overflow-x-auto mt-5 border-b border-white/10">
      <div className="flex gap-0.5 min-w-max">
        {TABS.map(tab => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap transition-colors ${
                active
                  ? "bg-slate-50 text-slate-900"
                  : "text-slate-400 hover:text-white hover:bg-white/10"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

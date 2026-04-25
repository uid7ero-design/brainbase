"use client";

import Link from "next/link";

type Crumb = { label: string; href?: string };

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "10px 0", fontSize: 13, color: "#64748b",
    }}>
      {crumbs.map((crumb, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {i > 0 && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          )}
          {crumb.href ? (
            <Link
              href={crumb.href}
              style={{
                color: "#64748b", textDecoration: "none", fontWeight: 500,
                transition: "color .15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#0f172a")}
              onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}
            >
              {crumb.label}
            </Link>
          ) : (
            <span style={{ color: "#0f172a", fontWeight: 600 }}>{crumb.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

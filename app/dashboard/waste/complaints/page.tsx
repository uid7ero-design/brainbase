"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, Cell,
} from "recharts";
import { KpiCard, Insight, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, GRID, TICK, DTT, DC, PAGE } from "../_dark";

const CATEGORIES = [
  { category: "Missed Collection",     count: 156, resolved: 148, avgDays: 1.2, color: "#ef4444" },
  { category: "Bin Damage",            count: 43,  resolved: 38,  avgDays: 4.1, color: "#f59e0b" },
  { category: "Bin Replacement",       count: 31,  resolved: 31,  avgDays: 3.5, color: "#3b82f6" },
  { category: "Contamination Notice",  count: 28,  resolved: 25,  avgDays: 2.8, color: "#8b5cf6" },
  { category: "Side Waste",            count: 19,  resolved: 14,  avgDays: 3.2, color: "#f97316" },
  { category: "Odour Complaint",       count: 12,  resolved: 11,  avgDays: 2.1, color: "#06b6d4" },
  { category: "General Enquiry",       count: 24,  resolved: 22,  avgDays: 5.3, color: "#64748b" },
].map(r => ({ ...r, open: r.count - r.resolved, resolutionRate: +((r.resolved / r.count) * 100).toFixed(0) }));

const ZONE_COMPLAINTS = [
  { zone: "Zone 1", missed: 18, damage: 5, other: 7,  total: 30, per1000hh: +(30/2840*1000).toFixed(1) },
  { zone: "Zone 2", missed: 12, damage: 4, other: 5,  total: 21, per1000hh: +(21/2610*1000).toFixed(1) },
  { zone: "Zone 3", missed: 27, damage: 7, other: 10, total: 44, per1000hh: +(44/3220*1000).toFixed(1) },
  { zone: "Zone 4", missed: 10, damage: 3, other: 4,  total: 17, per1000hh: +(17/2480*1000).toFixed(1) },
  { zone: "Zone 5", missed: 15, damage: 5, other: 6,  total: 26, per1000hh: +(26/2950*1000).toFixed(1) },
  { zone: "Zone 6", missed: 32, damage: 8, other: 12, total: 52, per1000hh: +(52/3400*1000).toFixed(1) },
  { zone: "Zone 7", missed: 9,  damage: 2, other: 3,  total: 14, per1000hh: +(14/2310*1000).toFixed(1) },
  { zone: "Zone 8", missed: 20, damage: 6, other: 9,  total: 35, per1000hh: +(35/3050*1000).toFixed(1) },
  { zone: "Zone 9", missed: 8,  damage: 2, other: 4,  total: 14, per1000hh: +(14/2560*1000).toFixed(1) },
  { zone: "Zone 10",missed: 5,  damage: 1, other: 3,  total:  9, per1000hh: +(9/2780*1000).toFixed(1) },
];

const MONTHLY = [
  { month: "Oct 25", requests: 249, resolved: 238 },
  { month: "Nov 25", requests: 234, resolved: 228 },
  { month: "Dec 25", requests: 268, resolved: 252 },
  { month: "Jan 26", requests: 341, resolved: 318 },
  { month: "Feb 26", requests: 312, resolved: 295 },
  { month: "Mar 26", requests: 313, resolved: 289 },
];

export default function ComplaintsPage() {
  const totalRequests  = CATEGORIES.reduce((s, r) => s + r.count, 0);
  const totalResolved  = CATEGORIES.reduce((s, r) => s + r.resolved, 0);
  const totalOpen      = totalRequests - totalResolved;
  const avgResolution  = +(CATEGORIES.reduce((s, r) => s + r.avgDays * r.count, 0) / totalRequests).toFixed(1);
  const TOTAL_HH       = 28200;
  const per1000hh      = +((totalRequests / TOTAL_HH) * 1000).toFixed(1);
  const worstZone      = ZONE_COMPLAINTS.reduce((max, r) => r.per1000hh > max.per1000hh ? r : max, ZONE_COMPLAINTS[0]);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={PAGE}>
      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Period: {today}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
        <KpiCard label="Total Service Requests" value={totalRequests.toLocaleString()}    sub="All types this period"                    accent="#3b82f6" />
        <KpiCard label="Requests per 1,000 HH"  value={per1000hh}                         sub="Target ≤ 10 per 1,000 HH"                 accent={per1000hh <= 10 ? "#10b981" : "#ef4444"} />
        <KpiCard label="Open / Unresolved"       value={totalOpen}                         sub={`${totalResolved} resolved (${Math.round(totalResolved/totalRequests*100)}%)`} accent={totalOpen > 20 ? "#ef4444" : "#10b981"} />
        <KpiCard label="Avg Resolution Time"     value={`${avgResolution} days`}           sub="Target ≤ 3 days"                          accent={avgResolution <= 3 ? "#10b981" : "#f59e0b"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
        <Insight icon="📋" color="red"
          title={`Missed collections = ${Math.round(156/totalRequests*100)}% of all requests`}
          body={`156 missed collection reports this period. The majority (${ZONE_COMPLAINTS.filter(z => z.missed > 15).map(z => z.zone).join(", ")}) are concentrated in high-density zones — review route capacity.`}
        />
        <Insight icon="⚠" color="amber"
          title={`${worstZone.zone} highest rate — ${worstZone.per1000hh} per 1,000 HH`}
          body={`This zone generates disproportionate requests relative to household count. ${totalOpen} requests remain open across all zones — prioritise before next collection cycle.`}
        />
        <Insight icon="✓" color="green"
          title={`${Math.round(totalResolved/totalRequests*100)}% resolution rate this period`}
          body={`${totalResolved} of ${totalRequests} requests resolved. Bin replacement requests achieved 100% resolution. Focus needed on side waste (${Math.round(14/19*100)}%) and damage follow-ups.`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Requests by Type" sub="Volume and resolution rate this period" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={CATEGORIES} layout="vertical" margin={{ left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="category" width={145} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Bar dataKey="resolved" name="Resolved" stackId="a" fill="#10b981" radius={[0,0,0,0]} />
              <Bar dataKey="open"     name="Open"     stackId="a" fill="#ef4444" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={DC}>
          <SectionHeader title="Monthly Request Volume" sub="Total received vs resolved Oct 2025 – Mar 2026" />
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={MONTHLY}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Line type="monotone" dataKey="requests" name="Received" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={DC}>
        <SectionHeader title="Complaints by Zone" sub="Missed collections, bin damage and other — per 1,000 households" />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={ZONE_COMPLAINTS} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="zone" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={DTT} />
            <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
            <Bar dataKey="missed" name="Missed Collection" stackId="a" fill="#ef4444" />
            <Bar dataKey="damage" name="Bin Damage"        stackId="a" fill="#f59e0b" />
            <Bar dataKey="other"  name="Other"             stackId="a" fill="rgba(255,255,255,0.25)" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="Request Category Summary" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {["Category","Received","Resolved","Open","Resolution Rate","Avg Days to Resolve"].map((h, i) => (
                <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: r.color, flexShrink: 0 }} />
                    {r.category}
                  </div>
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{r.count}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: "#4ade80" }}>{r.resolved}</td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}><span style={{ color: r.open > 5 ? "#f87171" : T2, fontWeight: r.open > 5 ? 600 : 400 }}>{r.open}</span></td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}><span style={{ fontWeight: 600, color: r.resolutionRate >= 90 ? "#4ade80" : "#f59e0b" }}>{r.resolutionRate}%</span></td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}><span style={{ color: r.avgDays <= 3 ? "#4ade80" : "#f59e0b" }}>{r.avgDays} days</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: ROW_HEAD, borderTop: `2px solid rgba(255,255,255,0.1)` }}>
              <td style={{ padding: "10px 14px", color: T1, fontWeight: 600 }}>Total</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>{totalRequests}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: "#4ade80", fontWeight: 600 }}>{totalResolved}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: "#f87171", fontWeight: 600 }}>{totalOpen}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>{Math.round(totalResolved/totalRequests*100)}%</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{avgResolution} days</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

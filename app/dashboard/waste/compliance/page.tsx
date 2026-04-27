"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { KpiCard, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, GRID, TICK, DTT, DC, PAGE } from "../_dark";

type StatusType = "compliant" | "due" | "overdue" | "na";

const EPA_CONDITIONS = [
  { condition: "EPA Licence — Waste Depot Operations",   status: "compliant" as StatusType, due: "30 Sep 2026", lastAudit: "12 Mar 2026", notes: "Annual audit passed. No corrective actions." },
  { condition: "EPA Licence — Transfer Station",          status: "compliant" as StatusType, due: "30 Sep 2026", lastAudit: "12 Mar 2026", notes: "Compliant. Leachate monitoring current." },
  { condition: "Landfill Levy Returns — Q3 FY2025-26",   status: "due"       as StatusType, due: "30 Apr 2026", lastAudit: "—",           notes: "Return due. Data collection in progress." },
  { condition: "Annual Environment Report",               status: "compliant" as StatusType, due: "31 Aug 2026", lastAudit: "1 Sep 2025",  notes: "FY2024-25 report submitted on time." },
  { condition: "Stormwater Quality Monitoring",           status: "compliant" as StatusType, due: "Quarterly",  lastAudit: "1 Mar 2026",  notes: "Q3 sampling complete. Results within limits." },
  { condition: "Air Emissions Reporting",                 status: "compliant" as StatusType, due: "Annual",     lastAudit: "31 Jan 2026", notes: "Vehicle fleet meets Euro 5/6 standards." },
  { condition: "Noise Monitoring — Depot",                status: "due"       as StatusType, due: "15 May 2026", lastAudit: "15 Nov 2025", notes: "6-monthly monitoring due May 2026." },
];

const SAFETY = [
  { category: "Lost Time Injuries (LTI)",        count: 0, ytd: 0,  target: 0,   status: "compliant" as StatusType },
  { category: "Medically Treated Injuries (MTI)", count: 1, ytd: 2,  target: "≤3", status: "compliant" as StatusType },
  { category: "Near Misses Reported",             count: 4, ytd: 11, target: "↑ culture", status: "compliant" as StatusType },
  { category: "Vehicle Incidents",                count: 1, ytd: 3,  target: "≤4", status: "compliant" as StatusType },
  { category: "Hazard Observations",             count: 18, ytd: 54, target: "↑ culture", status: "compliant" as StatusType },
  { category: "WHS Inspections Completed",       count: 6,  ytd: 18, target: 18,  status: "compliant" as StatusType },
];

const TRAINING = [
  { module: "Manual Handling",              total: 38, completed: 38, pct: 100 },
  { module: "Fatigue Management",           total: 38, completed: 36, pct: 95  },
  { module: "Load Safety & Securing",       total: 38, completed: 38, pct: 100 },
  { module: "Hazardous Materials Handling", total: 38, completed: 34, pct: 89  },
  { module: "Emergency Response",           total: 38, completed: 35, pct: 92  },
  { module: "Environmental Awareness",      total: 38, completed: 31, pct: 82  },
  { module: "Chain of Responsibility (CoR)",total: 38, completed: 38, pct: 100 },
  { module: "First Aid Refresher",          total: 12, completed: 10, pct: 83  },
];

const LEVY_PAYMENTS = [
  { quarter: "Q1 FY25-26", amount: 154200, paid: true,  dueDate: "31 Oct 2025" },
  { quarter: "Q2 FY25-26", amount: 148900, paid: true,  dueDate: "31 Jan 2026" },
  { quarter: "Q3 FY25-26", amount: 152400, paid: false, dueDate: "30 Apr 2026" },
  { quarter: "Q4 FY25-26", amount: 151000, paid: false, dueDate: "31 Jul 2026" },
];

const statusStyle: Record<StatusType, { label: string; bg: string; color: string; border: string }> = {
  compliant: { label: "Compliant", bg: "rgba(74,222,128,0.12)",   color: "#4ade80", border: "rgba(74,222,128,0.25)"   },
  due:       { label: "Due Soon",  bg: "rgba(245,158,11,0.12)",   color: "#f59e0b", border: "rgba(245,158,11,0.25)"   },
  overdue:   { label: "Overdue",   bg: "rgba(239,68,68,0.12)",    color: "#f87171", border: "rgba(239,68,68,0.25)"    },
  na:        { label: "N/A",       bg: "rgba(255,255,255,0.06)",  color: T3,        border: "rgba(255,255,255,0.12)"  },
};

export default function CompliancePage() {
  const avgTraining    = Math.round(TRAINING.reduce((s, r) => s + r.pct, 0) / TRAINING.length);
  const ltiCount       = SAFETY.find(s => s.category.includes("Lost Time"))!.count;
  const openConditions = EPA_CONDITIONS.filter(r => r.status !== "compliant").length;
  const levyOwed       = LEVY_PAYMENTS.filter(r => !r.paid).reduce((s, r) => s + r.amount, 0);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={PAGE}>
      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Reporting period: FY 2025–26 &nbsp;·&nbsp; As at {today}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
        <KpiCard label="EPA Conditions"        value={`${EPA_CONDITIONS.length - openConditions} / ${EPA_CONDITIONS.length}`} sub={openConditions > 0 ? `${openConditions} requiring action` : "All conditions met"} accent={openConditions === 0 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Lost Time Injuries YTD" value={ltiCount}                                sub="Target: 0 LTI"                             accent={ltiCount === 0 ? "#10b981" : "#ef4444"} />
        <KpiCard label="Training Completion"    value={`${avgTraining}%`}                       sub="Average across all modules"                accent={avgTraining >= 95 ? "#10b981" : avgTraining >= 85 ? "#f59e0b" : "#ef4444"} />
        <KpiCard label="Landfill Levy Outstanding" value={`$${levyOwed.toLocaleString()}`}      sub="Unpaid quarters — due dates upcoming"      accent="#8b5cf6" />
      </div>

      <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="EPA Licence & Regulatory Obligations" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "left" }}>Condition / Obligation</th>
              <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "center" }}>Status</th>
              <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "right" }}>Due / Frequency</th>
              <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "right" }}>Last Action</th>
              <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "left" }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {EPA_CONDITIONS.map((r, i) => {
              const s = statusStyle[r.status];
              const rowBg = r.status === "overdue" ? "rgba(239,68,68,0.06)" : r.status === "due" ? "rgba(245,158,11,0.06)" : "transparent";
              return (
                <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}`, background: rowBg }}>
                  <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{r.condition}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{s.label}</span>
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T3, fontSize: 12 }}>{r.due}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T3, fontSize: 12 }}>{r.lastAudit}</td>
                  <td style={{ padding: "10px 14px", color: T2, fontSize: 12 }}>{r.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
            <SectionHeader title="WHS Safety Performance" sub="This period and YTD" />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: ROW_HEAD }}>
                {["Category","This Period","YTD","Target"].map((h, i) => (
                  <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SAFETY.map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                  <td style={{ padding: "10px 14px", color: T2 }}>{r.category}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>{r.count}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{r.ytd}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T3, fontSize: 12 }}>{r.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "12px 20px", background: "rgba(74,222,128,0.08)", borderTop: `1px solid rgba(74,222,128,0.15)` }}>
            <p style={{ fontSize: 12, color: "#4ade80", fontWeight: 500, margin: 0 }}>✓ Zero Lost Time Injuries for 312 consecutive days</p>
          </div>
        </div>

        <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
            <SectionHeader title="SA EPA Landfill Levy Payments" sub="FY 2025–26 quarterly schedule" />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: ROW_HEAD }}>
                {["Quarter","Amount","Due Date","Status"].map((h, i) => (
                  <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : i === 3 ? "center" : "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEVY_PAYMENTS.map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}`, background: !r.paid ? "rgba(245,158,11,0.06)" : "transparent" }}>
                  <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{r.quarter}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${r.amount.toLocaleString()}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T3, fontSize: 12 }}>{r.dueDate}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: r.paid ? "rgba(74,222,128,0.12)" : "rgba(245,158,11,0.12)", color: r.paid ? "#4ade80" : "#f59e0b", border: `1px solid ${r.paid ? "rgba(74,222,128,0.25)" : "rgba(245,158,11,0.25)"}` }}>
                      {r.paid ? "Paid" : "Pending"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: ROW_HEAD, borderTop: `2px solid rgba(255,255,255,0.1)` }}>
                <td style={{ padding: "10px 14px", color: T1, fontWeight: 600 }}>FY Total</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${LEVY_PAYMENTS.reduce((s, r) => s + r.amount, 0).toLocaleString()}</td>
                <td colSpan={2} style={{ padding: "10px 14px", textAlign: "right", color: T3 }}>${levyOwed.toLocaleString()} outstanding</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div style={DC}>
        <SectionHeader title="Staff Training Completion" sub={`${TRAINING[0].total} staff — % completion per module`} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {TRAINING.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 13, color: T2, width: 256, flexShrink: 0 }}>{r.module}</span>
              <div style={{ flex: 1, height: 10, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${r.pct}%`, background: r.pct === 100 ? "#10b981" : r.pct >= 90 ? "#3b82f6" : r.pct >= 80 ? "#f59e0b" : "#ef4444" }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, width: 48, textAlign: "right", color: r.pct === 100 ? "#4ade80" : r.pct >= 90 ? "#60a5fa" : r.pct >= 80 ? "#f59e0b" : "#f87171" }}>{r.pct}%</span>
              <span style={{ fontSize: 12, color: T3, width: 80, textAlign: "right" }}>{r.completed}/{r.total} staff</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: T2 }}>Overall average completion</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: avgTraining >= 95 ? "#4ade80" : "#f59e0b" }}>{avgTraining}%</span>
        </div>
      </div>
    </div>
  );
}

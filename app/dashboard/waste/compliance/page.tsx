"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { KpiCard, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, DC, PAGE, TRACK, useWasteChart } from "../_dark";
import styles from "../WasteModule.module.css";

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
  compliant: { label: "Compliant", bg: "var(--status-success-muted)",   color: "var(--status-success)", border: "var(--status-success-border)"   },
  due:       { label: "Due Soon",  bg: "var(--status-warning-muted)",   color: "var(--status-warning)", border: "var(--status-warning-border)"   },
  overdue:   { label: "Overdue",   bg: "var(--status-danger-muted)",    color: "var(--status-danger)", border: "var(--status-danger-border)"    },
  na:        { label: "N/A",       bg: "var(--status-inactive-muted)",  color: T3,        border: "var(--border)"  },
};

export default function CompliancePage() {
  const chart = useWasteChart();
  const avgTraining    = Math.round(TRAINING.reduce((s, r) => s + r.pct, 0) / TRAINING.length);
  const ltiCount       = SAFETY.find(s => s.category.includes("Lost Time"))!.count;
  const openConditions = EPA_CONDITIONS.filter(r => r.status !== "compliant").length;
  const levyOwed       = LEVY_PAYMENTS.filter(r => !r.paid).reduce((s, r) => s + r.amount, 0);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={PAGE}>
      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Reporting period: FY 2025–26 &nbsp;·&nbsp; As at {today}</p>

      <div className={styles.kpiGrid}>
        <KpiCard label="EPA Conditions"        value={`${EPA_CONDITIONS.length - openConditions} / ${EPA_CONDITIONS.length}`} sub={openConditions > 0 ? `${openConditions} requiring action` : "All conditions met"} accent={chart.series(openConditions === 0 ? "#10b981" : "#f59e0b")} />
        <KpiCard label="Lost Time Injuries YTD" value={ltiCount}                                sub="Target: 0 LTI"                             accent={chart.series(ltiCount === 0 ? "#10b981" : "#ef4444")} />
        <KpiCard label="Training Completion"    value={`${avgTraining}%`}                       sub="Average across all modules"                accent={chart.series(avgTraining >= 95 ? "#10b981" : avgTraining >= 85 ? "#f59e0b" : "#ef4444")} />
        <KpiCard label="Landfill Levy Outstanding" value={`$${levyOwed.toLocaleString()}`}      sub="Unpaid quarters — due dates upcoming"      accent="var(--border-strong)" />
      </div>

      <div style={{ ...DC, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="EPA Licence & Regulatory Obligations" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              <th scope="col" style={{ padding: "10px 14px", fontWeight: 600, fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "left" }}>Condition / Obligation</th>
              <th scope="col" style={{ padding: "10px 14px", fontWeight: 600, fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "center" }}>Status</th>
              <th scope="col" style={{ padding: "10px 14px", fontWeight: 600, fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "right" }}>Due / Frequency</th>
              <th scope="col" style={{ padding: "10px 14px", fontWeight: 600, fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "right" }}>Last Action</th>
              <th scope="col" style={{ padding: "10px 14px", fontWeight: 600, fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: "left" }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {EPA_CONDITIONS.map((r, i) => {
              const s = statusStyle[r.status];
              const rowBg = r.status === "overdue" ? "var(--status-danger-muted)" : r.status === "due" ? "var(--status-warning-muted)" : "transparent";
              return (
                <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}`, background: rowBg }}>
                  <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{r.condition}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-sm)", background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{s.label}</span>
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2, fontSize: 12 }}>{r.due}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2, fontSize: 12 }}>{r.lastAudit}</td>
                  <td style={{ padding: "10px 14px", color: T2, fontSize: 12 }}>{r.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.grid2}>
        <div style={{ ...DC, padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
            <SectionHeader title="WHS Safety Performance" sub="This period and YTD" />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: ROW_HEAD }}>
                {["Category","This Period","YTD","Target"].map((h, i) => (
                  <th key={h} scope="col" style={{ padding: "10px 14px", fontWeight: 600, fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
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
          <div style={{ padding: "12px 20px", background: "var(--status-success-muted)", borderTop: `1px solid var(--status-success-border)` }}>
            <p style={{ fontSize: 12, color: "var(--status-success)", fontWeight: 500, margin: 0 }}>✓ Zero Lost Time Injuries for 312 consecutive days</p>
          </div>
        </div>

        <div style={{ ...DC, padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
            <SectionHeader title="SA EPA Landfill Levy Payments" sub="FY 2025–26 quarterly schedule" />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: ROW_HEAD }}>
                {["Quarter","Amount","Due Date","Status"].map((h, i) => (
                  <th key={h} scope="col" style={{ padding: "10px 14px", fontWeight: 600, fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : i === 3 ? "center" : "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEVY_PAYMENTS.map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}`, background: !r.paid ? "var(--status-warning-muted)" : "transparent" }}>
                  <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{r.quarter}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${r.amount.toLocaleString()}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2, fontSize: 12 }}>{r.dueDate}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-sm)", background: r.paid ? "var(--status-success-muted)" : "var(--status-warning-muted)", color: r.paid ? "var(--status-success)" : "var(--status-warning)", border: `1px solid ${r.paid ? "var(--status-success-border)" : "var(--status-warning-border)"}` }}>
                      {r.paid ? "Paid" : "Pending"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: ROW_HEAD, borderTop: `2px solid var(--border-strong)` }}>
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
            <div key={i} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 16, rowGap: 6 }}>
              <span style={{ fontSize: 13, color: T2, width: 256, maxWidth: "100%", flexShrink: 0 }}>{r.module}</span>
              <div style={{ flex: 1, minWidth: 120, height: 10, background: TRACK, borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${r.pct}%`, background: chart.series(r.pct === 100 ? "#10b981" : r.pct >= 90 ? "#3b82f6" : r.pct >= 80 ? "#f59e0b" : "#ef4444") }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, width: 48, textAlign: "right", color: r.pct === 100 ? "var(--status-success)" : r.pct >= 90 ? "var(--status-info)" : r.pct >= 80 ? "var(--status-warning)" : "var(--status-danger)" }}>{r.pct}%</span>
              <span style={{ fontSize: 12, color: T3, width: 80, textAlign: "right" }}>{r.completed}/{r.total} staff</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: T2 }}>Overall average completion</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: avgTraining >= 95 ? "var(--status-success)" : "var(--status-warning)" }}>{avgTraining}%</span>
        </div>
      </div>
    </div>
  );
}

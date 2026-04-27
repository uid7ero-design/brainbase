"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, Cell, ReferenceLine,
} from "recharts";
import { KpiCard, Insight, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, GRID, TICK, DTT, DC, PAGE } from "../_dark";

const DATA = [
  { zone: "Zone 1 – Northern",   planned: 11360, completed: 11248, missed: 112, contamination: 8.2,  gwLifts: 5680, recLifts: 2840, gwLifts2: 2840 },
  { zone: "Zone 2 – Central",    planned: 10440, completed: 10384, missed: 56,  contamination: 7.5,  gwLifts: 5220, recLifts: 2610, gwLifts2: 2610 },
  { zone: "Zone 3 – Eastern",    planned: 12880, completed: 12701, missed: 179, contamination: 9.1,  gwLifts: 6440, recLifts: 3220, gwLifts2: 3220 },
  { zone: "Zone 4 – Southern",   planned:  9920, completed:  9876, missed: 44,  contamination: 6.8,  gwLifts: 4960, recLifts: 2480, gwLifts2: 2480 },
  { zone: "Zone 5 – Western",    planned: 11800, completed: 11682, missed: 118, contamination: 8.8,  gwLifts: 5900, recLifts: 2950, gwLifts2: 2950 },
  { zone: "Zone 6 – Coastal",    planned: 13600, completed: 13353, missed: 247, contamination: 10.2, gwLifts: 6800, recLifts: 3400, gwLifts2: 3400 },
  { zone: "Zone 7 – Hills",      planned:  9240, completed:  9198, missed: 42,  contamination: 6.2,  gwLifts: 4620, recLifts: 2310, gwLifts2: 2310 },
  { zone: "Zone 8 – Industrial", planned: 12200, completed: 11993, missed: 207, contamination: 9.5,  gwLifts: 6100, recLifts: 3050, gwLifts2: 3050 },
  { zone: "Zone 9 – Suburban",   planned: 10240, completed: 10181, missed: 59,  contamination: 7.1,  gwLifts: 5120, recLifts: 2560, gwLifts2: 2560 },
  { zone: "Zone 10 – Riverside", planned: 11120, completed: 11020, missed: 100, contamination: 7.8,  gwLifts: 5560, recLifts: 2780, gwLifts2: 2780 },
].map(r => ({
  ...r,
  completionRate: +((r.completed / r.planned) * 100).toFixed(1),
  shortId: r.zone.split("–")[0].trim(),
}));

const WEEKLY_TREND = [
  { week: "Wk 1", completed: 2751, missed: 29, contamination: 7.9 },
  { week: "Wk 2", completed: 2788, missed: 22, contamination: 8.1 },
  { week: "Wk 3", completed: 2743, missed: 37, contamination: 8.4 },
  { week: "Wk 4", completed: 2753, missed: 37, contamination: 8.3 },
];

const STREAM_DATA = [
  { stream: "General Waste", lifts: DATA.reduce((s, r) => s + r.gwLifts, 0),  color: "#3b82f6" },
  { stream: "Recycling",     lifts: DATA.reduce((s, r) => s + r.recLifts, 0), color: "#10b981" },
  { stream: "Green Waste",   lifts: DATA.reduce((s, r) => s + r.gwLifts2, 0), color: "#f59e0b" },
];

export default function BinLiftsPage() {
  const totalPlanned   = DATA.reduce((s, r) => s + r.planned, 0);
  const totalCompleted = DATA.reduce((s, r) => s + r.completed, 0);
  const totalMissed    = DATA.reduce((s, r) => s + r.missed, 0);
  const completionRate = ((totalCompleted / totalPlanned) * 100).toFixed(1);
  const avgContam      = (DATA.reduce((s, r) => s + r.contamination, 0) / DATA.length).toFixed(1);
  const worstContam    = DATA.reduce((max, r) => r.contamination > max.contamination ? r : max, DATA[0]);
  const mostMissed     = DATA.reduce((max, r) => r.missed > max.missed ? r : max, DATA[0]);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={PAGE}>

      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Period: {today} &nbsp;·&nbsp; All waste streams</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16 }}>
        <KpiCard label="Total Planned Lifts"  value={totalPlanned.toLocaleString()}   sub="This period"          accent="#3b82f6" />
        <KpiCard label="Completed Lifts"      value={totalCompleted.toLocaleString()}  sub="Across all zones"     accent="#10b981" />
        <KpiCard label="Missed Lifts"         value={totalMissed.toLocaleString()}     sub="Requiring follow-up"  accent="#ef4444" />
        <KpiCard label="Completion Rate"      value={`${completionRate}%`}             sub="Target ≥ 98.5%"       accent={+completionRate >= 98.5 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Avg Contamination"    value={`${avgContam}%`}                  sub="Target ≤ 8.0%"        accent={+avgContam <= 8.0 ? "#10b981" : "#ef4444"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
        <Insight icon="✗" color="red"
          title={`${mostMissed.shortId} has most missed lifts`}
          body={`${mostMissed.missed} missed lifts (${(100 - mostMissed.completionRate).toFixed(1)}% miss rate). Investigate route capacity and crew availability for this zone.`}
        />
        <Insight icon="⚠" color="amber"
          title={`${worstContam.shortId} contamination at ${worstContam.contamination}%`}
          body={`Exceeds the 8% benchmark. Recommend targeted resident education campaign and bin audits in this zone to reduce recycling contamination.`}
        />
        <Insight icon="✓" color="green"
          title="7 of 10 zones within KPI targets"
          body={`Overall completion rate of ${completionRate}% across ${totalPlanned.toLocaleString()} scheduled lifts. Continued focus needed on Zones 3, 6 and 8.`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Completed vs Missed Lifts by Zone" sub="Monthly totals per collection zone" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={DATA} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => v.toLocaleString()} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[3,3,0,0]} />
              <Bar dataKey="missed"    name="Missed"    fill="#ef4444" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={DC}>
          <SectionHeader title="Recycling Contamination Rate by Zone" sub="% of recycling bins containing non-recyclable material" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={DATA} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 14]} />
              <ReferenceLine y={8} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "8% Target", position: "insideTopRight", fill: "#f59e0b", fontSize: 11 }} />
              <Tooltip formatter={v => [`${v}%`, "Contamination"]} contentStyle={DTT} />
              <Bar dataKey="contamination" name="Contamination %" radius={[3,3,0,0]}>
                {DATA.map((r, i) => <Cell key={i} fill={r.contamination > 8 ? "#ef4444" : "#10b981"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Lifts by Stream" sub="Total lifts per waste stream this period" />
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
            {STREAM_DATA.map(s => (
              <div key={s.stream}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: T1, fontWeight: 500 }}>{s.stream}</span>
                  <span style={{ color: T2 }}>{s.lifts.toLocaleString()}</span>
                </div>
                <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 999, width: `${(s.lifts / STREAM_DATA[0].lifts) * 100}%`, background: s.color }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: T2 }}>Total lifts</span>
            <span style={{ color: T1, fontWeight: 600 }}>{STREAM_DATA.reduce((s, r) => s + r.lifts, 0).toLocaleString()}</span>
          </div>
        </div>

        <div style={DC}>
          <SectionHeader title="Weekly Lift Performance" sub="Completed lifts and missed lifts over the current period" />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={WEEKLY_TREND} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="week" tick={{ fill: TICK, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left"  tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Bar yAxisId="left" dataKey="completed" name="Completed" fill="#3b82f6" radius={[3,3,0,0]} />
              <Bar yAxisId="left" dataKey="missed"    name="Missed"    fill="#ef4444" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="Zone Lift Summary" sub="Planned, completed, missed and contamination rate per zone" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {["Zone","Planned","Completed","Missed","Completion Rate","Contamination","Status"].map((h, i) => (
                <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DATA.map((row, i) => {
              const ok = row.completionRate >= 98.5 && row.contamination <= 8;
              return (
                <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                  <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{row.zone}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{row.planned.toLocaleString()}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{row.completed.toLocaleString()}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: "#f87171", fontWeight: 600 }}>{row.missed}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    <span style={{ fontWeight: 600, color: row.completionRate >= 98.5 ? "#4ade80" : "#f59e0b" }}>{row.completionRate}%</span>
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    <span style={{ fontWeight: 600, color: row.contamination <= 8 ? "#4ade80" : "#f87171" }}>{row.contamination}%</span>
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: ok ? "rgba(74,222,128,0.12)" : "rgba(239,68,68,0.12)", color: ok ? "#4ade80" : "#f87171", border: `1px solid ${ok ? "rgba(74,222,128,0.25)" : "rgba(239,68,68,0.25)"}` }}>
                      {ok ? "On Target" : "Needs Review"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

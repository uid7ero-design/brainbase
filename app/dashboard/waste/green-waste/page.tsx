"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, Cell, AreaChart, Area,
} from "recharts";
import { KpiCard, Insight, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, GRID, TICK, DTT, DC, PAGE } from "../_dark";

const ZONE_DATA = [
  { zone: "Zone 1 – Northern",   collected: 23, composted: 20, contamination: 5.1, households: 2840 },
  { zone: "Zone 2 – Central",    collected: 20, composted: 18, contamination: 4.8, households: 2610 },
  { zone: "Zone 3 – Eastern",    collected: 27, composted: 23, contamination: 6.8, households: 3220 },
  { zone: "Zone 4 – Southern",   collected: 18, composted: 17, contamination: 3.9, households: 2480 },
  { zone: "Zone 5 – Western",    collected: 23, composted: 20, contamination: 5.4, households: 2950 },
  { zone: "Zone 6 – Coastal",    collected: 28, composted: 23, contamination: 8.2, households: 3400 },
  { zone: "Zone 7 – Hills",      collected: 18, composted: 17, contamination: 3.2, households: 2310 },
  { zone: "Zone 8 – Industrial", collected: 26, composted: 22, contamination: 6.5, households: 3050 },
  { zone: "Zone 9 – Suburban",   collected: 18, composted: 16, contamination: 4.3, households: 2560 },
  { zone: "Zone 10 – Riverside", collected: 21, composted: 19, contamination: 4.9, households: 2780 },
].map(r => ({
  ...r,
  rejected: r.collected - r.composted,
  shortId: r.zone.split("–")[0].trim(),
  kgPerHH: +((r.collected * 1000) / r.households).toFixed(1),
}));

const MONTHLY = [
  { month: "Oct 25", collected: 222, composted: 198, contamination: 5.2, compostValue: 6930 },
  { month: "Nov 25", collected: 218, composted: 196, contamination: 5.0, compostValue: 6860 },
  { month: "Dec 25", collected: 210, composted: 185, contamination: 5.8, compostValue: 6475 },
  { month: "Jan 26", collected: 195, composted: 168, contamination: 7.4, compostValue: 5880 },
  { month: "Feb 26", collected: 205, composted: 181, contamination: 6.8, compostValue: 6335 },
  { month: "Mar 26", collected: 222, composted: 195, contamination: 5.4, compostValue: 6825 },
];

const COMPOST_PRICE_PER_T = 35;
const TARGET_CONTAM = 5.0;

export default function GreenWastePage() {
  const totalCollected = ZONE_DATA.reduce((s, r) => s + r.collected, 0);
  const totalComposted = ZONE_DATA.reduce((s, r) => s + r.composted, 0);
  const totalRejected  = totalCollected - totalComposted;
  const avgContam      = +(ZONE_DATA.reduce((s, r) => s + r.contamination, 0) / ZONE_DATA.length).toFixed(1);
  const compostRevenue = Math.round(totalComposted * COMPOST_PRICE_PER_T);
  const worstContam    = ZONE_DATA.reduce((max, r) => r.contamination > max.contamination ? r : max, ZONE_DATA[0]);
  const yieldRate      = +((totalComposted / totalCollected) * 100).toFixed(1);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={PAGE}>
      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Period: {today} &nbsp;·&nbsp; Fortnightly collection — all zones</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16 }}>
        <KpiCard label="Total Collected"        value={`${totalCollected} t`}                   sub="All zones this period"               accent="#10b981" />
        <KpiCard label="Total Composted"         value={`${totalComposted} t`}                   sub={`${yieldRate}% compost yield`}       accent="#22c55e" />
        <KpiCard label="Rejected / Contaminated" value={`${totalRejected} t`}                   sub="Diverted to landfill — avoidable"    accent="#ef4444" />
        <KpiCard label="Avg Contamination Rate"  value={`${avgContam}%`}                         sub={`Target ≤ ${TARGET_CONTAM}%`}        accent={avgContam <= TARGET_CONTAM ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Compost Revenue"         value={`$${compostRevenue.toLocaleString()}`}   sub={`$${COMPOST_PRICE_PER_T}/t to local market`} accent="#3b82f6" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
        <Insight icon="⚠" color={avgContam > TARGET_CONTAM ? "amber" : "green"}
          title={`Contamination averaging ${avgContam}% — target ${TARGET_CONTAM}%`}
          body={`${totalRejected} tonnes rejected and sent to landfill this period. Reducing contamination to ${TARGET_CONTAM}% would recover ~${Math.round(totalRejected * 0.5)} additional tonnes and save ~$${Math.round(totalRejected * 0.5 * 148.5).toLocaleString()} in levy.`}
        />
        <Insight icon="🌱" color="green"
          title={`$${compostRevenue.toLocaleString()} in compost revenue this period`}
          body={`${totalComposted} tonnes processed into compost at $${COMPOST_PRICE_PER_T}/t. Revenue flows back to offset collection costs. Improving yield from ${yieldRate}% to 92% would add ~$${Math.round((totalCollected * 0.92 - totalComposted) * COMPOST_PRICE_PER_T).toLocaleString()}.`}
        />
        <Insight icon="⚠" color="red"
          title={`${worstContam.shortId} at ${worstContam.contamination}% contamination`}
          body={`${worstContam.zone} has the highest contamination rate. Common contaminants include plastic bags and food waste. Targeted bin tag notification and letterbox campaign recommended.`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Green Waste Collected vs Composted by Zone" sub="Composted yield and rejected material (contaminated)" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={ZONE_DATA} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}t`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => `${v} t`} contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Bar dataKey="composted" name="Composted" stackId="a" fill="#10b981" />
              <Bar dataKey="rejected"  name="Rejected"  stackId="a" fill="#ef4444" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={DC}>
          <SectionHeader title="Contamination Rate by Zone" sub={`% contaminated — target ≤ ${TARGET_CONTAM}%`} />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={ZONE_DATA} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 12]} />
              <Tooltip formatter={v => `${v}%`} contentStyle={DTT} />
              <Bar dataKey="contamination" name="Contamination %" radius={[3,3,0,0]}>
                {ZONE_DATA.map((r, i) => <Cell key={i} fill={r.contamination > TARGET_CONTAM ? "#ef4444" : "#10b981"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={DC}>
        <SectionHeader title="Monthly Green Waste Trend" sub="Collected, composted and compost revenue Oct 2025 – Mar 2026" />
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={MONTHLY}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left"  tickFormatter={v => `${v}t`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={DTT} />
            <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
            <Area yAxisId="left"  type="monotone" dataKey="collected" name="Collected (t)"  stroke="rgba(255,255,255,0.3)" fill="rgba(255,255,255,0.05)" strokeWidth={1.5} />
            <Area yAxisId="left"  type="monotone" dataKey="composted" name="Composted (t)"  stroke="#10b981" fill="rgba(16,185,129,0.15)" strokeWidth={2} />
            <Line yAxisId="right" type="monotone" dataKey="compostValue" name="Compost Revenue" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="Zone Green Waste Summary" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {["Zone","Collected (t)","Composted (t)","Rejected (t)","Yield %","Contamination","kg / HH","Compost Revenue"].map((h, i) => (
                <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ZONE_DATA.map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{r.zone}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{r.collected}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: "#4ade80", fontWeight: 500 }}>{r.composted}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: "#f87171" }}>{r.rejected}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{((r.composted/r.collected)*100).toFixed(0)}%</td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}><span style={{ fontWeight: 600, color: r.contamination > TARGET_CONTAM ? "#f87171" : "#4ade80" }}>{r.contamination}%</span></td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T3 }}>{r.kgPerHH}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: "#60a5fa", fontWeight: 500 }}>${Math.round(r.composted * COMPOST_PRICE_PER_T).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: ROW_HEAD, borderTop: `2px solid rgba(255,255,255,0.1)` }}>
              <td style={{ padding: "10px 14px", color: T1, fontWeight: 600 }}>Total</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>{totalCollected}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: "#4ade80", fontWeight: 600 }}>{totalComposted}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: "#f87171", fontWeight: 600 }}>{totalRejected}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>{yieldRate}%</td>
              <td style={{ padding: "10px 14px", textAlign: "right" }}><span style={{ fontWeight: 600, color: avgContam > TARGET_CONTAM ? "#f87171" : "#4ade80" }}>{avgContam}%</span></td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T3 }}>—</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: "#60a5fa", fontWeight: 600 }}>${compostRevenue.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

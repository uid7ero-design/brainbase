"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, PieChart, Pie, Cell, ReferenceLine,
} from "recharts";
import { KpiCard, Insight, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, GRID, TICK, DTT, DC, PAGE } from "../_dark";

const LANDFILL_LEVY = 148.50;
const CO2_RECYCLING = 1.1;
const CO2_GREEN     = 0.5;

const ZONE_DATA = [
  { zone: "Zone 1 – Northern",   general: 87,  recycling: 52, green: 23, total: 162 },
  { zone: "Zone 2 – Central",    general: 82,  recycling: 47, green: 20, total: 149 },
  { zone: "Zone 3 – Eastern",    general: 108, recycling: 63, green: 27, total: 198 },
  { zone: "Zone 4 – Southern",   general: 77,  recycling: 43, green: 18, total: 138 },
  { zone: "Zone 5 – Western",    general: 93,  recycling: 55, green: 23, total: 171 },
  { zone: "Zone 6 – Coastal",    general: 111, recycling: 66, green: 28, total: 205 },
  { zone: "Zone 7 – Hills",      general: 70,  recycling: 40, green: 18, total: 128 },
  { zone: "Zone 8 – Industrial", general: 101, recycling: 60, green: 26, total: 187 },
  { zone: "Zone 9 – Suburban",   general: 79,  recycling: 47, green: 18, total: 144 },
  { zone: "Zone 10 – Riverside", general: 85,  recycling: 51, green: 21, total: 157 },
].map(r => ({
  ...r,
  diverted: r.recycling + r.green,
  diversionRate: +(((r.recycling + r.green) / r.total) * 100).toFixed(1),
  levyCost: Math.round(r.general * LANDFILL_LEVY),
  co2Saved: +((r.recycling * CO2_RECYCLING + r.green * CO2_GREEN)).toFixed(1),
  shortId: r.zone.split("–")[0].trim(),
}));

const MONTHLY = [
  { month: "Oct 25", general: 820, recycling: 530, green: 240, rate: 48.2 },
  { month: "Nov 25", general: 830, recycling: 525, green: 235, rate: 47.8 },
  { month: "Dec 25", general: 855, recycling: 510, green: 225, rate: 46.5 },
  { month: "Jan 26", general: 880, recycling: 500, green: 215, rate: 45.1 },
  { month: "Feb 26", general: 860, recycling: 515, green: 220, rate: 46.8 },
  { month: "Mar 26", general: 840, recycling: 520, green: 231, rate: 47.2 },
];

const STREAM_COLORS = { general: "#64748b", recycling: "#3b82f6", green: "#10b981" };
const PIE_COLORS = ["#64748b", "#3b82f6", "#10b981"];
const TARGET_DIVERSION = 50;

export default function DiversionPage() {
  const totalGeneral   = ZONE_DATA.reduce((s, r) => s + r.general, 0);
  const totalRecycling = ZONE_DATA.reduce((s, r) => s + r.recycling, 0);
  const totalGreen     = ZONE_DATA.reduce((s, r) => s + r.green, 0);
  const totalTonnage   = ZONE_DATA.reduce((s, r) => s + r.total, 0);
  const totalDiverted  = totalRecycling + totalGreen;
  const diversionRate  = +((totalDiverted / totalTonnage) * 100).toFixed(1);
  const totalLevy      = ZONE_DATA.reduce((s, r) => s + r.levyCost, 0);
  const totalCO2       = +ZONE_DATA.reduce((s, r) => s + r.co2Saved, 0).toFixed(1);
  const gapToTarget    = +(TARGET_DIVERSION - diversionRate).toFixed(1);

  const streamPie = [
    { name: "General Waste (Landfill)", value: totalGeneral },
    { name: "Recycling",                value: totalRecycling },
    { name: "Green Waste / Compost",    value: totalGreen },
  ];

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={PAGE}>
      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Period: {today} &nbsp;·&nbsp; SA EPA Landfill Levy: ${LANDFILL_LEVY}/tonne</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16 }}>
        <KpiCard label="Diversion Rate"        value={`${diversionRate}%`}              sub={`Target: ${TARGET_DIVERSION}% · Gap: ${gapToTarget}%`} accent={diversionRate >= TARGET_DIVERSION ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Tonnes Diverted"       value={`${totalDiverted.toLocaleString()} t`} sub="Recycling + green waste"              accent="#3b82f6" />
        <KpiCard label="Tonnes to Landfill"    value={`${totalGeneral.toLocaleString()} t`}  sub={`${((totalGeneral/totalTonnage)*100).toFixed(0)}% of total collected`} accent="#ef4444" />
        <KpiCard label="Landfill Levy Cost"    value={`$${totalLevy.toLocaleString()}`}       sub="At $148.50/tonne (SA EPA)"           accent="#8b5cf6" />
        <KpiCard label="CO₂-e Saved"           value={`${totalCO2} t`}                        sub="vs sending all waste to landfill"    accent="#10b981" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
        <Insight icon="♻" color={diversionRate >= TARGET_DIVERSION ? "green" : "amber"}
          title={`Diversion at ${diversionRate}% — target is ${TARGET_DIVERSION}%`}
          body={`Diverting an additional ${Math.ceil(totalGeneral * (gapToTarget / 100)).toLocaleString()} tonnes/month would close the gap. Focus: reduce landfill stream contamination to improve recycling yield.`}
        />
        <Insight icon="💰" color="red"
          title={`Landfill levy costing $${totalLevy.toLocaleString()}/month`}
          body={`Every tonne diverted from landfill saves $${LANDFILL_LEVY}. Hitting the ${TARGET_DIVERSION}% target would save ~$${Math.round(totalGeneral * (gapToTarget/100) * LANDFILL_LEVY).toLocaleString()}/month in levy.`}
        />
        <Insight icon="🌱" color="green"
          title={`${totalCO2} tonnes CO₂-e avoided this period`}
          body={`Equivalent to removing ~${Math.round(totalCO2 / 2.3)} cars from the road for a month. Green waste composting alone saves ${(totalGreen * CO2_GREEN).toFixed(0)} t CO₂-e vs landfill methane.`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Monthly Waste Stream Tonnage" sub="General waste (landfill), recycling and green waste — Oct 2025 to Mar 2026" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={MONTHLY} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}t`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={DTT} formatter={v => `${v} t`} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Bar dataKey="general"   name="General Waste" stackId="a" fill={STREAM_COLORS.general} />
              <Bar dataKey="recycling" name="Recycling"      stackId="a" fill={STREAM_COLORS.recycling} />
              <Bar dataKey="green"     name="Green Waste"    stackId="a" fill={STREAM_COLORS.green} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ ...DC, display: "flex", flexDirection: "column" }}>
          <SectionHeader title="Stream Composition" sub="Current period total" />
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={streamPie} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {streamPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={v => `${v} t`} contentStyle={DTT} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {streamPie.map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: PIE_COLORS[i] }} />
                  <span style={{ color: T2 }}>{s.name}</span>
                </div>
                <span style={{ fontWeight: 600, color: T1 }}>{((s.value / totalTonnage) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Diversion Rate Trend" sub={`Monthly % vs ${TARGET_DIVERSION}% target`} />
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={MONTHLY}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[42, 52]} />
              <ReferenceLine y={TARGET_DIVERSION} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: `${TARGET_DIVERSION}% Target`, position: "insideTopRight", fill: "#f59e0b", fontSize: 11 }} />
              <Tooltip formatter={v => `${v}%`} contentStyle={DTT} />
              <Line type="monotone" dataKey="rate" name="Diversion Rate" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={DC}>
          <SectionHeader title="Diversion Rate by Zone" sub="Recycling + green waste as % of total tonnage" />
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={ZONE_DATA} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 60]} />
              <YAxis type="category" dataKey="shortId" width={80} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <ReferenceLine x={TARGET_DIVERSION} stroke="#f59e0b" strokeDasharray="4 4" />
              <Tooltip formatter={v => `${v}%`} contentStyle={DTT} />
              <Bar dataKey="diversionRate" name="Diversion %" radius={[0,4,4,0]}>
                {ZONE_DATA.map((r, i) => <Cell key={i} fill={r.diversionRate >= TARGET_DIVERSION ? "#10b981" : "#3b82f6"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="Zone Diversion Summary" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {["Zone","General (t)","Recycling (t)","Green (t)","Total (t)","Diversion Rate","Levy Cost","CO₂ Saved","vs Target"].map((h, i) => (
                <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ZONE_DATA.map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{r.zone}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{r.general}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: "#60a5fa" }}>{r.recycling}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: "#4ade80" }}>{r.green}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{r.total}</td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  <span style={{ fontWeight: 600, color: r.diversionRate >= TARGET_DIVERSION ? "#4ade80" : "#f59e0b" }}>{r.diversionRate}%</span>
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: "#f87171" }}>${r.levyCost.toLocaleString()}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: "#4ade80" }}>{r.co2Saved} t</td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: r.diversionRate >= TARGET_DIVERSION ? "#4ade80" : "#f59e0b" }}>
                    {r.diversionRate >= TARGET_DIVERSION ? `+${(r.diversionRate - TARGET_DIVERSION).toFixed(1)}%` : `-${(TARGET_DIVERSION - r.diversionRate).toFixed(1)}%`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: ROW_HEAD, borderTop: `2px solid rgba(255,255,255,0.1)` }}>
              <td style={{ padding: "10px 14px", color: T1, fontWeight: 600 }}>Total</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>{totalGeneral}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: "#60a5fa", fontWeight: 600 }}>{totalRecycling}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: "#4ade80", fontWeight: 600 }}>{totalGreen}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>{totalTonnage}</td>
              <td style={{ padding: "10px 14px", textAlign: "right" }}><span style={{ fontWeight: 600, color: diversionRate >= TARGET_DIVERSION ? "#4ade80" : "#f59e0b" }}>{diversionRate}%</span></td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: "#f87171", fontWeight: 600 }}>${totalLevy.toLocaleString()}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: "#4ade80", fontWeight: 600 }}>{totalCO2} t</td>
              <td style={{ padding: "10px 14px", textAlign: "right" }}><span style={{ fontWeight: 600, color: gapToTarget <= 0 ? "#4ade80" : "#f59e0b" }}>{gapToTarget <= 0 ? `+${Math.abs(gapToTarget)}%` : `-${gapToTarget}%`}</span></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

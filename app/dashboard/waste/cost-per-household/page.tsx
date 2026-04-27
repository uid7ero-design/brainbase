"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, ReferenceLine, Cell,
} from "recharts";
import { KpiCard, Insight, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, GRID, TICK, DTT, DC, PAGE } from "../_dark";

const ZONE_DATA = [
  { zone: "Zone 1 – Northern",   households: 2840, total: 25900, general: 14200, recycling: 8400, green: 3300 },
  { zone: "Zone 2 – Central",    households: 2610, total: 23200, general: 12700, recycling: 7500, green: 3000 },
  { zone: "Zone 3 – Eastern",    households: 3220, total: 34800, general: 19100, recycling: 11200, green: 4500 },
  { zone: "Zone 4 – Southern",   households: 2480, total: 21400, general: 11700, recycling: 6900, green: 2800 },
  { zone: "Zone 5 – Western",    households: 2950, total: 28500, general: 15600, recycling: 9200, green: 3700 },
  { zone: "Zone 6 – Coastal",    households: 3400, total: 37200, general: 20400, recycling: 12000, green: 4800 },
  { zone: "Zone 7 – Hills",      households: 2310, total: 20400, general: 11200, recycling: 6600, green: 2600 },
  { zone: "Zone 8 – Industrial", households: 3050, total: 31700, general: 17400, recycling: 10200, green: 4100 },
  { zone: "Zone 9 – Suburban",   households: 2560, total: 22400, general: 12300, recycling: 7200, green: 2900 },
  { zone: "Zone 10 – Riverside", households: 2780, total: 25800, general: 14100, recycling: 8300, green: 3400 },
].map(r => ({
  ...r,
  cph:        +(r.total      / r.households).toFixed(2),
  cphGeneral: +(r.general    / r.households).toFixed(2),
  cphRecycle: +(r.recycling  / r.households).toFixed(2),
  cphGreen:   +(r.green      / r.households).toFixed(2),
  shortId:    r.zone.split("–")[0].trim(),
}));

const MONTHLY_TREND = [
  { month: "Oct 25", cph: 8.74, general: 5.82, recycling: 1.94, green: 0.98, target: 9.20 },
  { month: "Nov 25", cph: 8.48, general: 5.65, recycling: 1.88, green: 0.95, target: 9.20 },
  { month: "Dec 25", cph: 8.58, general: 5.71, recycling: 1.91, green: 0.96, target: 9.20 },
  { month: "Jan 26", cph: 10.69, general: 7.12, recycling: 2.37, green: 1.20, target: 9.20 },
  { month: "Feb 26", cph: 10.27, general: 6.84, recycling: 2.28, green: 1.15, target: 9.20 },
  { month: "Mar 26", cph: 9.78,  general: 6.51, recycling: 2.17, green: 1.10, target: 9.20 },
];

const TARGET_CPH = 9.20;

export default function CostPerHouseholdPage() {
  const totalHH    = ZONE_DATA.reduce((s, r) => s + r.households, 0);
  const totalCost  = ZONE_DATA.reduce((s, r) => s + r.total, 0);
  const avgCph     = +(totalCost / totalHH).toFixed(2);
  const bestZone   = ZONE_DATA.reduce((min, r) => r.cph < min.cph ? r : min, ZONE_DATA[0]);
  const worstZone  = ZONE_DATA.reduce((max, r) => r.cph > max.cph ? r : max, ZONE_DATA[0]);
  const varToTarget = +(avgCph - TARGET_CPH).toFixed(2);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={PAGE}>

      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Period: {today} &nbsp;·&nbsp; {totalHH.toLocaleString()} households across {ZONE_DATA.length} zones</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
        <KpiCard label="Avg Cost per Household" value={`$${avgCph}`}               sub={`Budget target: $${TARGET_CPH}`}                 accent="#3b82f6" />
        <KpiCard label="Variance to Target"      value={`${varToTarget > 0 ? "+" : ""}$${varToTarget}`} sub={varToTarget > 0 ? "Over budget" : "Under budget"} accent={varToTarget > 0 ? "#ef4444" : "#10b981"} />
        <KpiCard label="Best Performing Zone"    value={bestZone.shortId}          sub={`$${bestZone.cph}/household`}                    accent="#10b981" />
        <KpiCard label="Highest Cost Zone"       value={worstZone.shortId}         sub={`$${worstZone.cph}/household`}                   accent="#ef4444" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
        <Insight icon="📊" color="blue"
          title={`6-month average: $${(MONTHLY_TREND.reduce((s, r) => s + r.cph, 0) / MONTHLY_TREND.length).toFixed(2)}/HH`}
          body={`Jan–Feb peaks reflect seasonal summer demand. Average is tracking ${varToTarget > 0 ? "above" : "below"} the $${TARGET_CPH} annual target.`}
        />
        <Insight icon="♻" color="green"
          title="Recycling service is most cost-efficient"
          body={`Average recycling cost of $${(ZONE_DATA.reduce((s,r)=>s+r.cphRecycle,0)/ZONE_DATA.length).toFixed(2)}/HH — the lowest per-service cost. Consider expanding recycling frequency.`}
        />
        <Insight icon="⚠" color="amber"
          title={`${worstZone.shortId} is $${(worstZone.cph - bestZone.cph).toFixed(2)} above best zone`}
          body={`A ${((worstZone.cph - bestZone.cph) / bestZone.cph * 100).toFixed(0)}% gap between ${worstZone.shortId} and ${bestZone.shortId}. Route restructuring could reduce this gap significantly.`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Cost per Household by Zone" sub={`Compared to $${TARGET_CPH} target (dashed line)`} />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={ZONE_DATA} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${v}`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 14]} />
              <ReferenceLine y={TARGET_CPH} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: `$${TARGET_CPH} Target`, position: "insideTopRight", fill: "#f59e0b", fontSize: 11 }} />
              <Tooltip formatter={v => [`$${v}`, "Cost/HH"]} contentStyle={DTT} />
              <Bar dataKey="cph" name="Cost per Household" radius={[3,3,0,0]}>
                {ZONE_DATA.map((r, i) => <Cell key={i} fill={r.cph > TARGET_CPH ? "#ef4444" : "#3b82f6"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={DC}>
          <SectionHeader title="Monthly Cost per Household Trend" sub="Oct 2025 – Mar 2026 vs budget target" />
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={MONTHLY_TREND}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${v}`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[7, 12]} />
              <Tooltip formatter={v => `$${v}`} contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Line type="monotone" dataKey="cph"    name="Actual $/HH" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="target" name="Target"      stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={DC}>
        <SectionHeader title="Cost per Household by Service Type & Zone" sub="General waste, recycling and green waste split per household" />
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={ZONE_DATA} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="shortId" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `$${v}`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip formatter={v => `$${v}/HH`} contentStyle={DTT} />
            <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
            <Bar dataKey="cphGeneral" name="General Waste" fill="#3b82f6" radius={[3,3,0,0]} />
            <Bar dataKey="cphRecycle" name="Recycling"     fill="#10b981" radius={[3,3,0,0]} />
            <Bar dataKey="cphGreen"   name="Green Waste"   fill="#f59e0b" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="Zone Household Cost Summary" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {["Zone","Households","Total Cost","$/HH","General $/HH","Recycling $/HH","Green $/HH","vs Target"].map((h, i) => (
                <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ZONE_DATA.map((row, i) => {
              const diff = +(row.cph - TARGET_CPH).toFixed(2);
              return (
                <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                  <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{row.zone}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{row.households.toLocaleString()}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${row.total.toLocaleString()}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${row.cph}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${row.cphGeneral}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${row.cphRecycle}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${row.cphGreen}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: diff > 0 ? "#f87171" : "#4ade80" }}>
                      {diff > 0 ? `+$${diff}` : `-$${Math.abs(diff)}`}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: ROW_HEAD, borderTop: `2px solid rgba(255,255,255,0.1)` }}>
              <td style={{ padding: "10px 14px", color: T1, fontWeight: 600 }}>Average</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>{totalHH.toLocaleString()}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${totalCost.toLocaleString()}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${avgCph}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${(ZONE_DATA.reduce((s,r)=>s+r.cphGeneral,0)/ZONE_DATA.length).toFixed(2)}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${(ZONE_DATA.reduce((s,r)=>s+r.cphRecycle,0)/ZONE_DATA.length).toFixed(2)}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${(ZONE_DATA.reduce((s,r)=>s+r.cphGreen,0)/ZONE_DATA.length).toFixed(2)}</td>
              <td style={{ padding: "10px 14px", textAlign: "right" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: varToTarget > 0 ? "#f87171" : "#4ade80" }}>
                  {varToTarget > 0 ? `+$${varToTarget}` : `-$${Math.abs(varToTarget)}`}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

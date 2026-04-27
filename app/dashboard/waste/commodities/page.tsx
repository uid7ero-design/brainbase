"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, Cell,
} from "recharts";
import { KpiCard, Insight, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, GRID, TICK, DTT, DC, PAGE } from "../_dark";

const MATERIALS = [
  { material: "Paper / Cardboard", tonnes: 180, pricePerT: 45,   trend: "stable",  color: "#3b82f6" },
  { material: "Glass",             tonnes: 95,  pricePerT: 8,    trend: "down",    color: "#64748b" },
  { material: "Aluminium Cans",    tonnes: 12,  pricePerT: 1800, trend: "up",      color: "#f59e0b" },
  { material: "Steel / Ferrous",   tonnes: 28,  pricePerT: 220,  trend: "stable",  color: "#8b5cf6" },
  { material: "HDPE Plastics",     tonnes: 15,  pricePerT: 180,  trend: "up",      color: "#10b981" },
  { material: "PET Plastics",      tonnes: 8,   pricePerT: 280,  trend: "up",      color: "#06b6d4" },
  { material: "Mixed Plastics",    tonnes: 22,  pricePerT: 25,   trend: "down",    color: "#f97316" },
  { material: "Green Org./Compost",tonnes: 160, pricePerT: 35,   trend: "stable",  color: "#22c55e" },
].map(r => ({ ...r, revenue: Math.round(r.tonnes * r.pricePerT) }));

const PRICE_TREND = [
  { month: "Oct 25", aluminium: 1750, paper: 48, hdpe: 165, pet: 260 },
  { month: "Nov 25", aluminium: 1780, paper: 47, hdpe: 170, pet: 265 },
  { month: "Dec 25", aluminium: 1820, paper: 45, hdpe: 175, pet: 272 },
  { month: "Jan 26", aluminium: 1790, paper: 44, hdpe: 178, pet: 278 },
  { month: "Feb 26", aluminium: 1810, paper: 45, hdpe: 180, pet: 280 },
  { month: "Mar 26", aluminium: 1800, paper: 45, hdpe: 180, pet: 280 },
];

const GROSS_RECYCLING_COST = 134000;

export default function CommoditiesPage() {
  const totalRevenue  = MATERIALS.reduce((s, r) => s + r.revenue, 0);
  const totalTonnes   = MATERIALS.reduce((s, r) => s + r.tonnes, 0);
  const revenuePerT   = +(totalRevenue / totalTonnes).toFixed(2);
  const netCost       = GROSS_RECYCLING_COST - totalRevenue;
  const topMaterial   = MATERIALS.reduce((max, r) => r.revenue > max.revenue ? r : max, MATERIALS[0]);
  const risingMats    = MATERIALS.filter(r => r.trend === "up");

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={PAGE}>
      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Period: {today} &nbsp;·&nbsp; Prices reflect MRF gate returns</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
        <KpiCard label="Total Commodity Revenue" value={`$${totalRevenue.toLocaleString()}`}  sub="From recyclable material sales"             accent="#10b981" />
        <KpiCard label="Revenue per Tonne"        value={`$${revenuePerT}`}                   sub={`${totalTonnes} t total processed`}          accent="#3b82f6" />
        <KpiCard label="Net Recycling Cost"        value={`$${netCost.toLocaleString()}`}      sub={`After $${totalRevenue.toLocaleString()} revenue offset`} accent={netCost < 80000 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Top Revenue Material"      value={topMaterial.material.split("/")[0].trim()} sub={`$${topMaterial.revenue.toLocaleString()} @ $${topMaterial.pricePerT}/t`} accent="#f59e0b" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
        <Insight icon="📈" color="green"
          title={`${risingMats.length} commodities trending upward`}
          body={`${risingMats.map(r => r.material.split("/")[0]).join(", ")} are all on upward price trends. Aluminium at $${PRICE_TREND[PRICE_TREND.length-1].aluminium}/t is near its 6-month high — good time to lock in contracts.`}
        />
        <Insight icon="💰" color="blue"
          title={`Revenue offsets ${Math.round((totalRevenue/GROSS_RECYCLING_COST)*100)}% of recycling stream costs`}
          body={`$${totalRevenue.toLocaleString()} in commodity sales reduces the net recycling cost to $${netCost.toLocaleString()}. Improving contamination rates would increase yield and push this higher.`}
        />
        <Insight icon="⬇" color="amber"
          title="Glass and mixed plastics prices softening"
          body={`Glass remains at just $8/tonne — below gate fee costs. Mixed plastics at $25/t are also under pressure. Consider reviewing MRF contract terms for these streams.`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Revenue by Material" sub="This period — sorted by total revenue" />
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={[...MATERIALS].sort((a, b) => b.revenue - a.revenue)} layout="vertical" margin={{ left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="material" width={155} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => `$${Number(v).toLocaleString()}`} contentStyle={DTT} />
              <Bar dataKey="revenue" name="Revenue" radius={[0,4,4,0]}>
                {[...MATERIALS].sort((a, b) => b.revenue - a.revenue).map((r, i) => <Cell key={i} fill={r.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={DC}>
          <SectionHeader title="Key Commodity Price Trends" sub="Oct 2025 – Mar 2026 ($/tonne)" />
          <ResponsiveContainer width="100%" height={290}>
            <LineChart data={PRICE_TREND}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="high" tickFormatter={v => `$${v}`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="low"  orientation="right" tickFormatter={v => `$${v}`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 350]} />
              <Tooltip formatter={v => `$${Number(v).toLocaleString()}/t`} contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Line yAxisId="high" type="monotone" dataKey="aluminium" name="Aluminium" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="low"  type="monotone" dataKey="paper"     name="Paper/Card" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="low"  type="monotone" dataKey="hdpe"      name="HDPE"       stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="low"  type="monotone" dataKey="pet"       name="PET"        stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="Commodity Revenue Summary" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {["Material","Tonnes","Price / Tonne","Revenue","Price Trend","% of Total Revenue"].map((h, i) => (
                <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...MATERIALS].sort((a, b) => b.revenue - a.revenue).map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: r.color, flexShrink: 0 }} />
                    {r.material}
                  </div>
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{r.tonnes}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${r.pricePerT.toLocaleString()}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${r.revenue.toLocaleString()}</td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: r.trend === "up" ? "#4ade80" : r.trend === "down" ? "#f87171" : T3 }}>
                    {r.trend === "up" ? "▲ Rising" : r.trend === "down" ? "▼ Falling" : "→ Stable"}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                    <div style={{ width: 64, height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 999, width: `${(r.revenue/totalRevenue)*100}%`, background: r.color }} />
                    </div>
                    <span style={{ color: T2 }}>{((r.revenue / totalRevenue) * 100).toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: ROW_HEAD, borderTop: `2px solid rgba(255,255,255,0.1)` }}>
              <td style={{ padding: "10px 14px", color: T1, fontWeight: 600 }}>Total</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>{totalTonnes}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${revenuePerT} avg</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${totalRevenue.toLocaleString()}</td>
              <td style={{ padding: "10px 14px", textAlign: "right" }}></td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

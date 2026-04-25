"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, Cell,
} from "recharts";

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

const GROSS_RECYCLING_COST = 134000; // total fuel + services for recycling stream approx

export default function CommoditiesPage() {
  const totalRevenue  = MATERIALS.reduce((s, r) => s + r.revenue, 0);
  const totalTonnes   = MATERIALS.reduce((s, r) => s + r.tonnes, 0);
  const revenuePerT   = +(totalRevenue / totalTonnes).toFixed(2);
  const netCost       = GROSS_RECYCLING_COST - totalRevenue;
  const topMaterial   = MATERIALS.reduce((max, r) => r.revenue > max.revenue ? r : max, MATERIALS[0]);
  const risingMats    = MATERIALS.filter(r => r.trend === "up");

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="max-w-7xl mx-auto px-8 py-6 space-y-6">
      <p className="text-slate-500 text-sm">Period: {today} &nbsp;·&nbsp; <span className="text-slate-400">Prices reflect MRF gate returns</span></p>

      <div className="grid grid-cols-4 gap-5">
        <KpiCard label="Total Commodity Revenue" value={`$${totalRevenue.toLocaleString()}`}  sub="From recyclable material sales"             accent="#10b981" />
        <KpiCard label="Revenue per Tonne"        value={`$${revenuePerT}`}                   sub={`${totalTonnes} t total processed`}          accent="#3b82f6" />
        <KpiCard label="Net Recycling Cost"        value={`$${netCost.toLocaleString()}`}      sub={`After $${totalRevenue.toLocaleString()} revenue offset`} accent={netCost < 80000 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Top Revenue Material"      value={topMaterial.material.split("/")[0].trim()} sub={`$${topMaterial.revenue.toLocaleString()} @ $${topMaterial.pricePerT}/t`} accent="#f59e0b" />
      </div>

      <div className="grid grid-cols-3 gap-5">
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

      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Revenue by Material" sub="This period — sorted by total revenue" />
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={[...MATERIALS].sort((a, b) => b.revenue - a.revenue)} layout="vertical" margin={{ left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="material" width={155} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => `$${Number(v).toLocaleString()}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="revenue" name="Revenue" radius={[0,4,4,0]}>
                {[...MATERIALS].sort((a, b) => b.revenue - a.revenue).map((r, i) => <Cell key={i} fill={r.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Key Commodity Price Trends" sub="Oct 2025 – Mar 2026 ($/tonne)" />
          <ResponsiveContainer width="100%" height={290}>
            <LineChart data={PRICE_TREND}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="high" tickFormatter={v => `$${v}`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="low"  orientation="right" tickFormatter={v => `$${v}`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 350]} />
              <Tooltip formatter={v => `$${Number(v).toLocaleString()}/t`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="high" type="monotone" dataKey="aluminium" name="Aluminium" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="low"  type="monotone" dataKey="paper"     name="Paper/Card" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="low"  type="monotone" dataKey="hdpe"      name="HDPE"       stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="low"  type="monotone" dataKey="pet"       name="PET"        stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100"><SectionHeader title="Commodity Revenue Summary" /></div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              {["Material","Tonnes","Price / Tonne","Revenue","Price Trend","% of Total Revenue"].map(h => (
                <th key={h} className={`py-3 font-medium ${h === "Material" ? "text-left px-6" : "text-right px-4"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...MATERIALS].sort((a, b) => b.revenue - a.revenue).map((r, i) => (
              <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition">
                <td className="px-6 py-3 font-medium text-slate-800 flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: r.color }} />
                  {r.material}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{r.tonnes}</td>
                <td className="px-4 py-3 text-right text-slate-600">${r.pricePerT.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">${r.revenue.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-xs font-semibold ${r.trend === "up" ? "text-emerald-600" : r.trend === "down" ? "text-red-500" : "text-slate-500"}`}>
                    {r.trend === "up" ? "▲ Rising" : r.trend === "down" ? "▼ Falling" : "→ Stable"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(r.revenue/totalRevenue)*100}%`, background: r.color }} />
                    </div>
                    <span className="text-slate-600">{((r.revenue / totalRevenue) * 100).toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-slate-800 text-sm">
              <td className="px-6 py-3">Total</td>
              <td className="px-4 py-3 text-right">{totalTonnes}</td>
              <td className="px-4 py-3 text-right">${revenuePerT} avg</td>
              <td className="px-4 py-3 text-right">${totalRevenue.toLocaleString()}</td>
              <td className="px-4 py-3 text-right"></td>
              <td className="px-4 py-3 text-right">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: any) {
  return <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5" style={{ borderLeft: `4px solid ${accent}` }}><p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">{label}</p><p className="text-2xl font-bold text-slate-900 mb-1">{value}</p><p className="text-xs text-slate-400">{sub}</p></div>;
}
function Insight({ icon, color, title, body }: any) {
  const p = (({ red: ["bg-red-50","border-red-100","text-red-500"], amber: ["bg-amber-50","border-amber-100","text-amber-500"], green: ["bg-emerald-50","border-emerald-100","text-emerald-600"], blue: ["bg-blue-50","border-blue-100","text-blue-500"] }) as Record<string,string[]>)[color];
  return <div className={`rounded-2xl border p-5 ${p[0]} ${p[1]}`}><div className="flex items-start gap-3"><span className={`text-xl ${p[2]}`}>{icon}</span><div><p className="text-sm font-semibold text-slate-800 mb-1">{title}</p><p className="text-xs text-slate-600 leading-relaxed">{body}</p></div></div></div>;
}
function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return <div className="mb-4"><h2 className="text-base font-semibold text-slate-800">{title}</h2>{sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}</div>;
}

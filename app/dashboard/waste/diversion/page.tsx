"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, PieChart, Pie, Cell, ReferenceLine,
} from "recharts";

const LANDFILL_LEVY = 148.50; // SA EPA levy $/tonne
const CO2_RECYCLING = 1.1;    // tonne CO₂-e saved per tonne recycled
const CO2_GREEN     = 0.5;    // tonne CO₂-e saved per tonne green waste composted

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
    <div className="max-w-7xl mx-auto px-8 py-6 space-y-6">
      <p className="text-slate-500 text-sm">Period: {today} &nbsp;·&nbsp; <span className="text-slate-400">SA EPA Landfill Levy: ${LANDFILL_LEVY}/tonne</span></p>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-4">
        <KpiCard label="Diversion Rate"        value={`${diversionRate}%`}              sub={`Target: ${TARGET_DIVERSION}% · Gap: ${gapToTarget}%`} accent={diversionRate >= TARGET_DIVERSION ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Tonnes Diverted"       value={`${totalDiverted.toLocaleString()} t`} sub="Recycling + green waste"              accent="#3b82f6" />
        <KpiCard label="Tonnes to Landfill"    value={`${totalGeneral.toLocaleString()} t`}  sub={`${((totalGeneral/totalTonnage)*100).toFixed(0)}% of total collected`} accent="#ef4444" />
        <KpiCard label="Landfill Levy Cost"    value={`$${totalLevy.toLocaleString()}`}       sub="At $148.50/tonne (SA EPA)"           accent="#8b5cf6" />
        <KpiCard label="CO₂-e Saved"           value={`${totalCO2} t`}                        sub="vs sending all waste to landfill"    accent="#10b981" />
      </div>

      {/* Insights */}
      <div className="grid grid-cols-3 gap-5">
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

      {/* Charts row 1 */}
      <div className="grid grid-cols-3 gap-5">
        {/* Stacked monthly tonnage */}
        <div className="col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Monthly Waste Stream Tonnage" sub="General waste (landfill), recycling and green waste — Oct 2025 to Mar 2026" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={MONTHLY} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}t`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={v => `${v} t`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="general"   name="General Waste" stackId="a" fill={STREAM_COLORS.general} />
              <Bar dataKey="recycling" name="Recycling"      stackId="a" fill={STREAM_COLORS.recycling} />
              <Bar dataKey="green"     name="Green Waste"    stackId="a" fill={STREAM_COLORS.green} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Stream composition pie */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col">
          <SectionHeader title="Stream Composition" sub="Current period total" />
          <div className="flex-1 flex items-center justify-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={streamPie} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {streamPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={v => `${v} t`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {streamPie.map((s, i) => (
              <div key={i} className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} /><span className="text-slate-600">{s.name}</span></div>
                <span className="font-semibold text-slate-800">{((s.value / totalTonnage) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Diversion rate trend + by zone */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Diversion Rate Trend" sub={`Monthly % vs ${TARGET_DIVERSION}% target`} />
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={MONTHLY}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} domain={[42, 52]} />
              <ReferenceLine y={TARGET_DIVERSION} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: `${TARGET_DIVERSION}% Target`, position: "insideTopRight", fill: "#f59e0b", fontSize: 11 }} />
              <Tooltip formatter={v => `${v}%`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="rate" name="Diversion Rate" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Diversion Rate by Zone" sub="Recycling + green waste as % of total tonnage" />
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={ZONE_DATA} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 60]} />
              <YAxis type="category" dataKey="shortId" width={80} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <ReferenceLine x={TARGET_DIVERSION} stroke="#f59e0b" strokeDasharray="4 4" />
              <Tooltip formatter={v => `${v}%`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="diversionRate" name="Diversion %" radius={[0,4,4,0]}>
                {ZONE_DATA.map((r, i) => <Cell key={i} fill={r.diversionRate >= TARGET_DIVERSION ? "#10b981" : "#3b82f6"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Zone table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <SectionHeader title="Zone Diversion Summary" />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              {["Zone","General (t)","Recycling (t)","Green (t)","Total (t)","Diversion Rate","Levy Cost","CO₂ Saved","vs Target"].map(h => (
                <th key={h} className={`py-3 font-medium ${h === "Zone" ? "text-left px-6" : "text-right px-4"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ZONE_DATA.map((r, i) => (
              <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition">
                <td className="px-6 py-3 font-medium text-slate-800">{r.zone}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.general}</td>
                <td className="px-4 py-3 text-right text-blue-600">{r.recycling}</td>
                <td className="px-4 py-3 text-right text-emerald-600">{r.green}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.total}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-semibold ${r.diversionRate >= TARGET_DIVERSION ? "text-emerald-600" : "text-amber-500"}`}>{r.diversionRate}%</span>
                </td>
                <td className="px-4 py-3 text-right text-red-500">${r.levyCost.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-emerald-600">{r.co2Saved} t</td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-xs font-semibold ${r.diversionRate >= TARGET_DIVERSION ? "text-emerald-600" : "text-amber-500"}`}>
                    {r.diversionRate >= TARGET_DIVERSION ? `+${(r.diversionRate - TARGET_DIVERSION).toFixed(1)}%` : `-${(TARGET_DIVERSION - r.diversionRate).toFixed(1)}%`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-slate-800 text-sm">
              <td className="px-6 py-3">Total</td>
              <td className="px-4 py-3 text-right">{totalGeneral}</td>
              <td className="px-4 py-3 text-right text-blue-600">{totalRecycling}</td>
              <td className="px-4 py-3 text-right text-emerald-600">{totalGreen}</td>
              <td className="px-4 py-3 text-right">{totalTonnage}</td>
              <td className="px-4 py-3 text-right"><span className={diversionRate >= TARGET_DIVERSION ? "text-emerald-600" : "text-amber-500"}>{diversionRate}%</span></td>
              <td className="px-4 py-3 text-right text-red-500">${totalLevy.toLocaleString()}</td>
              <td className="px-4 py-3 text-right text-emerald-600">{totalCO2} t</td>
              <td className="px-4 py-3 text-right"><span className={gapToTarget <= 0 ? "text-emerald-600" : "text-amber-500"}>{gapToTarget <= 0 ? `+${Math.abs(gapToTarget)}%` : `-${gapToTarget}%`}</span></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: any) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5" style={{ borderLeft: `4px solid ${accent}` }}>
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mb-1">{value}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  );
}
function Insight({ icon, color, title, body }: any) {
  const p = (({ red: ["bg-red-50","border-red-100","text-red-500"], amber: ["bg-amber-50","border-amber-100","text-amber-500"], green: ["bg-emerald-50","border-emerald-100","text-emerald-600"], blue: ["bg-blue-50","border-blue-100","text-blue-500"] }) as Record<string,string[]>)[color];
  return (
    <div className={`rounded-2xl border p-5 ${p[0]} ${p[1]}`}>
      <div className="flex items-start gap-3"><span className={`text-xl ${p[2]}`}>{icon}</span><div><p className="text-sm font-semibold text-slate-800 mb-1">{title}</p><p className="text-xs text-slate-600 leading-relaxed">{body}</p></div></div>
    </div>
  );
}
function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return <div className="mb-4"><h2 className="text-base font-semibold text-slate-800">{title}</h2>{sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}</div>;
}

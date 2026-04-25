"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, Cell,
} from "recharts";

const FLEET = [
  { id: "WRT-001", type: "Side Loader",   make: "MAN TGS 26",        year: 2019, util: 88, km: 2840, fuelL: 1136, breakdowns: 1, maintCost: 2400 },
  { id: "WRT-002", type: "Rear Loader",   make: "Volvo FE 320",      year: 2020, util: 91, km: 3120, fuelL: 1154, breakdowns: 0, maintCost: 1800 },
  { id: "WRT-003", type: "Side Loader",   make: "Scania P320",       year: 2018, util: 85, km: 2650, fuelL: 1113, breakdowns: 2, maintCost: 3200 },
  { id: "WRT-004", type: "Side Loader",   make: "MAN TGS 26",        year: 2021, util: 93, km: 3280, fuelL: 1181, breakdowns: 0, maintCost: 1600 },
  { id: "WRT-005", type: "Rear Loader",   make: "Volvo FE 320",      year: 2017, util: 79, km: 2420, fuelL: 1040, breakdowns: 3, maintCost: 4100 },
  { id: "WRT-006", type: "Front Loader",  make: "Mercedes Econic",   year: 2022, util: 94, km: 3350, fuelL: 1172, breakdowns: 0, maintCost: 1400 },
  { id: "WRT-007", type: "Side Loader",   make: "Scania P320",       year: 2020, util: 89, km: 2980, fuelL: 1162, breakdowns: 1, maintCost: 2100 },
  { id: "WRT-008", type: "Rear Loader",   make: "MAN TGS 26",        year: 2019, util: 87, km: 2860, fuelL: 1144, breakdowns: 1, maintCost: 2300 },
  { id: "WRT-009", type: "Side Loader",   make: "Volvo FE 320",      year: 2023, util: 95, km: 3410, fuelL: 1160, breakdowns: 0, maintCost: 1200 },
  { id: "WRT-010", type: "Front Loader",  make: "Scania P320",       year: 2016, util: 74, km: 2180, fuelL:  983, breakdowns: 4, maintCost: 5200 },
  { id: "WRT-011", type: "Rear Loader",   make: "Mercedes Econic",   year: 2021, util: 91, km: 3050, fuelL: 1128, breakdowns: 0, maintCost: 1900 },
  { id: "WRT-012", type: "Side Loader",   make: "MAN TGS 26",        year: 2020, util: 90, km: 2920, fuelL: 1139, breakdowns: 1, maintCost: 2000 },
].map(r => ({
  ...r,
  l100km: +((r.fuelL / r.km) * 100).toFixed(1),
  age: 2026 - r.year,
}));

const FUEL_TREND = [
  { month: "Oct 25", avgL100km: 39.2, dieselPrice: 1.82 },
  { month: "Nov 25", avgL100km: 38.8, dieselPrice: 1.79 },
  { month: "Dec 25", avgL100km: 39.5, dieselPrice: 1.85 },
  { month: "Jan 26", avgL100km: 40.1, dieselPrice: 1.91 },
  { month: "Feb 26", avgL100km: 39.7, dieselPrice: 1.88 },
  { month: "Mar 26", avgL100km: 39.4, dieselPrice: 1.84 },
];

export default function FleetPage() {
  const totalKm       = FLEET.reduce((s, r) => s + r.km, 0);
  const totalFuelL    = FLEET.reduce((s, r) => s + r.fuelL, 0);
  const totalMaint    = FLEET.reduce((s, r) => s + r.maintCost, 0);
  const totalBreakdowns = FLEET.reduce((s, r) => s + r.breakdowns, 0);
  const avgUtil       = +(FLEET.reduce((s, r) => s + r.util, 0) / FLEET.length).toFixed(1);
  const avgL100km     = +((totalFuelL / totalKm) * 100).toFixed(1);
  const worstEfficiency = [...FLEET].sort((a, b) => b.l100km - a.l100km)[0];
  const mostBreakdowns  = [...FLEET].sort((a, b) => b.breakdowns - a.breakdowns)[0];
  const oldVehicles   = FLEET.filter(r => r.age >= 7).length;

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="max-w-7xl mx-auto px-8 py-6 space-y-6">
      <p className="text-slate-500 text-sm">Period: {today} &nbsp;·&nbsp; <span className="text-slate-400">Fleet of {FLEET.length} vehicles</span></p>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-4">
        <KpiCard label="Avg Utilisation"   value={`${avgUtil}%`}                        sub="Target ≥ 88%"                                 accent={avgUtil >= 88 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Total KM Driven"   value={totalKm.toLocaleString()}             sub="All vehicles this period"                     accent="#3b82f6" />
        <KpiCard label="Fleet Fuel Used"   value={`${totalFuelL.toLocaleString()} L`}   sub={`${avgL100km} L/100km average`}               accent="#f59e0b" />
        <KpiCard label="Breakdowns"        value={totalBreakdowns}                      sub={`${((totalBreakdowns/FLEET.length)).toFixed(1)} per vehicle`} accent={totalBreakdowns > 5 ? "#ef4444" : "#10b981"} />
        <KpiCard label="Maintenance Cost"  value={`$${totalMaint.toLocaleString()}`}    sub="Parts + labour this period"                   accent="#8b5cf6" />
      </div>

      {/* Insights */}
      <div className="grid grid-cols-3 gap-5">
        <Insight icon="⚠" color="red"
          title={`${mostBreakdowns.id} — ${mostBreakdowns.breakdowns} breakdowns`}
          body={`${mostBreakdowns.make} (${mostBreakdowns.year}) has the highest breakdown count this period with $${mostBreakdowns.maintCost.toLocaleString()} in maintenance. ${mostBreakdowns.age >= 7 ? "Age suggests replacement planning is needed." : ""}`}
        />
        <Insight icon="⛽" color="amber"
          title={`${worstEfficiency.id} using ${worstEfficiency.l100km} L/100km`}
          body={`Fleet average is ${avgL100km} L/100km. ${worstEfficiency.id} (${worstEfficiency.year}) is ${(worstEfficiency.l100km - avgL100km).toFixed(1)} L/100km above average — schedule an engine/tyre inspection.`}
        />
        <Insight icon="🚛" color={oldVehicles > 2 ? "amber" : "green"}
          title={`${oldVehicles} vehicle${oldVehicles !== 1 ? "s" : ""} aged 7+ years`}
          body={`Older vehicles correlate with higher maintenance costs and breakdown rates. Consider including WRT-010 (${2026 - 2016}yr) and WRT-005 (${2026 - 2017}yr) in the next capital works submission.`}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Vehicle Utilisation Rate" sub="% of available operating hours in use — target 88%" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={FLEET} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="id" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} domain={[60, 100]} />
              <Tooltip formatter={v => `${v}%`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="util" name="Utilisation %" radius={[3,3,0,0]}>
                {FLEET.map((r, i) => <Cell key={i} fill={r.util >= 88 ? "#10b981" : r.util >= 80 ? "#f59e0b" : "#ef4444"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Fuel Efficiency by Vehicle" sub="Litres per 100km — lower is better" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={[...FLEET].sort((a, b) => a.l100km - b.l100km)} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="id" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} domain={[30, 50]} />
              <Tooltip formatter={v => [`${v} L/100km`, "Fuel Efficiency"]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="l100km" name="L/100km" radius={[3,3,0,0]}>
                {[...FLEET].sort((a, b) => a.l100km - b.l100km).map((r, i) => <Cell key={i} fill={r.l100km <= 38 ? "#10b981" : r.l100km <= 41 ? "#f59e0b" : "#ef4444"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Maintenance Cost by Vehicle" sub="This period — sorted highest to lowest" />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={[...FLEET].sort((a, b) => b.maintCost - a.maintCost)} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(1)}k`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="id" width={65} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => `$${Number(v).toLocaleString()}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="maintCost" name="Maint. Cost" radius={[0,4,4,0]}>
                {[...FLEET].sort((a, b) => b.maintCost - a.maintCost).map((r, i) => <Cell key={i} fill={r.maintCost > 3000 ? "#ef4444" : r.maintCost > 2000 ? "#f59e0b" : "#10b981"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Fleet Fuel Efficiency Trend" sub="Average L/100km Oct 2025 – Mar 2026" />
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={FUEL_TREND}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left"  tickFormatter={v => `${v}`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} domain={[37, 42]} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={v => `$${v}`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left"  type="monotone" dataKey="avgL100km"   name="L/100km"      stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
              <Line yAxisId="right" type="monotone" dataKey="dieselPrice" name="Diesel $/L"   stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Fleet table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100"><SectionHeader title="Fleet Register" sub="All vehicles — performance this period" /></div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              {["Asset ID","Make/Model","Type","Year","Age","KM","Fuel (L)","L/100km","Utilisation","Breakdowns","Maint. Cost","Status"].map(h => (
                <th key={h} className={`py-3 font-medium ${h === "Asset ID" ? "text-left px-6" : "text-right px-3"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FLEET.map((r, i) => {
              const ok = r.util >= 88 && r.breakdowns <= 1 && r.l100km <= 41;
              return (
                <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-6 py-3 font-mono font-semibold text-slate-800">{r.id}</td>
                  <td className="px-3 py-3 text-right text-slate-700">{r.make}</td>
                  <td className="px-3 py-3 text-right text-slate-500">{r.type}</td>
                  <td className="px-3 py-3 text-right text-slate-500">{r.year}</td>
                  <td className="px-3 py-3 text-right"><span className={r.age >= 7 ? "text-amber-500 font-semibold" : "text-slate-500"}>{r.age} yr</span></td>
                  <td className="px-3 py-3 text-right text-slate-600">{r.km.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right text-slate-600">{r.fuelL.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right"><span className={r.l100km > 41 ? "text-red-500 font-semibold" : "text-slate-600"}>{r.l100km}</span></td>
                  <td className="px-3 py-3 text-right"><span className={r.util >= 88 ? "text-emerald-600 font-semibold" : "text-amber-500 font-semibold"}>{r.util}%</span></td>
                  <td className="px-3 py-3 text-right"><span className={r.breakdowns > 1 ? "text-red-500 font-semibold" : "text-slate-600"}>{r.breakdowns}</span></td>
                  <td className="px-3 py-3 text-right font-semibold text-slate-800">${r.maintCost.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right"><span className={`text-xs font-semibold px-2 py-1 rounded-full ${ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{ok ? "Good" : "Monitor"}</span></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-slate-800 text-sm">
              <td className="px-6 py-3" colSpan={5}>Fleet Total / Average</td>
              <td className="px-3 py-3 text-right">{totalKm.toLocaleString()}</td>
              <td className="px-3 py-3 text-right">{totalFuelL.toLocaleString()}</td>
              <td className="px-3 py-3 text-right">{avgL100km}</td>
              <td className="px-3 py-3 text-right">{avgUtil}%</td>
              <td className="px-3 py-3 text-right">{totalBreakdowns}</td>
              <td className="px-3 py-3 text-right">${totalMaint.toLocaleString()}</td>
              <td className="px-3 py-3 text-right"></td>
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
  const p = (({ red: ["bg-red-50","border-red-100","text-red-500"], amber: ["bg-amber-50","border-amber-100","text-amber-500"], green: ["bg-emerald-50","border-emerald-100","text-emerald-600"] }) as Record<string,string[]>)[color];
  return <div className={`rounded-2xl border p-5 ${p[0]} ${p[1]}`}><div className="flex items-start gap-3"><span className={`text-xl ${p[2]}`}>{icon}</span><div><p className="text-sm font-semibold text-slate-800 mb-1">{title}</p><p className="text-xs text-slate-600 leading-relaxed">{body}</p></div></div></div>;
}
function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return <div className="mb-4"><h2 className="text-base font-semibold text-slate-800">{title}</h2>{sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}</div>;
}

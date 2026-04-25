"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, ReferenceLine,
} from "recharts";

const ANNUAL_BUDGET = 3_535_000;
const YTD_MONTHS = 6; // Oct 25 – Mar 26
const YTD_BUDGET = Math.round(ANNUAL_BUDGET / 12 * YTD_MONTHS);

const CATEGORY_DATA = [
  { category: "Wages",       annual: 1_090_000, ytdBudget: 545_000,  ytdActual: 561_000  },
  { category: "Fuel",        annual: 1_620_000, ytdBudget: 810_000,  ytdActual: 789_000  },
  { category: "Maintenance", annual:   620_000, ytdBudget: 310_000,  ytdActual: 328_000  },
  { category: "Services",    annual:   205_000, ytdBudget: 102_500,  ytdActual: 102_000  },
].map(r => ({
  ...r,
  variance: r.ytdActual - r.ytdBudget,
  pctUsed: +((r.ytdActual / r.annual) * 100).toFixed(1),
  remaining: r.annual - r.ytdActual,
}));

const ZONE_BUDGET_DATA = [
  { zone: "Zone 1 – Northern",   budget: 27000, actual: 25900 },
  { zone: "Zone 2 – Central",    budget: 25000, actual: 23200 },
  { zone: "Zone 3 – Eastern",    budget: 32000, actual: 34800 },
  { zone: "Zone 4 – Southern",   budget: 23000, actual: 21400 },
  { zone: "Zone 5 – Western",    budget: 29000, actual: 28500 },
  { zone: "Zone 6 – Coastal",    budget: 35000, actual: 37200 },
  { zone: "Zone 7 – Hills",      budget: 22000, actual: 20400 },
  { zone: "Zone 8 – Industrial", budget: 31000, actual: 31700 },
  { zone: "Zone 9 – Suburban",   budget: 24000, actual: 22400 },
  { zone: "Zone 10 – Riverside", budget: 26000, actual: 25800 },
].map(r => ({ ...r, variance: r.actual - r.budget, shortId: r.zone.split("–")[0].trim() }));

const MONTHLY_SPEND = [
  { month: "Oct 25", actual: 278_000, budget: 294_583 },
  { month: "Nov 25", actual: 268_000, budget: 294_583 },
  { month: "Dec 25", actual: 262_000, budget: 294_583 },
  { month: "Jan 26", actual: 331_000, budget: 294_583 },
  { month: "Feb 26", actual: 318_000, budget: 294_583 },
  { month: "Mar 26", actual: 323_000, budget: 294_583 },
];

const FORECAST_MONTHS = [
  { month: "Apr 26", forecast: 300_000, budget: 294_583 },
  { month: "May 26", forecast: 285_000, budget: 294_583 },
  { month: "Jun 26", forecast: 280_000, budget: 294_583 },
  { month: "Jul 26", forecast: 276_000, budget: 294_583 },
  { month: "Aug 26", forecast: 272_000, budget: 294_583 },
  { month: "Sep 26", forecast: 270_000, budget: 294_583 },
];

const FULL_YEAR = [...MONTHLY_SPEND, ...FORECAST_MONTHS];

export default function BudgetingPage() {
  const ytdActual    = CATEGORY_DATA.reduce((s, r) => s + r.ytdActual, 0);
  const ytdVariance  = ytdActual - YTD_BUDGET;
  const pctUsed      = +((ytdActual / ANNUAL_BUDGET) * 100).toFixed(1);
  const annualForecast = ytdActual / YTD_MONTHS * 12;
  const forecastVar  = annualForecast - ANNUAL_BUDGET;

  const overBudgetZones = ZONE_BUDGET_DATA.filter(r => r.variance > 0);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  const fmt = (v: number) => v >= 0 ? `+$${v.toLocaleString()}` : `-$${Math.abs(v).toLocaleString()}`;

  return (
    <div className="max-w-7xl mx-auto px-8 py-6 space-y-6">

      {/* Toolbar */}
      <div className="flex justify-between items-center">
        <p className="text-slate-500 text-sm">Financial Year 2025–26 &nbsp;·&nbsp; YTD: Oct 2025 – Mar 2026 &nbsp;·&nbsp; <span className="text-slate-400">As at {today}</span></p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-5">
        <KpiCard label="Annual Budget"       value={`$${ANNUAL_BUDGET.toLocaleString()}`}               sub="FY 2025–26 approved budget"              accent="#3b82f6" />
        <KpiCard label="YTD Actual"          value={`$${ytdActual.toLocaleString()}`}                   sub={`${YTD_MONTHS} months (Oct 25 – Mar 26)`} accent="#8b5cf6" />
        <KpiCard label="YTD Variance"        value={fmt(ytdVariance)}                                   sub={ytdVariance > 0 ? "Over YTD budget" : "Under YTD budget"} accent={ytdVariance > 0 ? "#ef4444" : "#10b981"} />
        <KpiCard label="Full-Year Forecast"  value={`$${Math.round(annualForecast).toLocaleString()}`}  sub={`${fmt(Math.round(forecastVar))} vs budget`} accent={forecastVar > 0 ? "#ef4444" : "#10b981"} />
      </div>

      {/* Insights */}
      <div className="grid grid-cols-3 gap-5">
        <Insight icon="📈" color={ytdVariance > 0 ? "red" : "green"}
          title={`YTD spend ${ytdVariance > 0 ? "over" : "under"} by $${Math.abs(ytdVariance).toLocaleString()}`}
          body={`${pctUsed}% of annual budget consumed in ${YTD_MONTHS} months (${(100/12*YTD_MONTHS).toFixed(0)}% of year elapsed). Summer peaks in Jan–Feb drove the overspend.`}
        />
        <Insight icon="⛽" color="green"
          title="Fuel is the only underspend category"
          body={`Fuel tracking $${Math.abs(CATEGORY_DATA.find(c => c.category === "Fuel")!.variance).toLocaleString()} under YTD budget — likely reflecting lower diesel prices and route efficiencies.`}
        />
        <Insight icon="⚠" color="amber"
          title={`${overBudgetZones.length} zones over monthly budget`}
          body={`Zones ${overBudgetZones.map(z => z.shortId).join(", ")} are tracking above budget this period. Recommend a review of service hours and overtime in these areas.`}
        />
      </div>

      {/* Monthly trend + YTD by category */}
      <div className="grid grid-cols-2 gap-5">

        {/* Monthly spend trend */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Monthly Spend vs Budget" sub="Actual Oct 25 – Mar 26 + forecast to Sep 26 (lighter bars)" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={FULL_YEAR} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => `$${Number(v).toLocaleString()}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="actual"   name="Actual"   fill="#3b82f6" fillOpacity={1}   radius={[3,3,0,0]} />
              <Bar dataKey="forecast" name="Forecast" fill="#3b82f6" fillOpacity={0.35} radius={[3,3,0,0]} />
              <Bar dataKey="budget"   name="Budget"   fill="#f59e0b" fillOpacity={0.5}  radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Budget vs Actual by category */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="YTD Budget vs Actual by Category" sub="Oct 2025 – Mar 2026" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={CATEGORY_DATA} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="category" tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => `$${Number(v).toLocaleString()}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="ytdBudget" name="YTD Budget" fill="#94a3b8" radius={[3,3,0,0]} />
              <Bar dataKey="ytdActual" name="YTD Actual" fill="#3b82f6" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Zone budget vs actual */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <SectionHeader title="Budget vs Actual by Zone (This Period)" sub="Red = over budget · Green = under budget" />
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={ZONE_BUDGET_DATA} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="shortId" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip formatter={v => `$${Number(v).toLocaleString()}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="budget" name="Budget" fill="#94a3b8" radius={[3,3,0,0]} />
            <Bar dataKey="actual" name="Actual" radius={[3,3,0,0]}>
              {ZONE_BUDGET_DATA.map((r, i) => (
                <rect key={i} fill={r.variance > 0 ? "#ef4444" : "#10b981"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Category summary table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <SectionHeader title="Category Budget Summary" sub="FY 2025–26 annual budget and YTD performance" />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              {["Category","Annual Budget","YTD Budget","YTD Actual","Variance","% Used","Remaining"].map(h => (
                <th key={h} className={`py-3 font-medium ${h === "Category" ? "text-left px-6" : "text-right px-4"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORY_DATA.map((row, i) => (
              <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition">
                <td className="px-6 py-3 font-medium text-slate-800">{row.category}</td>
                <td className="px-4 py-3 text-right text-slate-600">${row.annual.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-600">${row.ytdBudget.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">${row.ytdActual.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-semibold ${row.variance > 0 ? "text-red-500" : "text-emerald-600"}`}>{fmt(row.variance)}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(row.pctUsed, 100)}%`, background: row.pctUsed > 55 ? "#ef4444" : "#10b981" }} />
                    </div>
                    <span className={`font-medium ${row.pctUsed > 55 ? "text-red-500" : "text-emerald-600"}`}>{row.pctUsed}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-slate-600">${row.remaining.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-slate-800 text-sm">
              <td className="px-6 py-3">Total</td>
              <td className="px-4 py-3 text-right">${ANNUAL_BUDGET.toLocaleString()}</td>
              <td className="px-4 py-3 text-right">${YTD_BUDGET.toLocaleString()}</td>
              <td className="px-4 py-3 text-right">${ytdActual.toLocaleString()}</td>
              <td className="px-4 py-3 text-right"><span className={`font-semibold ${ytdVariance > 0 ? "text-red-500" : "text-emerald-600"}`}>{fmt(ytdVariance)}</span></td>
              <td className="px-4 py-3 text-right"><span className={pctUsed > 55 ? "text-red-500" : "text-emerald-600"}>{pctUsed}%</span></td>
              <td className="px-4 py-3 text-right">${(ANNUAL_BUDGET - ytdActual).toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Zone budget table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <SectionHeader title="Zone Budget vs Actual (This Period)" />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              {["Zone","Budget","Actual","Variance","Status"].map(h => (
                <th key={h} className={`py-3 font-medium ${h === "Zone" ? "text-left px-6" : "text-right px-4"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ZONE_BUDGET_DATA.map((row, i) => (
              <tr key={i} className={`border-t border-slate-50 hover:bg-slate-50 transition ${row.variance > 0 ? "bg-red-50" : ""}`}>
                <td className="px-6 py-3 font-medium text-slate-800">{row.zone}</td>
                <td className="px-4 py-3 text-right text-slate-600">${row.budget.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">${row.actual.toLocaleString()}</td>
                <td className="px-4 py-3 text-right"><span className={`font-semibold ${row.variance > 0 ? "text-red-500" : "text-emerald-600"}`}>{fmt(row.variance)}</span></td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${row.variance > 0 ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-700"}`}>
                    {row.variance > 0 ? "Over Budget" : "On Budget"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
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
  const p = (({
    red:   ["bg-red-50",     "border-red-100",     "text-red-500"    ],
    amber: ["bg-amber-50",   "border-amber-100",   "text-amber-500"  ],
    green: ["bg-emerald-50", "border-emerald-100", "text-emerald-600"],
    blue:  ["bg-blue-50",    "border-blue-100",    "text-blue-500"   ],
  }) as Record<string,string[]>)[color];
  return (
    <div className={`rounded-2xl border p-5 ${p[0]} ${p[1]}`}>
      <div className="flex items-start gap-3">
        <span className={`text-xl ${p[2]}`}>{icon}</span>
        <div><p className="text-sm font-semibold text-slate-800 mb-1">{title}</p><p className="text-xs text-slate-600 leading-relaxed">{body}</p></div>
      </div>
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

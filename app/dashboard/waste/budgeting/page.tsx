"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, ReferenceLine,
} from "recharts";
import { KpiCard, Insight, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, GRID, TICK, DTT, DC, PAGE } from "../_dark";

const ANNUAL_BUDGET = 3_535_000;
const YTD_MONTHS = 6;
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
    <div style={PAGE}>

      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Financial Year 2025–26 &nbsp;·&nbsp; YTD: Oct 2025 – Mar 2026 &nbsp;·&nbsp; As at {today}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
        <KpiCard label="Annual Budget"       value={`$${ANNUAL_BUDGET.toLocaleString()}`}               sub="FY 2025–26 approved budget"              accent="#3b82f6" />
        <KpiCard label="YTD Actual"          value={`$${ytdActual.toLocaleString()}`}                   sub={`${YTD_MONTHS} months (Oct 25 – Mar 26)`} accent="#8b5cf6" />
        <KpiCard label="YTD Variance"        value={fmt(ytdVariance)}                                   sub={ytdVariance > 0 ? "Over YTD budget" : "Under YTD budget"} accent={ytdVariance > 0 ? "#ef4444" : "#10b981"} />
        <KpiCard label="Full-Year Forecast"  value={`$${Math.round(annualForecast).toLocaleString()}`}  sub={`${fmt(Math.round(forecastVar))} vs budget`} accent={forecastVar > 0 ? "#ef4444" : "#10b981"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Monthly Spend vs Budget" sub="Actual Oct 25 – Mar 26 + forecast to Sep 26 (lighter bars)" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={FULL_YEAR} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => `$${Number(v).toLocaleString()}`} contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Bar dataKey="actual"   name="Actual"   fill="#3b82f6" fillOpacity={1}   radius={[3,3,0,0]} />
              <Bar dataKey="forecast" name="Forecast" fill="#3b82f6" fillOpacity={0.35} radius={[3,3,0,0]} />
              <Bar dataKey="budget"   name="Budget"   fill="#f59e0b" fillOpacity={0.5}  radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={DC}>
          <SectionHeader title="YTD Budget vs Actual by Category" sub="Oct 2025 – Mar 2026" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={CATEGORY_DATA} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="category" tick={{ fill: TICK, fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => `$${Number(v).toLocaleString()}`} contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Bar dataKey="ytdBudget" name="YTD Budget" fill="rgba(255,255,255,0.2)" radius={[3,3,0,0]} />
              <Bar dataKey="ytdActual" name="YTD Actual" fill="#3b82f6" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={DC}>
        <SectionHeader title="Budget vs Actual by Zone (This Period)" sub="Red = over budget · Green = under budget" />
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={ZONE_BUDGET_DATA} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="shortId" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip formatter={v => `$${Number(v).toLocaleString()}`} contentStyle={DTT} />
            <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
            <Bar dataKey="budget" name="Budget" fill="rgba(255,255,255,0.2)" radius={[3,3,0,0]} />
            <Bar dataKey="actual" name="Actual" radius={[3,3,0,0]}>
              {ZONE_BUDGET_DATA.map((r, i) => (
                <rect key={i} fill={r.variance > 0 ? "#ef4444" : "#10b981"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="Category Budget Summary" sub="FY 2025–26 annual budget and YTD performance" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {["Category","Annual Budget","YTD Budget","YTD Actual","Variance","% Used","Remaining"].map((h, i) => (
                <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORY_DATA.map((row, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{row.category}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${row.annual.toLocaleString()}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${row.ytdBudget.toLocaleString()}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${row.ytdActual.toLocaleString()}</td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  <span style={{ fontWeight: 600, color: row.variance > 0 ? "#f87171" : "#4ade80" }}>{fmt(row.variance)}</span>
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                    <div style={{ width: 64, height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(row.pctUsed, 100)}%`, background: row.pctUsed > 55 ? "#ef4444" : "#10b981" }} />
                    </div>
                    <span style={{ fontWeight: 500, color: row.pctUsed > 55 ? "#f87171" : "#4ade80" }}>{row.pctUsed}%</span>
                  </div>
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${row.remaining.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: ROW_HEAD, borderTop: `2px solid rgba(255,255,255,0.1)` }}>
              <td style={{ padding: "10px 14px", color: T1, fontWeight: 600 }}>Total</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${ANNUAL_BUDGET.toLocaleString()}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${YTD_BUDGET.toLocaleString()}</td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${ytdActual.toLocaleString()}</td>
              <td style={{ padding: "10px 14px", textAlign: "right" }}><span style={{ fontWeight: 600, color: ytdVariance > 0 ? "#f87171" : "#4ade80" }}>{fmt(ytdVariance)}</span></td>
              <td style={{ padding: "10px 14px", textAlign: "right" }}><span style={{ color: pctUsed > 55 ? "#f87171" : "#4ade80" }}>{pctUsed}%</span></td>
              <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${(ANNUAL_BUDGET - ytdActual).toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="Zone Budget vs Actual (This Period)" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: ROW_HEAD }}>
              {["Zone","Budget","Actual","Variance","Status"].map((h, i) => (
                <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ZONE_BUDGET_DATA.map((row, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}`, background: row.variance > 0 ? "rgba(239,68,68,0.06)" : "transparent" }}>
                <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{row.zone}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>${row.budget.toLocaleString()}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", color: T1, fontWeight: 600 }}>${row.actual.toLocaleString()}</td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}><span style={{ fontWeight: 600, color: row.variance > 0 ? "#f87171" : "#4ade80" }}>{fmt(row.variance)}</span></td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: row.variance > 0 ? "rgba(239,68,68,0.12)" : "rgba(74,222,128,0.12)", color: row.variance > 0 ? "#f87171" : "#4ade80", border: `1px solid ${row.variance > 0 ? "rgba(239,68,68,0.25)" : "rgba(74,222,128,0.25)"}` }}>
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

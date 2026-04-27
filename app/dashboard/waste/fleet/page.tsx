"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, Cell,
} from "recharts";
import { KpiCard, Insight, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, GRID, TICK, DTT, DC, PAGE } from "../_dark";

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
  const totalKm         = FLEET.reduce((s, r) => s + r.km, 0);
  const totalFuelL      = FLEET.reduce((s, r) => s + r.fuelL, 0);
  const totalMaint      = FLEET.reduce((s, r) => s + r.maintCost, 0);
  const totalBreakdowns = FLEET.reduce((s, r) => s + r.breakdowns, 0);
  const avgUtil         = +(FLEET.reduce((s, r) => s + r.util, 0) / FLEET.length).toFixed(1);
  const avgL100km       = +((totalFuelL / totalKm) * 100).toFixed(1);
  const worstEfficiency = [...FLEET].sort((a, b) => b.l100km - a.l100km)[0];
  const mostBreakdowns  = [...FLEET].sort((a, b) => b.breakdowns - a.breakdowns)[0];
  const oldVehicles     = FLEET.filter(r => r.age >= 7).length;

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={PAGE}>
      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Period: {today} &nbsp;·&nbsp; Fleet of {FLEET.length} vehicles</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16 }}>
        <KpiCard label="Avg Utilisation"   value={`${avgUtil}%`}                        sub="Target ≥ 88%"                                 accent={avgUtil >= 88 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Total KM Driven"   value={totalKm.toLocaleString()}             sub="All vehicles this period"                     accent="#3b82f6" />
        <KpiCard label="Fleet Fuel Used"   value={`${totalFuelL.toLocaleString()} L`}   sub={`${avgL100km} L/100km average`}               accent="#f59e0b" />
        <KpiCard label="Breakdowns"        value={totalBreakdowns}                      sub={`${((totalBreakdowns/FLEET.length)).toFixed(1)} per vehicle`} accent={totalBreakdowns > 5 ? "#ef4444" : "#10b981"} />
        <KpiCard label="Maintenance Cost"  value={`$${totalMaint.toLocaleString()}`}    sub="Parts + labour this period"                   accent="#8b5cf6" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Vehicle Utilisation Rate" sub="% of available operating hours in use — target 88%" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={FLEET} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="id" tick={{ fill: TICK, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[60, 100]} />
              <Tooltip formatter={v => `${v}%`} contentStyle={DTT} />
              <Bar dataKey="util" name="Utilisation %" radius={[3,3,0,0]}>
                {FLEET.map((r, i) => <Cell key={i} fill={r.util >= 88 ? "#10b981" : r.util >= 80 ? "#f59e0b" : "#ef4444"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={DC}>
          <SectionHeader title="Fuel Efficiency by Vehicle" sub="Litres per 100km — lower is better" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={[...FLEET].sort((a, b) => a.l100km - b.l100km)} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="id" tick={{ fill: TICK, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[30, 50]} />
              <Tooltip formatter={v => [`${v} L/100km`, "Fuel Efficiency"]} contentStyle={DTT} />
              <Bar dataKey="l100km" name="L/100km" radius={[3,3,0,0]}>
                {[...FLEET].sort((a, b) => a.l100km - b.l100km).map((r, i) => <Cell key={i} fill={r.l100km <= 38 ? "#10b981" : r.l100km <= 41 ? "#f59e0b" : "#ef4444"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Maintenance Cost by Vehicle" sub="This period — sorted highest to lowest" />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={[...FLEET].sort((a, b) => b.maintCost - a.maintCost)} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(1)}k`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="id" width={65} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => `$${Number(v).toLocaleString()}`} contentStyle={DTT} />
              <Bar dataKey="maintCost" name="Maint. Cost" radius={[0,4,4,0]}>
                {[...FLEET].sort((a, b) => b.maintCost - a.maintCost).map((r, i) => <Cell key={i} fill={r.maintCost > 3000 ? "#ef4444" : r.maintCost > 2000 ? "#f59e0b" : "#10b981"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={DC}>
          <SectionHeader title="Fleet Fuel Efficiency Trend" sub="Average L/100km Oct 2025 – Mar 2026" />
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={FUEL_TREND}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left"  tickFormatter={v => `${v}`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[37, 42]} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={v => `$${v}`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Line yAxisId="left"  type="monotone" dataKey="avgL100km"   name="L/100km"    stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
              <Line yAxisId="right" type="monotone" dataKey="dieselPrice" name="Diesel $/L" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <SectionHeader title="Fleet Register" sub="All vehicles — performance this period" />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: ROW_HEAD }}>
                {["Asset ID","Make/Model","Type","Year","Age","KM","Fuel (L)","L/100km","Utilisation","Breakdowns","Maint. Cost","Status"].map((h, i) => (
                  <th key={h} style={{ padding: "10px 10px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FLEET.map((r, i) => {
                const ok = r.util >= 88 && r.breakdowns <= 1 && r.l100km <= 41;
                return (
                  <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                    <td style={{ padding: "9px 10px", fontFamily: "monospace", fontWeight: 600, color: T1 }}>{r.id}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: T2 }}>{r.make}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: T3 }}>{r.type}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: T3 }}>{r.year}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}><span style={{ color: r.age >= 7 ? "#f59e0b" : T3, fontWeight: r.age >= 7 ? 600 : 400 }}>{r.age} yr</span></td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: T2 }}>{r.km.toLocaleString()}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: T2 }}>{r.fuelL.toLocaleString()}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}><span style={{ color: r.l100km > 41 ? "#f87171" : T2, fontWeight: r.l100km > 41 ? 600 : 400 }}>{r.l100km}</span></td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}><span style={{ fontWeight: 600, color: r.util >= 88 ? "#4ade80" : "#f59e0b" }}>{r.util}%</span></td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}><span style={{ color: r.breakdowns > 1 ? "#f87171" : T2, fontWeight: r.breakdowns > 1 ? 600 : 400 }}>{r.breakdowns}</span></td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: T1, fontWeight: 600 }}>${r.maintCost.toLocaleString()}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 999, background: ok ? "rgba(74,222,128,0.12)" : "rgba(245,158,11,0.12)", color: ok ? "#4ade80" : "#f59e0b", border: `1px solid ${ok ? "rgba(74,222,128,0.25)" : "rgba(245,158,11,0.25)"}` }}>
                        {ok ? "Good" : "Monitor"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: ROW_HEAD, borderTop: `2px solid rgba(255,255,255,0.1)` }}>
                <td style={{ padding: "9px 10px", color: T1, fontWeight: 600 }} colSpan={5}>Fleet Total / Average</td>
                <td style={{ padding: "9px 10px", textAlign: "right", color: T1, fontWeight: 600 }}>{totalKm.toLocaleString()}</td>
                <td style={{ padding: "9px 10px", textAlign: "right", color: T1, fontWeight: 600 }}>{totalFuelL.toLocaleString()}</td>
                <td style={{ padding: "9px 10px", textAlign: "right", color: T1, fontWeight: 600 }}>{avgL100km}</td>
                <td style={{ padding: "9px 10px", textAlign: "right", color: T1, fontWeight: 600 }}>{avgUtil}%</td>
                <td style={{ padding: "9px 10px", textAlign: "right", color: T1, fontWeight: 600 }}>{totalBreakdowns}</td>
                <td style={{ padding: "9px 10px", textAlign: "right", color: T1, fontWeight: 600 }}>${totalMaint.toLocaleString()}</td>
                <td style={{ padding: "9px 10px", textAlign: "right" }}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

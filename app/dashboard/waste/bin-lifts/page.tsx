"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, Cell, ReferenceLine,
} from "recharts";

const DATA = [
  { zone: "Zone 1 – Northern",   planned: 11360, completed: 11248, missed: 112, contamination: 8.2,  gwLifts: 5680, recLifts: 2840, gwLifts2: 2840 },
  { zone: "Zone 2 – Central",    planned: 10440, completed: 10384, missed: 56,  contamination: 7.5,  gwLifts: 5220, recLifts: 2610, gwLifts2: 2610 },
  { zone: "Zone 3 – Eastern",    planned: 12880, completed: 12701, missed: 179, contamination: 9.1,  gwLifts: 6440, recLifts: 3220, gwLifts2: 3220 },
  { zone: "Zone 4 – Southern",   planned:  9920, completed:  9876, missed: 44,  contamination: 6.8,  gwLifts: 4960, recLifts: 2480, gwLifts2: 2480 },
  { zone: "Zone 5 – Western",    planned: 11800, completed: 11682, missed: 118, contamination: 8.8,  gwLifts: 5900, recLifts: 2950, gwLifts2: 2950 },
  { zone: "Zone 6 – Coastal",    planned: 13600, completed: 13353, missed: 247, contamination: 10.2, gwLifts: 6800, recLifts: 3400, gwLifts2: 3400 },
  { zone: "Zone 7 – Hills",      planned:  9240, completed:  9198, missed: 42,  contamination: 6.2,  gwLifts: 4620, recLifts: 2310, gwLifts2: 2310 },
  { zone: "Zone 8 – Industrial", planned: 12200, completed: 11993, missed: 207, contamination: 9.5,  gwLifts: 6100, recLifts: 3050, gwLifts2: 3050 },
  { zone: "Zone 9 – Suburban",   planned: 10240, completed: 10181, missed: 59,  contamination: 7.1,  gwLifts: 5120, recLifts: 2560, gwLifts2: 2560 },
  { zone: "Zone 10 – Riverside", planned: 11120, completed: 11020, missed: 100, contamination: 7.8,  gwLifts: 5560, recLifts: 2780, gwLifts2: 2780 },
].map(r => ({
  ...r,
  completionRate: +((r.completed / r.planned) * 100).toFixed(1),
  shortId: r.zone.split("–")[0].trim(),
}));

const WEEKLY_TREND = [
  { week: "Wk 1", completed: 2751, missed: 29, contamination: 7.9 },
  { week: "Wk 2", completed: 2788, missed: 22, contamination: 8.1 },
  { week: "Wk 3", completed: 2743, missed: 37, contamination: 8.4 },
  { week: "Wk 4", completed: 2753, missed: 37, contamination: 8.3 },
];

const STREAM_DATA = [
  { stream: "General Waste", lifts: DATA.reduce((s, r) => s + r.gwLifts, 0),  color: "#3b82f6" },
  { stream: "Recycling",     lifts: DATA.reduce((s, r) => s + r.recLifts, 0), color: "#10b981" },
  { stream: "Green Waste",   lifts: DATA.reduce((s, r) => s + r.gwLifts2, 0), color: "#f59e0b" },
];

export default function BinLiftsPage() {
  const totalPlanned   = DATA.reduce((s, r) => s + r.planned, 0);
  const totalCompleted = DATA.reduce((s, r) => s + r.completed, 0);
  const totalMissed    = DATA.reduce((s, r) => s + r.missed, 0);
  const completionRate = ((totalCompleted / totalPlanned) * 100).toFixed(1);
  const avgContam      = (DATA.reduce((s, r) => s + r.contamination, 0) / DATA.length).toFixed(1);
  const worstContam    = DATA.reduce((max, r) => r.contamination > max.contamination ? r : max, DATA[0]);
  const mostMissed     = DATA.reduce((max, r) => r.missed > max.missed ? r : max, DATA[0]);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="max-w-7xl mx-auto px-8 py-6 space-y-6">

      {/* Toolbar */}
      <div className="flex justify-between items-center">
        <p className="text-slate-500 text-sm">Period: {today} &nbsp;·&nbsp; <span className="text-slate-400">All waste streams</span></p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-4">
        <KpiCard label="Total Planned Lifts"  value={totalPlanned.toLocaleString()}  sub="This period"             accent="#3b82f6" />
        <KpiCard label="Completed Lifts"      value={totalCompleted.toLocaleString()} sub="Across all zones"       accent="#10b981" />
        <KpiCard label="Missed Lifts"         value={totalMissed.toLocaleString()}    sub="Requiring follow-up"    accent="#ef4444" />
        <KpiCard label="Completion Rate"      value={`${completionRate}%`}            sub="Target ≥ 98.5%"         accent={+completionRate >= 98.5 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Avg Contamination"    value={`${avgContam}%`}                 sub="Target ≤ 8.0%"          accent={+avgContam <= 8.0 ? "#10b981" : "#ef4444"} />
      </div>

      {/* Insights */}
      <div className="grid grid-cols-3 gap-5">
        <Insight icon="✗" color="red"
          title={`${mostMissed.shortId} has most missed lifts`}
          body={`${mostMissed.missed} missed lifts (${(100 - mostMissed.completionRate).toFixed(1)}% miss rate). Investigate route capacity and crew availability for this zone.`}
        />
        <Insight icon="⚠" color="amber"
          title={`${worstContam.shortId} contamination at ${worstContam.contamination}%`}
          body={`Exceeds the 8% benchmark. Recommend targeted resident education campaign and bin audits in this zone to reduce recycling contamination.`}
        />
        <Insight icon="✓" color="green"
          title="7 of 10 zones within KPI targets"
          body={`Overall completion rate of ${completionRate}% across ${totalPlanned.toLocaleString()} scheduled lifts. Continued focus needed on Zones 3, 6 and 8.`}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-5">

        {/* Completed vs Missed */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Completed vs Missed Lifts by Zone" sub="Monthly totals per collection zone" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={DATA} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => v.toLocaleString()} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[3,3,0,0]} />
              <Bar dataKey="missed"    name="Missed"    fill="#ef4444" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Contamination Rate */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Recycling Contamination Rate by Zone" sub="% of recycling bins containing non-recyclable material" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={DATA} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 14]} />
              <ReferenceLine y={8} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "8% Target", position: "insideTopRight", fill: "#f59e0b", fontSize: 11 }} />
              <Tooltip formatter={v => [`${v}%`, "Contamination"]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="contamination" name="Contamination %" radius={[3,3,0,0]}>
                {DATA.map((r, i) => <Cell key={i} fill={r.contamination > 8 ? "#ef4444" : "#10b981"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Lift stream breakdown + weekly trend */}
      <div className="grid grid-cols-3 gap-5">
        {/* Stream split */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Lifts by Stream" sub="Total lifts per waste stream this period" />
          <div className="space-y-4 mt-6">
            {STREAM_DATA.map(s => (
              <div key={s.stream}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-700 font-medium">{s.stream}</span>
                  <span className="text-slate-500">{s.lifts.toLocaleString()}</span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(s.lifts / STREAM_DATA[0].lifts) * 100}%`, background: s.color }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Total lifts</span>
              <span className="font-semibold text-slate-800">{STREAM_DATA.reduce((s, r) => s + r.lifts, 0).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Weekly trend */}
        <div className="col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Weekly Lift Performance" sub="Completed lifts and missed lifts over the current period" />
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={WEEKLY_TREND} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left"  tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="completed" name="Completed" fill="#3b82f6" radius={[3,3,0,0]} />
              <Bar yAxisId="left" dataKey="missed"    name="Missed"    fill="#ef4444" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <SectionHeader title="Zone Lift Summary" sub="Planned, completed, missed and contamination rate per zone" />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              {["Zone","Planned","Completed","Missed","Completion Rate","Contamination","Status"].map(h => (
                <th key={h} className={`py-3 font-medium ${h === "Zone" ? "text-left px-6" : "text-right px-4"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DATA.map((row, i) => {
              const ok = row.completionRate >= 98.5 && row.contamination <= 8;
              return (
                <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-6 py-3 font-medium text-slate-800">{row.zone}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{row.planned.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{row.completed.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-red-500 font-medium">{row.missed}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-medium ${row.completionRate >= 98.5 ? "text-emerald-600" : "text-amber-500"}`}>{row.completionRate}%</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-medium ${row.contamination <= 8 ? "text-emerald-600" : "text-red-500"}`}>{row.contamination}%</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                      {ok ? "On Target" : "Needs Review"}
                    </span>
                  </td>
                </tr>
              );
            })}
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
  const p = (({ red: ["bg-red-50","border-red-100","text-red-500"], amber: ["bg-amber-50","border-amber-100","text-amber-500"], green: ["bg-emerald-50","border-emerald-100","text-emerald-600"] }) as Record<string,string[]>)[color];
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

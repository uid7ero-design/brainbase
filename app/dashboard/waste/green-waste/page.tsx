"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, Cell, AreaChart, Area,
} from "recharts";

const ZONE_DATA = [
  { zone: "Zone 1 – Northern",   collected: 23, composted: 20, contamination: 5.1, households: 2840 },
  { zone: "Zone 2 – Central",    collected: 20, composted: 18, contamination: 4.8, households: 2610 },
  { zone: "Zone 3 – Eastern",    collected: 27, composted: 23, contamination: 6.8, households: 3220 },
  { zone: "Zone 4 – Southern",   collected: 18, composted: 17, contamination: 3.9, households: 2480 },
  { zone: "Zone 5 – Western",    collected: 23, composted: 20, contamination: 5.4, households: 2950 },
  { zone: "Zone 6 – Coastal",    collected: 28, composted: 23, contamination: 8.2, households: 3400 },
  { zone: "Zone 7 – Hills",      collected: 18, composted: 17, contamination: 3.2, households: 2310 },
  { zone: "Zone 8 – Industrial", collected: 26, composted: 22, contamination: 6.5, households: 3050 },
  { zone: "Zone 9 – Suburban",   collected: 18, composted: 16, contamination: 4.3, households: 2560 },
  { zone: "Zone 10 – Riverside", collected: 21, composted: 19, contamination: 4.9, households: 2780 },
].map(r => ({
  ...r,
  rejected: r.collected - r.composted,
  shortId: r.zone.split("–")[0].trim(),
  kgPerHH: +((r.collected * 1000) / r.households).toFixed(1),
}));

const MONTHLY = [
  { month: "Oct 25", collected: 222, composted: 198, contamination: 5.2, compostValue: 6930 },
  { month: "Nov 25", collected: 218, composted: 196, contamination: 5.0, compostValue: 6860 },
  { month: "Dec 25", collected: 210, composted: 185, contamination: 5.8, compostValue: 6475 },
  { month: "Jan 26", collected: 195, composted: 168, contamination: 7.4, compostValue: 5880 },
  { month: "Feb 26", collected: 205, composted: 181, contamination: 6.8, compostValue: 6335 },
  { month: "Mar 26", collected: 222, composted: 195, contamination: 5.4, compostValue: 6825 },
];

const COMPOST_PRICE_PER_T = 35;
const TARGET_CONTAM = 5.0;

export default function GreenWastePage() {
  const totalCollected = ZONE_DATA.reduce((s, r) => s + r.collected, 0);
  const totalComposted = ZONE_DATA.reduce((s, r) => s + r.composted, 0);
  const totalRejected  = totalCollected - totalComposted;
  const avgContam      = +(ZONE_DATA.reduce((s, r) => s + r.contamination, 0) / ZONE_DATA.length).toFixed(1);
  const compostRevenue = Math.round(totalComposted * COMPOST_PRICE_PER_T);
  const worstContam    = ZONE_DATA.reduce((max, r) => r.contamination > max.contamination ? r : max, ZONE_DATA[0]);
  const yieldRate      = +((totalComposted / totalCollected) * 100).toFixed(1);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="max-w-7xl mx-auto px-8 py-6 space-y-6">
      <p className="text-slate-500 text-sm">Period: {today} &nbsp;·&nbsp; <span className="text-slate-400">Fortnightly collection — all zones</span></p>

      <div className="grid grid-cols-5 gap-4">
        <KpiCard label="Total Collected"       value={`${totalCollected} t`}                   sub="All zones this period"               accent="#10b981" />
        <KpiCard label="Total Composted"        value={`${totalComposted} t`}                   sub={`${yieldRate}% compost yield`}       accent="#22c55e" />
        <KpiCard label="Rejected / Contaminated"value={`${totalRejected} t`}                   sub="Diverted to landfill — avoidable"    accent="#ef4444" />
        <KpiCard label="Avg Contamination Rate" value={`${avgContam}%`}                         sub={`Target ≤ ${TARGET_CONTAM}%`}        accent={avgContam <= TARGET_CONTAM ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Compost Revenue"        value={`$${compostRevenue.toLocaleString()}`}   sub={`$${COMPOST_PRICE_PER_T}/t to local market`} accent="#3b82f6" />
      </div>

      <div className="grid grid-cols-3 gap-5">
        <Insight icon="⚠" color={avgContam > TARGET_CONTAM ? "amber" : "green"}
          title={`Contamination averaging ${avgContam}% — target ${TARGET_CONTAM}%`}
          body={`${totalRejected} tonnes rejected and sent to landfill this period. Reducing contamination to ${TARGET_CONTAM}% would recover ~${Math.round(totalRejected * 0.5)} additional tonnes and save ~$${Math.round(totalRejected * 0.5 * 148.5).toLocaleString()} in levy.`}
        />
        <Insight icon="🌱" color="green"
          title={`${compostRevenue.toLocaleString()} in compost revenue this period`}
          body={`${totalComposted} tonnes processed into compost at $${COMPOST_PRICE_PER_T}/t. Revenue flows back to offset collection costs. Improving yield from ${yieldRate}% to 92% would add ~$${Math.round((totalCollected * 0.92 - totalComposted) * COMPOST_PRICE_PER_T).toLocaleString()}.`}
        />
        <Insight icon="⚠" color="red"
          title={`${worstContam.shortId} at ${worstContam.contamination}% contamination`}
          body={`${worstContam.zone} has the highest contamination rate. Common contaminants include plastic bags and food waste. Targeted bin tag notification and letterbox campaign recommended.`}
        />
      </div>

      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Green Waste Collected vs Composted by Zone" sub="Composted yield and rejected material (contaminated)" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={ZONE_DATA} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}t`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v => `${v} t`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="composted" name="Composted" stackId="a" fill="#10b981" />
              <Bar dataKey="rejected"  name="Rejected"  stackId="a" fill="#ef4444" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Contamination Rate by Zone" sub={`% contaminated — target ≤ ${TARGET_CONTAM}%`} />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={ZONE_DATA} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="shortId" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={v => `${v}%`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 12]} />
              <Tooltip formatter={v => `${v}%`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="contamination" name="Contamination %" radius={[3,3,0,0]}>
                {ZONE_DATA.map((r, i) => <Cell key={i} fill={r.contamination > TARGET_CONTAM ? "#ef4444" : "#10b981"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <SectionHeader title="Monthly Green Waste Trend" sub="Collected, composted and compost revenue Oct 2025 – Mar 2026" />
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={MONTHLY}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left"  tickFormatter={v => `${v}t`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area yAxisId="left"  type="monotone" dataKey="collected" name="Collected (t)"  stroke="#64748b" fill="#f1f5f9" strokeWidth={1.5} />
            <Area yAxisId="left"  type="monotone" dataKey="composted" name="Composted (t)"  stroke="#10b981" fill="#d1fae5" strokeWidth={2} />
            <Line yAxisId="right" type="monotone" dataKey="compostValue" name="Compost Revenue" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100"><SectionHeader title="Zone Green Waste Summary" /></div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              {["Zone","Collected (t)","Composted (t)","Rejected (t)","Yield %","Contamination","kg / HH","Compost Revenue"].map(h => (
                <th key={h} className={`py-3 font-medium ${h === "Zone" ? "text-left px-6" : "text-right px-4"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ZONE_DATA.map((r, i) => (
              <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition">
                <td className="px-6 py-3 font-medium text-slate-800">{r.zone}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.collected}</td>
                <td className="px-4 py-3 text-right text-emerald-600 font-medium">{r.composted}</td>
                <td className="px-4 py-3 text-right text-red-500">{r.rejected}</td>
                <td className="px-4 py-3 text-right text-slate-600">{((r.composted/r.collected)*100).toFixed(0)}%</td>
                <td className="px-4 py-3 text-right"><span className={r.contamination > TARGET_CONTAM ? "text-red-500 font-semibold" : "text-emerald-600 font-semibold"}>{r.contamination}%</span></td>
                <td className="px-4 py-3 text-right text-slate-500">{r.kgPerHH}</td>
                <td className="px-4 py-3 text-right text-blue-600 font-medium">${Math.round(r.composted * COMPOST_PRICE_PER_T).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-slate-800 text-sm">
              <td className="px-6 py-3">Total</td>
              <td className="px-4 py-3 text-right">{totalCollected}</td>
              <td className="px-4 py-3 text-right text-emerald-600">{totalComposted}</td>
              <td className="px-4 py-3 text-right text-red-500">{totalRejected}</td>
              <td className="px-4 py-3 text-right">{yieldRate}%</td>
              <td className="px-4 py-3 text-right"><span className={avgContam > TARGET_CONTAM ? "text-red-500" : "text-emerald-600"}>{avgContam}%</span></td>
              <td className="px-4 py-3 text-right">—</td>
              <td className="px-4 py-3 text-right text-blue-600">${compostRevenue.toLocaleString()}</td>
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

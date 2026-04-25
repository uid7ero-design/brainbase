"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, Cell,
} from "recharts";

const CATEGORIES = [
  { category: "Missed Collection",     count: 156, resolved: 148, avgDays: 1.2, color: "#ef4444" },
  { category: "Bin Damage",            count: 43,  resolved: 38,  avgDays: 4.1, color: "#f59e0b" },
  { category: "Bin Replacement",       count: 31,  resolved: 31,  avgDays: 3.5, color: "#3b82f6" },
  { category: "Contamination Notice",  count: 28,  resolved: 25,  avgDays: 2.8, color: "#8b5cf6" },
  { category: "Side Waste",            count: 19,  resolved: 14,  avgDays: 3.2, color: "#f97316" },
  { category: "Odour Complaint",       count: 12,  resolved: 11,  avgDays: 2.1, color: "#06b6d4" },
  { category: "General Enquiry",       count: 24,  resolved: 22,  avgDays: 5.3, color: "#64748b" },
].map(r => ({ ...r, open: r.count - r.resolved, resolutionRate: +((r.resolved / r.count) * 100).toFixed(0) }));

const ZONE_COMPLAINTS = [
  { zone: "Zone 1", missed: 18, damage: 5, other: 7,  total: 30, per1000hh: +(30/2840*1000).toFixed(1) },
  { zone: "Zone 2", missed: 12, damage: 4, other: 5,  total: 21, per1000hh: +(21/2610*1000).toFixed(1) },
  { zone: "Zone 3", missed: 27, damage: 7, other: 10, total: 44, per1000hh: +(44/3220*1000).toFixed(1) },
  { zone: "Zone 4", missed: 10, damage: 3, other: 4,  total: 17, per1000hh: +(17/2480*1000).toFixed(1) },
  { zone: "Zone 5", missed: 15, damage: 5, other: 6,  total: 26, per1000hh: +(26/2950*1000).toFixed(1) },
  { zone: "Zone 6", missed: 32, damage: 8, other: 12, total: 52, per1000hh: +(52/3400*1000).toFixed(1) },
  { zone: "Zone 7", missed: 9,  damage: 2, other: 3,  total: 14, per1000hh: +(14/2310*1000).toFixed(1) },
  { zone: "Zone 8", missed: 20, damage: 6, other: 9,  total: 35, per1000hh: +(35/3050*1000).toFixed(1) },
  { zone: "Zone 9", missed: 8,  damage: 2, other: 4,  total: 14, per1000hh: +(14/2560*1000).toFixed(1) },
  { zone: "Zone 10",missed: 5,  damage: 1, other: 3,  total:  9, per1000hh: +(9/2780*1000).toFixed(1) },
];

const MONTHLY = [
  { month: "Oct 25", requests: 249, resolved: 238 },
  { month: "Nov 25", requests: 234, resolved: 228 },
  { month: "Dec 25", requests: 268, resolved: 252 },
  { month: "Jan 26", requests: 341, resolved: 318 },
  { month: "Feb 26", requests: 312, resolved: 295 },
  { month: "Mar 26", requests: 313, resolved: 289 },
];

export default function ComplaintsPage() {
  const totalRequests  = CATEGORIES.reduce((s, r) => s + r.count, 0);
  const totalResolved  = CATEGORIES.reduce((s, r) => s + r.resolved, 0);
  const totalOpen      = totalRequests - totalResolved;
  const avgResolution  = +(CATEGORIES.reduce((s, r) => s + r.avgDays * r.count, 0) / totalRequests).toFixed(1);
  const TOTAL_HH       = 28200;
  const per1000hh      = +((totalRequests / TOTAL_HH) * 1000).toFixed(1);
  const worstZone      = ZONE_COMPLAINTS.reduce((max, r) => r.per1000hh > max.per1000hh ? r : max, ZONE_COMPLAINTS[0]);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="max-w-7xl mx-auto px-8 py-6 space-y-6">
      <p className="text-slate-500 text-sm">Period: {today}</p>

      <div className="grid grid-cols-4 gap-5">
        <KpiCard label="Total Service Requests" value={totalRequests.toLocaleString()}    sub="All types this period"                    accent="#3b82f6" />
        <KpiCard label="Requests per 1,000 HH"  value={per1000hh}                         sub="Target ≤ 10 per 1,000 HH"                 accent={per1000hh <= 10 ? "#10b981" : "#ef4444"} />
        <KpiCard label="Open / Unresolved"       value={totalOpen}                         sub={`${totalResolved} resolved (${Math.round(totalResolved/totalRequests*100)}%)`} accent={totalOpen > 20 ? "#ef4444" : "#10b981"} />
        <KpiCard label="Avg Resolution Time"     value={`${avgResolution} days`}           sub="Target ≤ 3 days"                          accent={avgResolution <= 3 ? "#10b981" : "#f59e0b"} />
      </div>

      <div className="grid grid-cols-3 gap-5">
        <Insight icon="📋" color="red"
          title={`Missed collections = ${Math.round(156/totalRequests*100)}% of all requests`}
          body={`156 missed collection reports this period. The majority (${ZONE_COMPLAINTS.filter(z => z.missed > 15).map(z => z.zone).join(", ")}) are concentrated in high-density zones — review route capacity.`}
        />
        <Insight icon="⚠" color="amber"
          title={`${worstZone.zone} highest rate — ${worstZone.per1000hh} per 1,000 HH`}
          body={`This zone generates disproportionate requests relative to household count. ${totalOpen} requests remain open across all zones — prioritise before next collection cycle.`}
        />
        <Insight icon="✓" color="green"
          title={`${Math.round(totalResolved/totalRequests*100)}% resolution rate this period`}
          body={`${totalResolved} of ${totalRequests} requests resolved. Bin replacement requests achieved 100% resolution. Focus needed on side waste (${Math.round(14/19*100)}%) and damage follow-ups.`}
        />
      </div>

      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Requests by Type" sub="Volume and resolution rate this period" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={CATEGORIES} layout="vertical" margin={{ left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="category" width={145} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="resolved" name="Resolved" stackId="a" fill="#10b981" radius={[0,0,0,0]} />
              <Bar dataKey="open"     name="Open"     stackId="a" fill="#ef4444" radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Monthly Request Volume" sub="Total received vs resolved Oct 2025 – Mar 2026" />
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={MONTHLY}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="requests" name="Received" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <SectionHeader title="Complaints by Zone" sub="Missed collections, bin damage and other — per 1,000 households" />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={ZONE_COMPLAINTS} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="zone" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="missed" name="Missed Collection" stackId="a" fill="#ef4444" />
            <Bar dataKey="damage" name="Bin Damage"        stackId="a" fill="#f59e0b" />
            <Bar dataKey="other"  name="Other"             stackId="a" fill="#94a3b8" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100"><SectionHeader title="Request Category Summary" /></div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              {["Category","Received","Resolved","Open","Resolution Rate","Avg Days to Resolve"].map(h => (
                <th key={h} className={`py-3 font-medium ${h === "Category" ? "text-left px-6" : "text-right px-4"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((r, i) => (
              <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition">
                <td className="px-6 py-3 font-medium text-slate-800 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }} />
                  {r.category}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{r.count}</td>
                <td className="px-4 py-3 text-right text-emerald-600">{r.resolved}</td>
                <td className="px-4 py-3 text-right"><span className={r.open > 5 ? "text-red-500 font-semibold" : "text-slate-600"}>{r.open}</span></td>
                <td className="px-4 py-3 text-right"><span className={r.resolutionRate >= 90 ? "text-emerald-600 font-semibold" : "text-amber-500 font-semibold"}>{r.resolutionRate}%</span></td>
                <td className="px-4 py-3 text-right"><span className={r.avgDays <= 3 ? "text-emerald-600" : "text-amber-500"}>{r.avgDays} days</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-slate-800 text-sm">
              <td className="px-6 py-3">Total</td>
              <td className="px-4 py-3 text-right">{totalRequests}</td>
              <td className="px-4 py-3 text-right text-emerald-600">{totalResolved}</td>
              <td className="px-4 py-3 text-right text-red-500">{totalOpen}</td>
              <td className="px-4 py-3 text-right">{Math.round(totalResolved/totalRequests*100)}%</td>
              <td className="px-4 py-3 text-right">{avgResolution} days</td>
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

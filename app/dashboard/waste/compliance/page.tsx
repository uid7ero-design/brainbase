"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type StatusType = "compliant" | "due" | "overdue" | "na";

const EPA_CONDITIONS = [
  { condition: "EPA Licence — Waste Depot Operations",   status: "compliant" as StatusType, due: "30 Sep 2026", lastAudit: "12 Mar 2026", notes: "Annual audit passed. No corrective actions." },
  { condition: "EPA Licence — Transfer Station",          status: "compliant" as StatusType, due: "30 Sep 2026", lastAudit: "12 Mar 2026", notes: "Compliant. Leachate monitoring current." },
  { condition: "Landfill Levy Returns — Q3 FY2025-26",   status: "due"       as StatusType, due: "30 Apr 2026", lastAudit: "—",           notes: "Return due. Data collection in progress." },
  { condition: "Annual Environment Report",               status: "compliant" as StatusType, due: "31 Aug 2026", lastAudit: "1 Sep 2025",  notes: "FY2024-25 report submitted on time." },
  { condition: "Stormwater Quality Monitoring",           status: "compliant" as StatusType, due: "Quarterly",  lastAudit: "1 Mar 2026",  notes: "Q3 sampling complete. Results within limits." },
  { condition: "Air Emissions Reporting",                 status: "compliant" as StatusType, due: "Annual",     lastAudit: "31 Jan 2026", notes: "Vehicle fleet meets Euro 5/6 standards." },
  { condition: "Noise Monitoring — Depot",                status: "due"       as StatusType, due: "15 May 2026", lastAudit: "15 Nov 2025", notes: "6-monthly monitoring due May 2026." },
];

const SAFETY = [
  { category: "Lost Time Injuries (LTI)",        count: 0, ytd: 0,  target: 0,   status: "compliant" as StatusType },
  { category: "Medically Treated Injuries (MTI)", count: 1, ytd: 2,  target: "≤3", status: "compliant" as StatusType },
  { category: "Near Misses Reported",             count: 4, ytd: 11, target: "↑ culture", status: "compliant" as StatusType },
  { category: "Vehicle Incidents",                count: 1, ytd: 3,  target: "≤4", status: "compliant" as StatusType },
  { category: "Hazard Observations",             count: 18, ytd: 54, target: "↑ culture", status: "compliant" as StatusType },
  { category: "WHS Inspections Completed",       count: 6,  ytd: 18, target: 18,  status: "compliant" as StatusType },
];

const TRAINING = [
  { module: "Manual Handling",              total: 38, completed: 38, pct: 100 },
  { module: "Fatigue Management",           total: 38, completed: 36, pct: 95  },
  { module: "Load Safety & Securing",       total: 38, completed: 38, pct: 100 },
  { module: "Hazardous Materials Handling", total: 38, completed: 34, pct: 89  },
  { module: "Emergency Response",           total: 38, completed: 35, pct: 92  },
  { module: "Environmental Awareness",      total: 38, completed: 31, pct: 82  },
  { module: "Chain of Responsibility (CoR)",total: 38, completed: 38, pct: 100 },
  { module: "First Aid Refresher",          total: 12, completed: 10, pct: 83  },
];

const LEVY_PAYMENTS = [
  { quarter: "Q1 FY25-26", amount: 154200, paid: true,  dueDate: "31 Oct 2025" },
  { quarter: "Q2 FY25-26", amount: 148900, paid: true,  dueDate: "31 Jan 2026" },
  { quarter: "Q3 FY25-26", amount: 152400, paid: false, dueDate: "30 Apr 2026" },
  { quarter: "Q4 FY25-26", amount: 151000, paid: false, dueDate: "31 Jul 2026" },
];

const statusStyle: Record<StatusType, { label: string; cls: string }> = {
  compliant: { label: "Compliant",   cls: "bg-emerald-100 text-emerald-700" },
  due:       { label: "Due Soon",    cls: "bg-amber-100 text-amber-700"     },
  overdue:   { label: "Overdue",     cls: "bg-red-100 text-red-700"         },
  na:        { label: "N/A",         cls: "bg-slate-100 text-slate-500"     },
};

export default function CompliancePage() {
  const avgTraining    = Math.round(TRAINING.reduce((s, r) => s + r.pct, 0) / TRAINING.length);
  const ltiCount       = SAFETY.find(s => s.category.includes("Lost Time"))!.count;
  const openConditions = EPA_CONDITIONS.filter(r => r.status !== "compliant").length;
  const levyOwed       = LEVY_PAYMENTS.filter(r => !r.paid).reduce((s, r) => s + r.amount, 0);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="max-w-7xl mx-auto px-8 py-6 space-y-6">
      <p className="text-slate-500 text-sm">Reporting period: FY 2025–26 &nbsp;·&nbsp; As at {today}</p>

      <div className="grid grid-cols-4 gap-5">
        <KpiCard label="EPA Conditions"        value={`${EPA_CONDITIONS.length - openConditions} / ${EPA_CONDITIONS.length}`} sub={openConditions > 0 ? `${openConditions} requiring action` : "All conditions met"} accent={openConditions === 0 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Lost Time Injuries YTD" value={ltiCount}                                sub="Target: 0 LTI"                             accent={ltiCount === 0 ? "#10b981" : "#ef4444"} />
        <KpiCard label="Training Completion"    value={`${avgTraining}%`}                       sub="Average across all modules"                accent={avgTraining >= 95 ? "#10b981" : avgTraining >= 85 ? "#f59e0b" : "#ef4444"} />
        <KpiCard label="Landfill Levy Outstanding" value={`$${levyOwed.toLocaleString()}`}      sub="Unpaid quarters — due dates upcoming"      accent="#8b5cf6" />
      </div>

      {/* Compliance status strip */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100"><SectionHeader title="EPA Licence & Regulatory Obligations" /></div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <th className="text-left px-6 py-3 font-medium">Condition / Obligation</th>
              <th className="text-center px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Due / Frequency</th>
              <th className="text-right px-4 py-3 font-medium">Last Action</th>
              <th className="text-left px-6 py-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {EPA_CONDITIONS.map((r, i) => (
              <tr key={i} className={`border-t border-slate-50 hover:bg-slate-50 transition ${r.status === "overdue" ? "bg-red-50" : r.status === "due" ? "bg-amber-50" : ""}`}>
                <td className="px-6 py-3 font-medium text-slate-800">{r.condition}</td>
                <td className="px-4 py-3 text-center"><span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusStyle[r.status].cls}`}>{statusStyle[r.status].label}</span></td>
                <td className="px-4 py-3 text-right text-slate-500 text-xs">{r.due}</td>
                <td className="px-4 py-3 text-right text-slate-500 text-xs">{r.lastAudit}</td>
                <td className="px-6 py-3 text-xs text-slate-500">{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Safety record */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100"><SectionHeader title="WHS Safety Performance" sub="This period and YTD" /></div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="text-left px-6 py-3 font-medium">Category</th>
                <th className="text-right px-4 py-3 font-medium">This Period</th>
                <th className="text-right px-4 py-3 font-medium">YTD</th>
                <th className="text-right px-4 py-3 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {SAFETY.map((r, i) => (
                <tr key={i} className="border-t border-slate-50">
                  <td className="px-6 py-3 text-slate-700">{r.category}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">{r.count}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.ytd}</td>
                  <td className="px-4 py-3 text-right text-slate-500 text-xs">{r.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-6 py-3 bg-emerald-50 border-t border-emerald-100">
            <p className="text-xs text-emerald-700 font-medium">✓ Zero Lost Time Injuries for 312 consecutive days</p>
          </div>
        </div>

        {/* Levy payments */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100"><SectionHeader title="SA EPA Landfill Levy Payments" sub="FY 2025–26 quarterly schedule" /></div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="text-left px-6 py-3 font-medium">Quarter</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-right px-4 py-3 font-medium">Due Date</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {LEVY_PAYMENTS.map((r, i) => (
                <tr key={i} className={`border-t border-slate-50 ${!r.paid ? "bg-amber-50" : ""}`}>
                  <td className="px-6 py-3 font-medium text-slate-800">{r.quarter}</td>
                  <td className="px-4 py-3 text-right text-slate-700">${r.amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-500 text-xs">{r.dueDate}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${r.paid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{r.paid ? "Paid" : "Pending"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-slate-800 text-sm">
                <td className="px-6 py-3">FY Total</td>
                <td className="px-4 py-3 text-right">${LEVY_PAYMENTS.reduce((s, r) => s + r.amount, 0).toLocaleString()}</td>
                <td colSpan={2} className="px-4 py-3 text-right text-slate-500">${levyOwed.toLocaleString()} outstanding</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Training completion */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <SectionHeader title="Staff Training Completion" sub={`${TRAINING[0].total} staff — % completion per module`} />
        <div className="space-y-3">
          {TRAINING.map((r, i) => (
            <div key={i} className="flex items-center gap-4">
              <span className="text-sm text-slate-700 w-64 flex-shrink-0">{r.module}</span>
              <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${r.pct}%`, background: r.pct === 100 ? "#10b981" : r.pct >= 90 ? "#3b82f6" : r.pct >= 80 ? "#f59e0b" : "#ef4444" }} />
              </div>
              <span className={`text-sm font-semibold w-12 text-right ${r.pct === 100 ? "text-emerald-600" : r.pct >= 90 ? "text-blue-600" : r.pct >= 80 ? "text-amber-500" : "text-red-500"}`}>{r.pct}%</span>
              <span className="text-xs text-slate-400 w-20 text-right">{r.completed}/{r.total} staff</span>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
          <span className="text-sm text-slate-600">Overall average completion</span>
          <span className={`text-lg font-bold ${avgTraining >= 95 ? "text-emerald-600" : "text-amber-500"}`}>{avgTraining}%</span>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: any) {
  return <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5" style={{ borderLeft: `4px solid ${accent}` }}><p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">{label}</p><p className="text-2xl font-bold text-slate-900 mb-1">{value}</p><p className="text-xs text-slate-400">{sub}</p></div>;
}
function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return <div className="mb-4"><h2 className="text-base font-semibold text-slate-800">{title}</h2>{sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}</div>;
}

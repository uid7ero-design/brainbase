"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, Cell,
} from "recharts";

const SATISFACTION = [
  { service: "General Waste",  score: 4.1, responses: 312 },
  { service: "Recycling",      score: 3.8, responses: 287 },
  { service: "Green Waste",    score: 4.3, responses: 264 },
  { service: "Bulk Hard Waste",score: 3.9, responses: 198 },
  { service: "E-Waste Events", score: 4.5, responses: 143 },
  { service: "Overall",        score: 4.1, responses: 480 },
];

const BIN_AUDIT = [
  { zone: "Zone 1", recyclePassed: 88, recycFailed: 12, greenPassed: 91, greenFailed: 9  },
  { zone: "Zone 2", recyclePassed: 90, recycFailed: 10, greenPassed: 93, greenFailed: 7  },
  { zone: "Zone 3", recyclePassed: 82, recycFailed: 18, greenPassed: 87, greenFailed: 13 },
  { zone: "Zone 4", recyclePassed: 93, recycFailed: 7,  greenPassed: 95, greenFailed: 5  },
  { zone: "Zone 5", recyclePassed: 85, recycFailed: 15, greenPassed: 89, greenFailed: 11 },
  { zone: "Zone 6", recyclePassed: 79, recycFailed: 21, greenPassed: 84, greenFailed: 16 },
  { zone: "Zone 7", recyclePassed: 94, recycFailed: 6,  greenPassed: 96, greenFailed: 4  },
  { zone: "Zone 8", recyclePassed: 81, recycFailed: 19, greenPassed: 86, greenFailed: 14 },
  { zone: "Zone 9", recyclePassed: 91, recycFailed: 9,  greenPassed: 93, greenFailed: 7  },
  { zone: "Zone 10",recyclePassed: 92, recycFailed: 8,  greenPassed: 94, greenFailed: 6  },
];

const CAMPAIGNS = [
  { name: "Spring Clean Leaflet Drop",    reach: 28200, type: "Letterbox", outcome: "8.2% contamination reduction" },
  { name: "What Goes in Your Bin?",       reach: 14800, type: "Social Media", outcome: "3,200 engagements" },
  { name: "School Education Program",     reach: 2400,  type: "In-Person", outcome: "12 schools, 2,400 students" },
  { name: "New Resident Welcome Kit",     reach: 1840,  type: "Letterbox", outcome: "184 new properties" },
  { name: "Green Waste No Plastics Drive",reach: 28200, type: "Letterbox", outcome: "4.1% green waste contamination reduction" },
];

const HOTLINE = [
  { month: "Oct 25", calls: 412, digital: 187 },
  { month: "Nov 25", calls: 388, digital: 201 },
  { month: "Dec 25", calls: 425, digital: 218 },
  { month: "Jan 26", calls: 541, digital: 276 },
  { month: "Feb 26", calls: 498, digital: 255 },
  { month: "Mar 26", calls: 463, digital: 241 },
];

const EVENTS = [
  { event: "E-Waste Drop-Off Day",       date: "15 Mar 2026", attendees: 684,  tonnes: 8.2  },
  { event: "Household Hazardous Waste",  date: "22 Feb 2026", attendees: 412,  tonnes: 3.1  },
  { event: "Bulk Hard Waste Collection", date: "8 Feb 2026",  attendees: 1240, tonnes: 42.6 },
  { event: "Green Waste Mulch Day",      date: "1 Feb 2026",  attendees: 328,  tonnes: 18.4 },
  { event: "Community Composting Workshop",date:"25 Jan 2026",attendees: 94,   tonnes: 0    },
];

export default function CommunityPage() {
  const overallScore    = SATISFACTION.find(s => s.service === "Overall")!.score;
  const totalAuditZones = BIN_AUDIT.length;
  const avgRecyclePass  = Math.round(BIN_AUDIT.reduce((s, r) => s + r.recyclePassed, 0) / BIN_AUDIT.length);
  const totalCampaignReach = CAMPAIGNS.reduce((s, r) => s + r.reach, 0);
  const totalEventTonnes = +EVENTS.reduce((s, r) => s + r.tonnes, 0).toFixed(1);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="max-w-7xl mx-auto px-8 py-6 space-y-6">
      <p className="text-slate-500 text-sm">Period: {today}</p>

      <div className="grid grid-cols-4 gap-5">
        <KpiCard label="Overall Satisfaction"   value={`${overallScore}/5.0`}                 sub="480 survey responses this period"            accent={overallScore >= 4 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Recycling Bin Pass Rate" value={`${avgRecyclePass}%`}                  sub="Correct materials, no contamination"          accent={avgRecyclePass >= 90 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Campaign Reach"          value={totalCampaignReach.toLocaleString()}   sub={`${CAMPAIGNS.length} campaigns this period`}  accent="#3b82f6" />
        <KpiCard label="Event Waste Diverted"    value={`${totalEventTonnes} t`}               sub={`${EVENTS.length} community events`}          accent="#8b5cf6" />
      </div>

      <div className="grid grid-cols-3 gap-5">
        <Insight icon="⭐" color={overallScore >= 4 ? "green" : "amber"}
          title={`Satisfaction score ${overallScore}/5 — ${overallScore >= 4 ? "strong" : "needs attention"}`}
          body={`E-waste events lead at 4.5/5. Recycling service at 3.8/5 is the lowest — correlates with contamination confusion. Targeted bin guide could lift this score.`}
        />
        <Insight icon="📚" color="blue"
          title={`${totalCampaignReach.toLocaleString()} total campaign touchpoints`}
          body={`School program reached 2,400 students across 12 schools — high long-term diversion impact. Letterbox drops remain the broadest reach mechanism at 28,200 households.`}
        />
        <Insight icon="🎪" color="green"
          title={`${totalEventTonnes} t diverted via community events`}
          body={`Hard waste collection was the highest volume event (42.6 t). E-waste and HHW events prevent dangerous material entering the general waste stream — high community and compliance value.`}
        />
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Satisfaction scores */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Community Satisfaction by Service" sub="Survey responses — 1 to 5 scale" />
          <div className="space-y-4 mt-2">
            {SATISFACTION.filter(s => s.service !== "Overall").map(s => (
              <div key={s.service}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-slate-700 font-medium">{s.service}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">{s.responses} responses</span>
                    <span className={`font-bold text-base ${s.score >= 4.2 ? "text-emerald-600" : s.score >= 3.9 ? "text-blue-600" : "text-amber-500"}`}>{s.score}/5</span>
                  </div>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(s.score / 5) * 100}%`, background: s.score >= 4.2 ? "#10b981" : s.score >= 3.9 ? "#3b82f6" : "#f59e0b" }} />
                </div>
              </div>
            ))}
            <div className="border-t border-slate-100 pt-3 flex justify-between items-center">
              <span className="text-sm font-semibold text-slate-700">Overall Score</span>
              <span className="text-2xl font-bold text-emerald-600">{overallScore} / 5.0</span>
            </div>
          </div>
        </div>

        {/* Contact centre trend */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <SectionHeader title="Customer Contact Volume" sub="Phone calls and digital requests Oct 2025 – Mar 2026" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={HOTLINE} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="calls"   name="Phone"   stackId="a" fill="#3b82f6" />
              <Bar dataKey="digital" name="Digital" stackId="a" fill="#10b981" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bin audit */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <SectionHeader title="Bin Audit Results by Zone" sub="% of audited bins correctly sorted (pass) — target ≥ 90%" />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={BIN_AUDIT} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="zone" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `${v}%`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} domain={[70, 100]} />
            <Tooltip formatter={v => `${v}%`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="recyclePassed" name="Recycling Pass %" fill="#3b82f6" radius={[3,3,0,0]} />
            <Bar dataKey="greenPassed"   name="Green Waste Pass %" fill="#10b981" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Campaigns table */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100"><SectionHeader title="Education Campaigns" /></div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="text-left px-6 py-3 font-medium">Campaign</th>
                <th className="text-center px-4 py-3 font-medium">Type</th>
                <th className="text-right px-4 py-3 font-medium">Reach</th>
                <th className="text-left px-4 py-3 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {CAMPAIGNS.map((r, i) => (
                <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-6 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 text-center"><span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">{r.type}</span></td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.reach.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{r.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100"><SectionHeader title="Community Events" /></div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="text-left px-6 py-3 font-medium">Event</th>
                <th className="text-right px-4 py-3 font-medium">Date</th>
                <th className="text-right px-4 py-3 font-medium">Attendees</th>
                <th className="text-right px-4 py-3 font-medium">Tonnes</th>
              </tr>
            </thead>
            <tbody>
              {EVENTS.map((r, i) => (
                <tr key={i} className="border-t border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-6 py-3 font-medium text-slate-800">{r.event}</td>
                  <td className="px-4 py-3 text-right text-slate-500 text-xs">{r.date}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.attendees.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 font-medium">{r.tonnes > 0 ? `${r.tonnes} t` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

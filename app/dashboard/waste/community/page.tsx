"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  CartesianGrid, LineChart, Line, Cell,
} from "recharts";
import { KpiCard, Insight, SectionHeader, T1, T2, T3, BORDER, ROW_BDR, ROW_HEAD, GRID, TICK, DTT, DC, PAGE } from "../_dark";

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
  { name: "Spring Clean Leaflet Drop",    reach: 28200, type: "Letterbox",   outcome: "8.2% contamination reduction" },
  { name: "What Goes in Your Bin?",       reach: 14800, type: "Social Media", outcome: "3,200 engagements" },
  { name: "School Education Program",     reach: 2400,  type: "In-Person",   outcome: "12 schools, 2,400 students" },
  { name: "New Resident Welcome Kit",     reach: 1840,  type: "Letterbox",   outcome: "184 new properties" },
  { name: "Green Waste No Plastics Drive",reach: 28200, type: "Letterbox",   outcome: "4.1% green waste contamination reduction" },
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
  { event: "E-Waste Drop-Off Day",         date: "15 Mar 2026", attendees: 684,  tonnes: 8.2  },
  { event: "Household Hazardous Waste",    date: "22 Feb 2026", attendees: 412,  tonnes: 3.1  },
  { event: "Bulk Hard Waste Collection",   date: "8 Feb 2026",  attendees: 1240, tonnes: 42.6 },
  { event: "Green Waste Mulch Day",        date: "1 Feb 2026",  attendees: 328,  tonnes: 18.4 },
  { event: "Community Composting Workshop",date: "25 Jan 2026", attendees: 94,   tonnes: 0    },
];

export default function CommunityPage() {
  const overallScore       = SATISFACTION.find(s => s.service === "Overall")!.score;
  const avgRecyclePass     = Math.round(BIN_AUDIT.reduce((s, r) => s + r.recyclePassed, 0) / BIN_AUDIT.length);
  const totalCampaignReach = CAMPAIGNS.reduce((s, r) => s + r.reach, 0);
  const totalEventTonnes   = +EVENTS.reduce((s, r) => s + r.tonnes, 0).toFixed(1);

  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={PAGE}>
      <p style={{ fontSize: 13, color: T3, margin: 0 }}>Period: {today}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
        <KpiCard label="Overall Satisfaction"    value={`${overallScore}/5.0`}                sub="480 survey responses this period"            accent={overallScore >= 4 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Recycling Bin Pass Rate" value={`${avgRecyclePass}%`}                 sub="Correct materials, no contamination"          accent={avgRecyclePass >= 90 ? "#10b981" : "#f59e0b"} />
        <KpiCard label="Campaign Reach"          value={totalCampaignReach.toLocaleString()}  sub={`${CAMPAIGNS.length} campaigns this period`}  accent="#3b82f6" />
        <KpiCard label="Event Waste Diverted"    value={`${totalEventTonnes} t`}              sub={`${EVENTS.length} community events`}          accent="#8b5cf6" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={DC}>
          <SectionHeader title="Community Satisfaction by Service" sub="Survey responses — 1 to 5 scale" />
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
            {SATISFACTION.filter(s => s.service !== "Overall").map(s => (
              <div key={s.service}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: T1, fontWeight: 500 }}>{s.service}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 12, color: T3 }}>{s.responses} responses</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: s.score >= 4.2 ? "#4ade80" : s.score >= 3.9 ? "#60a5fa" : "#f59e0b" }}>{s.score}/5</span>
                  </div>
                </div>
                <div style={{ height: 10, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 999, width: `${(s.score / 5) * 100}%`, background: s.score >= 4.2 ? "#10b981" : s.score >= 3.9 ? "#3b82f6" : "#f59e0b" }} />
                </div>
              </div>
            ))}
            <div style={{ paddingTop: 12, borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T1 }}>Overall Score</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: "#4ade80" }}>{overallScore} / 5.0</span>
            </div>
          </div>
        </div>

        <div style={DC}>
          <SectionHeader title="Customer Contact Volume" sub="Phone calls and digital requests Oct 2025 – Mar 2026" />
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={HOTLINE} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={DTT} />
              <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
              <Bar dataKey="calls"   name="Phone"   stackId="a" fill="#3b82f6" />
              <Bar dataKey="digital" name="Digital" stackId="a" fill="#10b981" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={DC}>
        <SectionHeader title="Bin Audit Results by Zone" sub="% of audited bins correctly sorted (pass) — target ≥ 90%" />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={BIN_AUDIT} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="zone" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `${v}%`} tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} domain={[70, 100]} />
            <Tooltip formatter={v => `${v}%`} contentStyle={DTT} />
            <Legend wrapperStyle={{ fontSize: 12, color: T2 }} />
            <Bar dataKey="recyclePassed" name="Recycling Pass %" fill="#3b82f6" radius={[3,3,0,0]} />
            <Bar dataKey="greenPassed"   name="Green Waste Pass %" fill="#10b981" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
            <SectionHeader title="Education Campaigns" />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: ROW_HEAD }}>
                {["Campaign","Type","Reach","Outcome"].map((h, i) => (
                  <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 2 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAMPAIGNS.map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                  <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{r.name}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "rgba(255,255,255,0.08)", color: T2 }}>{r.type}</span>
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{r.reach.toLocaleString()}</td>
                  <td style={{ padding: "10px 14px", color: T3, fontSize: 12 }}>{r.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ ...DC, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}` }}>
            <SectionHeader title="Community Events" />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: ROW_HEAD }}>
                {["Event","Date","Attendees","Tonnes"].map((h, i) => (
                  <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENTS.map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${ROW_BDR}` }}>
                  <td style={{ padding: "10px 14px", color: T1, fontWeight: 500 }}>{r.event}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T3, fontSize: 12 }}>{r.date}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: T2 }}>{r.attendees.toLocaleString()}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", color: "#4ade80", fontWeight: 500 }}>{r.tonnes > 0 ? `${r.tonnes} t` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

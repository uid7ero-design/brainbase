"use client";

import React, { useEffect, useRef, useState } from "react";

interface CommandDemoProps {
  placeholder?: string;
}

const getLoadingMessage = (q: string): string => {
  const t = q.toLowerCase();
  if (t.includes("fleet") || t.includes("vehicle") || t.includes("service"))
    return "Reviewing fleet service records…";
  if (t.includes("waste") || t.includes("contamination") || t.includes("recycl"))
    return "Analysing waste and contamination data…";
  if (t.includes("water") || t.includes("utilit") || t.includes("leak"))
    return "Checking water usage across districts…";
  if (t.includes("labour") || t.includes("workforce") || t.includes("cost") || t.includes("staff"))
    return "Calculating labour costs by department…";
  if (t.includes("road") || t.includes("infrastructure") || t.includes("pothole"))
    return "Scanning road defect reports…";
  if (t.includes("park") || t.includes("open space") || t.includes("green"))
    return "Reviewing parks and open spaces data…";
  if (t.includes("facilit") || t.includes("building") || t.includes("depot"))
    return "Checking facility maintenance logs…";
  if (t.includes("construction") || t.includes("project") || t.includes("capital"))
    return "Reviewing capital works project status…";
  return "Analysing your operations…";
};

type Domain = "fleet" | "waste" | "water" | "labour" | "roads" | "parks" | "facilities" | "construction" | "general";

const inferDomain = (filename: string, query: string): Domain => {
  const s = (filename + " " + query).toLowerCase();
  if (s.match(/fleet|vehicle|truck|van|rego|service|maint/))        return "fleet";
  if (s.match(/waste|bin|recycl|contamin|rubbish|collection/))      return "waste";
  if (s.match(/water|utilit|leak|pipe|meter|usage|district/))       return "water";
  if (s.match(/labour|staff|workforce|roster|payroll|overtime|cost/)) return "labour";
  if (s.match(/road|pothole|defect|asphalt|pavement|infrastructure/)) return "roads";
  if (s.match(/park|reserve|green|open.?space|playground|mow/))     return "parks";
  if (s.match(/facilit|building|hvac|depot|civic|maintenance/))     return "facilities";
  if (s.match(/construct|project|capital|works|tender|contract/))   return "construction";
  return "general";
};

const inferIntent = (query: string): string => {
  const q = query.toLowerCase();
  if (q.match(/overdue|late|behind|miss/))   return "overdue";
  if (q.match(/cost|spend|budget|expensive/)) return "cost";
  if (q.match(/risk|danger|unsafe|hazard/))  return "risk";
  if (q.match(/best|top|highest|most/))      return "top";
  if (q.match(/trend|over time|month|week/)) return "trend";
  return "summary";
};

const ANALYSES: Record<Domain, Record<string, { insight: string; risk: string; action: string }>> = {
  fleet: {
    overdue:  { insight: "37% of vehicles (14 of 38) are past their scheduled service date, with the highest concentration in the northern depot.", risk: "3 heavy vehicles exceed their service threshold by over 30 days — increasing breakdown probability and voiding warranty coverage.", action: "Prioritise servicing for units F-04, F-11, and F-19 within 48 hours. Flag remaining overdue vehicles for next-week scheduling." },
    cost:     { insight: "Fleet maintenance spend this quarter is $84,200 — up 14% on the same period last year, driven by unplanned repairs.", risk: "Reactive repair costs are outpacing the preventive maintenance budget, compressing the overall fleet operations budget.", action: "Shift 20% of discretionary maintenance spend to scheduled servicing to reduce reactive repair frequency." },
    summary:  { insight: "Fleet data processed across 38 active vehicles. 14 are flagged, 6 are grounded, and 18 are fully operational.", risk: "Current grounding rate (16%) is above the acceptable 10% threshold for uninterrupted service delivery.", action: "Review grounding reasons with depot manager and escalate any vehicles awaiting parts beyond 5 days." },
  },
  waste: {
    overdue:  { insight: "4 scheduled collection runs in Zone 3 were missed or delayed in the past fortnight, affecting approximately 1,200 households.", risk: "Repeat missed collections breach the service charter SLA and may trigger formal complaints or council review.", action: "Reschedule missed runs within 48 hours and investigate routing cause with the collections team." },
    cost:     { insight: "Waste processing costs are $3.40/kg this quarter — up from $2.90/kg last year, driven by contamination surcharges.", risk: "Surcharge increases will exceed the annual waste budget by approximately $28,000 if contamination rates are not reduced.", action: "Target the top 3 contaminating zones with resident education. Review processor contract for surcharge thresholds." },
    summary:  { insight: "Contamination rate across all zones averages 16.2%. Zone 3 is the highest at 18.4%, up 2.1% from last month.", risk: "Rates above 15% risk penalties from the processing facility and reduced recycling diversion credits.", action: "Deploy bin audits and education letterdrops in Zone 3. Set a 30-day target to reduce contamination below 15%." },
  },
  water: {
    overdue:  { insight: "6 scheduled pipe inspections are overdue across District 2 and District 4, some by more than 3 weeks.", risk: "Uninspected pipes in District 4 coincide with the area showing elevated usage — increasing the likelihood of undetected leakage.", action: "Schedule District 4 inspections immediately. Cross-reference overdue inspections with pressure anomaly logs." },
    cost:     { insight: "Water distribution costs are tracking 11% above budget this quarter, partly due to emergency response in District 4.", risk: "If the District 4 anomaly is a main leak, remediation costs could exceed $60,000 depending on depth and access.", action: "Authorise a targeted leak detection sweep in District 4 before committing further operational spend." },
    summary:  { insight: "9 of 11 districts are within normal usage range. District 4 is 12% above baseline for the second consecutive week.", risk: "A sustained spike of this magnitude typically indicates either a leak or an unreported connection — both require investigation.", action: "Deploy inspection crew to the Riverside main in District 4 and cross-reference meter readings with usage data." },
  },
  labour: {
    overdue:  { insight: "11 timesheets from last fortnight remain unsubmitted across Parks, Waste, and Depot teams.", risk: "Late timesheet submission delays payroll processing and creates compliance gaps in the workforce management audit trail.", action: "Issue reminders to supervisors in affected teams. Set a hard deadline of COB tomorrow for outstanding submissions." },
    cost:     { insight: "Weekly labour spend is $142,300 — 8% above the equivalent period last quarter. Parks & Recreation accounts for 31% of spend.", risk: "Overtime hours in Parks are unsustainable heading into peak season and will likely breach the annual overtime cap by Q4.", action: "Review the Parks rostering plan. Consider 2 additional casual hires to reduce overtime dependency before the season peak." },
    trend:    { insight: "Labour costs have increased 6% quarter-on-quarter for the past 3 periods, with overtime as the primary driver.", risk: "If the trend continues unchecked, the annual labour budget will be exhausted by late Q3, forcing a supplementary budget request.", action: "Conduct a workforce demand review for Q3 and Q4 and present options for casual uplift or overtime capping to management." },
    summary:  { insight: "Workforce data reviewed across 6 departments. Total headcount: 214 FTE. Overtime flagged in 3 departments.", risk: "Two departments are operating understaffed relative to current service demand, increasing burnout and error risk.", action: "Share workforce snapshot with department heads and initiate a staffing review for the two understaffed teams." },
  },
  roads: {
    overdue:  { insight: "4 road defects logged more than 10 days ago have not yet been assessed, breaching the 7-day SLA.", risk: "The Grant St defect near the primary school is in the highest-risk category and exposes council to public liability.", action: "Escalate Grant St to priority status immediately. Assign assessment crews to all 4 overdue defects this week." },
    risk:     { insight: "7 of 23 open defects are classified high-risk based on location, defect type, and traffic volume.", risk: "High-risk defects in school zones and on arterial roads carry the greatest public liability exposure if incidents occur.", action: "Implement temporary hazard signage on all 7 high-risk sites today while permanent repairs are scheduled." },
    summary:  { insight: "23 road defects are currently open. 8 resolved, 11 scheduled, 4 pending assessment. Average resolution time is 9.2 days.", risk: "Average resolution time exceeds the 7-day SLA. Continued slippage risks charter breach and increased liability exposure.", action: "Review crew scheduling for the coming fortnight and prioritise the 4 unassessed defects." },
  },
  parks: {
    overdue:  { insight: "3 maintenance requests across Centennial Reserve, Riverside Park, and Eastfield are more than 5 days old without assignment.", risk: "The Centennial Reserve fencing defect near the playground presents an active safety risk and potential liability if left unresolved.", action: "Assign a crew to Centennial Reserve by end of day. Triage the remaining 2 requests for scheduling this week." },
    summary:  { insight: "16 of 17 parks are fully operational. Centennial Reserve has one open maintenance request (fencing, 3 days old). Mowing is on schedule.", risk: "The open fencing defect is adjacent to a playground — it carries a public safety and liability risk if not addressed promptly.", action: "Escalate Centennial Reserve fencing to priority maintenance. Confirm closure of the request within 48 hours." },
  },
  facilities: {
    overdue:  { insight: "The civic centre HVAC inspection is 5 days overdue. 3 additional facility requests are unassigned and approaching SLA.", risk: "An overdue HVAC inspection may void the maintenance warranty and breach council's Workplace Health & Safety obligations.", action: "Book HVAC inspection within 72 hours. Assign the 3 remaining requests to facility managers today." },
    summary:  { insight: "4 facility maintenance requests are open across 3 sites. HVAC inspection is the highest priority item.", risk: "Deferred facility maintenance compounds over time — unresolved issues across multiple sites increase overall operational risk.", action: "Conduct a monthly facility review meeting and implement a weekly open-request triage process." },
  },
  construction: {
    cost:     { insight: "The library carpark project is 6% over budget ($18,000 above allocation), driven by subcontractor variations.", risk: "If variations continue at the current rate, the project will require a supplementary budget request before practical completion.", action: "Freeze discretionary variations immediately. Review contract with the subcontractor to identify savings or scope reduction." },
    overdue:  { insight: "The Westfield drain upgrade is 3 weeks behind schedule, primarily due to delayed materials delivery.", risk: "Further slippage risks non-compliance with stormwater management obligations ahead of the winter rainfall season.", action: "Convene a project recovery meeting this week. Explore expedited materials sourcing and adjust the programme accordingly." },
    summary:  { insight: "12 capital works projects are active. 3 on schedule, 7 within acceptable variance, 2 flagged for cost or time overrun.", risk: "The 2 flagged projects (Westfield drain and library carpark) carry the highest delivery and financial risk this quarter.", action: "Escalate both flagged projects to the capital works steering committee. Update the risk register and reforecast completion dates." },
  },
  general: {
    summary:  { insight: "Uploaded data processed across 6 service areas. 3 anomalies detected relative to the 90-day baseline.", risk: "Two anomalies fall outside acceptable variance thresholds and warrant further review before the next reporting period.", action: "Share this report with relevant department leads and schedule a cross-team review within 5 business days." },
  },
};

const getFileAnalysis = (filename: string, q: string): string => {
  const domain  = inferDomain(filename, q);
  const intent  = inferIntent(q);
  const set     = ANALYSES[domain] ?? ANALYSES.general;
  const entry   = set[intent] ?? set.summary ?? ANALYSES.general.summary;
  return `Insight: ${entry.insight}\nRisk: ${entry.risk}\nRecommended Action: ${entry.action}`;
};

// ── Types ─────────────────────────────────────────────────────────────────

interface InsightItem {
  text?: string; insight?: string
  confidence?: number
  impact?: string; severity?: string
  why_this_matters?: string; why?: string
  recommended_action?: string; recommendation?: string
  area?: string; category?: string
  trend?: string; delta?: string | number
}
interface DecisionItem { text?: string; action?: string; priority?: string; area?: string }
interface IssueItem    { text?: string; issue?: string;  severity?: string; field?: string }

interface PipelineResult {
  risks?:               unknown;
  recommended_actions?: unknown;
  data_issues?:         unknown;
  key_insights?:        unknown;
  summary?:             string;
  overall_status?:      string;
  confidence_score?:    number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

const strOf = (item: unknown, ...keys: string[]): string => {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    for (const k of keys) {
      const v = (item as Record<string, unknown>)[k];
      if (typeof v === "string" && v) return v;
    }
  }
  return "";
};

const levelOf = (item: unknown, ...keys: string[]): string | undefined => {
  if (typeof item !== "object" || !item) return undefined;
  for (const k of keys) {
    const v = (item as Record<string, unknown>)[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
};

const isPipelineShape = (v: unknown): v is PipelineResult =>
  !!v && typeof v === "object" &&
  !!(  (v as PipelineResult).risks
    || (v as PipelineResult).recommended_actions
    || (v as PipelineResult).key_insights
    || (v as PipelineResult).data_issues);

// Severity palette — Critical/High/Medium/Low
const SEV: Record<string, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: '#F87171', bg: 'rgba(248,113,113,.08)', border: 'rgba(248,113,113,.28)', label: 'Critical' },
  high:     { color: '#F59E0B', bg: 'rgba(245,158,11,.07)',  border: 'rgba(245,158,11,.26)',  label: 'High'     },
  medium:   { color: '#60A5FA', bg: 'rgba(96,165,250,.07)',  border: 'rgba(96,165,250,.22)',  label: 'Medium'   },
  low:      { color: '#94A3B8', bg: 'rgba(148,163,184,.05)', border: 'rgba(148,163,184,.18)', label: 'Low'      },
};
const sev = (v?: string) => SEV[(v ?? '').toLowerCase()] ?? SEV.medium;

const confPct = (v: number) => Math.round(v > 1 ? v : v * 100);

// ── Sub-components ────────────────────────────────────────────────────────

const ChevronDown = ({ size = 12, style: s = {} }: { size?: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" style={s}>
    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ShieldIcon = () => (
  <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <path d="M7 1.5L2 3.5v3.5c0 2.9 2.1 5.6 5 6.2 2.9-.6 5-3.3 5-6.2V3.5L7 1.5z" stroke="#F87171" strokeWidth="1.2" strokeLinejoin="round"/>
  </svg>
);

const LightbulbIcon = () => (
  <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <path d="M7 2a3.5 3.5 0 0 1 2.6 5.9c-.4.4-.6.9-.6 1.4v.2H5v-.2c0-.5-.2-1-.6-1.4A3.5 3.5 0 0 1 7 2z" stroke="#818CF8" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M5.5 11h3M6 12.5h2" stroke="#818CF8" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const TrendIcon = () => (
  <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
    <path d="M1.5 10.5l4-4 3 2.5L12 3" stroke="#22D3EE" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 3h2v2" stroke="#22D3EE" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const DatabaseIcon = () => (
  <svg width={13} height={13} viewBox="0 0 14 14" fill="none">
    <ellipse cx="7" cy="3.5" rx="4.5" ry="1.5" stroke="#94A3B8" strokeWidth="1.2"/>
    <path d="M2.5 3.5v3c0 .83 2.01 1.5 4.5 1.5s4.5-.67 4.5-1.5v-3" stroke="#94A3B8" strokeWidth="1.2"/>
    <path d="M2.5 6.5v3c0 .83 2.01 1.5 4.5 1.5s4.5-.67 4.5-1.5v-3" stroke="#94A3B8" strokeWidth="1.2"/>
  </svg>
);

function ConfidenceMeter({ score }: { score: number }) {
  const pct   = confPct(score);
  const color = pct >= 80 ? '#34D399' : pct >= 60 ? '#60A5FA' : pct >= 40 ? '#F59E0B' : '#F87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .6s ease' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color, flexShrink: 0, minWidth: 34, textAlign: 'right' }}>{pct}% conf</span>
    </div>
  );
}

function SeverityBadge({ level }: { level?: string }) {
  if (!level) return null;
  const s = sev(level);
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 4, flexShrink: 0,
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

function SectionHeader({ icon, label, count, color, open, onToggle }: {
  icon: React.ReactNode; label: string; count: number; color: string;
  open: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 10px', textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', opacity: 0.75 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color, flex: 1 }}>{label}</span>
      <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: `${color}14`, border: `1px solid ${color}28`, color, marginRight: 4 }}>{count}</span>
      <ChevronDown size={10} style={{ color: 'rgba(255,255,255,.25)', transition: 'transform .2s', transform: open ? 'none' : 'rotate(-90deg)' }} />
    </button>
  );
}

function HeroSummary({ summary, status, confidence, topAction }: {
  summary?: string; status?: string; confidence?: number; topAction?: string;
}) {
  if (!summary && !status && !topAction) return null;
  const sl = (status ?? '').toLowerCase();
  const statusColor = sl.includes('good') || sl.includes('ok') || sl.includes('normal')
    ? '#34D399' : sl.includes('critical') || sl.includes('alert') ? '#F87171' : '#F59E0B';
  return (
    <div style={{
      padding: '20px 22px', borderRadius: 12,
      background: 'linear-gradient(135deg, rgba(99,102,241,.07) 0%, rgba(139,92,246,.04) 100%)',
      border: '1px solid rgba(99,102,241,.22)',
      boxShadow: '0 4px 32px rgba(99,102,241,.05)',
    }}>
      {status && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: summary ? 12 : 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0, boxShadow: `0 0 8px ${statusColor}` }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.35)' }}>Status</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: statusColor }}>{status}</span>
        </div>
      )}
      {summary && (
        <p style={{ margin: 0, fontSize: 14, color: '#E2E8F0', lineHeight: 1.7 }}>{summary}</p>
      )}
      {(confidence != null || topAction) && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {confidence != null && <ConfidenceMeter score={confidence} />}
          {topAction && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#34D399', flexShrink: 0, paddingTop: 1 }}>Action</span>
              <span style={{ fontSize: 12, color: 'rgba(110,231,183,.75)', lineHeight: 1.55 }}>{topAction}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RiskIntelligenceCard({ item }: { item: string | InsightItem }) {
  const [expanded, setExpanded] = useState(false);
  const text     = strOf(item, "insight", "text");
  const why      = typeof item !== "string" ? (item.why_this_matters ?? item.why) : undefined;
  const action   = typeof item !== "string" ? (item.recommended_action ?? item.recommendation) : undefined;
  const area     = typeof item !== "string" ? (item.area ?? item.category) : undefined;
  const severity = levelOf(item, "severity", "impact");
  const s = sev(severity);
  const hasDetail = !!(why || action);
  return (
    <div
      style={{ borderRadius: 10, overflow: 'hidden', background: s.bg, border: `1px solid ${s.border}`, borderLeft: `3px solid ${s.color}`, transition: 'transform .15s, box-shadow .15s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 24px ${s.color}18`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
    >
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
          {area && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)' }}>{area}</span>}
          <SeverityBadge level={severity} />
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#E2E8F0', lineHeight: 1.65 }}>{text}</p>
      </div>
      {hasDetail && (
        <>
          <button
            onClick={() => setExpanded(o => !o)}
            style={{
              width: '100%', padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(0,0,0,.15)', border: 'none', borderTop: `1px solid ${s.border}`,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', flex: 1 }}>
              {expanded ? 'Less detail' : 'Why this matters'}
            </span>
            <ChevronDown size={10} style={{ color: 'rgba(255,255,255,.20)', transition: 'transform .2s', transform: expanded ? 'rotate(180deg)' : 'none' }} />
          </button>
          {expanded && (
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {why && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', marginBottom: 4 }}>Why this matters</div>
                  <p style={{ margin: 0, fontSize: 12, color: 'rgba(226,232,240,.60)', lineHeight: 1.6 }}>{why}</p>
                </div>
              )}
              {action && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#34D399', marginBottom: 4 }}>Recommended action</div>
                  <p style={{ margin: 0, fontSize: 12, color: 'rgba(110,231,183,.72)', lineHeight: 1.6 }}>{action}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OpportunityCard({ item }: { item: string | InsightItem }) {
  const text   = strOf(item, "insight", "text");
  const action = typeof item !== "string" ? (item.recommended_action ?? item.recommendation) : undefined;
  const area   = typeof item !== "string" ? (item.area ?? item.category) : undefined;
  const conf   = typeof item !== "string" ? item.confidence : undefined;
  return (
    <div
      style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(129,140,248,.05)', border: '1px solid rgba(129,140,248,.16)', borderLeft: '3px solid rgba(129,140,248,.55)', transition: 'transform .15s, box-shadow .15s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 20px rgba(129,140,248,.10)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        {area && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)' }}>{area}</span>}
        {conf != null && (
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(129,140,248,.12)', border: '1px solid rgba(129,140,248,.20)', color: 'rgba(167,139,250,.80)', flexShrink: 0 }}>
            {confPct(conf)}% conf
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: '#E2E8F0', lineHeight: 1.65 }}>{text}</p>
      {action && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'rgba(129,140,248,.65)', lineHeight: 1.55 }}>→ {action}</p>}
    </div>
  );
}

function TrendSignal({ item }: { item: InsightItem }) {
  const text  = strOf(item, "insight", "text");
  const delta = item.delta;
  const trend = item.trend;
  const area  = item.area ?? item.category;
  const dirStr = String(delta ?? trend ?? '');
  const isUp   = /^\+|up|incr/i.test(dirStr);
  const isDown = /^-|down|decr/i.test(dirStr);
  const dirColor = isUp ? '#34D399' : isDown ? '#F87171' : '#22D3EE';
  return (
    <div
      style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(34,211,238,.04)', border: '1px solid rgba(34,211,238,.12)', display: 'flex', gap: 10, alignItems: 'flex-start', transition: 'transform .15s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; }}
    >
      {delta != null && (
        <span style={{ fontSize: 15, fontWeight: 700, color: dirColor, flexShrink: 0, lineHeight: 1.2 }}>
          {isUp ? '↑' : isDown ? '↓' : '→'} {String(delta)}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {area && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#22D3EE', marginBottom: 3 }}>{area}</div>}
        <p style={{ margin: 0, fontSize: 12, color: 'rgba(226,232,240,.65)', lineHeight: 1.55 }}>{text}</p>
        {trend && !delta && <span style={{ fontSize: 11, color: dirColor, marginTop: 4, display: 'block' }}>{trend}</span>}
      </div>
    </div>
  );
}

const toArr = <T,>(v: unknown, ...fallbackKeys: string[]): T[] => {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object") {
    for (const k of fallbackKeys) {
      const nested = (v as Record<string, unknown>)[k];
      if (Array.isArray(nested)) return nested as T[];
    }
  }
  return [];
};

function PipelineResultView({ result }: { result: PipelineResult }) {
  const [risksOpen,    setRisksOpen]    = useState(true);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [trendsOpen,   setTrendsOpen]   = useState(true);
  const [qualityOpen,  setQualityOpen]  = useState(false);

  const issues   = toArr<string | IssueItem>  (result.data_issues);
  const insights = toArr<string | InsightItem>(result.key_insights);
  const xforms   = toArr<string | InsightItem>(result.risks);
  const actions  = toArr<string | DecisionItem>(result.recommended_actions);

  const allRisks = [
    ...xforms,
    ...insights.filter(i => ['critical', 'high'].includes((levelOf(i, "impact", "severity") ?? '').toLowerCase())),
  ];
  const opportunities = insights.filter(
    i => !['critical', 'high'].includes((levelOf(i, "impact", "severity") ?? '').toLowerCase())
  );
  const trends = [...insights, ...xforms].filter((i): i is InsightItem =>
    typeof i !== "string" && ((i as InsightItem).delta != null || !!(i as InsightItem).trend)
  );

  const topAction = actions.length > 0 ? strOf(actions[0], "action", "text") : undefined;
  const lowConf   = result.confidence_score != null && confPct(result.confidence_score) < 60;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* 1 — Hero */}
      <HeroSummary
        summary={result.summary}
        status={result.overall_status}
        confidence={result.confidence_score}
        topAction={topAction}
      />

      {/* Low-confidence warning */}
      {lowConf && (
        <div style={{ padding: '10px 14px', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.22)' }}>
          <span style={{ fontSize: 12, color: '#F59E0B', flexShrink: 0 }}>⚠</span>
          <span style={{ fontSize: 12, color: 'rgba(245,158,11,.75)', lineHeight: 1.5 }}>
            Confidence below 60% — treat findings as directional. Results may reflect incomplete or inconsistent data.
          </span>
        </div>
      )}

      {/* 2 — Risk Intelligence */}
      {allRisks.length > 0 && (
        <div>
          <SectionHeader icon={<ShieldIcon />} label="Risk Intelligence" count={allRisks.length} color="#F87171" open={risksOpen} onToggle={() => setRisksOpen(o => !o)} />
          {risksOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {allRisks.map((item, i) => <RiskIntelligenceCard key={i} item={item as InsightItem} />)}
            </div>
          )}
        </div>
      )}

      {/* 3 — Opportunities */}
      {opportunities.length > 0 && (
        <div>
          <SectionHeader icon={<LightbulbIcon />} label="Opportunities" count={opportunities.length} color="#818CF8" open={insightsOpen} onToggle={() => setInsightsOpen(o => !o)} />
          {insightsOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {opportunities.map((item, i) => <OpportunityCard key={i} item={item as InsightItem} />)}
            </div>
          )}
        </div>
      )}

      {/* 4 — Trends & Signals */}
      {trends.length > 0 && (
        <div>
          <SectionHeader icon={<TrendIcon />} label="Trends & Signals" count={trends.length} color="#22D3EE" open={trendsOpen} onToggle={() => setTrendsOpen(o => !o)} />
          {trendsOpen && (
            <div style={{ display: 'grid', gridTemplateColumns: trends.length > 1 ? '1fr 1fr' : '1fr', gap: 8 }}>
              {trends.map((item, i) => <TrendSignal key={i} item={item} />)}
            </div>
          )}
        </div>
      )}

      {/* 5 — Data Quality */}
      {issues.length > 0 && (
        <div>
          <SectionHeader icon={<DatabaseIcon />} label="Data Quality" count={issues.length} color="#94A3B8" open={qualityOpen} onToggle={() => setQualityOpen(o => !o)} />
          {qualityOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {issues.map((item, i) => {
                const text     = strOf(item, "issue", "text");
                const field    = typeof item !== "string" ? item.field : undefined;
                const severity = levelOf(item, "severity") ?? 'medium';
                const s = sev(severity);
                return (
                  <div key={i} style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: 12, color: 'rgba(226,232,240,.60)', lineHeight: 1.55, flex: 1 }}>
                      {field && <span style={{ color: s.color, marginRight: 5, fontWeight: 600 }}>{field}:</span>}
                      {text}
                    </span>
                    <SeverityBadge level={severity} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {allRisks.length === 0 && opportunities.length === 0 && trends.length === 0 && issues.length === 0 && !result.summary && (
        <div style={{ padding: '28px', textAlign: 'center', borderRadius: 10, background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,.28)' }}>No structured intelligence found in this result.</p>
        </div>
      )}
    </div>
  );
}

const getFallbackResponse = (q: string): string => {
  const t = q.toLowerCase();
  if (t.includes("fleet") || t.includes("vehicle") || t.includes("service"))
    return "14 vehicles are currently flagged for service. Of these, 6 are overdue by more than 14 days — primarily in the northern depot. Recommended priority: units F-04, F-11, and F-19.";
  if (t.includes("waste") || t.includes("contamination") || t.includes("recycl"))
    return "Zone 3 contamination rate is currently 18.4%, up 2.1% from last month. The highest contributing streets are Maple Ave and Cross St. A resident education campaign is recommended.";
  if (t.includes("water") || t.includes("utilit") || t.includes("leak"))
    return "Water usage is within normal range across 9 of 11 districts. District 4 shows a 12% spike this week, potentially indicating a leak on the Riverside main. Inspection is advised.";
  if (t.includes("labour") || t.includes("workforce") || t.includes("cost") || t.includes("staff"))
    return "Total labour cost this week: $142,300 across 6 departments. Parks & Recreation accounts for 31% due to seasonal rostering. Overtime hours are up 8% compared to the same period last quarter.";
  if (t.includes("road") || t.includes("infrastructure") || t.includes("pothole"))
    return "23 road defects were logged this week. 8 have been resolved, 11 are scheduled, and 4 are awaiting assessment. The highest-priority outstanding issue is on Grant St near the school zone.";
  if (t.includes("park") || t.includes("open space") || t.includes("green"))
    return "All 17 parks are operational. Centennial Reserve has a maintenance request open for damaged fencing (logged 3 days ago). Mowing schedules are on track for the week.";
  if (t.includes("facilit") || t.includes("building") || t.includes("depot"))
    return "4 facility maintenance requests are currently open. The civic centre HVAC inspection is overdue by 5 days. All depot sites are operational with no critical issues reported.";
  if (t.includes("construction") || t.includes("project") || t.includes("capital"))
    return "12 capital works projects are active. 3 are on schedule, 7 are within acceptable variance, and 2 are flagged — the Westfield drain upgrade (delayed 3 weeks) and the library carpark (budget overage of 6%).";
  return "Based on your operational data, everything is within normal parameters. 3 items require attention this week. Would you like a detailed breakdown by department or service area?";
};

const THINKING_MSGS = [
  "Analysing operational patterns",
  "Identifying risks and anomalies",
  "Evaluating trends and signals",
  "Structuring intelligence report",
];

export default function CommandDemo({ placeholder = "Type a query..." }: CommandDemoProps) {
  const [query,      setQuery]      = useState("");
  const [result,     setResult]     = useState<PipelineResult | { _fallback: string } | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Analysing your operations…");
  const [file,       setFile]       = useState<File | null>(null);
  const [dots,       setDots]       = useState(0);
  const [msgIdx,     setMsgIdx]     = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading) return;
    setDots(0);
    setMsgIdx(0);
    const dotId = setInterval(() => setDots(d => (d + 1) % 3), 480);
    const msgId = setInterval(() => setMsgIdx(m => (m + 1) % THINKING_MSGS.length), 2000);
    return () => { clearInterval(dotId); clearInterval(msgId); };
  }, [loading]);

  const resolveRaw = (raw: unknown, fallbackFn: () => string): PipelineResult | string => {
    // Already a pipeline object
    if (isPipelineShape(raw)) return raw;
    // Object envelope
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      // New backend format: { type: "pipeline", result: { risks, recommended_actions, ... } }
      if (r.type === "pipeline" && r.result && typeof r.result === "object") {
        return r.result as PipelineResult;
      }
      // Legacy: nested under .result key
      const nested = r.result;
      if (isPipelineShape(nested)) return nested;
      if (typeof nested === "string") raw = nested;
      else raw = JSON.stringify(raw);
    }
    // String — check for LLM unavailable sentinel
    const s = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (s.includes("LLM unavailable")) return fallbackFn();
    // Try parsing as JSON pipeline
    try {
      const parsed = JSON.parse(s);
      if (isPipelineShape(parsed)) return parsed;
    } catch { /* not JSON */ }
    return s;
  };

  const applyResult = (resolved: PipelineResult | string) => {
    if (typeof resolved === "string") {
      setResult({ _fallback: resolved });
    } else {
      setResult(resolved);
    }
  };

  const DEFAULT_FILE_QUERY = "Analyse this dataset and identify risks and insights";

  const runQuery = async (q = query) => {
    const effectiveQ = q.trim() || (file ? DEFAULT_FILE_QUERY : "");
    if (!effectiveQ) return;
    q = effectiveQ;
    setResult(null);
    setLoadingMsg(file ? `Uploading ${file.name}…` : getLoadingMessage(q));
    setLoading(true);
    try {
      if (file) {
        // Step 1 — upload file
        const form = new FormData();
        form.append("file", file);
        form.append("query", q);
        const uploadRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upload`, {
          method: "POST",
          body: form,
        });
        const uploadData = await uploadRes.json();
        console.log("upload:", uploadData);
        const filePath: string = uploadData.file_path ?? uploadData.path ?? uploadData.filename ?? "";

        // Step 2 — run query against uploaded file
        setLoadingMsg(getLoadingMessage(q));
        const runRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, file_path: filePath }),
        });
        const runData = await runRes.json();
        console.log("run:", runData);
        applyResult(resolveRaw(runData, () => getFileAnalysis(file.name, q)));
      } else {
        const [res] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_URL}/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q }),
          }),
          new Promise(r => setTimeout(r, 1500)),
        ]);
        const data = await res.json();
        console.log(data);
        applyResult(resolveRaw(data, () => getFallbackResponse(q)));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* ── File upload ── */}
      <div style={{ marginBottom: 10 }}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx"
          style={{ display: 'none' }}
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => fileRef.current?.click()}
            style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
              background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)',
              color: 'rgba(226,232,240,.70)', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Upload file
          </button>
          {file ? (
            <span style={{ fontSize: 13, color: 'rgba(226,232,240,.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file.name}
              <button
                onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                style={{ marginLeft: 8, background: 'none', border: 'none', color: 'rgba(226,232,240,.35)', cursor: 'pointer', fontSize: 12, padding: 0 }}
              >
                ✕
              </button>
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'rgba(226,232,240,.28)' }}>.csv or .xlsx</span>
          )}
        </div>
      </div>

      {/* ── Query input ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !file) runQuery(); }}
          placeholder={file ? 'Optional: ask something specific about this file…' : placeholder}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 8,
            border: '1px solid rgba(255,255,255,.14)',
            background: 'rgba(255,255,255,.05)', color: '#F1F5F9',
            fontSize: 14, outline: 'none', fontFamily: 'inherit',
          }}
        />
        {!file && (
          <button
            onClick={() => runQuery()}
            disabled={loading}
            style={{
              padding: '10px 20px', borderRadius: 8,
              background: loading ? 'rgba(99,102,241,.14)' : 'rgba(99,102,241,.28)',
              border: '1px solid rgba(99,102,241,.50)',
              color: '#F1F5F9', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'default' : 'pointer', transition: 'background .15s',
            }}
          >
            {loading ? '…' : 'Ask'}
          </button>
        )}
      </div>

      {file && (
        <button
          onClick={() => runQuery()}
          disabled={loading}
          style={{
            width: '100%', padding: '11px', borderRadius: 8, marginBottom: 12,
            background: loading ? 'rgba(99,102,241,.10)' : 'linear-gradient(135deg, rgba(99,102,241,.30), rgba(139,92,246,.30))',
            border: '1px solid rgba(99,102,241,.45)',
            color: '#F1F5F9', fontSize: 14, fontWeight: 600,
            cursor: loading ? 'default' : 'pointer', transition: 'opacity .15s',
            letterSpacing: '.02em',
          }}
        >
          {loading ? 'Analysing…' : '⚡ Analyse Data'}
        </button>
      )}

      {loading && (
        <div style={{
          padding: '18px 20px', borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(139,92,246,.06) 0%, rgba(99,102,241,.04) 100%)',
          border: '1px solid rgba(139,92,246,.16)',
        }}>
          {/* HLNΛ badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#A78BFA', boxShadow: '0 0 7px #A78BFA', flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(167,139,250,.55)' }}>
              HLNΛ · Processing
            </span>
          </div>
          {/* Contextual phase message */}
          <div style={{ fontSize: 11, color: 'rgba(226,232,240,.32)', marginBottom: 8, fontStyle: 'italic', letterSpacing: '.01em' }}>
            {loadingMsg}
          </div>
          {/* Rotating intelligence message */}
          <div style={{ fontSize: 13, color: 'rgba(226,232,240,.72)', marginBottom: 14, lineHeight: 1.5, minHeight: 20 }}>
            {THINKING_MSGS[msgIdx]}
          </div>
          {/* Dot indicators */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                background: i === dots ? '#A78BFA' : 'rgba(167,139,250,.18)',
                transform: i === dots ? 'scale(1.4)' : 'scale(1)',
                transition: 'background .25s, transform .25s',
              }} />
            ))}
          </div>
        </div>
      )}

      {!loading && (
        result && typeof result === "object" && !("_fallback" in result)
          ? <PipelineResultView result={result} />
          : null
      )}
    </div>
  );
}

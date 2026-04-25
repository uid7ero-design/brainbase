'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend } from "recharts";
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, IndustryTab } from "@/components/dashboard/DashboardShell";

const C = { blue:"#38bdf8", green:"#4ade80", amber:"#fbbf24", red:"#f87171", purple:"#a78bfa", orange:"#fb923c" };
const TT = { background:"#0d0f14", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10 };
const fmt = (n:number) => `$${n.toLocaleString("en-AU",{maximumFractionDigits:0})}`;

const T1 = "#F5F7FA";
const T2 = "rgba(230,237,243,0.55)";
const T3 = "rgba(230,237,243,0.35)";
const DC: React.CSSProperties = { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:20 };
const tbl: React.CSSProperties = { width:"100%", borderCollapse:"collapse", fontSize:13 };
const th: React.CSSProperties = { padding:"10px 12px", textAlign:"left", color:T3, fontWeight:600, fontSize:11, letterSpacing:".05em" };
const td: React.CSSProperties = { padding:"12px", color:T2 };
const GRID = "rgba(255,255,255,0.05)";
const TICK = { fill:T3, fontSize:11 };

function badge(label:string, bg:string, color:string) {
  return <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:bg, color }}>{label}</span>;
}

function StatCard({ label, value, sub, color }: { label:string; value:string; sub:string; color?:string }) {
  return (
    <div style={DC}>
      <div style={{ fontSize:11, color:T3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:26, fontWeight:700, color:color||T1, letterSpacing:"-0.02em", marginBottom:4 }}>{value}</div>
      <div style={{ fontSize:12, color:T3 }}>{sub}</div>
    </div>
  );
}

type Project = { id:string; name:string; client:string; type:string; budget:number; actual:number; variations:number; progress:number; status:string; pm:string; startDate:string; endDate:string };
type Variation = { project:string; ref:string; description:string; value:number; status:string; submittedDate:string };
type Milestone = { project:string; milestone:string; planned:string; actual:string; status:string };
type Subcontractor = { name:string; trade:string; project:string; contract:number; paid:number; invoiceDue:string; performance:number };
type Risk = { id:string; project:string; description:string; category:string; likelihood:string; impact:string; rating:string; owner:string; mitigation:string };
type Claim = { id:string; project:string; type:string; description:string; value:number; submittedDate:string; status:string; daysOpen:number };

const SAMPLE_PROJECTS: Project[] = [
  {id:"PRJ-001",name:"Council Admin Fitout",client:"City of Bayside",type:"Commercial",budget:2400000,actual:2180000,variations:124000,progress:91,status:"On Track",pm:"Sarah Mitchell",startDate:"2025-01-15",endDate:"2025-06-30"},
  {id:"PRJ-002",name:"Riverside Apartments Stage 2",client:"Apex Living",type:"Residential",budget:8750000,actual:5240000,variations:312000,progress:60,status:"Delayed",pm:"Tom Richards",startDate:"2024-11-01",endDate:"2025-09-30"},
  {id:"PRJ-003",name:"Industrial Shed — Warehouse 4",client:"Storage Co",type:"Industrial",budget:1100000,actual:1090000,variations:0,progress:99,status:"Completed",pm:"James Lee",startDate:"2025-02-01",endDate:"2025-04-30"},
  {id:"PRJ-004",name:"Medical Centre Refurbishment",client:"HealthGroup",type:"Commercial",budget:640000,actual:290000,variations:48000,progress:45,status:"On Track",pm:"Sarah Mitchell",startDate:"2025-03-01",endDate:"2025-08-31"},
  {id:"PRJ-005",name:"School Hall Extension",client:"Dept of Education",type:"Education",budget:3200000,actual:980000,variations:0,progress:31,status:"On Track",pm:"Amy Chen",startDate:"2025-02-15",endDate:"2026-02-28"},
];

const SAMPLE_VARIATIONS: Variation[] = [
  {project:"PRJ-001",ref:"VAR-001",description:"Additional acoustic panelling — boardroom",value:38000,status:"Approved",submittedDate:"2025-03-10"},
  {project:"PRJ-001",ref:"VAR-002",description:"Upgrade to motorised blinds",value:24000,status:"Pending",submittedDate:"2025-04-02"},
  {project:"PRJ-002",ref:"VAR-003",description:"Design change — lobby layout",value:142000,status:"Approved",submittedDate:"2025-02-18"},
  {project:"PRJ-002",ref:"VAR-004",description:"Structural engineer revisions",value:98000,status:"Approved",submittedDate:"2025-03-22"},
  {project:"PRJ-002",ref:"VAR-005",description:"Material substitution — facade",value:72000,status:"Rejected",submittedDate:"2025-04-01"},
  {project:"PRJ-004",ref:"VAR-006",description:"Fire door compliance upgrade",value:48000,status:"Approved",submittedDate:"2025-03-28"},
];

const SAMPLE_MILESTONES: Milestone[] = [
  {project:"PRJ-001",milestone:"Demolition complete",planned:"2025-02-01",actual:"2025-01-28",status:"Complete"},
  {project:"PRJ-001",milestone:"Framing & services rough-in",planned:"2025-03-15",actual:"2025-03-18",status:"Complete"},
  {project:"PRJ-001",milestone:"Fit-out & finishes",planned:"2025-05-30",actual:"",status:"In Progress"},
  {project:"PRJ-002",milestone:"Slab pour — Level 4",planned:"2025-03-01",actual:"2025-03-14",status:"Complete"},
  {project:"PRJ-002",milestone:"Façade complete",planned:"2025-05-01",actual:"",status:"Delayed"},
  {project:"PRJ-005",milestone:"Site establishment",planned:"2025-02-15",actual:"2025-02-16",status:"Complete"},
  {project:"PRJ-005",milestone:"Footings & slab",planned:"2025-04-30",actual:"",status:"In Progress"},
];

const SAMPLE_SUBS: Subcontractor[] = [
  {name:"Apex Electrical",trade:"Electrical",project:"PRJ-001",contract:340000,paid:280000,invoiceDue:"2025-05-15",performance:92},
  {name:"FlowRight Plumbing",trade:"Plumbing",project:"PRJ-002",contract:520000,paid:310000,invoiceDue:"2025-05-01",performance:88},
  {name:"SteelFab Co",trade:"Structural Steel",project:"PRJ-002",contract:1240000,paid:740000,invoiceDue:"2025-04-28",performance:95},
  {name:"FineLine Joinery",trade:"Joinery",project:"PRJ-001",contract:280000,paid:180000,invoiceDue:"2025-05-20",performance:85},
  {name:"AirFlow HVAC",trade:"Mechanical",project:"PRJ-004",contract:190000,paid:80000,invoiceDue:"2025-05-10",performance:79},
];

const MONTHLY_COST = [
  {month:"Oct",budget:420000,actual:380000},{month:"Nov",budget:580000,actual:610000},
  {month:"Dec",budget:390000,actual:420000},{month:"Jan",budget:540000,actual:500000},
  {month:"Feb",budget:620000,actual:590000},{month:"Mar",budget:680000,actual:720000},
];

const SAMPLE_RISKS: Risk[] = [
  {id:"RSK-001",project:"PRJ-002",description:"Façade subcontractor capacity shortage",category:"Programme",likelihood:"High",impact:"High",rating:"Critical",owner:"Tom Richards",mitigation:"Engaged backup supplier — pricing being confirmed"},
  {id:"RSK-002",project:"PRJ-002",description:"Concrete supply delays — national shortage",category:"Materials",likelihood:"Medium",impact:"High",rating:"High",owner:"Tom Richards",mitigation:"Pre-ordered 8-week supply buffer"},
  {id:"RSK-003",project:"PRJ-004",description:"Asbestos found in existing wall lining",category:"Compliance",likelihood:"Low",impact:"High",rating:"High",owner:"Sarah Mitchell",mitigation:"Licensed removalist engaged — scope added as variation"},
  {id:"RSK-004",project:"PRJ-005",description:"Weather delays during slab pour window",category:"Programme",likelihood:"Medium",impact:"Medium",rating:"Medium",owner:"Amy Chen",mitigation:"Extended pour window to 2 weeks"},
  {id:"RSK-005",project:"PRJ-001",description:"Client change requests not formalised",category:"Commercial",likelihood:"Low",impact:"Medium",rating:"Low",owner:"Sarah Mitchell",mitigation:"Change management register implemented"},
];

const SAMPLE_CLAIMS: Claim[] = [
  {id:"CLM-001",project:"PRJ-002",type:"Progress Claim",description:"Progress claim #8 — Level 4-6 structure",value:840000,submittedDate:"2025-04-01",status:"Approved",daysOpen:14},
  {id:"CLM-002",project:"PRJ-001",type:"Variation Claim",description:"VAR-001 acoustic panelling",value:38000,submittedDate:"2025-04-08",status:"Pending",daysOpen:17},
  {id:"CLM-003",project:"PRJ-004",type:"Progress Claim",description:"Progress claim #3 — fit-out commencing",value:184000,submittedDate:"2025-04-10",status:"Approved",daysOpen:15},
  {id:"CLM-004",project:"PRJ-002",type:"EOT Claim",description:"Extension of time — façade delay",value:0,submittedDate:"2025-04-14",status:"Under Review",daysOpen:11},
  {id:"CLM-005",project:"PRJ-005",type:"Progress Claim",description:"Progress claim #2 — earthworks complete",value:124000,submittedDate:"2025-04-20",status:"Pending",daysOpen:5},
];

const FORECAST_DATA = SAMPLE_PROJECTS.map(p=>({
  project:p.id,
  name:p.name.substring(0,18),
  budget:p.budget,
  spent:p.actual,
  forecast:Math.round(p.actual + (p.budget - p.actual) * (p.status==="Delayed"?1.12:1.0) / ((p.progress)/100+0.001) * (1-p.progress/100)),
}));

const MONTHLY_TREND: MonthlyPoint[] = [
  {month:"Oct",actual:380000,budget:420000,prevYear:340000},
  {month:"Nov",actual:610000,budget:580000,prevYear:520000},
  {month:"Dec",actual:420000,budget:390000,prevYear:360000},
  {month:"Jan",actual:500000,budget:540000,prevYear:460000},
  {month:"Feb",actual:590000,budget:620000,prevYear:540000},
  {month:"Mar",actual:720000,budget:680000,prevYear:620000},
];

const COST_ACCOUNTS: CostAccount[] = [
  {account:"Labour – Direct",budget:2100000,actual:2240000},
  {account:"Labour – Subcontract",budget:3800000,actual:3640000},
  {account:"Materials",budget:4200000,actual:4180000},
  {account:"Plant & Equipment",budget:840000,actual:780000},
  {account:"Preliminaries",budget:620000,actual:680000},
  {account:"Variations",budget:200000,actual:484000},
];

const SLA_TARGETS: SLATarget[] = [
  {kpi:"Projects On Schedule",target:"≥ 80%",actual:"80%",status:"Met"},
  {kpi:"Budget Variance",target:"< 5%",actual:"3.8%",status:"Met"},
  {kpi:"Approved Variations Processed",target:"< 14 days",actual:"11 days",status:"Met"},
  {kpi:"Subcontractor Payment Terms",target:"≤ 30 days",actual:"28 days",status:"Met"},
  {kpi:"Safety Incidents",target:"0 LTIs",actual:"0",status:"Met"},
  {kpi:"Claim Payment <30 days",target:"≥ 90%",actual:"75%",status:"Missed",note:"PRJ-002 façade delay claim pending"},
];

const DEFAULT_ACTIONS: Action[] = [
  {id:"a1",title:"Resolve PRJ-002 façade subcontractor",assignee:"Tom Richards",dueDate:"2025-04-30",status:"In progress",priority:"High"},
  {id:"a2",title:"Finalise VAR-002 motorised blinds approval",assignee:"Sarah Mitchell",dueDate:"2025-05-05",status:"Not started",priority:"Medium"},
  {id:"a3",title:"Submit EOT claim documentation for PRJ-002",assignee:"Tom Richards",dueDate:"2025-04-28",status:"In progress",priority:"High"},
];

const KPI_DATA: KPI[] = [
  {label:"Total Portfolio",value:"$16.1M",sub:"5 active projects",icon:"🏗",status:"normal"},
  {label:"Spent to Date",value:"$9.78M",sub:"61% of budget",icon:"💰",status:"normal"},
  {label:"Approved Variations",value:"$484K",sub:"Across all projects",alert:true,status:"watch",icon:"📋"},
  {label:"On Schedule",value:"4 / 5",sub:"Projects on track",icon:"✅",status:"normal"},
  {label:"Pending Claims",value:"$162K",sub:"2 claims awaiting payment",status:"risk",icon:"⚠"},
  {label:"Open Risks",value:"5",sub:"1 critical",alert:true,status:"risk",icon:"🔴"},
];

function OverviewContent() {
  const totalBudget = SAMPLE_PROJECTS.reduce((s,p)=>s+p.budget,0);
  const totalActual = SAMPLE_PROJECTS.reduce((s,p)=>s+p.actual,0);
  const totalVariations = SAMPLE_VARIATIONS.filter(v=>v.status==="Approved").reduce((s,v)=>s+v.value,0);
  const onTrack = SAMPLE_PROJECTS.filter(p=>p.status==="On Track").length;
  const statusData = [
    {name:"On Track",value:SAMPLE_PROJECTS.filter(p=>p.status==="On Track").length,fill:C.green},
    {name:"Delayed",value:SAMPLE_PROJECTS.filter(p=>p.status==="Delayed").length,fill:C.red},
    {name:"Completed",value:SAMPLE_PROJECTS.filter(p=>p.status==="Completed").length,fill:C.blue},
  ];
  return (
    <div style={{ color:T1 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:24 }}>
        <StatCard label="Total Budget"        value={fmt(totalBudget)}     sub={`${SAMPLE_PROJECTS.length} active projects`} />
        <StatCard label="Spent to Date"       value={fmt(totalActual)}     sub={`${Math.round(totalActual/totalBudget*100)}% of budget`} />
        <StatCard label="Approved Variations" value={fmt(totalVariations)} sub={`${SAMPLE_VARIATIONS.filter(v=>v.status==="Approved").length} variations`} color={C.amber} />
        <StatCard label="On Track"            value={`${onTrack}/${SAMPLE_PROJECTS.length}`} sub="Projects on schedule" color={C.green} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:20, marginBottom:20 }}>
        <div style={DC}>
          <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Monthly Budget vs Actual</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={MONTHLY_COST}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
              <XAxis dataKey="month" tick={TICK}/><YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={TICK}/>
              <Tooltip contentStyle={TT} formatter={(v:any)=>fmt(v)}/><Legend wrapperStyle={{ color:T2, fontSize:12 }}/>
              <Bar dataKey="budget" fill={C.blue} name="Budget" radius={[4,4,0,0]} opacity={0.6}/>
              <Bar dataKey="actual" fill={C.orange} name="Actual" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={DC}>
          <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Project Status</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value">
                {statusData.map((e,i)=><Cell key={i} fill={e.fill}/>)}
              </Pie>
              <Tooltip contentStyle={TT}/><Legend wrapperStyle={{ color:T2, fontSize:12 }}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={DC}>
        <p style={{ fontWeight:700, marginBottom:16, color:T1 }}>Project Budget Progress</p>
        {SAMPLE_PROJECTS.map(p=>(
          <div key={p.id} style={{ marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
              <span style={{ fontSize:13, fontWeight:600, color:T1 }}>{p.name}</span>
              <span style={{ fontSize:12, color:T3 }}>{fmt(p.actual)} / {fmt(p.budget)}</span>
            </div>
            <div style={{ height:8, background:"rgba(255,255,255,0.08)", borderRadius:4, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${Math.min(100,Math.round(p.actual/p.budget*100))}%`, background:p.actual>p.budget?C.red:C.green, borderRadius:4 }}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectsTab() {
  return (
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
        <p style={{ fontWeight:700, fontSize:16, color:T1 }}>All Projects</p>
      </div>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["ID","Project","Client","Type","Budget","Actual","Variations","Progress","Status","PM"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_PROJECTS.map((p,i)=>(
            <tr key={p.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontFamily:"monospace", fontWeight:700, color:T1 }}>{p.id}</td>
              <td style={{ padding:"12px", fontWeight:600, maxWidth:180, color:T1 }}>{p.name}</td>
              <td style={td}>{p.client}</td>
              <td style={td}>{p.type}</td>
              <td style={{ padding:"12px", fontWeight:600, color:T1 }}>{fmt(p.budget)}</td>
              <td style={td}>{fmt(p.actual)}</td>
              <td style={{ padding:"12px", color:p.variations>0?C.amber:T2 }}>{fmt(p.variations)}</td>
              <td style={{ padding:"12px" }}><span style={{ color:p.progress>=90?C.green:p.progress>=50?C.amber:C.blue, fontWeight:700 }}>{p.progress}%</span></td>
              <td style={{ padding:"12px" }}>{badge(p.status, p.status==="On Track"?"rgba(74,222,128,0.15)":p.status==="Delayed"?"rgba(248,113,113,0.15)":"rgba(56,189,248,0.15)", p.status==="On Track"?C.green:p.status==="Delayed"?C.red:C.blue)}</td>
              <td style={td}>{p.pm}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VariationsTab() {
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:24 }}>
      <StatCard label="Approved" value={fmt(SAMPLE_VARIATIONS.filter(v=>v.status==="Approved").reduce((s,v)=>s+v.value,0))} sub={`${SAMPLE_VARIATIONS.filter(v=>v.status==="Approved").length} variations`} color={C.green} />
      <StatCard label="Pending"  value={fmt(SAMPLE_VARIATIONS.filter(v=>v.status==="Pending").reduce((s,v)=>s+v.value,0))}  sub={`${SAMPLE_VARIATIONS.filter(v=>v.status==="Pending").length} awaiting approval`} color={C.amber} />
      <StatCard label="Rejected" value={fmt(SAMPLE_VARIATIONS.filter(v=>v.status==="Rejected").reduce((s,v)=>s+v.value,0))} sub={`${SAMPLE_VARIATIONS.filter(v=>v.status==="Rejected").length} rejected`} color={C.red} />
    </div>
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["Ref","Project","Description","Value","Status","Date"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_VARIATIONS.map((v,i)=>(
            <tr key={v.ref} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontFamily:"monospace", fontWeight:700, color:T1 }}>{v.ref}</td>
              <td style={td}>{v.project}</td>
              <td style={{ padding:"12px", maxWidth:240, color:T1 }}>{v.description}</td>
              <td style={{ padding:"12px", fontWeight:700, color:C.amber }}>{fmt(v.value)}</td>
              <td style={{ padding:"12px" }}>{badge(v.status, v.status==="Approved"?"rgba(74,222,128,0.15)":v.status==="Pending"?"rgba(251,191,36,0.15)":"rgba(248,113,113,0.15)", v.status==="Approved"?C.green:v.status==="Pending"?C.amber:C.red)}</td>
              <td style={td}>{v.submittedDate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function ProgrammeTab() {
  return (
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
        <p style={{ fontWeight:700, fontSize:16, color:T1 }}>Milestone Tracker</p>
      </div>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["Project","Milestone","Planned","Actual","Status"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_MILESTONES.map((m,i)=>(
            <tr key={i} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontFamily:"monospace", color:T3 }}>{m.project}</td>
              <td style={{ padding:"12px", fontWeight:600, color:T1 }}>{m.milestone}</td>
              <td style={td}>{m.planned}</td>
              <td style={td}>{m.actual||"—"}</td>
              <td style={{ padding:"12px" }}>{badge(m.status, m.status==="Complete"?"rgba(74,222,128,0.15)":m.status==="Delayed"?"rgba(248,113,113,0.15)":"rgba(56,189,248,0.15)", m.status==="Complete"?C.green:m.status==="Delayed"?C.red:C.blue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubcontractorsTab() {
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:24 }}>
      <StatCard label="Total Contracted" value={fmt(SAMPLE_SUBS.reduce((s,r)=>s+r.contract,0))} sub={`${SAMPLE_SUBS.length} subcontractors`} />
      <StatCard label="Paid to Date"     value={fmt(SAMPLE_SUBS.reduce((s,r)=>s+r.paid,0))}     sub="Across all packages" />
      <StatCard label="Avg Performance"  value={`${Math.round(SAMPLE_SUBS.reduce((s,r)=>s+r.performance,0)/SAMPLE_SUBS.length)}%`} sub="Quality & programme" color={C.green} />
    </div>
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["Subcontractor","Trade","Project","Contract","Paid","Balance","Next Invoice","Performance"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_SUBS.map((s,i)=>(
            <tr key={s.name} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontWeight:700, color:T1 }}>{s.name}</td>
              <td style={td}>{s.trade}</td>
              <td style={{ padding:"12px", color:T3, fontFamily:"monospace" }}>{s.project}</td>
              <td style={{ padding:"12px", fontWeight:600, color:T1 }}>{fmt(s.contract)}</td>
              <td style={td}>{fmt(s.paid)}</td>
              <td style={{ padding:"12px", color:C.amber, fontWeight:600 }}>{fmt(s.contract-s.paid)}</td>
              <td style={td}>{s.invoiceDue}</td>
              <td style={{ padding:"12px" }}><span style={{ color:s.performance>=90?C.green:s.performance>=80?C.amber:C.red, fontWeight:700 }}>{s.performance}%</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function RisksTab() {
  const ratingBg   = (r:string) => r==="Critical"?"rgba(248,113,113,0.15)":r==="High"?"rgba(251,163,7,0.15)":r==="Medium"?"rgba(251,191,36,0.12)":"rgba(74,222,128,0.12)";
  const ratingColor = (r:string) => r==="Critical"?C.red:r==="High"?C.orange:r==="Medium"?C.amber:C.green;
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:24 }}>
      {(["Critical","High","Medium","Low"] as const).map(r=>(
        <StatCard key={r} label={r} value={String(SAMPLE_RISKS.filter(k=>k.rating===r).length)} sub="open risks" color={ratingColor(r)} />
      ))}
    </div>
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
        <p style={{ fontWeight:700, fontSize:16, color:T1 }}>Risk Register</p>
      </div>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["ID","Project","Description","Category","Rating","Owner","Mitigation"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_RISKS.map((r,i)=>(
            <tr key={r.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontFamily:"monospace", fontWeight:700, color:T1 }}>{r.id}</td>
              <td style={td}>{r.project}</td>
              <td style={{ padding:"12px", maxWidth:200, fontSize:12, color:T2 }}>{r.description}</td>
              <td style={td}>{r.category}</td>
              <td style={{ padding:"12px" }}>{badge(r.rating, ratingBg(r.rating), ratingColor(r.rating))}</td>
              <td style={td}>{r.owner}</td>
              <td style={{ padding:"12px", fontSize:12, color:T3, maxWidth:220 }}>{r.mitigation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function ClaimsTab() {
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:24 }}>
      <StatCard label="Total Claimed" value={fmt(SAMPLE_CLAIMS.reduce((s,c)=>s+c.value,0))} sub={`${SAMPLE_CLAIMS.length} claims`} />
      <StatCard label="Approved" value={fmt(SAMPLE_CLAIMS.filter(c=>c.status==="Approved").reduce((s,c)=>s+c.value,0))} sub="Paid or scheduled" color={C.green} />
      <StatCard label="Pending" value={fmt(SAMPLE_CLAIMS.filter(c=>c.status==="Pending"||c.status==="Under Review").reduce((s,c)=>s+c.value,0))} sub="Awaiting approval" color={C.amber} />
    </div>
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["ID","Project","Type","Description","Value","Submitted","Status","Days Open"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_CLAIMS.map((c,i)=>(
            <tr key={c.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontFamily:"monospace", fontWeight:700, color:T1 }}>{c.id}</td>
              <td style={td}>{c.project}</td>
              <td style={td}>{c.type}</td>
              <td style={{ padding:"12px", maxWidth:200, fontSize:12, color:T2 }}>{c.description}</td>
              <td style={{ padding:"12px", fontWeight:700, color:C.amber }}>{c.value?fmt(c.value):"—"}</td>
              <td style={td}>{c.submittedDate}</td>
              <td style={{ padding:"12px" }}>{badge(c.status, c.status==="Approved"?"rgba(74,222,128,0.15)":c.status==="Pending"?"rgba(251,191,36,0.15)":"rgba(56,189,248,0.15)", c.status==="Approved"?C.green:c.status==="Pending"?C.amber:C.blue)}</td>
              <td style={{ padding:"12px", color:c.daysOpen>14?C.red:T2, fontWeight:c.daysOpen>14?700:400 }}>{c.daysOpen}d</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function ForecastTab() {
  return (<>
    <div style={{ ...DC, marginBottom:20 }}>
      <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Budget vs Forecast Final Cost</p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={FORECAST_DATA}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
          <XAxis dataKey="name" tick={TICK}/><YAxis tickFormatter={v=>`$${(v/1000000).toFixed(1)}M`} tick={TICK}/>
          <Tooltip contentStyle={TT} formatter={(v:any)=>fmt(v)}/><Legend wrapperStyle={{ color:T2, fontSize:12 }}/>
          <Bar dataKey="budget"   fill={C.blue}  name="Original Budget"  radius={[4,4,0,0]} opacity={0.6}/>
          <Bar dataKey="spent"    fill={C.green} name="Spent"            radius={[0,0,0,0]}/>
          <Bar dataKey="forecast" fill={C.orange} name="Forecast Final"  radius={[4,4,0,0]} opacity={0.8}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["Project","Budget","Spent","Forecast Final","Variance","Status"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {FORECAST_DATA.map((r,i)=>{
            const variance = r.forecast - r.budget;
            return (
              <tr key={r.project} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
                <td style={{ padding:"12px", fontWeight:600, color:T1 }}>{r.name}</td>
                <td style={td}>{fmt(r.budget)}</td>
                <td style={td}>{fmt(r.spent)}</td>
                <td style={{ padding:"12px", fontWeight:700, color:T1 }}>{fmt(r.forecast)}</td>
                <td style={{ padding:"12px", fontWeight:700, color:variance>0?C.red:C.green }}>{variance>0?"+":""}{fmt(variance)}</td>
                <td style={{ padding:"12px" }}>{badge(variance>0?"Over Budget":"Within Budget", variance>0?"rgba(248,113,113,0.15)":"rgba(74,222,128,0.15)", variance>0?C.red:C.green)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </>);
}

const INDUSTRY_TABS: IndustryTab[] = [
  {label:"Projects",            content:<ProjectsTab/>},
  {label:"Variations",          content:<VariationsTab/>},
  {label:"Programme",           content:<ProgrammeTab/>},
  {label:"Subcontractors",      content:<SubcontractorsTab/>},
  {label:"Risks & Issues",      content:<RisksTab/>},
  {label:"Claims & Payments",   content:<ClaimsTab/>},
  {label:"Forecast Final Cost", content:<ForecastTab/>},
];

export default function ConstructionDashboard() {
  return (
    <DashboardShell
      theme="dark"
      title="Construction Project Intelligence"
      subtitle="Budget tracking · Variations · Programme · Subcontractors"
      headerColor="#f97316"
      accentColor="#fb923c"
      breadcrumbLabel="Construction Projects"
      kpis={KPI_DATA}
      recommendedActions={[
        {title:"Accelerate PRJ-002 façade (save $140k if resolved by May)",explanation:"Façade subcontractor 8 weeks behind — critical path delay will push completion to Dec 2025 unless alternate supplier is engaged immediately. Quote confirmed.",impact:"$140,000 programme savings if resolved by May",priority:"High"},
        {title:"Recover $162k in unpaid approved variation claims now",explanation:"$162,000 in approved variations unpaid beyond 30-day terms across 2 projects. No formal payment notice issued — cash flow risk increasing weekly.",impact:"$162,000 cash recovery",priority:"High"},
        {title:"Freeze PRJ-002 variations — reduce exposure by ~$80k",explanation:"Variations represent 3.6% of contract value and trending up without change-control enforcement. Formalising the register prevents further scope creep.",impact:"Reduce variation exposure by ~$80,000",priority:"Medium"},
        {title:"Submit PRJ-004 asbestos variation to recover $48k",explanation:"Licensed removalist engaged for work outside original scope. Formal variation submission recovers cost — window closes if not lodged this week.",impact:"$48,000 cost recovery",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"PRJ-002 tracking $284k over budget with no approved recovery plan — cost bleed continuing",cause:"Uncosted variations approved during design review without formal change control; 3.6% of contract value and growing",recommendation:"Freeze further variations immediately; present cost recovery plan to council within 14 days to stop further exposure",severity:"High"},
        {problem:"$162k in approved variations outstanding beyond 30-day payment terms — cash flow at risk",cause:"3 clients with overdue invoices; no formal debt escalation triggered at the 30-day threshold",recommendation:"Issue formal payment notices this week; escalate to contract dispute process if unpaid by 45 days",severity:"High"},
        {problem:"Variation rejection rate at 28% — 2× the industry benchmark, $80k+ in claims at risk",cause:"Claims submitted without daily work records, site photos, or signed-off scope documentation",recommendation:"Mandate photo evidence and signed daily logs before submission — apply retrospectively to 6 pending claims",severity:"Medium"},
      ]}
      overviewContent={<OverviewContent/>}
      industryTabs={INDUSTRY_TABS}
      sampleData={{Projects:SAMPLE_PROJECTS,Variations:SAMPLE_VARIATIONS,Milestones:SAMPLE_MILESTONES,Subcontractors:SAMPLE_SUBS}}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="Construction dashboard. Portfolio: $16.1M across 5 projects. 80% on schedule. $484K in approved variations. PRJ-002 Riverside Apartments delayed — façade subcontractor capacity issue. 1 critical risk open."
      executiveSummary="PRJ-002 is $284k over budget with no approved recovery plan, while $162k in approved variations remain unpaid — total programme exposure is $350k+ if variation rejection rate is not addressed this week."
      snapshotPanel={{ topCostDriver: 'PRJ-002 façade variations — $284k over budget and growing', biggestRisk: '$162k in approved variations unpaid beyond 30-day terms', savingsIdentified: 350000, confidence: 79, lastUpdated: 'Apr 2026' }}
    />
  );
}

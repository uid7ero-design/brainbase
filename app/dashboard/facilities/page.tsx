'use client';

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, IndustryTab, InsightCard } from "@/components/dashboard/DashboardShell";

const C = { purple:"#8b5cf6", blue:"#38bdf8", green:"#4ade80", amber:"#fbbf24", red:"#f87171", slate:"rgba(255,255,255,0.4)" };
const TT = { background:"#0d0f14", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10 };
const fmt = (n:number) => `$${n.toLocaleString("en-AU",{maximumFractionDigits:0})}`;

const T1 = "#F5F7FA";
const T2 = "rgba(230,237,243,0.55)";
const T3 = "rgba(230,237,243,0.35)";
const DC: React.CSSProperties = { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:20 };
const tbl: React.CSSProperties = { width:"100%", borderCollapse:"collapse", fontSize:13 };
const th: React.CSSProperties = { padding:"12px 10px", textAlign:"left", color:T3, fontWeight:600, fontSize:11, letterSpacing:".05em" };
const td: React.CSSProperties = { padding:"12px 10px", color:T2 };
const GRID = "rgba(255,255,255,0.05)";
const TICK = { fill:T3, fontSize:11 };

function badge(label:string, bg:string, color:string) {
  return <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:bg, color }}>{label}</span>;
}

type Building = { id:string; name:string; type:string; suburb:string; sqm:number; tenants:number; reactive:number; planned:number; energy:number; energyBudget:number; condition:number };
type WorkOrder = { id:string; building:string; category:string; description:string; priority:string; cost:number; raisedDate:string; closedDate:string; status:string; daysOpen:number };
type Tenant = { name:string; building:string; floor:string; sqm:number; requests:number; avgResponse:number; satisfaction:number; leaseExpiry:string };
type Energy = { month:string; electricity:number; gas:number; water:number; total:number };

const SAMPLE_BUILDINGS: Building[] = [
  {id:"BLD-001",name:"Civic Centre",type:"Government",suburb:"Central",sqm:8400,tenants:12,reactive:84000,planned:210000,energy:186400,energyBudget:180000,condition:4},
  {id:"BLD-002",name:"Operations Depot",type:"Industrial",suburb:"Eastport",sqm:3200,tenants:2,reactive:124000,planned:96000,energy:92800,energyBudget:100000,condition:3},
  {id:"BLD-003",name:"Library & Community Centre",type:"Community",suburb:"Northside",sqm:2800,tenants:8,reactive:42000,planned:84000,energy:68400,energyBudget:72000,condition:5},
  {id:"BLD-004",name:"Council Depot — South",type:"Industrial",suburb:"Southern",sqm:4100,tenants:3,reactive:98000,planned:124000,energy:112000,energyBudget:108000,condition:3},
  {id:"BLD-005",name:"Administration Building",type:"Commercial",suburb:"CBD",sqm:6200,tenants:24,reactive:62000,planned:168000,energy:204000,energyBudget:196000,condition:4},
];

const SAMPLE_WORK_ORDERS: WorkOrder[] = [
  {id:"WO-001",building:"Civic Centre",category:"HVAC",description:"Air conditioning fault — Level 2 east wing",priority:"High",cost:8400,raisedDate:"2025-04-18",closedDate:"2025-04-20",status:"Closed",daysOpen:2},
  {id:"WO-002",building:"Operations Depot",category:"Electrical",description:"Distribution board inspection — overheating",priority:"Critical",cost:18000,raisedDate:"2025-04-20",closedDate:"",status:"Open",daysOpen:5},
  {id:"WO-003",building:"Library & Community Centre",category:"Plumbing",description:"Blocked drain — main amenities block",priority:"Medium",cost:2800,raisedDate:"2025-04-15",closedDate:"2025-04-16",status:"Closed",daysOpen:1},
  {id:"WO-004",building:"Administration Building",category:"Lift",description:"Lift 2 — intermittent fault on Door 3",priority:"High",cost:12000,raisedDate:"2025-04-21",closedDate:"",status:"Open",daysOpen:4},
  {id:"WO-005",building:"Council Depot — South",category:"Roofing",description:"Roof leak — warehouse section B",priority:"High",cost:24000,raisedDate:"2025-04-12",closedDate:"",status:"In Progress",daysOpen:13},
  {id:"WO-006",building:"Civic Centre",category:"Security",description:"CCTV camera replacement x4",priority:"Medium",cost:6400,raisedDate:"2025-04-08",closedDate:"2025-04-17",status:"Closed",daysOpen:9},
];

const SAMPLE_TENANTS: Tenant[] = [
  {name:"Planning Department",building:"Civic Centre",floor:"Level 3",sqm:840,requests:8,avgResponse:1.2,satisfaction:92,leaseExpiry:"2027-06-30"},
  {name:"Legal Services",building:"Civic Centre",floor:"Level 2",sqm:420,requests:4,avgResponse:0.8,satisfaction:96,leaseExpiry:"2026-12-31"},
  {name:"State Dept of Transport",building:"Administration Building",floor:"Level 4",sqm:1240,requests:14,avgResponse:2.4,satisfaction:78,leaseExpiry:"2025-09-30"},
  {name:"Community Services",building:"Library & Community Centre",floor:"Ground",sqm:680,requests:18,avgResponse:1.8,satisfaction:84,leaseExpiry:"2028-03-31"},
  {name:"Works & Operations",building:"Operations Depot",floor:"Ground",sqm:1800,requests:6,avgResponse:1.0,satisfaction:90,leaseExpiry:"2030-06-30"},
];

const ENERGY_DATA: Energy[] = [
  {month:"Oct",electricity:84200,gas:12400,water:8400,total:105000},
  {month:"Nov",electricity:88400,gas:14200,water:8800,total:111400},
  {month:"Dec",electricity:96800,gas:16800,water:9200,total:122800},
  {month:"Jan",electricity:104200,gas:18400,water:9600,total:132200},
  {month:"Feb",electricity:98400,gas:16200,water:9000,total:123600},
  {month:"Mar",electricity:88800,gas:13600,water:8600,total:111000},
];

const CATEGORY_DIST = [
  {name:"HVAC",value:32,fill:C.blue},{name:"Electrical",value:24,fill:C.amber},
  {name:"Plumbing",value:18,fill:C.purple},{name:"Structural",value:14,fill:C.slate},{name:"Other",value:12,fill:C.green},
];

const CLEANING_CONTRACTS = [
  {contractor:"CityClean",buildings:3,sqm:17400,frequency:"Daily",contract:186000,qualityScore:91,complaints:4,nextAudit:"2025-05-15"},
  {contractor:"SparkSecurity",service:"Security",buildings:5,sqm:24700,frequency:"24/7",contract:324000,qualityScore:88,complaints:7,nextAudit:"2025-06-01"},
  {contractor:"EcoClean",buildings:2,sqm:7300,frequency:"3x/week",contract:84000,qualityScore:85,complaints:9,nextAudit:"2025-05-20"},
];

const COMPLIANCE_CHECKS = [
  {id:"CC-001",building:"Civic Centre",type:"Fire Safety",lastInspection:"2025-03-15",nextDue:"2025-09-15",status:"Current",result:"Pass"},
  {id:"CC-002",building:"Operations Depot",type:"Electrical Safety",lastInspection:"2025-01-20",nextDue:"2025-07-20",status:"Current",result:"Pass"},
  {id:"CC-003",building:"Library & Community Centre",type:"BCA Compliance",lastInspection:"2024-11-10",nextDue:"2025-11-10",status:"Current",result:"Pass"},
  {id:"CC-004",building:"Council Depot — South",type:"Fire Safety",lastInspection:"2024-09-01",nextDue:"2025-03-01",status:"Overdue",result:"Outstanding"},
  {id:"CC-005",building:"Administration Building",type:"Lift Registration",lastInspection:"2025-02-28",nextDue:"2026-02-28",status:"Current",result:"Pass"},
  {id:"CC-006",building:"Civic Centre",type:"Asbestos Register",lastInspection:"2024-12-01",nextDue:"2025-12-01",status:"Current",result:"Updated"},
  {id:"CC-007",building:"Operations Depot",type:"WHS Inspection",lastInspection:"2025-04-01",nextDue:"2025-07-01",status:"Current",result:"2 minor items"},
];

const LIFECYCLE_FORECAST = [
  {component:"Civic Centre HVAC",building:"Civic Centre",installed:2015,lifespan:15,renewalYear:2030,renewalCost:420000,condition:3,priority:"Medium"},
  {component:"Depot South Roof",building:"Council Depot — South",installed:2008,lifespan:20,renewalYear:2028,renewalCost:280000,condition:2,priority:"High"},
  {component:"Admin Building Lifts (x2)",building:"Administration Building",installed:2010,lifespan:20,renewalYear:2030,renewalCost:360000,condition:3,priority:"Medium"},
  {component:"Civic Centre Façade",building:"Civic Centre",installed:2002,lifespan:25,renewalYear:2027,renewalCost:840000,condition:2,priority:"High"},
  {component:"Depot Electrical Board",building:"Operations Depot",installed:2005,lifespan:20,renewalYear:2025,renewalCost:120000,condition:1,priority:"Critical"},
  {component:"Library AV & IT Systems",building:"Library & Community Centre",installed:2019,lifespan:8,renewalYear:2027,renewalCost:180000,condition:4,priority:"Low"},
];

const MONTHLY_TREND: MonthlyPoint[] = [
  {month:"Oct",actual:198000,budget:188000,prevYear:172000},
  {month:"Nov",actual:206000,budget:198000,prevYear:180000},
  {month:"Dec",actual:218000,budget:210000,prevYear:192000},
  {month:"Jan",actual:224000,budget:218000,prevYear:198000},
  {month:"Feb",actual:212000,budget:210000,prevYear:188000},
  {month:"Mar",actual:198000,budget:196000,prevYear:176000},
];

const COST_ACCOUNTS: CostAccount[] = [
  {account:"Reactive Maintenance",budget:380000,actual:410000},
  {account:"Planned Maintenance",budget:680000,actual:682000},
  {account:"Cleaning Contracts",budget:270000,actual:268000},
  {account:"Security Services",budget:324000,actual:330000},
  {account:"Energy – Electricity",budget:540000,actual:560800},
  {account:"Energy – Gas",budget:88000,actual:91600},
];

const SLA_TARGETS: SLATarget[] = [
  {kpi:"Critical WO Response < 2hr",target:"100%",actual:"100%",status:"Met"},
  {kpi:"High Priority WO < 24hr",target:"≥ 90%",actual:"80%",status:"Missed",note:"Depot South roof WO overdue 13 days"},
  {kpi:"Compliance Checks Current",target:"100%",actual:"86%",status:"Missed",note:"Depot South fire safety overdue"},
  {kpi:"Tenant Satisfaction",target:"≥ 88%",actual:"88%",status:"Met"},
  {kpi:"Reactive Maintenance Ratio",target:"< 35%",actual:"37%",status:"At Risk"},
  {kpi:"Energy Budget Variance",target:"< 5%",actual:"4.1%",status:"Met"},
];

const DEFAULT_ACTIONS: Action[] = [
  {id:"a1",title:"Resolve Operations Depot electrical board — critical",assignee:"B. Hall",dueDate:"2025-04-28",status:"In progress",priority:"High"},
  {id:"a2",title:"Schedule overdue fire safety inspection — Depot South",assignee:"Compliance",dueDate:"2025-05-05",status:"Not started",priority:"High"},
  {id:"a3",title:"Renew State Dept of Transport lease negotiations",assignee:"Property Team",dueDate:"2025-08-01",status:"Not started",priority:"Medium"},
];

const KPI_DATA: KPI[] = [
  {label:"Reactive Maintenance",value:"$410K",sub:"37% of spend",alert:true,status:"risk",icon:"🔧"},
  {label:"Open Work Orders",value:"3",sub:"1 critical priority",alert:true,status:"risk",icon:"⚠"},
  {label:"Compliance Checks",value:"86% current",sub:"1 overdue",alert:true,status:"risk",icon:"📋"},
  {label:"Tenant Satisfaction",value:"88%",sub:"5 tenants",icon:"😊",status:"normal"},
  {label:"Energy Spend YTD",value:"$706K",sub:"Vs $668K budget",alert:true,status:"watch",icon:"⚡"},
  {label:"Buildings Managed",value:"5",sub:"24,700 m² total",icon:"🏢",status:"normal"},
];

function StatCard({ label, value, sub, color }: { label:string; value:string; sub:string; color?:string }) {
  return (
    <div style={DC}>
      <div style={{ fontSize:11, color:T3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:26, fontWeight:700, color:color||T1, letterSpacing:"-0.02em", marginBottom:4 }}>{value}</div>
      <div style={{ fontSize:12, color:T3 }}>{sub}</div>
    </div>
  );
}

function OverviewContent() {
  const totalReactive = SAMPLE_BUILDINGS.reduce((s,b)=>s+b.reactive,0);
  const totalPlanned = SAMPLE_BUILDINGS.reduce((s,b)=>s+b.planned,0);
  const reactivePct = Math.round(totalReactive/(totalReactive+totalPlanned)*100);
  const openWO = SAMPLE_WORK_ORDERS.filter(w=>w.status!=="Closed").length;
  return (
    <div style={{ color:T1 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:24 }}>
        <StatCard label="Reactive Maintenance" value={fmt(totalReactive)} sub={`${reactivePct}% of total spend`} color={reactivePct>40?C.red:C.amber} />
        <StatCard label="Planned Maintenance"  value={fmt(totalPlanned)}  sub={`${100-reactivePct}% of total spend`} color={C.green} />
        <StatCard label="Open Work Orders"      value={String(openWO)}    sub={`${SAMPLE_WORK_ORDERS.filter(w=>w.priority==="Critical"||w.priority==="High").length} high/critical`} color={openWO>3?C.red:C.amber} />
        <StatCard label="Energy Intensity"      value={`${Math.round(SAMPLE_BUILDINGS.reduce((s,b)=>s+b.energy/b.sqm,0)/SAMPLE_BUILDINGS.length)} $/m²`} sub="Avg across all buildings" />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:20 }}>
        <div style={DC}>
          <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Monthly Energy Spend ($)</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ENERGY_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="month" tick={TICK} /><YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={TICK} />
              <Tooltip contentStyle={TT} formatter={(v)=>typeof v==="number"?fmt(v):v}/><Legend wrapperStyle={{ color:T2, fontSize:12 }} />
              <Bar dataKey="electricity" fill={C.amber} name="Electricity" stackId="a"/>
              <Bar dataKey="gas" fill={C.blue} name="Gas" stackId="a"/>
              <Bar dataKey="water" fill={C.purple} name="Water" stackId="a" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={DC}>
          <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Work Order Categories</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={CATEGORY_DIST} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value">
                {CATEGORY_DIST.map((e,i)=><Cell key={i} fill={e.fill}/>)}
              </Pie>
              <Tooltip contentStyle={TT} formatter={(v)=>typeof v==="number"?`${v}%`:v}/><Legend wrapperStyle={{ color:T2, fontSize:12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function BuildingsTab() {
  return (
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["ID","Name","Type","Suburb","sqm","Tenants","Reactive","Planned","Energy","Condition"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_BUILDINGS.map((b,i)=>(
            <tr key={b.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ ...td, fontFamily:"monospace", fontWeight:700, color:T3 }}>{b.id}</td>
              <td style={{ ...td, fontWeight:600, color:T1 }}>{b.name}</td>
              <td style={td}>{b.type}</td>
              <td style={td}>{b.suburb}</td>
              <td style={td}>{b.sqm.toLocaleString()}</td>
              <td style={td}>{b.tenants}</td>
              <td style={{ ...td, fontWeight:600, color:C.red }}>{fmt(b.reactive)}</td>
              <td style={{ ...td, fontWeight:600, color:C.blue }}>{fmt(b.planned)}</td>
              <td style={{ ...td, fontWeight:600, color:b.energy>b.energyBudget?C.amber:C.green }}>{fmt(b.energy)}</td>
              <td style={td}>
                <div style={{ display:"flex", gap:3 }}>{[1,2,3,4,5].map(n=><div key={n} style={{ width:8, height:8, borderRadius:2, background:n<=b.condition?C.purple:"rgba(255,255,255,0.1)" }}/>)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkOrdersTab() {
  return (
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["ID","Building","Category","Description","Priority","Cost","Raised","Closed","Status","Days Open"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_WORK_ORDERS.map((w,i)=>(
            <tr key={w.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ ...td, fontFamily:"monospace", fontWeight:700, color:T1 }}>{w.id}</td>
              <td style={{ ...td, fontSize:12 }}>{w.building}</td>
              <td style={{ ...td, fontWeight:600, color:T1 }}>{w.category}</td>
              <td style={{ ...td, fontSize:12, maxWidth:180 }}>{w.description}</td>
              <td style={td}>{badge(w.priority, w.priority==="Critical"?"rgba(248,113,113,0.15)":w.priority==="High"?"rgba(251,191,36,0.15)":"rgba(255,255,255,0.08)", w.priority==="Critical"?C.red:w.priority==="High"?C.amber:T3)}</td>
              <td style={{ ...td, fontWeight:600, color:T1 }}>{fmt(w.cost)}</td>
              <td style={td}>{w.raisedDate}</td>
              <td style={td}>{w.closedDate||"—"}</td>
              <td style={td}>{badge(w.status, w.status==="Closed"?"rgba(74,222,128,0.15)":w.status==="Open"?"rgba(248,113,113,0.15)":"rgba(56,189,248,0.15)", w.status==="Closed"?C.green:w.status==="Open"?C.red:C.blue)}</td>
              <td style={{ ...td, fontWeight:700, color:w.daysOpen>7?C.red:w.daysOpen>3?C.amber:C.green }}>{w.daysOpen}d</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TenantsTab() {
  return (
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["Tenant","Building","Floor","sqm","Requests","Avg Response (days)","Satisfaction","Lease Expiry"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_TENANTS.map((t,i)=>(
            <tr key={t.name} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ ...td, fontWeight:700, color:T1 }}>{t.name}</td>
              <td style={td}>{t.building}</td>
              <td style={td}>{t.floor}</td>
              <td style={td}>{t.sqm.toLocaleString()}</td>
              <td style={td}>{t.requests}</td>
              <td style={{ ...td, fontWeight:700, color:t.avgResponse<=1?C.green:t.avgResponse<=2?C.amber:C.red }}>{t.avgResponse}d</td>
              <td style={{ ...td, fontWeight:700, color:t.satisfaction>=90?C.green:t.satisfaction>=80?C.amber:C.red }}>{t.satisfaction}%</td>
              <td style={td}>{t.leaseExpiry}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EnergyTab() {
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:24 }}>
      <StatCard label="YTD Electricity" value={fmt(ENERGY_DATA.reduce((s,e)=>s+e.electricity,0))} sub="Target: $540k" />
      <StatCard label="YTD Gas"         value={fmt(ENERGY_DATA.reduce((s,e)=>s+e.gas,0))}         sub="Target: $88k" />
      <StatCard label="YTD Total"       value={fmt(ENERGY_DATA.reduce((s,e)=>s+e.total,0))}       sub="Budget: $660k" />
    </div>
    <div style={DC}>
      <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Energy Cost Trend</p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={ENERGY_DATA}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="month" tick={TICK} /><YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={TICK} />
          <Tooltip contentStyle={TT} formatter={(v)=>typeof v==="number"?fmt(v):v}/><Legend wrapperStyle={{ color:T2, fontSize:12 }} />
          <Line type="monotone" dataKey="electricity" stroke={C.amber} strokeWidth={2.5} name="Electricity" dot={{ r:4 }}/>
          <Line type="monotone" dataKey="gas"         stroke={C.blue}  strokeWidth={2.5} name="Gas"         dot={{ r:4 }}/>
          <Line type="monotone" dataKey="total"       stroke={C.purple} strokeWidth={2.5} strokeDasharray="5 5" name="Total" dot={{ r:4 }}/>
        </LineChart>
      </ResponsiveContainer>
    </div>
  </>);
}

function CleaningSecurityTab() {
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:24 }}>
      <StatCard label="Total Contract Value" value={fmt(CLEANING_CONTRACTS.reduce((s,c)=>s+c.contract,0))} sub="Cleaning + Security" />
      <StatCard label="Avg Quality Score" value={`${Math.round(CLEANING_CONTRACTS.reduce((s,c)=>s+c.qualityScore,0)/CLEANING_CONTRACTS.length)}%`} sub="Target: ≥90%" color={C.amber} />
      <StatCard label="Open Complaints" value={String(CLEANING_CONTRACTS.reduce((s,c)=>s+c.complaints,0))} sub="This quarter" color={C.amber} />
    </div>
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["Contractor","Service","Buildings","sqm","Frequency","Contract","Quality Score","Complaints","Next Audit"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {CLEANING_CONTRACTS.map((c,i)=>(
            <tr key={c.contractor} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ ...td, fontWeight:700, color:T1 }}>{c.contractor}</td>
              <td style={td}>{c.service||"Cleaning"}</td>
              <td style={td}>{c.buildings}</td>
              <td style={td}>{c.sqm.toLocaleString()}</td>
              <td style={td}>{c.frequency}</td>
              <td style={{ ...td, fontWeight:600, color:T1 }}>{fmt(c.contract)}</td>
              <td style={{ ...td, fontWeight:700, color:c.qualityScore>=90?C.green:C.amber }}>{c.qualityScore}%</td>
              <td style={{ ...td, color:c.complaints>5?C.red:T2 }}>{c.complaints}</td>
              <td style={td}>{c.nextAudit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function ComplianceTab() {
  const current = COMPLIANCE_CHECKS.filter(c=>c.status==="Current").length;
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:24 }}>
      <StatCard label="Checks Current"   value={`${current}/${COMPLIANCE_CHECKS.length}`} sub="Up to date"                color={C.green} />
      <StatCard label="Overdue"           value={String(COMPLIANCE_CHECKS.filter(c=>c.status==="Overdue").length)} sub="Requires immediate action" color={C.red} />
      <StatCard label="Due Within 90 days" value="3" sub="Schedule now" color={C.amber} />
    </div>
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["Ref","Building","Type","Last Inspection","Next Due","Status","Result"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {COMPLIANCE_CHECKS.map((c,i)=>(
            <tr key={c.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:c.status==="Overdue"?"rgba(248,113,113,0.05)":i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ ...td, fontFamily:"monospace", fontWeight:700, color:T1 }}>{c.id}</td>
              <td style={{ ...td, fontSize:12 }}>{c.building}</td>
              <td style={{ ...td, fontWeight:600, color:T1 }}>{c.type}</td>
              <td style={td}>{c.lastInspection}</td>
              <td style={{ ...td, color:c.status==="Overdue"?C.red:T2, fontWeight:c.status==="Overdue"?700:400 }}>{c.nextDue}</td>
              <td style={td}>{badge(c.status, c.status==="Current"?"rgba(74,222,128,0.15)":"rgba(248,113,113,0.15)", c.status==="Current"?C.green:C.red)}</td>
              <td style={{ ...td, fontSize:12 }}>{c.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function LifecycleTab() {
  const totalRenewal = LIFECYCLE_FORECAST.reduce((s,l)=>s+l.renewalCost,0);
  const within5yr = LIFECYCLE_FORECAST.filter(l=>l.renewalYear<=2030).reduce((s,l)=>s+l.renewalCost,0);
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:24 }}>
      <StatCard label="Total Renewal Liability" value={fmt(totalRenewal)} sub="All components" />
      <StatCard label="Due Within 5 Years"       value={fmt(within5yr)} sub="2025–2030" color={C.amber} />
      <StatCard label="Critical Priority"         value={String(LIFECYCLE_FORECAST.filter(l=>l.priority==="Critical").length)} sub="Immediate action needed" color={C.red} />
    </div>
    <div style={{ ...DC, padding:0, overflow:"hidden" }}>
      <table style={tbl}>
        <thead><tr style={{ background:"rgba(255,255,255,0.06)" }}>
          {["Component","Building","Installed","Lifespan","Renewal Year","Renewal Cost","Condition","Priority"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {LIFECYCLE_FORECAST.sort((a,b)=>a.renewalYear-b.renewalYear).map((l,i)=>(
            <tr key={l.component} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ ...td, fontWeight:700, fontSize:12, color:T1 }}>{l.component}</td>
              <td style={{ ...td, fontSize:12 }}>{l.building}</td>
              <td style={td}>{l.installed}</td>
              <td style={td}>{l.lifespan} yr</td>
              <td style={{ ...td, fontWeight:700, color:l.renewalYear<=2026?C.red:l.renewalYear<=2028?C.amber:T3 }}>{l.renewalYear}</td>
              <td style={{ ...td, fontWeight:600, color:T1 }}>{fmt(l.renewalCost)}</td>
              <td style={td}>
                <div style={{ display:"flex", gap:3 }}>{[1,2,3,4,5].map(n=><div key={n} style={{ width:8, height:8, borderRadius:2, background:n<=l.condition?C.purple:"rgba(255,255,255,0.1)" }}/>)}</div>
              </td>
              <td style={td}>{badge(l.priority, l.priority==="Critical"?"rgba(248,113,113,0.15)":l.priority==="High"?"rgba(251,191,36,0.15)":l.priority==="Medium"?"rgba(56,189,248,0.15)":"rgba(74,222,128,0.15)", l.priority==="Critical"?C.red:l.priority==="High"?C.amber:l.priority==="Medium"?C.blue:C.green)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

const INDUSTRY_TABS: IndustryTab[] = [
  {label:"Buildings",content:<BuildingsTab/>},
  {label:"Work Orders",content:<WorkOrdersTab/>},
  {label:"Tenants",content:<TenantsTab/>},
  {label:"Energy",content:<EnergyTab/>},
  {label:"Cleaning & Security",content:<CleaningSecurityTab/>},
  {label:"Compliance Checks",content:<ComplianceTab/>},
  {label:"Lifecycle Renewal",content:<LifecycleTab/>},
];

export default function FacilitiesDashboard() {
  return (
    <DashboardShell
      theme="dark"
      title="Facilities Management Intelligence"
      subtitle="Work orders · Tenant management · Energy · Lifecycle costs"
      headerColor="#4c1d95"
      accentColor="#8b5cf6"
      breadcrumbLabel="Facilities Management"
      kpis={KPI_DATA}
      recommendedActions={[
        {title:"Resolve Council Chambers electrical fault (prevent $15k–$50k penalty)",explanation:"Open critical work order 22 days with no licensed electrician engaged. Electrical fault poses active safety and compliance risk; insurance invalidated if incident occurs.",impact:"Prevent $15,000–$50,000 regulatory penalty + insurance claim",priority:"High"},
        {title:"Complete overdue fire inspection — $50k regulatory penalty at risk",explanation:"Depot South fire safety inspection 54 days overdue. Non-compliance is an active breach under the Building Act — penalty escalates with each passing week.",impact:"Avoid $15,000–$50,000 regulatory penalty",priority:"High"},
        {title:"Shift 3 assets to planned maintenance (save $22k in reactive premium)",explanation:"Reactive spend at 37% of total — above the 35% target. Each reactive call-out costs 40% more than a scheduled equivalent. 3 assets are candidates for planned cycle.",impact:"$22,000 annual saving by reducing reactive call-out premium",priority:"Medium"},
        {title:"Initiate capital planning for $2.2M lifecycle renewal pipeline",explanation:"Major renewals due across 3 facilities by 2030. Without early capital planning, emergency funding pressure will compress delivery options and inflate cost.",impact:"Optimal capital allocation for $2.2M renewal programme",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"Electrical board at Operations Depot overheating — unresolved 5 days, critical safety risk active",cause:"Asset management system miscategorised fault as Medium; escalation did not trigger; no licensed electrician dispatched",recommendation:"Engage licensed electrician within 24 hours; reclassify critical assets in CMMS — $15k–$50k penalty exposure",severity:"High"},
        {problem:"Depot South fire safety inspection 54 days overdue — active regulatory compliance breach",cause:"Compliance calendar not integrated with work order system; inspections not auto-triggering at required intervals",recommendation:"Schedule inspection this week; integrate compliance calendar with asset platform to prevent future breaches",severity:"High"},
        {problem:"Reactive-to-planned ratio at 62:38 vs 40:60 target — costing $22k+ in reactive call-out premium",cause:"Planned maintenance deferrals for 2 consecutive quarters building backlog, forcing reactive emergency responses",recommendation:"Increase planned maintenance allocation by 15% next quarter; clear high-priority backlog to recover $22k annually",severity:"Medium"},
      ]}
      overviewContent={<OverviewContent/>}
      industryTabs={INDUSTRY_TABS}
      sampleData={{Buildings:SAMPLE_BUILDINGS,"Work Orders":SAMPLE_WORK_ORDERS,Tenants:SAMPLE_TENANTS,Energy:ENERGY_DATA}}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="Facilities Management dashboard. 5 buildings, 24,700 m². Reactive spend 37% (target <35%). 3 open work orders — 1 critical electrical. 1 overdue compliance check. $2.2M lifecycle renewal due by 2030."
      executiveSummary="A critical electrical fault at Operations Depot remains unresolved at 22 days while Depot South fire compliance is 54 days overdue — combined regulatory penalty exposure of up to $100k with reactive maintenance costing $22k above plan."
      snapshotPanel={{ topCostDriver: 'Reactive maintenance premium at 37% of total spend vs 35% target', biggestRisk: 'Depot South fire inspection 54 days overdue — active legislative breach', savingsIdentified: 22000, confidence: 88, lastUpdated: 'Apr 2026' }}
    />
  );
}

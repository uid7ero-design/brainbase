'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, IndustryTab, InsightCard } from "@/components/dashboard/DashboardShell";

const C = { green:"#22c55e", blue:"#3b82f6", amber:"#f59e0b", red:"#ef4444", slate:"#94a3b8", teal:"#14b8a6" };
const TT = { background:"#0d0f14", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10 };
const T1 = "#F5F7FA", T2 = "rgba(230,237,243,0.55)", T3 = "rgba(230,237,243,0.35)";
const DC: React.CSSProperties = { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:24 };
const BORDER = "rgba(255,255,255,0.07)", ROW_BDR = "rgba(255,255,255,0.05)", GRID = "rgba(255,255,255,0.05)", TICK = "rgba(255,255,255,0.4)";
const fmt = (n:number) => `$${n.toLocaleString("en-AU",{maximumFractionDigits:0})}`;

type Reserve = { id:string; name:string; suburb:string; area:number; type:string; contractor:string; mowFreq:string; lastMow:string; condition:number; irrigated:boolean; annualCost:number };
type Contractor = { name:string; contract:number; zones:number; onTimePct:number; qualityScore:number; complaints:number; renewalDate:string };
type WorkOrder = { id:string; reserve:string; type:string; description:string; priority:string; cost:number; status:string; scheduled:string };
type Irrigation = { zone:string; reserve:string; usage:number; budget:number; schedule:string; lastRun:string; status:string };

const SAMPLE_RESERVES: Reserve[] = [
  {id:"RSV-001",name:"Riverside Park",suburb:"Northside",area:8.4,type:"Active Recreation",contractor:"GreenScape",mowFreq:"Weekly",lastMow:"2025-04-21",condition:4,irrigated:true,annualCost:84200},
  {id:"RSV-002",name:"Memorial Gardens",suburb:"Central",area:2.1,type:"Passive Recreation",contractor:"EcoMow",mowFreq:"Fortnightly",lastMow:"2025-04-14",condition:5,irrigated:true,annualCost:38400},
  {id:"RSV-003",name:"Eastfield Reserve",suburb:"Eastern",area:14.2,type:"Sporting Reserve",contractor:"GreenScape",mowFreq:"Weekly",lastMow:"2025-04-20",condition:4,irrigated:false,annualCost:124800},
  {id:"RSV-004",name:"Harbour Foreshore",suburb:"Coastal",area:5.6,type:"Passive Recreation",contractor:"CoastalTurf",mowFreq:"Fortnightly",lastMow:"2025-04-18",condition:3,irrigated:true,annualCost:62400},
  {id:"RSV-005",name:"Valley Sports Complex",suburb:"Hills",area:22.8,type:"Sporting Reserve",contractor:"GreenScape",mowFreq:"Weekly",lastMow:"2025-04-22",condition:5,irrigated:true,annualCost:198000},
  {id:"RSV-006",name:"North Street Pocket Park",suburb:"Northside",area:0.8,type:"Pocket Park",contractor:"EcoMow",mowFreq:"Monthly",lastMow:"2025-04-08",condition:3,irrigated:false,annualCost:8400},
];

const SAMPLE_CONTRACTORS: Contractor[] = [
  {name:"GreenScape",contract:1240000,zones:18,onTimePct:94,qualityScore:88,complaints:6,renewalDate:"2026-06-30"},
  {name:"EcoMow",contract:480000,zones:12,onTimePct:89,qualityScore:82,complaints:14,renewalDate:"2025-12-31"},
  {name:"CoastalTurf",contract:320000,zones:6,onTimePct:91,qualityScore:85,complaints:8,renewalDate:"2026-03-31"},
  {name:"CityParks Co",contract:180000,zones:4,onTimePct:96,qualityScore:91,complaints:2,renewalDate:"2026-06-30"},
];

const SAMPLE_WORK_ORDERS: WorkOrder[] = [
  {id:"WO-001",reserve:"Riverside Park",type:"Tree Surgery",description:"Dangerous limb removal — storm damage",priority:"Critical",cost:8400,status:"Complete",scheduled:"2025-04-20"},
  {id:"WO-002",reserve:"Eastfield Reserve",type:"Irrigation Repair",description:"Broken heads — oval 3 zone",priority:"High",cost:2800,status:"In Progress",scheduled:"2025-04-25"},
  {id:"WO-003",reserve:"Memorial Gardens",type:"Vandalism",description:"Graffiti removal — toilet block",priority:"Medium",cost:1200,status:"Scheduled",scheduled:"2025-04-28"},
  {id:"WO-004",reserve:"Valley Sports Complex",type:"Fence Repair",description:"40m chain link fencing — damaged",priority:"Medium",cost:6400,status:"Scheduled",scheduled:"2025-05-02"},
  {id:"WO-005",reserve:"Harbour Foreshore",type:"Beach Clean",description:"Post-storm sand and debris clearing",priority:"High",cost:3600,status:"Complete",scheduled:"2025-04-19"},
];

const SAMPLE_IRRIGATION: Irrigation[] = [
  {zone:"Oval 1 — Eastfield",reserve:"Eastfield Reserve",usage:184200,budget:160000,schedule:"Mon/Wed/Fri 4am",lastRun:"2025-04-22",status:"OK"},
  {zone:"North Lawn",reserve:"Valley Sports Complex",usage:92400,budget:100000,schedule:"Tue/Thu 5am",lastRun:"2025-04-22",status:"OK"},
  {zone:"Rose Garden",reserve:"Memorial Gardens",usage:48600,budget:40000,schedule:"Daily 6am",lastRun:"2025-04-22",status:"Over Budget"},
  {zone:"Central Oval",reserve:"Valley Sports Complex",usage:124800,budget:130000,schedule:"Mon/Wed/Fri 4am",lastRun:"2025-04-22",status:"OK"},
  {zone:"Foreshore Lawn",reserve:"Harbour Foreshore",usage:68400,budget:72000,schedule:"Mon/Thu 5am",lastRun:"2025-04-18",status:"Fault"},
];

const MONTHLY_COST = [
  {month:"Oct",mowing:84000,irrigation:28000,maintenance:42000},
  {month:"Nov",mowing:88000,irrigation:36000,maintenance:38000},
  {month:"Dec",mowing:92000,irrigation:48000,maintenance:44000},
  {month:"Jan",mowing:90000,irrigation:52000,maintenance:36000},
  {month:"Feb",mowing:86000,irrigation:44000,maintenance:48000},
  {month:"Mar",mowing:82000,irrigation:32000,maintenance:40000},
];

const CONDITION_DIST = [
  {name:"Excellent",value:22,fill:C.green},{name:"Good",value:44,fill:C.blue},
  {name:"Fair",value:26,fill:C.amber},{name:"Poor",value:8,fill:C.red},
];

const MOWING_SCHEDULE = [
  {reserve:"Riverside Park",contractor:"GreenScape",frequency:"Weekly",lastCompleted:"2025-04-21",nextDue:"2025-04-28",overdue:false,compliance:96},
  {reserve:"Eastfield Reserve",contractor:"GreenScape",frequency:"Weekly",lastCompleted:"2025-04-20",nextDue:"2025-04-27",overdue:false,compliance:94},
  {reserve:"Valley Sports Complex",contractor:"GreenScape",frequency:"Weekly",lastCompleted:"2025-04-22",nextDue:"2025-04-29",overdue:false,compliance:98},
  {reserve:"Memorial Gardens",contractor:"EcoMow",frequency:"Fortnightly",lastCompleted:"2025-04-14",nextDue:"2025-04-28",overdue:false,compliance:88},
  {reserve:"Harbour Foreshore",contractor:"CoastalTurf",frequency:"Fortnightly",lastCompleted:"2025-04-18",nextDue:"2025-05-02",overdue:false,compliance:91},
  {reserve:"North Street Pocket Park",contractor:"EcoMow",frequency:"Monthly",lastCompleted:"2025-04-08",nextDue:"2025-05-08",overdue:false,compliance:82},
];

const CUSTOMER_REQUESTS = [
  {id:"REQ-001",reserve:"Riverside Park",type:"Maintenance",description:"Broken park bench near playground",status:"In Progress",raised:"2025-04-19",priority:"Medium"},
  {id:"REQ-002",reserve:"Eastfield Reserve",type:"Safety",description:"Glass on oval surface — hazard",status:"Complete",raised:"2025-04-20",priority:"High"},
  {id:"REQ-003",reserve:"Memorial Gardens",type:"Complaint",description:"Dog off-leash in off-leash restricted area",status:"Noted",raised:"2025-04-21",priority:"Low"},
  {id:"REQ-004",reserve:"Valley Sports Complex",type:"Booking",description:"Weekend AFL ground booking request",status:"Approved",raised:"2025-04-22",priority:"Low"},
  {id:"REQ-005",reserve:"Harbour Foreshore",type:"Maintenance",description:"Damaged BBQ facilities",status:"Scheduled",raised:"2025-04-18",priority:"Medium"},
  {id:"REQ-006",reserve:"North Street Pocket Park",type:"Safety",description:"Tree branch overhanging footpath",status:"Scheduled",raised:"2025-04-17",priority:"High"},
];

const COST_PER_RESERVE = SAMPLE_RESERVES.map(r=>({
  name:r.name.substring(0,14),
  costPerHa:Math.round(r.annualCost/r.area),
  total:r.annualCost,
  area:r.area,
})).sort((a,b)=>b.costPerHa-a.costPerHa);

const REACTIVE_VS_PLANNED = [
  {month:"Oct",reactive:38000,planned:88000,ratio:30},
  {month:"Nov",reactive:42000,planned:84000,ratio:33},
  {month:"Dec",reactive:52000,planned:88000,ratio:37},
  {month:"Jan",reactive:44000,planned:82000,ratio:35},
  {month:"Feb",reactive:48000,planned:90000,ratio:35},
  {month:"Mar",reactive:36000,planned:86000,ratio:29},
];

const MONTHLY_TREND: MonthlyPoint[] = [
  {month:"Oct",actual:154000,budget:148000,prevYear:138000},
  {month:"Nov",actual:162000,budget:156000,prevYear:144000},
  {month:"Dec",actual:184000,budget:172000,prevYear:158000},
  {month:"Jan",actual:178000,budget:168000,prevYear:152000},
  {month:"Feb",actual:176000,budget:168000,prevYear:154000},
  {month:"Mar",actual:158000,budget:154000,prevYear:142000},
];

const COST_ACCOUNTS: CostAccount[] = [
  {account:"Mowing – GreenScape",budget:640000,actual:620000},
  {account:"Mowing – EcoMow",budget:280000,actual:296000},
  {account:"Mowing – CoastalTurf",budget:180000,actual:174000},
  {account:"Irrigation Operations",budget:220000,actual:244000},
  {account:"Reactive Maintenance",budget:380000,actual:412000},
  {account:"Arborist Services",budget:120000,actual:98000},
];

const SLA_TARGETS: SLATarget[] = [
  {kpi:"Mowing Compliance Rate",target:"≥ 95%",actual:"93%",status:"At Risk",note:"EcoMow underperforming"},
  {kpi:"Work Order Completion < 5 days",target:"≥ 90%",actual:"80%",status:"Missed",note:"Irrigation repair delay"},
  {kpi:"Critical Request Response < 24hr",target:"100%",actual:"100%",status:"Met"},
  {kpi:"Contractor Quality Score",target:"≥ 85%",actual:"87%",status:"Met"},
  {kpi:"Irrigation Fault Resolution",target:"< 3 days",actual:"4 days",status:"Missed",note:"Foreshore fault outstanding"},
  {kpi:"Complaints Resolved < 7 days",target:"≥ 85%",actual:"88%",status:"Met"},
];

const DEFAULT_ACTIONS: Action[] = [
  {id:"a1",title:"Repair foreshore lawn irrigation fault",assignee:"J. Park",dueDate:"2025-04-28",status:"In progress",priority:"High"},
  {id:"a2",title:"Tender review for EcoMow contract renewal",assignee:"Contracts Team",dueDate:"2025-11-01",status:"Not started",priority:"Medium"},
  {id:"a3",title:"North Street pocket park tree audit",assignee:"J. Park",dueDate:"2025-05-05",status:"Not started",priority:"High"},
];

const KPI_DATA: KPI[] = [
  {label:"Total Reserves",value:String(SAMPLE_RESERVES.length),sub:`${SAMPLE_RESERVES.reduce((s,r)=>s+r.area,0).toFixed(1)} hectares`,icon:"🌳",status:"normal"},
  {label:"Annual Cost",value:"$516,200",sub:"$9,720 per hectare",icon:"💰",status:"normal"},
  {label:"Avg Condition",value:"4.0 / 5",sub:"Asset condition score",icon:"⭐",status:"normal"},
  {label:"Mowing Compliance",value:"93%",sub:"Target: 95%",alert:true,status:"watch",icon:"🌿"},
  {label:"Open Work Orders",value:"3",sub:"2 high priority",alert:true,status:"risk",icon:"⚠"},
  {label:"Customer Requests",value:"6",sub:"This week",icon:"📋",status:"normal"},
];

function StatCard({label,value,sub,color}:{label:string;value:string;sub:string;color?:string}) {
  return (
    <div style={DC}>
      <p style={{fontSize:11,color:T3,fontWeight:600,letterSpacing:".06em",marginBottom:8}}>{label.toUpperCase()}</p>
      <p style={{fontSize:26,fontWeight:800,color:color||T1,letterSpacing:"-0.03em",marginBottom:4}}>{value}</p>
      <p style={{fontSize:12,color:T3}}>{sub}</p>
    </div>
  );
}

function OverviewContent() {
  const totalArea = SAMPLE_RESERVES.reduce((s,r)=>s+r.area,0).toFixed(1);
  const totalCost = SAMPLE_RESERVES.reduce((s,r)=>s+r.annualCost,0);
  const avgCondition = (SAMPLE_RESERVES.reduce((s,r)=>s+r.condition,0)/SAMPLE_RESERVES.length).toFixed(1);
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24}}>
        <StatCard label="Total Reserves" value={String(SAMPLE_RESERVES.length)} sub={`${totalArea} hectares managed`}/>
        <StatCard label="Annual Cost" value={fmt(totalCost)} sub={`${fmt(Math.round(totalCost/parseFloat(totalArea)))} per hectare`}/>
        <StatCard label="Avg Condition" value={`${avgCondition}/5`} sub="Asset condition score" color={parseFloat(avgCondition)>=4?C.green:C.amber}/>
        <StatCard label="Contractors" value={String(SAMPLE_CONTRACTORS.length)} sub="Active service contracts"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:20}}>
        <div style={DC}>
          <p style={{fontWeight:700,marginBottom:20,color:T1}}>Monthly Maintenance Cost by Category</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={MONTHLY_COST}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
              <XAxis dataKey="month" tick={{fill:TICK,fontSize:12}}/><YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fill:TICK,fontSize:12}}/>
              <Tooltip contentStyle={TT} formatter={(v)=>typeof v==="number"?fmt(v):v}/><Legend wrapperStyle={{color:T2}}/>
              <Bar dataKey="mowing" fill={C.green} name="Mowing" stackId="a"/>
              <Bar dataKey="irrigation" fill={C.blue} name="Irrigation" stackId="a"/>
              <Bar dataKey="maintenance" fill={C.amber} name="Maintenance" stackId="a" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={DC}>
          <p style={{fontWeight:700,marginBottom:20,color:T1}}>Reserve Condition</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={CONDITION_DIST} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value">
                {CONDITION_DIST.map((e,i)=><Cell key={i} fill={e.fill}/>)}
              </Pie>
              <Tooltip contentStyle={TT} formatter={(v)=>typeof v==="number"?`${v}%`:v}/><Legend wrapperStyle={{color:T2}}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function tableRow(i:number) { return {borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"} as React.CSSProperties; }
function tableHead(cols:string[]) {
  return (
    <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
      {cols.map(h=><th key={h} style={{padding:"9px 9px",textAlign:"left",color:T3,fontWeight:600,fontSize:10}}>{h.toUpperCase()}</th>)}
    </tr></thead>
  );
}

function ReservesTab() {
  return (
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        {tableHead(["ID","Name","Suburb","Area (ha)","Type","Contractor","Mow Freq","Last Mow","Condition","Irrigated","Annual Cost"])}
        <tbody>
          {SAMPLE_RESERVES.map((r,i)=>(
            <tr key={r.id} style={tableRow(i)}>
              <td style={{padding:"11px 9px",fontFamily:"monospace",fontWeight:700,color:T2}}>{r.id}</td>
              <td style={{padding:"11px 9px",fontWeight:600,color:T1}}>{r.name}</td>
              <td style={{padding:"11px 9px",color:T2}}>{r.suburb}</td>
              <td style={{padding:"11px 9px",color:T2}}>{r.area}</td>
              <td style={{padding:"11px 9px",color:T2,fontSize:11}}>{r.type}</td>
              <td style={{padding:"11px 9px",color:T2}}>{r.contractor}</td>
              <td style={{padding:"11px 9px",color:T2}}>{r.mowFreq}</td>
              <td style={{padding:"11px 9px",color:T2}}>{r.lastMow}</td>
              <td style={{padding:"11px 9px"}}>
                <div style={{display:"flex",gap:3}}>{[1,2,3,4,5].map(n=><div key={n} style={{width:8,height:8,borderRadius:2,background:n<=r.condition?C.green:"rgba(255,255,255,0.1)"}}/>)}</div>
              </td>
              <td style={{padding:"11px 9px"}}><span style={{color:r.irrigated?C.blue:T3}}>{r.irrigated?"Yes":"No"}</span></td>
              <td style={{padding:"11px 9px",fontWeight:600,color:T1}}>{fmt(r.annualCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContractorsTab() {
  return (<>
    <div style={{...DC,marginBottom:20}}>
      <p style={{fontWeight:700,marginBottom:20,color:T1}}>Contractor On-Time Performance</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={SAMPLE_CONTRACTORS} layout="vertical">
          <XAxis type="number" domain={[0,100]} tick={{fill:TICK,fontSize:12}} tickFormatter={v=>`${v}%`}/>
          <YAxis dataKey="name" type="category" tick={{fill:TICK,fontSize:12}} width={100}/>
          <Tooltip contentStyle={TT} formatter={(v)=>typeof v==="number"?`${v}%`:v}/>
          <Bar dataKey="onTimePct" fill={C.green} name="On-Time %" radius={[0,4,4,0]}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        {tableHead(["Contractor","Contract Value","Zones","On-Time %","Quality Score","Complaints","Contract Renewal"])}
        <tbody>
          {SAMPLE_CONTRACTORS.map((c,i)=>(
            <tr key={c.name} style={tableRow(i)}>
              <td style={{padding:"12px",fontWeight:700,color:T1}}>{c.name}</td>
              <td style={{padding:"12px",fontWeight:600,color:T1}}>{fmt(c.contract)}</td>
              <td style={{padding:"12px",color:T2}}>{c.zones}</td>
              <td style={{padding:"12px",fontWeight:700,color:c.onTimePct>=90?C.green:C.amber}}>{c.onTimePct}%</td>
              <td style={{padding:"12px",fontWeight:700,color:c.qualityScore>=85?C.green:C.amber}}>{c.qualityScore}%</td>
              <td style={{padding:"12px",color:c.complaints>10?C.red:T2}}>{c.complaints}</td>
              <td style={{padding:"12px",color:T2}}>{c.renewalDate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function WorkOrdersTab() {
  return (
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        {tableHead(["ID","Reserve","Type","Description","Priority","Cost","Status","Scheduled"])}
        <tbody>
          {SAMPLE_WORK_ORDERS.map((w,i)=>(
            <tr key={w.id} style={tableRow(i)}>
              <td style={{padding:"12px",fontFamily:"monospace",fontWeight:700,color:T1}}>{w.id}</td>
              <td style={{padding:"12px",color:T2}}>{w.reserve}</td>
              <td style={{padding:"12px",fontWeight:600,color:T1}}>{w.type}</td>
              <td style={{padding:"12px",color:T2,fontSize:12}}>{w.description}</td>
              <td style={{padding:"12px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:w.priority==="Critical"?"rgba(239,68,68,0.15)":w.priority==="High"?"rgba(245,158,11,0.15)":"rgba(100,116,139,0.2)",color:w.priority==="Critical"?C.red:w.priority==="High"?C.amber:C.slate}}>{w.priority}</span>
              </td>
              <td style={{padding:"12px",fontWeight:600,color:T1}}>{fmt(w.cost)}</td>
              <td style={{padding:"12px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:w.status==="Complete"?"rgba(16,185,129,0.15)":w.status==="In Progress"?"rgba(59,130,246,0.15)":"rgba(100,116,139,0.2)",color:w.status==="Complete"?C.green:w.status==="In Progress"?C.blue:C.slate}}>{w.status}</span>
              </td>
              <td style={{padding:"12px",color:T2}}>{w.scheduled}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IrrigationTab() {
  return (
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        {tableHead(["Zone","Reserve","Usage (kL)","Budget (kL)","Schedule","Last Run","Status"])}
        <tbody>
          {SAMPLE_IRRIGATION.map((ir,i)=>(
            <tr key={ir.zone} style={tableRow(i)}>
              <td style={{padding:"12px",fontWeight:700,color:T1}}>{ir.zone}</td>
              <td style={{padding:"12px",color:T2}}>{ir.reserve}</td>
              <td style={{padding:"12px",fontWeight:600,color:ir.usage>ir.budget?C.red:T2}}>{ir.usage.toLocaleString()}</td>
              <td style={{padding:"12px",color:T2}}>{ir.budget.toLocaleString()}</td>
              <td style={{padding:"12px",color:T2,fontSize:12}}>{ir.schedule}</td>
              <td style={{padding:"12px",color:T2}}>{ir.lastRun}</td>
              <td style={{padding:"12px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:ir.status==="OK"?"rgba(16,185,129,0.15)":ir.status==="Fault"?"rgba(239,68,68,0.15)":"rgba(245,158,11,0.15)",color:ir.status==="OK"?C.green:ir.status==="Fault"?C.red:C.amber}}>{ir.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MowingScheduleTab() {
  return (<>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:24}}>
      <StatCard label="Weekly Sites" value={String(MOWING_SCHEDULE.filter(m=>m.frequency==="Weekly").length)} sub="GreenScape contract"/>
      <StatCard label="Compliance Rate" value="93%" sub="Target: 95%" color={C.amber}/>
      <StatCard label="Overdue Mowing" value="0" sub="All sites current" color={C.green}/>
    </div>
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        {tableHead(["Reserve","Contractor","Frequency","Last Completed","Next Due","Compliance %"])}
        <tbody>
          {MOWING_SCHEDULE.map((m,i)=>(
            <tr key={m.reserve} style={tableRow(i)}>
              <td style={{padding:"12px",fontWeight:700,color:T1}}>{m.reserve}</td>
              <td style={{padding:"12px",color:T2}}>{m.contractor}</td>
              <td style={{padding:"12px",color:T2}}>{m.frequency}</td>
              <td style={{padding:"12px",color:T2}}>{m.lastCompleted}</td>
              <td style={{padding:"12px",color:m.overdue?C.red:T2,fontWeight:m.overdue?700:400}}>{m.nextDue}</td>
              <td style={{padding:"12px",fontWeight:700,color:m.compliance>=95?C.green:m.compliance>=85?C.amber:C.red}}>{m.compliance}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function CustomerRequestsTab() {
  return (<>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24}}>
      {(["High","Medium","Low","All"] as string[]).map(p=>(
        <div key={p} style={DC}>
          <p style={{fontSize:11,color:T3,fontWeight:600,letterSpacing:".06em",marginBottom:8}}>{p==="All"?"TOTAL":p.toUpperCase()}</p>
          <p style={{fontSize:28,fontWeight:800,color:p==="High"?C.red:p==="Medium"?C.amber:p==="Low"?C.green:T1,letterSpacing:"-0.03em",marginBottom:4}}>{p==="All"?CUSTOMER_REQUESTS.length:CUSTOMER_REQUESTS.filter(r=>r.priority===p).length}</p>
          <p style={{fontSize:12,color:T3}}>requests</p>
        </div>
      ))}
    </div>
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        {tableHead(["ID","Reserve","Type","Description","Priority","Status","Raised"])}
        <tbody>
          {CUSTOMER_REQUESTS.map((r,i)=>(
            <tr key={r.id} style={tableRow(i)}>
              <td style={{padding:"12px",fontFamily:"monospace",fontWeight:700,color:T1}}>{r.id}</td>
              <td style={{padding:"12px",color:T2}}>{r.reserve}</td>
              <td style={{padding:"12px",color:T1}}>{r.type}</td>
              <td style={{padding:"12px",color:T2,fontSize:12}}>{r.description}</td>
              <td style={{padding:"12px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:r.priority==="High"?"rgba(239,68,68,0.15)":r.priority==="Medium"?"rgba(245,158,11,0.15)":"rgba(16,185,129,0.15)",color:r.priority==="High"?C.red:r.priority==="Medium"?C.amber:C.green}}>{r.priority}</span>
              </td>
              <td style={{padding:"12px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:r.status==="Complete"||r.status==="Approved"?"rgba(16,185,129,0.15)":r.status==="In Progress"||r.status==="Scheduled"?"rgba(59,130,246,0.15)":"rgba(100,116,139,0.2)",color:r.status==="Complete"||r.status==="Approved"?C.green:r.status==="In Progress"||r.status==="Scheduled"?C.blue:C.slate}}>{r.status}</span>
              </td>
              <td style={{padding:"12px",color:T2}}>{r.raised}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function ReactiveVsPlannedTab() {
  return (<>
    <div style={{...DC,marginBottom:20}}>
      <p style={{fontWeight:700,marginBottom:8,color:T1}}>Reactive vs Planned Maintenance Spend</p>
      <p style={{fontSize:12,color:T3,marginBottom:20}}>Target: reactive maintenance &lt; 30% of total spend.</p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={REACTIVE_VS_PLANNED}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
          <XAxis dataKey="month" tick={{fill:TICK,fontSize:12}}/><YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fill:TICK,fontSize:12}}/>
          <Tooltip contentStyle={TT} formatter={(v)=>typeof v==="number"?fmt(v):v}/><Legend wrapperStyle={{color:T2}}/>
          <Bar dataKey="planned" fill={C.green} name="Planned" stackId="a"/>
          <Bar dataKey="reactive" fill={C.red} name="Reactive" stackId="a" radius={[4,4,0,0]}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
      <StatCard label="Avg Reactive Ratio" value="33%" sub="Target: <30%" color={C.amber}/>
      <StatCard label="Best Month" value="Mar — 29%" sub="Lowest reactive ratio" color={C.green}/>
      <StatCard label="Reactive Spend YTD" value={fmt(REACTIVE_VS_PLANNED.reduce((s,r)=>s+r.reactive,0))} sub="Unplanned maintenance"/>
    </div>
  </>);
}

function CostPerReserveTab() {
  return (<>
    <div style={{...DC,marginBottom:20}}>
      <p style={{fontWeight:700,marginBottom:20,color:T1}}>Cost per Hectare by Reserve</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={COST_PER_RESERVE} layout="vertical">
          <XAxis type="number" tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fill:TICK,fontSize:12}}/>
          <YAxis dataKey="name" type="category" tick={{fill:TICK,fontSize:11}} width={110}/>
          <Tooltip contentStyle={TT} formatter={(v)=>typeof v==="number"?fmt(v):v}/>
          <Bar dataKey="costPerHa" fill={C.teal} name="Cost / ha" radius={[0,4,4,0]}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        {tableHead(["Reserve","Area (ha)","Annual Cost","Cost / ha","Type","Benchmark"])}
        <tbody>
          {COST_PER_RESERVE.map((r,i)=>(
            <tr key={r.name} style={tableRow(i)}>
              <td style={{padding:"12px",fontWeight:700,color:T1}}>{r.name}</td>
              <td style={{padding:"12px",color:T2}}>{r.area}</td>
              <td style={{padding:"12px",fontWeight:600,color:T1}}>{fmt(r.total)}</td>
              <td style={{padding:"12px",fontWeight:700,color:r.costPerHa>12000?C.red:r.costPerHa>8000?C.amber:C.green}}>{fmt(r.costPerHa)}</td>
              <td style={{padding:"12px",color:T2}}>{SAMPLE_RESERVES[i]?.type||"—"}</td>
              <td style={{padding:"12px"}}>
                <span style={{fontSize:12,color:r.costPerHa>12000?C.red:r.costPerHa>8000?C.amber:C.green,fontWeight:600}}>{r.costPerHa>12000?"Above Benchmark":r.costPerHa>8000?"At Benchmark":"Below Benchmark"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

const INDUSTRY_TABS: IndustryTab[] = [
  {label:"Reserves",content:<ReservesTab/>},
  {label:"Contractors",content:<ContractorsTab/>},
  {label:"Work Orders",content:<WorkOrdersTab/>},
  {label:"Irrigation",content:<IrrigationTab/>},
  {label:"Mowing Schedule",content:<MowingScheduleTab/>},
  {label:"Customer Requests",content:<CustomerRequestsTab/>},
  {label:"Reactive vs Planned",content:<ReactiveVsPlannedTab/>},
  {label:"Cost per Reserve",content:<CostPerReserveTab/>},
];

export default function ParksDashboard() {
  return (
    <DashboardShell
      theme="dark"
      title="Parks & Open Spaces Intelligence"
      subtitle="Reserve management · Contractor performance · Irrigation · Work orders"
      headerColor="#14532d"
      accentColor="#22c55e"
      breadcrumbLabel="Parks & Open Spaces"
      kpis={KPI_DATA}
      recommendedActions={[
        {title:"Issue EcoMow performance notice (recover $18k in liquidated damages)",explanation:"EcoMow's mowing compliance at 88% — 9 points below the 97% SLA. 3 missed services in 30 days with no formal notice yet issued. Contract entitles council to liquidated damages.",impact:"$18,000 liquidated damages recoverable under contract",priority:"High"},
        {title:"Repair Foreshore irrigation fault (save $6.2k over 90-day season)",explanation:"Fault logged 14 days ago — unresolved. Water wastage estimated at 40kL/day. Summer moisture stress risk rising across the reserve's root zone.",impact:"$6,200 water saving over 90-day summer season",priority:"High"},
        {title:"Consolidate high cost-per-hectare routes (save $28k annually)",explanation:"Cost disparity between best and worst managed reserves exceeds 60%. Route consolidation and contractor reallocation would reduce visit costs across 3 reserves.",impact:"$28,000 annual efficiency gain",priority:"Medium"},
        {title:"Convert steep terrain to ground cover (save $12k annually in mowing)",explanation:"3 areas with steep terrain add contractor time without amenity value. Ground cover conversion eliminates recurring mowing cost and reduces erosion risk.",impact:"$12,000 annual mowing cost reduction",priority:"Low"},
      ]}
      insightCards={[
        {problem:"Harbour Foreshore irrigation fault — 240kL/week water loss, $6.2k seasonal cost, unresolved 14 days",cause:"Aging reticulation with no automated fault detection; issue identified only through visual inspection",recommendation:"Repair fault this week; install automated leak detection at top 6 reserves by cost before summer season",severity:"High"},
        {problem:"EcoMow mowing completion at 89% vs 97% SLA — $18k in liquidated damages recoverable",cause:"Insufficient crew allocation for contracted zones; EcoMow subcontracting without council approval",recommendation:"Issue formal performance notice today; require remediation plan within 7 days — initiate contract dispute if unresolved",severity:"Medium"},
        {problem:"Ground cover below 60% at 6 sportsgrounds — increasing complaints and reducing playability",cause:"No aeration or oversow programme; high-frequency use compacting soil without scheduled recovery windows",recommendation:"Schedule quarterly aeration and oversow before winter — prioritise Category 1 sportsgrounds first",severity:"Medium"},
      ]}
      overviewContent={<OverviewContent/>}
      industryTabs={INDUSTRY_TABS}
      sampleData={{Reserves:SAMPLE_RESERVES,Contractors:SAMPLE_CONTRACTORS,"Work Orders":SAMPLE_WORK_ORDERS,Irrigation:SAMPLE_IRRIGATION}}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="Parks & Open Spaces dashboard. 6 reserves, 53.9 ha managed. Annual cost $516K ($9,720/ha). Mowing compliance 93% (target 95%). EcoMow underperforming. Foreshore irrigation fault outstanding. 3 open work orders."
      executiveSummary="EcoMow's 89% compliance rate triggers $18k in recoverable liquidated damages while the Foreshore irrigation fault has been losing 240kL/week for 14 days — combined action value of $64k including route consolidation savings."
      snapshotPanel={{ topCostDriver: 'EcoMow contract — compliance at 89% vs 97% SLA, $18k damages recoverable', biggestRisk: 'Foreshore irrigation fault — 240kL/week water loss unresolved for 14 days', savingsIdentified: 64000, confidence: 83, lastUpdated: 'Apr 2026' }}
    />
  );
}

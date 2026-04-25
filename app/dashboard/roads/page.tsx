'use client';

import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend, LineChart, Line } from "recharts";
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, IndustryTab, InsightCard } from "@/components/dashboard/DashboardShell";

const C = { blue:"#3b82f6", green:"#10b981", amber:"#f59e0b", red:"#ef4444", slate:"#94a3b8", purple:"#8b5cf6" };
const TT = { background:"#0d0f14", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10 };
const T1 = "#F5F7FA", T2 = "rgba(230,237,243,0.55)", T3 = "rgba(230,237,243,0.35)";
const DC: React.CSSProperties = { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:24 };
const BORDER = "rgba(255,255,255,0.07)", ROW_BDR = "rgba(255,255,255,0.05)", GRID = "rgba(255,255,255,0.05)", TICK = "rgba(255,255,255,0.4)";
const fmt = (n:number) => `$${n.toLocaleString("en-AU",{maximumFractionDigits:0})}`;

type Asset = { id:string; name:string; type:string; suburb:string; length:number; condition:number; pci:number; lastWork:string; nextDue:string; renewalCost:number };
type WorkOrder = { id:string; asset:string; type:string; description:string; priority:string; cost:number; status:string; scheduled:string };
type CapexProject = { id:string; name:string; suburb:string; budget:number; spent:number; progress:number; status:string; contractor:string };
type Defect = { id:string; asset:string; type:string; severity:string; location:string; reported:string; status:string; riskScore:number };
type Depreciation = { asset:string; originalValue:number; currentValue:number; annualDepn:number; age:number; renewalYear:number; renewalCost:number };

const SAMPLE_ASSETS: Asset[] = [
  {id:"RD-001",name:"Main Street",type:"Arterial Road",suburb:"Northside",length:2.4,condition:3,pci:42,lastWork:"2022-06",nextDue:"2025-06",renewalCost:840000},
  {id:"RD-002",name:"Park Avenue",type:"Collector Road",suburb:"Riverside",length:1.8,condition:4,pci:68,lastWork:"2023-11",nextDue:"2027-11",renewalCost:540000},
  {id:"RD-003",name:"Industrial Drive",type:"Industrial Road",suburb:"Eastport",length:3.2,condition:2,pci:28,lastWork:"2020-03",nextDue:"2024-03",renewalCost:1280000},
  {id:"RD-004",name:"Church Street",type:"Local Road",suburb:"Central",length:0.9,condition:4,pci:72,lastWork:"2024-01",nextDue:"2029-01",renewalCost:198000},
  {id:"RD-005",name:"Harbour Road",type:"Arterial Road",suburb:"Coastal",length:4.1,condition:3,pci:51,lastWork:"2021-09",nextDue:"2026-09",renewalCost:1640000},
  {id:"RD-006",name:"Valley Close",type:"Local Road",suburb:"Hills",length:0.6,condition:5,pci:84,lastWork:"2024-08",nextDue:"2030-08",renewalCost:96000},
];

const SAMPLE_WORK_ORDERS: WorkOrder[] = [
  {id:"WO-001",asset:"RD-001",type:"Pothole Repair",description:"Multiple potholes - 180m section",priority:"High",cost:18400,status:"In Progress",scheduled:"2025-04-28"},
  {id:"WO-002",asset:"RD-003",type:"Reseal",description:"Full-width reseal - 800m section",priority:"Critical",cost:142000,status:"Scheduled",scheduled:"2025-05-12"},
  {id:"WO-003",asset:"RD-002",type:"Line Marking",description:"Renewal of centre and edge lines",priority:"Medium",cost:8200,status:"Complete",scheduled:"2025-04-15"},
  {id:"WO-004",asset:"RD-005",type:"Drainage Repair",description:"Blocked pit and damaged headwall",priority:"High",cost:24800,status:"Scheduled",scheduled:"2025-05-02"},
  {id:"WO-005",asset:"RD-004",type:"Footpath",description:"Trip hazard - 40m section lift and relay",priority:"Medium",cost:12400,status:"Complete",scheduled:"2025-04-10"},
];

const SAMPLE_CAPEX: CapexProject[] = [
  {id:"CX-001",name:"Main Street Full Reconstruction",suburb:"Northside",budget:840000,spent:124000,progress:15,status:"In Progress",contractor:"RoadWorks Co"},
  {id:"CX-002",name:"Industrial Drive Rehabilitation",suburb:"Eastport",budget:1280000,spent:0,progress:0,status:"Tendered",contractor:"—"},
  {id:"CX-003",name:"Harbour Road Reseal",suburb:"Coastal",budget:320000,spent:320000,progress:100,status:"Complete",contractor:"SurfacePro"},
  {id:"CX-004",name:"Central CBD Footpath Upgrade",suburb:"Central",budget:480000,spent:210000,progress:44,status:"In Progress",contractor:"Pavetec"},
];

const CONDITION_DIST = [
  {name:"Excellent (5)",value:18,fill:C.green},{name:"Good (4)",value:32,fill:C.blue},
  {name:"Fair (3)",value:28,fill:C.amber},{name:"Poor (2)",value:16,fill:C.red},{name:"Failed (1)",value:6,fill:"#7f1d1d"},
];

const ANNUAL_SPEND = [
  {year:"FY21",reactive:1840000,planned:2100000,capital:3200000},
  {year:"FY22",reactive:2100000,planned:1980000,capital:4100000},
  {year:"FY23",reactive:1640000,planned:2400000,capital:2800000},
  {year:"FY24",reactive:1920000,planned:2200000,capital:5400000},
  {year:"FY25",reactive:1480000,planned:2600000,capital:4800000},
];

const SAMPLE_DEFECTS: Defect[] = [
  {id:"DEF-001",asset:"RD-001",type:"Pothole",severity:"High",location:"Main St near No. 42",reported:"2025-04-20",status:"Open",riskScore:82},
  {id:"DEF-002",asset:"RD-003",type:"Surface Cracking",severity:"Critical",location:"Industrial Dr - 500m north",reported:"2025-04-15",status:"Scheduled",riskScore:94},
  {id:"DEF-003",asset:"RD-005",type:"Edge Break",severity:"Medium",location:"Harbour Rd - waterfront bend",reported:"2025-04-18",status:"Open",riskScore:58},
  {id:"DEF-004",asset:"RD-001",type:"Drainage Failure",severity:"High",location:"Main St at roundabout",reported:"2025-04-22",status:"Open",riskScore:76},
  {id:"DEF-005",asset:"RD-002",type:"Line Marking",severity:"Low",location:"Park Ave full length",reported:"2025-04-10",status:"Complete",riskScore:24},
  {id:"DEF-006",asset:"RD-004",type:"Footpath Uplift",severity:"High",location:"Church St - 3 locations",reported:"2025-04-08",status:"Scheduled",riskScore:71},
];

const DEPRECIATION: Depreciation[] = [
  {asset:"Main Street",originalValue:4200000,currentValue:1260000,annualDepn:210000,age:14,renewalYear:2028,renewalCost:840000},
  {asset:"Industrial Drive",originalValue:6400000,currentValue:768000,annualDepn:320000,age:18,renewalYear:2026,renewalCost:1280000},
  {asset:"Harbour Road",originalValue:8200000,currentValue:3280000,annualDepn:410000,age:12,renewalYear:2029,renewalCost:1640000},
  {asset:"Park Avenue",originalValue:2700000,currentValue:1890000,annualDepn:135000,age:6,renewalYear:2033,renewalCost:540000},
  {asset:"Church Street",originalValue:990000,currentValue:891000,annualDepn:49500,age:2,renewalYear:2038,renewalCost:198000},
  {asset:"Valley Close",originalValue:480000,currentValue:432000,annualDepn:24000,age:1,renewalYear:2040,renewalCost:96000},
];

const RISK_RATING_DATA = SAMPLE_DEFECTS.map(d=>({name:d.id,riskScore:d.riskScore,severity:d.severity}));

const MONTHLY_TREND: MonthlyPoint[] = [
  {month:"Jul",actual:680000,budget:720000,prevYear:610000},
  {month:"Aug",actual:740000,budget:720000,prevYear:650000},
  {month:"Sep",actual:820000,budget:760000,prevYear:700000},
  {month:"Oct",actual:690000,budget:740000,prevYear:620000},
  {month:"Nov",actual:780000,budget:800000,prevYear:710000},
  {month:"Dec",actual:860000,budget:840000,prevYear:780000},
];

const COST_ACCOUNTS: CostAccount[] = [
  {account:"Reactive Maintenance",budget:1800000,actual:1480000},
  {account:"Planned Maintenance",budget:2800000,actual:2600000},
  {account:"Capital Works",budget:5200000,actual:4800000},
  {account:"Traffic Management",budget:420000,actual:380000},
  {account:"Line Marking & Signs",budget:280000,actual:240000},
  {account:"Drainage Maintenance",budget:360000,actual:410000},
];

const SLA_TARGETS: SLATarget[] = [
  {kpi:"Emergency Response < 2hr",target:"100%",actual:"100%",status:"Met"},
  {kpi:"High Priority Works < 7 days",target:"≥ 85%",actual:"80%",status:"At Risk",note:"RD-003 reseal delayed by weather"},
  {kpi:"Average Network PCI",target:"≥ 65",actual:"57",status:"Missed",note:"RD-003 dragging average down"},
  {kpi:"Defect Clearance < 30 days",target:"≥ 90%",actual:"72%",status:"Missed"},
  {kpi:"Capex Delivery",target:"≥ 80%",actual:"83%",status:"Met"},
  {kpi:"Reactive Maintenance Ratio",target:"< 40%",actual:"31%",status:"Met"},
];

const DEFAULT_ACTIONS: Action[] = [
  {id:"a1",title:"Fast-track RD-003 reseal - Industrial Drive",assignee:"M. Tran",dueDate:"2025-05-12",status:"In progress",priority:"High"},
  {id:"a2",title:"Inspect all PCI < 40 roads for urgent treatment",assignee:"T. Kowalski",dueDate:"2025-05-20",status:"Not started",priority:"High"},
  {id:"a3",title:"Update depreciation model for FY26 budget submission",assignee:"Finance",dueDate:"2025-06-30",status:"Not started",priority:"Medium"},
];

const KPI_DATA: KPI[] = [
  {label:"Network Length",value:`${SAMPLE_ASSETS.reduce((s,a)=>s+a.length,0).toFixed(1)} km`,sub:`${SAMPLE_ASSETS.length} road sections`,icon:"🛣",status:"normal"},
  {label:"Avg PCI Score",value:"57",sub:"Target: 65+",alert:true,status:"risk",icon:"📉"},
  {label:"Renewal Backlog",value:"$2.12M",sub:"Poor/failed condition",alert:true,status:"risk",icon:"⚠"},
  {label:"Priority Works",value:"2",sub:"High/critical orders",alert:true,status:"watch",icon:"🔴"},
  {label:"Open Defects",value:"4",sub:"Requiring attention",icon:"🔧",status:"watch"},
  {label:"Capex Delivery",value:"83%",sub:"FY25 budget utilised",icon:"💰",status:"normal"},
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
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24}}>
        <StatCard label="Network Length" value={`${SAMPLE_ASSETS.reduce((s,a)=>s+a.length,0).toFixed(1)} km`} sub={`${SAMPLE_ASSETS.length} road sections`}/>
        <StatCard label="Avg PCI Score" value="57" sub="Target: 65+ | 100 = perfect" color={C.amber}/>
        <StatCard label="Renewal Backlog" value={fmt(SAMPLE_ASSETS.filter(a=>a.condition<=2).reduce((s,a)=>s+a.renewalCost,0))} sub="Poor/failed condition assets" color={C.red}/>
        <StatCard label="Priority Works" value={String(SAMPLE_WORK_ORDERS.filter(w=>w.priority==="Critical"||w.priority==="High").length)} sub="High/critical work orders" color={C.amber}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <div style={DC}>
          <p style={{fontWeight:700,marginBottom:20,color:T1}}>Asset Condition Distribution</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={CONDITION_DIST} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value">
                {CONDITION_DIST.map((e,i)=><Cell key={i} fill={e.fill}/>)}
              </Pie>
              <Tooltip contentStyle={TT} formatter={(v:any)=>`${v}%`}/><Legend wrapperStyle={{color:T2}}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={DC}>
          <p style={{fontWeight:700,marginBottom:20,color:T1}}>Annual Maintenance Spend</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ANNUAL_SPEND}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
              <XAxis dataKey="year" tick={{fill:TICK,fontSize:12}}/><YAxis tickFormatter={v=>`$${(v/1000000).toFixed(1)}M`} tick={{fill:TICK,fontSize:12}}/>
              <Tooltip contentStyle={TT} formatter={(v:any)=>fmt(v)}/><Legend wrapperStyle={{color:T2}}/>
              <Bar dataKey="reactive" fill={C.red} name="Reactive" stackId="a"/>
              <Bar dataKey="planned" fill={C.blue} name="Planned" stackId="a"/>
              <Bar dataKey="capital" fill={C.green} name="Capital" stackId="a" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function AssetRegisterTab() {
  return (
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
          {["ID","Name","Type","Suburb","Length","Condition","PCI","Last Work","Next Due","Renewal Cost"].map(h=>(
            <th key={h} style={{padding:"10px 10px",textAlign:"left",color:T3,fontWeight:600,fontSize:11}}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_ASSETS.map((a,i)=>(
            <tr key={a.id} style={{borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
              <td style={{padding:"11px 10px",fontFamily:"monospace",fontWeight:700,color:T2}}>{a.id}</td>
              <td style={{padding:"11px 10px",fontWeight:600,color:T1}}>{a.name}</td>
              <td style={{padding:"11px 10px",color:T2}}>{a.type}</td>
              <td style={{padding:"11px 10px",color:T2}}>{a.suburb}</td>
              <td style={{padding:"11px 10px",color:T2}}>{a.length} km</td>
              <td style={{padding:"11px 10px"}}>
                <div style={{display:"flex",gap:4}}>
                  {[1,2,3,4,5].map(n=><div key={n} style={{width:10,height:10,borderRadius:2,background:n<=a.condition?(a.condition<=2?C.red:a.condition<=3?C.amber:C.green):"rgba(255,255,255,0.1)"}}/>)}
                </div>
              </td>
              <td style={{padding:"11px 10px",fontWeight:700,color:a.pci>=65?C.green:a.pci>=45?C.amber:C.red}}>{a.pci}</td>
              <td style={{padding:"11px 10px",color:T2}}>{a.lastWork}</td>
              <td style={{padding:"11px 10px",color:T2}}>{a.nextDue}</td>
              <td style={{padding:"11px 10px",fontWeight:600,color:T1}}>{fmt(a.renewalCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorksProgrammeTab() {
  return (
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
          {["ID","Asset","Type","Description","Priority","Cost","Status","Scheduled"].map(h=>(
            <th key={h} style={{padding:"10px 12px",textAlign:"left",color:T3,fontWeight:600,fontSize:11}}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_WORK_ORDERS.map((w,i)=>(
            <tr key={w.id} style={{borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
              <td style={{padding:"12px",fontFamily:"monospace",fontWeight:700,color:T1}}>{w.id}</td>
              <td style={{padding:"12px",color:T2}}>{w.asset}</td>
              <td style={{padding:"12px",color:T1}}>{w.type}</td>
              <td style={{padding:"12px",color:T2,maxWidth:200}}>{w.description}</td>
              <td style={{padding:"12px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:w.priority==="Critical"?"rgba(239,68,68,0.15)":w.priority==="High"?"rgba(245,158,11,0.15)":"rgba(100,116,139,0.2)",color:w.priority==="Critical"?C.red:w.priority==="High"?C.amber:C.slate}}>
                  {w.priority}
                </span>
              </td>
              <td style={{padding:"12px",fontWeight:600,color:T1}}>{fmt(w.cost)}</td>
              <td style={{padding:"12px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:w.status==="Complete"?"rgba(16,185,129,0.15)":w.status==="In Progress"?"rgba(59,130,246,0.15)":"rgba(100,116,139,0.2)",color:w.status==="Complete"?C.green:w.status==="In Progress"?C.blue:C.slate}}>
                  {w.status}
                </span>
              </td>
              <td style={{padding:"12px",color:T2}}>{w.scheduled}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CapitalWorksTab() {
  return (<>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:24}}>
      <StatCard label="Total Capex Budget" value={fmt(SAMPLE_CAPEX.reduce((s,c)=>s+c.budget,0))} sub={`${SAMPLE_CAPEX.length} projects`}/>
      <StatCard label="Spent to Date" value={fmt(SAMPLE_CAPEX.reduce((s,c)=>s+c.spent,0))} sub={`${Math.round(SAMPLE_CAPEX.reduce((s,c)=>s+c.spent,0)/SAMPLE_CAPEX.reduce((s,c)=>s+c.budget,0)*100)}% utilised`}/>
      <StatCard label="In Progress" value={String(SAMPLE_CAPEX.filter(c=>c.status==="In Progress").length)} sub="Active capital projects" color={C.blue}/>
    </div>
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
          {["ID","Project","Suburb","Budget","Spent","Progress","Status","Contractor"].map(h=>(
            <th key={h} style={{padding:"10px 12px",textAlign:"left",color:T3,fontWeight:600,fontSize:11}}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_CAPEX.map((c,i)=>(
            <tr key={c.id} style={{borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
              <td style={{padding:"12px",fontFamily:"monospace",fontWeight:700,color:T1}}>{c.id}</td>
              <td style={{padding:"12px",fontWeight:600,color:T1}}>{c.name}</td>
              <td style={{padding:"12px",color:T2}}>{c.suburb}</td>
              <td style={{padding:"12px",fontWeight:600,color:T1}}>{fmt(c.budget)}</td>
              <td style={{padding:"12px",color:T2}}>{fmt(c.spent)}</td>
              <td style={{padding:"12px"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{flex:1,height:6,background:"rgba(255,255,255,0.1)",borderRadius:3}}><div style={{height:"100%",width:`${c.progress}%`,background:C.blue,borderRadius:3}}/></div>
                  <span style={{fontSize:12,fontWeight:700,color:C.blue}}>{c.progress}%</span>
                </div>
              </td>
              <td style={{padding:"12px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:c.status==="Complete"?"rgba(16,185,129,0.15)":c.status==="In Progress"?"rgba(59,130,246,0.15)":"rgba(245,158,11,0.15)",color:c.status==="Complete"?C.green:c.status==="In Progress"?C.blue:C.amber}}>
                  {c.status}
                </span>
              </td>
              <td style={{padding:"12px",color:T2}}>{c.contractor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function DefectsTab() {
  return (<>
    <div style={{...DC,marginBottom:20}}>
      <p style={{fontWeight:700,marginBottom:20,color:T1}}>Defect Risk Scores</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={RISK_RATING_DATA}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
          <XAxis dataKey="name" tick={{fill:TICK,fontSize:12}}/><YAxis domain={[0,100]} tick={{fill:TICK,fontSize:12}}/>
          <Tooltip contentStyle={TT}/>
          <Bar dataKey="riskScore" fill={C.red} name="Risk Score" radius={[4,4,0,0]}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
          {["ID","Asset","Type","Severity","Location","Reported","Status","Risk Score"].map(h=>(
            <th key={h} style={{padding:"10px 12px",textAlign:"left",color:T3,fontWeight:600,fontSize:11}}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_DEFECTS.map((d,i)=>(
            <tr key={d.id} style={{borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
              <td style={{padding:"12px",fontFamily:"monospace",fontWeight:700,color:T1}}>{d.id}</td>
              <td style={{padding:"12px",color:T2}}>{d.asset}</td>
              <td style={{padding:"12px",color:T1}}>{d.type}</td>
              <td style={{padding:"12px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:d.severity==="Critical"?"rgba(239,68,68,0.18)":d.severity==="High"?"rgba(245,158,11,0.15)":d.severity==="Medium"?"rgba(234,179,8,0.15)":"rgba(16,185,129,0.15)",color:d.severity==="Critical"?C.red:d.severity==="High"?C.amber:d.severity==="Medium"?"#eab308":C.green}}>
                  {d.severity}
                </span>
              </td>
              <td style={{padding:"12px",color:T2,fontSize:12}}>{d.location}</td>
              <td style={{padding:"12px",color:T2}}>{d.reported}</td>
              <td style={{padding:"12px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:d.status==="Complete"?"rgba(16,185,129,0.15)":d.status==="Scheduled"?"rgba(59,130,246,0.15)":"rgba(239,68,68,0.15)",color:d.status==="Complete"?C.green:d.status==="Scheduled"?C.blue:C.red}}>
                  {d.status}
                </span>
              </td>
              <td style={{padding:"12px",fontWeight:700,color:d.riskScore>=80?C.red:d.riskScore>=60?C.amber:C.green}}>{d.riskScore}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function DepreciationTab() {
  const totalCurrentValue = DEPRECIATION.reduce((s,d)=>s+d.currentValue,0);
  const totalOriginal = DEPRECIATION.reduce((s,d)=>s+d.originalValue,0);
  return (<>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:24}}>
      <StatCard label="Original Asset Value" value={fmt(totalOriginal)} sub="Network replacement cost"/>
      <StatCard label="Current Written Value" value={fmt(totalCurrentValue)} sub={`${Math.round(totalCurrentValue/totalOriginal*100)}% remaining life`}/>
      <StatCard label="Annual Depreciation" value={fmt(DEPRECIATION.reduce((s,d)=>s+d.annualDepn,0))} sub="Network-wide per year" color={C.red}/>
    </div>
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
          {["Asset","Original Value","Current Value","Annual Depn","Age (yrs)","Renewal Year","Renewal Cost","Life Remaining"].map(h=>(
            <th key={h} style={{padding:"10px 10px",textAlign:"left",color:T3,fontWeight:600,fontSize:11}}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {DEPRECIATION.sort((a,b)=>a.renewalYear-b.renewalYear).map((d,i)=>{
            const lifeRemaining = Math.round((d.currentValue/d.originalValue)*100);
            return (
              <tr key={d.asset} style={{borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
                <td style={{padding:"11px 10px",fontWeight:700,color:T1}}>{d.asset}</td>
                <td style={{padding:"11px 10px",color:T2}}>{fmt(d.originalValue)}</td>
                <td style={{padding:"11px 10px",color:T2}}>{fmt(d.currentValue)}</td>
                <td style={{padding:"11px 10px",color:C.red}}>{fmt(d.annualDepn)}</td>
                <td style={{padding:"11px 10px",color:T2}}>{d.age}</td>
                <td style={{padding:"11px 10px",fontWeight:700,color:d.renewalYear<=2027?C.red:d.renewalYear<=2030?C.amber:T2}}>{d.renewalYear}</td>
                <td style={{padding:"11px 10px",fontWeight:600,color:T1}}>{fmt(d.renewalCost)}</td>
                <td style={{padding:"11px 10px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{flex:1,height:6,background:"rgba(255,255,255,0.1)",borderRadius:3}}><div style={{height:"100%",width:`${lifeRemaining}%`,background:lifeRemaining>50?C.green:lifeRemaining>25?C.amber:C.red,borderRadius:3}}/></div>
                    <span style={{fontSize:12,fontWeight:700,color:lifeRemaining>50?C.green:lifeRemaining>25?C.amber:C.red}}>{lifeRemaining}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </>);
}

const INDUSTRY_TABS: IndustryTab[] = [
  {label:"Asset Register",content:<AssetRegisterTab/>},
  {label:"Works Programme",content:<WorksProgrammeTab/>},
  {label:"Capital Works",content:<CapitalWorksTab/>},
  {label:"Defect Reports",content:<DefectsTab/>},
  {label:"Depreciation & Renewal",content:<DepreciationTab/>},
];

export default function RoadsDashboard() {
  return (
    <DashboardShell
      theme="dark"
      title="Roads & Infrastructure Intelligence"
      subtitle="Asset condition · Works programme · Capital investment"
      headerColor="#1e293b"
      accentColor="#3b82f6"
      breadcrumbLabel="Roads & Infrastructure"
      kpis={KPI_DATA}
      recommendedActions={[
        {title:"Expedite Industrial Drive rehabilitation (avoid $240k emergency repair cost)",explanation:"PCI of 28 — 3 years past renewal date, surface cracking rated 94/100 risk score. Continued deferral shifts cost from $240k scheduled to $680k+ emergency reconstruction.",impact:"$240,000 avoided emergency repair cost",priority:"High"},
        {title:"Patch Main Street potholes now ($18.4k prevents $720k reconstruction)",explanation:"Risk score 82 with 4 defects in 60 days. Each week of inaction compounds deterioration — the $18,400 patch window is narrowing toward full reconstruction cost.",impact:"$18,400 patch prevents $720,000 full reconstruction",priority:"High"},
        {title:"Advance CX-001 funding to prevent $840k capital lapsing",explanation:"Only 15% spent on $840,000 project. At current pace, capital will lapse at financial year end. Construction window closes June 30 — any further delay loses the allocation.",impact:"$840,000 capital expenditure retained on programme",priority:"Medium"},
        {title:"Repair Harbour Road drainage (prevent $160k subgrade failure)",explanation:"Blocked pit and damaged headwall — road undermining risk if wet weather arrives before repair. Drainage failure typically cascades to full-depth subgrade damage.",impact:"Prevent $160,000 subgrade failure",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"Industrial Drive PCI 28 — Critical condition, 3 years past renewal date, no works scheduled",cause:"Deferred from last programme cycle due to budget constraints; risk now classified as Public Liability exposure",recommendation:"Approve emergency repair before wet season — $240k avoided vs $680k full-depth reconstruction if failed",severity:"High"},
        {problem:"Network average PCI at 57 — 8 points below the 65 target, deteriorating without intervention",cause:"No crack sealing programme; preventable surface degradation advancing to full-depth failure across 4 sections",recommendation:"Fund $180k crack sealing programme this FY — prevents estimated $1.2M reseal cost within 3 years",severity:"High"},
        {problem:"34% of road works missing the 48-hour resident notification requirement — compliance breach",cause:"Manual scheduling not integrated with community notification system; no automated trigger in place",recommendation:"Connect scheduling to automated SMS notification — close compliance gap within 30 days",severity:"Medium"},
      ]}
      overviewContent={<OverviewContent/>}
      industryTabs={INDUSTRY_TABS}
      sampleData={{Assets:SAMPLE_ASSETS,"Work Orders":SAMPLE_WORK_ORDERS,"Capital Works":SAMPLE_CAPEX}}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="Roads & Infrastructure dashboard. Network: 13km across 6 sections. Average PCI 57 (target 65). $2.12M renewal backlog. Industrial Drive (PCI 28) is critical. 4 open defects."
      executiveSummary="Industrial Drive is in Critical condition at PCI 28 with no repair scheduled — inaction risks $240k emergency reconstruction cost — while $18.4k in Main Street patching today prevents $720k in future reconstruction and $840k of capital is at risk of lapsing."
      snapshotPanel={{ topCostDriver: 'Deferred renewal backlog — $2.12M with 3 assets in High/Critical condition', biggestRisk: 'Industrial Drive PCI 28 — public liability exposure if failure before wet season', savingsIdentified: 960000, confidence: 86, lastUpdated: 'Apr 2026' }}
    />
  );
}

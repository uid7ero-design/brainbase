'use client';

import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Cell, CartesianGrid, Legend } from "recharts";
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, IndustryTab, InsightCard } from "@/components/dashboard/DashboardShell";

const C = { blue:"#06b6d4", green:"#10b981", amber:"#f59e0b", red:"#ef4444", slate:"#94a3b8", indigo:"#6366f1" };
const TT = { background:"#0d0f14", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10 };
const T1 = "#F5F7FA", T2 = "rgba(230,237,243,0.55)", T3 = "rgba(230,237,243,0.35)";
const DC: React.CSSProperties = { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:24 };
const BORDER = "rgba(255,255,255,0.07)", ROW_BDR = "rgba(255,255,255,0.05)", ROW_HEAD = "rgba(255,255,255,0.04)", GRID = "rgba(255,255,255,0.05)", TICK = "rgba(255,255,255,0.4)";
const fmt = (n:number) => `$${n.toLocaleString("en-AU",{maximumFractionDigits:0})}`;

type Zone = { id:string; name:string; type:string; consumption:number; budget:number; leakage:number; pressure:number; customers:number; complaints:number };
type Pump = { id:string; name:string; location:string; status:string; efficiency:number; runtime:number; lastService:string; nextService:string; alerts:number };
type Compliance = { parameter:string; result:string; limit:string; status:string; sampleDate:string; lab:string };
type Incident = { id:string; type:string; location:string; severity:string; duration:number; affected:number; resolved:boolean; date:string };

const SAMPLE_ZONES: Zone[] = [
  {id:"Z1",name:"Northern Catchment",type:"Residential",consumption:142800,budget:138000,leakage:4.2,pressure:68,customers:3840,complaints:12},
  {id:"Z2",name:"CBD Distribution",type:"Commercial",consumption:98400,budget:102000,leakage:6.8,pressure:72,customers:1240,complaints:28},
  {id:"Z3",name:"Industrial Park",type:"Industrial",consumption:184200,budget:180000,leakage:2.1,pressure:65,customers:280,complaints:4},
  {id:"Z4",name:"Southern Suburbs",type:"Residential",consumption:112600,budget:115000,leakage:5.4,pressure:70,customers:2980,complaints:18},
  {id:"Z5",name:"Eastern Growth Area",type:"Mixed",consumption:76400,budget:74000,leakage:3.8,pressure:66,customers:1860,complaints:9},
];

const SAMPLE_PUMPS: Pump[] = [
  {id:"PS-01",name:"Main Pumping Station",location:"Northern Catchment",status:"Running",efficiency:87,runtime:1842,lastService:"2025-02-14",nextService:"2025-08-14",alerts:0},
  {id:"PS-02",name:"CBD Booster",location:"CBD Distribution",status:"Running",efficiency:79,runtime:2140,lastService:"2025-01-08",nextService:"2025-07-08",alerts:1},
  {id:"PS-03",name:"Industrial Supply Pump",location:"Industrial Park",status:"Maintenance",efficiency:0,runtime:3210,lastService:"2025-04-20",nextService:"2025-04-28",alerts:3},
  {id:"PS-04",name:"Southern Pressure Zone",location:"Southern Suburbs",status:"Running",efficiency:91,runtime:1640,lastService:"2025-03-01",nextService:"2025-09-01",alerts:0},
  {id:"PS-05",name:"East Booster",location:"Eastern Growth Area",status:"Running",efficiency:84,runtime:980,lastService:"2025-04-01",nextService:"2025-10-01",alerts:0},
];

const SAMPLE_COMPLIANCE: Compliance[] = [
  {parameter:"Turbidity (NTU)",result:"0.18",limit:"<1.0",status:"Pass",sampleDate:"2025-04-22",lab:"ALS Laboratories"},
  {parameter:"E.coli (cfu/100mL)",result:"0",limit:"0",status:"Pass",sampleDate:"2025-04-22",lab:"ALS Laboratories"},
  {parameter:"Chlorine (mg/L)",result:"0.52",limit:"0.2–5.0",status:"Pass",sampleDate:"2025-04-22",lab:"ALS Laboratories"},
  {parameter:"pH",result:"7.4",limit:"6.5–8.5",status:"Pass",sampleDate:"2025-04-22",lab:"ALS Laboratories"},
  {parameter:"Fluoride (mg/L)",result:"0.98",limit:"0.6–1.1",status:"Pass",sampleDate:"2025-04-22",lab:"ALS Laboratories"},
  {parameter:"Nitrate (mg/L)",result:"8.4",limit:"<11.3",status:"Pass",sampleDate:"2025-04-22",lab:"ALS Laboratories"},
  {parameter:"THMs (µg/L)",result:"62",limit:"<250",status:"Pass",sampleDate:"2025-04-18",lab:"ALS Laboratories"},
];

const SAMPLE_INCIDENTS: Incident[] = [
  {id:"INC-001",type:"Main Break",location:"Main Street, Northside",severity:"High",duration:6.5,affected:840,resolved:true,date:"2025-04-18"},
  {id:"INC-002",type:"Pressure Issue",location:"CBD Zone 2",severity:"Medium",duration:2.0,affected:120,resolved:true,date:"2025-04-12"},
  {id:"INC-003",type:"Service Leak",location:"Park Ave, Riverside",severity:"Low",duration:1.5,affected:4,resolved:true,date:"2025-04-10"},
  {id:"INC-004",type:"Pump Failure",location:"Industrial PS-03",severity:"High",duration:18.0,affected:280,resolved:false,date:"2025-04-20"},
];

const MONTHLY_CONSUMPTION = [
  {month:"Oct",kL:584200,target:560000},{month:"Nov",kL:612400,target:580000},
  {month:"Dec",kL:698800,target:650000},{month:"Jan",kL:724600,target:680000},
  {month:"Feb",kL:641200,target:640000},{month:"Mar",kL:568400,target:560000},
];

const LEAKAGE_TREND = [
  {month:"Oct",Z1:3.8,Z2:7.2,Z3:2.4,Z4:6.1,Z5:3.2},
  {month:"Nov",Z1:4.0,Z2:7.0,Z3:2.2,Z4:5.8,Z5:3.5},
  {month:"Dec",Z1:4.1,Z2:6.9,Z3:2.3,Z4:5.6,Z5:3.7},
  {month:"Jan",Z1:4.3,Z2:6.8,Z3:2.1,Z4:5.4,Z5:3.8},
  {month:"Feb",Z1:4.2,Z2:6.8,Z3:2.0,Z4:5.5,Z5:3.9},
  {month:"Mar",Z1:4.2,Z2:6.8,Z3:2.1,Z4:5.4,Z5:3.8},
];

const PRESSURE_ZONES = [
  {zone:"Z1 Northern",minPressure:62,maxPressure:74,avgPressure:68,target:65,complaints:12},
  {zone:"Z2 CBD",minPressure:68,maxPressure:78,avgPressure:72,target:70,complaints:28},
  {zone:"Z3 Industrial",minPressure:60,maxPressure:70,avgPressure:65,target:65,complaints:4},
  {zone:"Z4 Southern",minPressure:65,maxPressure:76,avgPressure:70,target:68,complaints:18},
  {zone:"Z5 Eastern",minPressure:61,maxPressure:72,avgPressure:66,target:65,complaints:9},
];

const MONTHLY_TREND: MonthlyPoint[] = [
  {month:"Oct",actual:284000,budget:270000,prevYear:258000},
  {month:"Nov",actual:298000,budget:285000,prevYear:268000},
  {month:"Dec",actual:342000,budget:320000,prevYear:298000},
  {month:"Jan",actual:368000,budget:350000,prevYear:318000},
  {month:"Feb",actual:326000,budget:330000,prevYear:298000},
  {month:"Mar",actual:291000,budget:290000,prevYear:264000},
];

const COST_ACCOUNTS: CostAccount[] = [
  {account:"Pump Station Operations",budget:480000,actual:512000},
  {account:"Network Maintenance",budget:380000,actual:348000},
  {account:"Water Quality Testing",budget:120000,actual:108000},
  {account:"Capital Renewal",budget:840000,actual:760000},
  {account:"Customer Service",budget:180000,actual:196000},
  {account:"Energy & Chemicals",budget:320000,actual:364000},
];

const SLA_TARGETS: SLATarget[] = [
  {kpi:"Water Quality Compliance",target:"100%",actual:"100%",status:"Met"},
  {kpi:"Average Leakage Rate",target:"< 4%",actual:"4.5%",status:"At Risk",note:"CBD zone Z2 at 6.8%"},
  {kpi:"Incident Response < 2hr",target:"≥ 95%",actual:"100%",status:"Met"},
  {kpi:"Pump Station Availability",target:"≥ 98%",actual:"96%",status:"At Risk",note:"PS-03 in maintenance"},
  {kpi:"Customer Complaints",target:"< 50/month",actual:"71",status:"Missed",note:"CBD zone complaints elevated"},
  {kpi:"Pressure Compliance",target:"40–80 kPa",actual:"100%",status:"Met"},
];

const DEFAULT_ACTIONS: Action[] = [
  {id:"a1",title:"Repair PS-03 Industrial Supply Pump",assignee:"B. Watts",dueDate:"2025-04-28",status:"In progress",priority:"High"},
  {id:"a2",title:"Investigate CBD Zone Z2 leakage",assignee:"N. Patel",dueDate:"2025-05-10",status:"Not started",priority:"High"},
  {id:"a3",title:"CBD complaint analysis and customer comms",assignee:"Customer Team",dueDate:"2025-05-05",status:"Not started",priority:"Medium"},
];

const KPI_DATA: KPI[] = [
  {label:"Total Consumption",value:"2,829 kL",sub:"This month across all zones",icon:"💧",status:"normal"},
  {label:"Avg Leakage",value:"4.5%",sub:"Target: <4%",alert:true,status:"risk",icon:"📉"},
  {label:"Compliance Rate",value:"100%",sub:"All parameters pass",icon:"✅",status:"normal"},
  {label:"Active Alerts",value:"4",sub:"Pump station alerts",alert:true,status:"risk",icon:"🚨"},
  {label:"Open Incidents",value:"1",sub:"PS-03 pump failure",icon:"⚠",status:"risk"},
  {label:"Customer Complaints",value:"71",sub:"This month",alert:true,status:"watch",icon:"📣"},
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
  const totalConsumption = SAMPLE_ZONES.reduce((s,z)=>s+z.consumption,0);
  const avgLeakage = (SAMPLE_ZONES.reduce((s,z)=>s+z.leakage,0)/SAMPLE_ZONES.length).toFixed(1);
  const passRate = Math.round(SAMPLE_COMPLIANCE.filter(c=>c.status==="Pass").length/SAMPLE_COMPLIANCE.length*100);
  const activeAlerts = SAMPLE_PUMPS.reduce((s,p)=>s+p.alerts,0);
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24}}>
        <StatCard label="Total Consumption" value={`${(totalConsumption/1000).toFixed(0)} ML`} sub="This month across all zones"/>
        <StatCard label="Avg Leakage" value={`${avgLeakage}%`} sub="Target: <4%" color={parseFloat(avgLeakage)<=4?C.green:C.amber}/>
        <StatCard label="Compliance" value={`${passRate}%`} sub="Water quality parameters" color={passRate===100?C.green:C.red}/>
        <StatCard label="Active Alerts" value={String(activeAlerts)} sub="Pump station alerts" color={activeAlerts>0?C.red:C.green}/>
      </div>
      <div style={DC}>
        <p style={{fontWeight:700,marginBottom:20,color:T1}}>Monthly Consumption vs Target (kL)</p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={MONTHLY_CONSUMPTION}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
            <XAxis dataKey="month" tick={{fill:TICK,fontSize:12}}/><YAxis tickFormatter={v=>`${(v/1000).toFixed(0)}k`} tick={{fill:TICK,fontSize:12}}/>
            <Tooltip contentStyle={TT} formatter={(v:any)=>`${(Number(v)/1000).toFixed(0)} kL`}/><Legend wrapperStyle={{color:T2}}/>
            <Area type="monotone" dataKey="target" stroke={T3} fill="rgba(255,255,255,0.04)" name="Target" strokeDasharray="5 5"/>
            <Area type="monotone" dataKey="kL" stroke={C.blue} fill={`${C.blue}20`} name="Actual (kL)"/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ZonesTab() {
  return (
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
          {["Zone","Name","Type","Consumption (kL)","Budget (kL)","Leakage %","Pressure (kPa)","Customers","Complaints"].map(h=>(
            <th key={h} style={{padding:"10px 10px",textAlign:"left",color:T3,fontWeight:600,fontSize:11}}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_ZONES.map((z,i)=>(
            <tr key={z.id} style={{borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
              <td style={{padding:"11px 10px",fontWeight:700,fontFamily:"monospace",color:T1}}>{z.id}</td>
              <td style={{padding:"11px 10px",fontWeight:600,color:T1}}>{z.name}</td>
              <td style={{padding:"11px 10px",color:T2}}>{z.type}</td>
              <td style={{padding:"11px 10px",fontWeight:600,color:T1}}>{z.consumption.toLocaleString()}</td>
              <td style={{padding:"11px 10px",color:T2}}>{z.budget.toLocaleString()}</td>
              <td style={{padding:"11px 10px",fontWeight:700,color:z.leakage<=4?C.green:z.leakage<=7?C.amber:C.red}}>{z.leakage}%</td>
              <td style={{padding:"11px 10px",color:T2}}>{z.pressure}</td>
              <td style={{padding:"11px 10px",color:T2}}>{z.customers.toLocaleString()}</td>
              <td style={{padding:"11px 10px",color:z.complaints>15?C.red:z.complaints>5?C.amber:C.green,fontWeight:600}}>{z.complaints}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PumpStationsTab() {
  return (
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
          {["ID","Name","Location","Status","Efficiency","Runtime (hrs)","Last Service","Next Service","Alerts"].map(h=>(
            <th key={h} style={{padding:"10px 10px",textAlign:"left",color:T3,fontWeight:600,fontSize:11}}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_PUMPS.map((p,i)=>(
            <tr key={p.id} style={{borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
              <td style={{padding:"11px 10px",fontFamily:"monospace",fontWeight:700,color:T1}}>{p.id}</td>
              <td style={{padding:"11px 10px",fontWeight:600,color:T1}}>{p.name}</td>
              <td style={{padding:"11px 10px",color:T2}}>{p.location}</td>
              <td style={{padding:"11px 10px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:p.status==="Running"?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)",color:p.status==="Running"?C.green:C.red}}>{p.status}</span>
              </td>
              <td style={{padding:"11px 10px",fontWeight:700,color:p.efficiency>=85?C.green:p.efficiency>=70?C.amber:C.red}}>{p.efficiency>0?`${p.efficiency}%`:"—"}</td>
              <td style={{padding:"11px 10px",color:T2}}>{p.runtime.toLocaleString()}</td>
              <td style={{padding:"11px 10px",color:T2}}>{p.lastService}</td>
              <td style={{padding:"11px 10px",color:T2}}>{p.nextService}</td>
              <td style={{padding:"11px 10px",fontWeight:700,color:p.alerts>0?C.red:C.green}}>{p.alerts>0?`${p.alerts} ⚠`:"✓"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComplianceTab() {
  const passRate = Math.round(SAMPLE_COMPLIANCE.filter(c=>c.status==="Pass").length/SAMPLE_COMPLIANCE.length*100);
  return (<>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:24}}>
      <StatCard label="Tests Passed" value={`${SAMPLE_COMPLIANCE.filter(c=>c.status==="Pass").length}/${SAMPLE_COMPLIANCE.length}`} sub="All parameters" color={C.green}/>
      <StatCard label="Compliance Rate" value={`${passRate}%`} sub="ADWG 2022 targets" color={C.green}/>
      <StatCard label="Last Tested" value="22 Apr 2025" sub="ALS Laboratories"/>
    </div>
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
          {["Parameter","Result","Guideline Limit","Status","Sample Date","Laboratory"].map(h=>(
            <th key={h} style={{padding:"10px 12px",textAlign:"left",color:T3,fontWeight:600,fontSize:11}}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_COMPLIANCE.map((c,i)=>(
            <tr key={c.parameter} style={{borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
              <td style={{padding:"12px",fontWeight:600,color:T1}}>{c.parameter}</td>
              <td style={{padding:"12px",fontWeight:700,color:C.blue}}>{c.result}</td>
              <td style={{padding:"12px",color:T2}}>{c.limit}</td>
              <td style={{padding:"12px"}}><span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:"rgba(16,185,129,0.15)",color:C.green}}>✓ {c.status}</span></td>
              <td style={{padding:"12px",color:T2}}>{c.sampleDate}</td>
              <td style={{padding:"12px",color:T2}}>{c.lab}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function IncidentsTab() {
  return (
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
          {["ID","Type","Location","Severity","Duration (hrs)","Customers Affected","Resolved","Date"].map(h=>(
            <th key={h} style={{padding:"10px 10px",textAlign:"left",color:T3,fontWeight:600,fontSize:11}}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SAMPLE_INCIDENTS.map((inc,i)=>(
            <tr key={inc.id} style={{borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
              <td style={{padding:"11px 10px",fontFamily:"monospace",fontWeight:700,color:T1}}>{inc.id}</td>
              <td style={{padding:"11px 10px",fontWeight:600,color:T1}}>{inc.type}</td>
              <td style={{padding:"11px 10px",color:T2}}>{inc.location}</td>
              <td style={{padding:"11px 10px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:inc.severity==="High"?"rgba(239,68,68,0.15)":inc.severity==="Medium"?"rgba(245,158,11,0.15)":"rgba(100,116,139,0.2)",color:inc.severity==="High"?C.red:inc.severity==="Medium"?C.amber:C.slate}}>{inc.severity}</span>
              </td>
              <td style={{padding:"11px 10px",color:T2}}>{inc.duration}</td>
              <td style={{padding:"11px 10px",color:T2}}>{inc.affected.toLocaleString()}</td>
              <td style={{padding:"11px 10px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:inc.resolved?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)",color:inc.resolved?C.green:C.red}}>{inc.resolved?"Resolved":"Open"}</span>
              </td>
              <td style={{padding:"11px 10px",color:T2}}>{inc.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeakageTab() {
  return (<>
    <div style={{...DC,marginBottom:20}}>
      <p style={{fontWeight:700,marginBottom:8,color:T1}}>Zone Leakage Trend (%)</p>
      <p style={{fontSize:12,color:T3,marginBottom:20}}>Target: &lt; 4% per zone. Z2 CBD above target for 6 consecutive months.</p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={LEAKAGE_TREND}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
          <XAxis dataKey="month" tick={{fill:TICK,fontSize:12}}/><YAxis domain={[0,10]} tickFormatter={v=>`${v}%`} tick={{fill:TICK,fontSize:12}}/>
          <Tooltip contentStyle={TT} formatter={(v:any)=>`${v}%`}/><Legend wrapperStyle={{color:T2}}/>
          <Line type="monotone" dataKey="Z1" stroke={C.green} strokeWidth={2} dot={{r:3}} name="Z1 Northern"/>
          <Line type="monotone" dataKey="Z2" stroke={C.red} strokeWidth={2.5} dot={{r:4}} name="Z2 CBD"/>
          <Line type="monotone" dataKey="Z3" stroke={C.blue} strokeWidth={2} dot={{r:3}} name="Z3 Industrial"/>
          <Line type="monotone" dataKey="Z4" stroke={C.amber} strokeWidth={2} dot={{r:3}} name="Z4 Southern"/>
          <Line type="monotone" dataKey="Z5" stroke={C.indigo} strokeWidth={2} dot={{r:3}} name="Z5 Eastern"/>
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div style={DC}>
      <p style={{fontWeight:700,marginBottom:20,color:T1}}>Current Leakage by Zone</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={SAMPLE_ZONES}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
          <XAxis dataKey="name" tick={{fill:TICK,fontSize:11}}/><YAxis tickFormatter={v=>`${v}%`} tick={{fill:TICK,fontSize:12}} domain={[0,10]}/>
          <Tooltip contentStyle={TT} formatter={(v:any)=>`${v}%`}/>
          <Bar dataKey="leakage" name="Leakage %" radius={[4,4,0,0]}>
            {SAMPLE_ZONES.map((z,i)=><Cell key={i} fill={z.leakage<=4?C.green:z.leakage<=7?C.amber:C.red}/>)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </>);
}

function PressureTab() {
  return (<>
    <div style={{...DC,marginBottom:20}}>
      <p style={{fontWeight:700,marginBottom:20,color:T1}}>Pressure Zone Summary</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={PRESSURE_ZONES}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
          <XAxis dataKey="zone" tick={{fill:TICK,fontSize:11}}/><YAxis domain={[50,85]} tick={{fill:TICK,fontSize:12}} label={{value:"kPa",angle:-90,position:"insideLeft",fontSize:12,fill:T3}}/>
          <Tooltip contentStyle={TT} formatter={(v:any)=>`${v} kPa`}/><Legend wrapperStyle={{color:T2}}/>
          <Bar dataKey="minPressure" fill={C.indigo} name="Min"/>
          <Bar dataKey="avgPressure" fill={C.blue} name="Avg"/>
          <Bar dataKey="maxPressure" fill={C.amber} name="Max" radius={[4,4,0,0]}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div style={DC}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:`2px solid ${BORDER}`}}>
          {["Zone","Min (kPa)","Max (kPa)","Avg (kPa)","Target","Complaints","Status"].map(h=>(
            <th key={h} style={{padding:"10px 12px",textAlign:"left",color:T3,fontWeight:600,fontSize:11}}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {PRESSURE_ZONES.map((p,i)=>{
            const ok = p.avgPressure>=40&&p.avgPressure<=80;
            return (
              <tr key={p.zone} style={{borderBottom:`1px solid ${ROW_BDR}`,background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
                <td style={{padding:"12px",fontWeight:700,color:T1}}>{p.zone}</td>
                <td style={{padding:"12px",color:T2}}>{p.minPressure}</td>
                <td style={{padding:"12px",color:T2}}>{p.maxPressure}</td>
                <td style={{padding:"12px",fontWeight:700,color:C.blue}}>{p.avgPressure}</td>
                <td style={{padding:"12px",color:T2}}>{p.target}</td>
                <td style={{padding:"12px",color:p.complaints>20?C.red:T2}}>{p.complaints}</td>
                <td style={{padding:"12px"}}>
                  <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:ok?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)",color:ok?C.green:C.red}}>{ok?"Within Range":"Out of Range"}</span>
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
  {label:"Zones",content:<ZonesTab/>},
  {label:"Pump Stations",content:<PumpStationsTab/>},
  {label:"Water Quality",content:<ComplianceTab/>},
  {label:"Incidents",content:<IncidentsTab/>},
  {label:"Leakage Analysis",content:<LeakageTab/>},
  {label:"Pressure Management",content:<PressureTab/>},
];

export default function WaterDashboard() {
  return (
    <DashboardShell
      theme="dark"
      title="Water & Utilities Intelligence"
      subtitle="Network performance · Compliance · Pump stations · Incidents"
      headerColor="#0c4a6e"
      accentColor="#06b6d4"
      breadcrumbLabel="Water & Utilities"
      kpis={KPI_DATA}
      recommendedActions={[
        {title:"Investigate CBD Zone 2 leakage ($68.4k annual water loss)",explanation:"Leakage rate of 6.8% — highest in the network, 70% above target, and trending flat for 6 months. Aging mains the likely cause — no detection survey in 4 years.",impact:"$68,400 annual non-revenue water saving + regulatory risk reduction",priority:"High"},
        {title:"Restore PS-03 pump (280 customers offline, SLA breach imminent)",explanation:"Pump in maintenance with 3 active alerts and 280 industrial customers affected. INC-004 unresolved at 18+ hours — SLA breach threshold approaching.",impact:"Restore 280 industrial customers, prevent SLA breach",priority:"High"},
        {title:"Service PS-02 CBD booster (recover 5% efficiency, save $12k/year)",explanation:"Runtime at 2,140 hours with 1 active alert — overdue for inspection. Efficiency at 79%, 8 points below network average and contributing to CBD pressure issues.",impact:"$12,000/year energy saving on restored pump efficiency",priority:"Medium"},
        {title:"Audit Zone 4 leakage (recover $42k in non-revenue water)",explanation:"Zone 4 leakage at 5.4% despite adequate pressure — root cause likely aging mains. Camera inspection will determine repair vs replacement decision.",impact:"Est. $42,000 non-revenue water reduction",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"CBD Zone Z2 leakage at 6.8% — 70% above the 4% network target, $68.4k annual water loss",cause:"Aging mains (pre-2000) with no acoustic leak detection survey conducted in 4 years — root cause undetected",recommendation:"Commission acoustic leak detection within 30 days; prioritise mains replacement in 5-year capital plan",severity:"High"},
        {problem:"PS-03 Industrial pump failure unresolved at 18+ hours, 280 customers without supply",cause:"No redundancy pump at Industrial Park station — single-pump configuration creates single point of failure",recommendation:"Source backup pump on emergency hire today; review redundancy specifications for all stations this FY",severity:"High"},
        {problem:"Customer complaints at 71 this month — 42% above the 50-complaint monthly target",cause:"Pressure fluctuations in CBD during peak demand 7–9am causing supply interruptions across 120+ properties",recommendation:"Install demand management controls on PS-02 booster and communicate improvement timeline to residents",severity:"Medium"},
      ]}
      overviewContent={<OverviewContent/>}
      industryTabs={INDUSTRY_TABS}
      sampleData={{Zones:SAMPLE_ZONES,"Pump Stations":SAMPLE_PUMPS,Compliance:SAMPLE_COMPLIANCE,Incidents:SAMPLE_INCIDENTS}}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="Water & Utilities dashboard. 5 zones, 614 kL/month total. Average leakage 4.5% (target <4%). Z2 CBD at 6.8% — persistent issue. PS-03 pump in maintenance, 4 active alerts. 100% water quality compliance."
      executiveSummary="PS-03 has been offline for 18+ hours with 280 industrial customers affected, CBD Zone 2 leakage at 6.8% is costing $68.4k annually, and complaints are 42% above the monthly target — three concurrent service failures requiring immediate escalation."
      snapshotPanel={{ topCostDriver: 'CBD Zone Z2 non-revenue water — $68,400 annual loss at 6.8% leakage rate', biggestRisk: 'PS-03 Industrial pump offline 18+ hours — 280 customers, SLA breach imminent', savingsIdentified: 122400, confidence: 89, lastUpdated: 'Apr 2026' }}
    />
  );
}

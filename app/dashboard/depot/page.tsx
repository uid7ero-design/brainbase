'use client';

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, IndustryTab, InsightCard } from '@/components/dashboard/DashboardShell';

const SAMPLE_BAYS = [
  { id: 'B01', type: 'Heavy Vehicle', capacity: 4, occupied: 3, utilisation: 75, avgTurnaround: 42 },
  { id: 'B02', type: 'Light Vehicle', capacity: 8, occupied: 6, utilisation: 75, avgTurnaround: 18 },
  { id: 'B03', type: 'Fuel & Wash',   capacity: 3, occupied: 1, utilisation: 33, avgTurnaround: 12 },
  { id: 'B04', type: 'Workshop',      capacity: 6, occupied: 6, utilisation: 100, avgTurnaround: 240 },
  { id: 'B05', type: 'Storage',       capacity: 10, occupied: 7, utilisation: 70, avgTurnaround: 0 },
  { id: 'B06', type: 'Trailer Park',  capacity: 12, occupied: 9, utilisation: 75, avgTurnaround: 0 },
];

const SAMPLE_PRESTARTS = [
  { id: 'PS001', vehicle: 'TRK-001', driver: 'B. Harris', date: '2025-04-25', time: '06:05', result: 'Pass', defects: 0 },
  { id: 'PS002', vehicle: 'TRK-002', driver: 'K. Wong',   date: '2025-04-25', time: '06:12', result: 'Fail', defects: 2 },
  { id: 'PS003', vehicle: 'LV-041',  driver: 'S. Patel',  date: '2025-04-25', time: '06:18', result: 'Pass', defects: 0 },
  { id: 'PS004', vehicle: 'EXC-007', driver: 'M. Russo',  date: '2025-04-25', time: '06:25', result: 'Pass', defects: 1 },
  { id: 'PS005', vehicle: 'TRK-008', driver: 'J. Tan',    date: '2025-04-25', time: '06:31', result: 'Pass', defects: 0 },
  { id: 'PS006', vehicle: 'LV-052',  driver: 'A. Singh',  date: '2025-04-25', time: '06:37', result: 'Pass', defects: 0 },
];

const SAMPLE_THROUGHPUT = [
  { day: 'Mon', vehicles: 34, avgTime: 28 },
  { day: 'Tue', vehicles: 41, avgTime: 31 },
  { day: 'Wed', vehicles: 38, avgTime: 25 },
  { day: 'Thu', vehicles: 45, avgTime: 33 },
  { day: 'Fri', vehicles: 52, avgTime: 38 },
  { day: 'Sat', vehicles: 22, avgTime: 20 },
  { day: 'Sun', vehicles: 8,  avgTime: 15 },
];

const SAMPLE_INCIDENTS = [
  { id: 'INC-001', date: '2025-04-22', type: 'Near Miss',      location: 'Bay B04',    severity: 'Low',    status: 'Closed' },
  { id: 'INC-002', date: '2025-04-18', type: 'Property Damage',location: 'Entry Gate', severity: 'Medium', status: 'Open' },
  { id: 'INC-003', date: '2025-04-10', type: 'Spill',          location: 'Fuel Bay',   severity: 'Medium', status: 'Closed' },
  { id: 'INC-004', date: '2025-03-30', type: 'Near Miss',      location: 'Yard',       severity: 'Low',    status: 'Closed' },
];

const PIE_COLORS = ['#7c3aed', '#a78bfa', '#ddd6fe', '#4c1d95', '#c084fc', '#6d28d9'];

const MONTHLY_TREND: MonthlyPoint[] = [
  {month:"Oct",actual:84000,budget:80000,prevYear:72000},
  {month:"Nov",actual:92000,budget:88000,prevYear:76000},
  {month:"Dec",actual:96000,budget:92000,prevYear:80000},
  {month:"Jan",actual:88000,budget:90000,prevYear:74000},
  {month:"Feb",actual:94000,budget:92000,prevYear:78000},
  {month:"Mar",actual:98000,budget:95000,prevYear:82000},
];

const COST_ACCOUNTS: CostAccount[] = [
  {account:"Labour – Depot Staff",budget:420000,actual:434000},
  {account:"Fuel & Lubricants",budget:280000,actual:298000},
  {account:"Workshop Consumables",budget:96000,actual:88000},
  {account:"Yard Maintenance",budget:120000,actual:114000},
  {account:"Safety & Compliance",budget:48000,actual:52000},
];

const SLA_TARGETS: SLATarget[] = [
  {kpi:"Pre-Start Pass Rate",target:"≥ 95%",actual:"83%",status:"Missed",note:"TRK-002 failed — defects being rectified"},
  {kpi:"Bay Utilisation",target:"70–90%",actual:"71%",status:"Met"},
  {kpi:"Avg Vehicle Turnaround",target:"< 35 min",actual:"31 min",status:"Met"},
  {kpi:"Incident-Free Days",target:"≥ 14 days",actual:"3 days",status:"Missed",note:"Property damage incident 18 Apr"},
  {kpi:"Workshop Throughput",target:"≥ 40 vehicles/day",actual:"45",status:"Met"},
  {kpi:"Compliance Checks Current",target:"100%",actual:"95%",status:"At Risk"},
];

const DEFAULT_ACTIONS: Action[] = [
  {id:"a1",title:"Rectify TRK-002 pre-start defects",assignee:"Workshop",dueDate:"2025-04-26",status:"In progress",priority:"High"},
  {id:"a2",title:"Investigate property damage at entry gate",assignee:"Safety Officer",dueDate:"2025-04-28",status:"Not started",priority:"High"},
  {id:"a3",title:"Review workshop bay capacity — B04 at 100%",assignee:"Depot Manager",dueDate:"2025-05-05",status:"Not started",priority:"Medium"},
];

const KPI_DATA: KPI[] = [
  {label:"Avg Bay Utilisation",value:"71%",sub:`${SAMPLE_BAYS.length} bays total`,icon:"🏭",status:"normal"},
  {label:"Pre-Start Pass Rate",value:"83%",sub:"Target: ≥95%",alert:true,status:"risk",icon:"🔍"},
  {label:"Defects Raised",value:"3",sub:"Today",status:"watch",icon:"🔧"},
  {label:"Daily Throughput",value:"45",sub:"Vehicles today",icon:"🚗",status:"normal"},
  {label:"Avg Turnaround",value:"31 min",sub:"All vehicle types",icon:"⏱",status:"normal"},
  {label:"Open Incidents",value:"1",sub:"Requires action",alert:true,status:"watch",icon:"⚠"},
];

const darkCard = {background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:20};
const darkText = {color:"rgba(255,255,255,0.5)"};

function OverviewContent() {
  return (
    <div style={{background:"#0f0f0f",borderRadius:12,padding:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:16,marginBottom:24}}>
        {[
          {label:"Bay Utilisation",value:`${Math.round(SAMPLE_BAYS.reduce((s,b)=>s+b.utilisation,0)/SAMPLE_BAYS.length)}%`,sub:`${SAMPLE_BAYS.length} bays`},
          {label:"Pre-Start Pass Rate",value:`${Math.round(SAMPLE_PRESTARTS.filter(p=>p.result==="Pass").length/SAMPLE_PRESTARTS.length*100)}%`,sub:"Today"},
          {label:"Defects Raised",value:SAMPLE_PRESTARTS.reduce((s,p)=>s+p.defects,0),sub:"Today"},
          {label:"Daily Throughput",value:45,sub:"Vehicles today"},
          {label:"Avg Turnaround",value:"31 min",sub:"All vehicle types"},
          {label:"Open Incidents",value:SAMPLE_INCIDENTS.filter(i=>i.status==="Open").length,sub:"Require action"},
        ].map(k=>(
          <div key={k.label} style={{...darkCard,padding:16}}>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>{k.label}</div>
            <div style={{fontSize:26,fontWeight:700,color:"#a78bfa"}}>{k.value}</div>
            <div style={{fontSize:12,...darkText,marginTop:4}}>{k.sub}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <div style={darkCard}>
          <h3 style={{margin:"0 0 16px",fontSize:14,color:"#e5e7eb"}}>Bay Type Utilisation</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={SAMPLE_BAYS}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
              <XAxis dataKey="type" tick={{fill:"rgba(255,255,255,0.4)",fontSize:10}}/>
              <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1a1a2e",border:"none",borderRadius:8}}/>
              <Bar dataKey="utilisation" fill="#7c3aed" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={darkCard}>
          <h3 style={{margin:"0 0 16px",fontSize:14,color:"#e5e7eb"}}>Weekly Throughput</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={SAMPLE_THROUGHPUT}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
              <XAxis dataKey="day" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}}/>
              <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}}/>
              <Tooltip contentStyle={{background:"#1a1a2e",border:"none",borderRadius:8}}/>
              <Line type="monotone" dataKey="vehicles" stroke="#a78bfa" strokeWidth={2} dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={darkCard}>
          <h3 style={{margin:"0 0 16px",fontSize:14,color:"#e5e7eb"}}>Bay Capacity Split</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={SAMPLE_BAYS} dataKey="capacity" nameKey="type" cx="50%" cy="50%" outerRadius={80}>
                {SAMPLE_BAYS.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
              </Pie>
              <Tooltip contentStyle={{background:"#1a1a2e",border:"none",borderRadius:8}}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={darkCard}>
          <h3 style={{margin:"0 0 16px",fontSize:14,color:"#e5e7eb"}}>Pre-Start Results (Today)</h3>
          <div style={{display:"flex",gap:20,marginBottom:12}}>
            <div style={{textAlign:"center"}}><div style={{fontSize:32,fontWeight:700,color:"#4ade80"}}>{SAMPLE_PRESTARTS.filter(p=>p.result==="Pass").length}</div><div style={{fontSize:12,...darkText}}>Pass</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:32,fontWeight:700,color:"#f87171"}}>{SAMPLE_PRESTARTS.filter(p=>p.result==="Fail").length}</div><div style={{fontSize:12,...darkText}}>Fail</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:32,fontWeight:700,color:"#fbbf24"}}>{SAMPLE_PRESTARTS.reduce((s,p)=>s+p.defects,0)}</div><div style={{fontSize:12,...darkText}}>Defects</div></div>
          </div>
          {SAMPLE_PRESTARTS.slice(0,4).map(p=>(
            <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:13,color:"#e5e7eb"}}>
              <span>{p.vehicle} — {p.driver}</span>
              <span style={{color:p.result==="Pass"?"#4ade80":"#f87171",fontWeight:600}}>{p.result}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BaysTab() {
  return (
    <div style={{...darkCard,background:"#0f0f0f",padding:0,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,color:"#e5e7eb"}}>
        <thead><tr style={{background:"rgba(255,255,255,0.06)"}}>
          {["Bay","Type","Capacity","Occupied","Utilisation %","Avg Turnaround (min)"].map(h=>(
            <th key={h} style={{padding:"12px 16px",textAlign:"left",fontSize:12,color:"rgba(255,255,255,0.5)",fontWeight:600}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>{SAMPLE_BAYS.map((b,i)=>(
          <tr key={b.id} style={{borderBottom:"1px solid rgba(255,255,255,0.05)",background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
            <td style={{padding:"12px 16px"}}>{b.id}</td>
            <td style={{padding:"12px 16px"}}>{b.type}</td>
            <td style={{padding:"12px 16px"}}>{b.capacity}</td>
            <td style={{padding:"12px 16px"}}>{b.occupied}</td>
            <td style={{padding:"12px 16px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:80,height:6,background:"rgba(255,255,255,0.1)",borderRadius:3}}>
                  <div style={{width:`${b.utilisation}%`,height:"100%",background:b.utilisation>=100?"#f87171":"#7c3aed",borderRadius:3}}/>
                </div>
                <span>{b.utilisation}%</span>
              </div>
            </td>
            <td style={{padding:"12px 16px"}}>{b.avgTurnaround||"—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function PreStartsTab() {
  return (
    <div style={{...darkCard,background:"#0f0f0f",padding:0,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,color:"#e5e7eb"}}>
        <thead><tr style={{background:"rgba(255,255,255,0.06)"}}>
          {["ID","Vehicle","Driver","Date","Time","Result","Defects"].map(h=>(
            <th key={h} style={{padding:"12px 16px",textAlign:"left",fontSize:12,color:"rgba(255,255,255,0.5)",fontWeight:600}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>{SAMPLE_PRESTARTS.map((p,i)=>(
          <tr key={p.id} style={{borderBottom:"1px solid rgba(255,255,255,0.05)",background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
            <td style={{padding:"12px 16px",color:"rgba(255,255,255,0.5)"}}>{p.id}</td>
            <td style={{padding:"12px 16px",fontWeight:600}}>{p.vehicle}</td>
            <td style={{padding:"12px 16px"}}>{p.driver}</td>
            <td style={{padding:"12px 16px"}}>{p.date}</td>
            <td style={{padding:"12px 16px"}}>{p.time}</td>
            <td style={{padding:"12px 16px"}}>
              <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600,background:p.result==="Pass"?"rgba(74,222,128,0.15)":"rgba(248,113,113,0.15)",color:p.result==="Pass"?"#4ade80":"#f87171"}}>{p.result}</span>
            </td>
            <td style={{padding:"12px 16px"}}>{p.defects}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ThroughputTab() {
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,background:"#0f0f0f",padding:16,borderRadius:12}}>
      <div style={darkCard}>
        <h3 style={{margin:"0 0 16px",fontSize:14,color:"#e5e7eb"}}>Vehicles Processed per Day</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={SAMPLE_THROUGHPUT}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
            <XAxis dataKey="day" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}}/>
            <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}}/>
            <Tooltip contentStyle={{background:"#1a1a2e",border:"none",borderRadius:8}}/>
            <Bar dataKey="vehicles" fill="#7c3aed" radius={[4,4,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={darkCard}>
        <h3 style={{margin:"0 0 16px",fontSize:14,color:"#e5e7eb"}}>Avg Turnaround Time (min)</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={SAMPLE_THROUGHPUT}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
            <XAxis dataKey="day" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}}/>
            <YAxis tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}}/>
            <Tooltip contentStyle={{background:"#1a1a2e",border:"none",borderRadius:8}}/>
            <Line type="monotone" dataKey="avgTime" stroke="#c084fc" strokeWidth={2} dot={{fill:"#7c3aed"}}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function IncidentsTab() {
  return (
    <div style={{...darkCard,background:"#0f0f0f",padding:0,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,color:"#e5e7eb"}}>
        <thead><tr style={{background:"rgba(255,255,255,0.06)"}}>
          {["ID","Date","Type","Location","Severity","Status"].map(h=>(
            <th key={h} style={{padding:"12px 16px",textAlign:"left",fontSize:12,color:"rgba(255,255,255,0.5)",fontWeight:600}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>{SAMPLE_INCIDENTS.map((inc,i)=>(
          <tr key={inc.id} style={{borderBottom:"1px solid rgba(255,255,255,0.05)",background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
            <td style={{padding:"12px 16px",color:"rgba(255,255,255,0.5)"}}>{inc.id}</td>
            <td style={{padding:"12px 16px"}}>{inc.date}</td>
            <td style={{padding:"12px 16px"}}>{inc.type}</td>
            <td style={{padding:"12px 16px"}}>{inc.location}</td>
            <td style={{padding:"12px 16px"}}>
              <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600,background:inc.severity==="High"?"rgba(248,113,113,0.15)":inc.severity==="Medium"?"rgba(251,191,36,0.15)":"rgba(74,222,128,0.15)",color:inc.severity==="High"?"#f87171":inc.severity==="Medium"?"#fbbf24":"#4ade80"}}>{inc.severity}</span>
            </td>
            <td style={{padding:"12px 16px"}}>
              <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600,background:inc.status==="Open"?"rgba(251,191,36,0.15)":"rgba(255,255,255,0.08)",color:inc.status==="Open"?"#fbbf24":"rgba(255,255,255,0.5)"}}>{inc.status}</span>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const INDUSTRY_TABS: IndustryTab[] = [
  {label:"Bay Utilisation",content:<BaysTab/>},
  {label:"Pre-Starts",content:<PreStartsTab/>},
  {label:"Throughput",content:<ThroughputTab/>},
  {label:"Incidents",content:<IncidentsTab/>},
];

export default function DepotPage() {
  return (
    <DashboardShell
      theme="dark"
      title="Depot & Yard Operations"
      subtitle="Bay utilisation · Pre-starts · Yard throughput · Safety"
      headerColor="#3b0764"
      accentColor="#a78bfa"
      breadcrumbLabel="Depot & Yard Operations"
      kpis={KPI_DATA}
      recommendedActions={[
        {title:"Ground TRK-002 immediately — WHS breach and insurance invalidated",explanation:"Pre-start failure with 2 unresolved defects. Operating a defective vehicle violates WHS Act and invalidates insurance coverage — no formal stop-work issued yet.",impact:"Prevent worker safety incident and regulatory enforcement action",priority:"High"},
        {title:"Outsource workshop overflow (reduce 30–40 min turnaround per vehicle)",explanation:"Workshop bay B04 at 100% capacity — vehicles queuing in yard, reducing fleet availability. Engaging external overflow removes the bottleneck immediately.",impact:"30–40 minute turnaround reduction per vehicle; $8,400 annual defect saving",priority:"High"},
        {title:"Close pre-start compliance gap (save $8.4k annually in defect cost)",explanation:"Pass rate at 83% — below the 95% target. Repeat non-compliant assets or drivers unidentified due to no trend analysis in place.",impact:"Reduce defect rate by est. 25%, $8,400 annual saving",priority:"Medium"},
        {title:"Resolve entry gate incident — insurance claim window closing",explanation:"Property damage incident unresolved with liability exposure growing. Insurance claim documentation must be completed before the claim window closes.",impact:"Protect insurance claim and limit liability exposure",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"TRK-002 offline with no ETA — critical operations vehicle grounded, hydraulic parts 3-week lead time",cause:"Single-source supplier for hydraulic components; no safety stock held for top 10 failure items",recommendation:"Source parts on emergency basis today; dual-source suppliers and build 30-day buffer for critical components",severity:"High"},
        {problem:"Pre-start pass rate at 83% — 17% of vehicles entering service with unresolved defects",cause:"Inspection roster understaffed; no hard stop-work enforcement triggered on failed pre-start checks",recommendation:"Enforce stop-work on all pre-start failures immediately; engage agency staff to clear inspection backlog",severity:"High"},
        {problem:"Incident rate 2.1× above LTI target — 3 near-miss events in vehicle/pedestrian conflict zones",cause:"No hard separation barriers between vehicle movement and pedestrian zones at entry and fuel bay",recommendation:"Conduct site risk review within 7 days; install physical barriers before next operational shift",severity:"Medium"},
      ]}      overviewContent={<OverviewContent/>}
      industryTabs={INDUSTRY_TABS}
      sampleData={{Bays:SAMPLE_BAYS,"Pre-Starts":SAMPLE_PRESTARTS,Throughput:SAMPLE_THROUGHPUT,Incidents:SAMPLE_INCIDENTS}}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="Depot & Yard Operations dashboard. 6 bays at 71% avg utilisation. Workshop at 100% capacity. Pre-start pass rate 83% today (TRK-002 failed, 2 defects). 1 open incident — property damage at entry gate."
      executiveSummary="TRK-002 is grounded with a 3-week parts lead time, workshop is at 100% capacity, and pre-start compliance is at 83% — all three issues converge into rising WHS liability and reduced fleet availability."
      snapshotPanel={{ topCostDriver: 'Workshop bottleneck — 30–40 min turnaround premium per vehicle', biggestRisk: 'TRK-002 operating with unresolved defects — WHS breach and insurance invalidated', savingsIdentified: 8400, confidence: 91, lastUpdated: 'Apr 2026' }}
    />
  );
}

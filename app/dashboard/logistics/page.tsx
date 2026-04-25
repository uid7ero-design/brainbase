'use client';

import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, CartesianGrid, Legend } from "recharts";
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, IndustryTab, InsightCard } from "@/components/dashboard/DashboardShell";

const C = { blue:"#38bdf8", green:"#4ade80", amber:"#fbbf24", red:"#f87171", purple:"#a78bfa", cyan:"#22d3ee" };
const TT = { background:"#0d0f14", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10 };
const fmt = (n:number) => `$${n.toLocaleString("en-AU",{maximumFractionDigits:0})}`;

const T1 = "#F5F7FA";
const T2 = "rgba(230,237,243,0.55)";
const T3 = "rgba(230,237,243,0.35)";
const DC: React.CSSProperties = { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:20 };
const tbl: React.CSSProperties = { width:"100%", borderCollapse:"collapse", fontSize:13 };
const th: React.CSSProperties  = { padding:"10px 12px", textAlign:"left", color:T3, fontWeight:600, fontSize:11, letterSpacing:".05em" };
const td: React.CSSProperties  = { padding:"12px", color:T2 };
const GRID = "rgba(255,255,255,0.05)";
const TICK = { fill:T3, fontSize:12 };

const shipStatus: Record<string,[string,string]> = {
  Delivered:    ["rgba(74,222,128,0.12)", C.green],
  "In Transit": ["rgba(56,189,248,0.12)", C.blue],
  Delayed:      ["rgba(248,113,113,0.12)", C.red],
};
const impactStatus: Record<string,[string,string]> = {
  High:   ["rgba(248,113,113,0.12)",  C.red],
  Medium: ["rgba(245,158,11,0.12)",   C.amber],
  Low:    ["rgba(74,222,128,0.12)",  C.green],
};

function StatusBadge({ v, map }: { v:string; map:Record<string,[string,string]> }) {
  const [bg, color] = map[v] ?? ["rgba(255,255,255,0.08)", T3];
  return <span style={{ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:bg, color }}>{v}</span>;
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

const SHIPMENTS = [
  {id:"SH-001",origin:"Melbourne",dest:"Sydney",carrier:"FastFreight",weight:2400,cost:1840,status:"Delivered",days:2,onTime:true},
  {id:"SH-002",origin:"Sydney",dest:"Brisbane",carrier:"NorthRun",weight:1800,cost:1220,status:"In Transit",days:1,onTime:true},
  {id:"SH-003",origin:"Perth",dest:"Adelaide",carrier:"WestLink",weight:3100,cost:2650,status:"Delayed",days:4,onTime:false},
  {id:"SH-004",origin:"Melbourne",dest:"Adelaide",carrier:"FastFreight",weight:950,cost:710,status:"Delivered",days:1,onTime:true},
  {id:"SH-005",origin:"Brisbane",dest:"Cairns",carrier:"NorthRun",weight:2200,cost:1980,status:"Delivered",days:3,onTime:false},
  {id:"SH-006",origin:"Sydney",dest:"Melbourne",carrier:"SouthExpress",weight:4100,cost:2100,status:"In Transit",days:1,onTime:true},
  {id:"SH-007",origin:"Adelaide",dest:"Melbourne",carrier:"FastFreight",weight:1500,cost:980,status:"Delivered",days:2,onTime:true},
  {id:"SH-008",origin:"Melbourne",dest:"Hobart",carrier:"IslandRun",weight:780,cost:1240,status:"Delayed",days:5,onTime:false},
];

const CARRIERS = [
  {name:"FastFreight",shipments:142,onTime:94,avgCost:1210,damage:2,rating:4.7},
  {name:"NorthRun",shipments:98,onTime:88,avgCost:1640,damage:5,rating:4.2},
  {name:"WestLink",shipments:74,onTime:79,avgCost:2100,damage:8,rating:3.8},
  {name:"SouthExpress",shipments:115,onTime:91,avgCost:980,damage:3,rating:4.5},
  {name:"IslandRun",shipments:31,onTime:71,avgCost:1480,damage:12,rating:3.4},
];

const MONTHLY = [
  {month:"Oct",shipments:82,cost:98400,onTime:91},
  {month:"Nov",shipments:94,cost:112000,onTime:89},
  {month:"Dec",shipments:118,cost:141600,onTime:85},
  {month:"Jan",shipments:76,cost:91200,onTime:92},
  {month:"Feb",shipments:88,cost:105600,onTime:90},
  {month:"Mar",shipments:102,cost:122400,onTime:88},
];

const LANES = [
  {lane:"MEL–SYD",vol:148,avgCost:1840,transit:2.1,onTime:93},
  {lane:"SYD–BNE",vol:112,avgCost:1220,transit:1.8,onTime:90},
  {lane:"MEL–ADL",vol:96,avgCost:710,transit:1.2,onTime:95},
  {lane:"PER–ADL",vol:58,avgCost:2650,transit:3.8,onTime:76},
  {lane:"BNE–CNS",vol:44,avgCost:1980,transit:2.9,onTime:82},
  {lane:"SYD–MEL",vol:131,avgCost:2100,transit:1.9,onTime:91},
];

const EXCEPTIONS = [
  {id:"EX-001",shipment:"SH-003",reason:"Carrier capacity shortage",impact:"High",customer:"Pilbara Mining Co",delay:2,resolution:"Redirected via alternative carrier"},
  {id:"EX-002",shipment:"SH-008",reason:"Weather delay – Basslink",impact:"Medium",customer:"Tassie Timber",delay:3,resolution:"Awaiting clearance"},
  {id:"EX-003",shipment:"SH-005",reason:"Address query",impact:"Low",customer:"NQ Fresh",delay:1,resolution:"Resolved — redelivery scheduled"},
  {id:"EX-004",shipment:"SH-003",reason:"Customs documentation",impact:"High",customer:"Pilbara Mining Co",delay:1,resolution:"Documents lodged"},
];

const FUEL_SURCHARGE = [
  {carrier:"FastFreight",baseCost:1210,fuelSurcharge:121,total:1331,pct:10.0},
  {carrier:"NorthRun",baseCost:1640,fuelSurcharge:197,total:1837,pct:12.0},
  {carrier:"WestLink",baseCost:2100,fuelSurcharge:273,total:2373,pct:13.0},
  {carrier:"SouthExpress",baseCost:980,fuelSurcharge:108,total:1088,pct:11.0},
  {carrier:"IslandRun",baseCost:1480,fuelSurcharge:207,total:1687,pct:14.0},
];

const CUSTOMER_IMPACT = [
  {customer:"Pilbara Mining Co",shipments:38,onTime:76,delayed:9,complaints:4,csat:3.2},
  {customer:"NQ Fresh",shipments:52,onTime:90,delayed:5,complaints:1,csat:4.6},
  {customer:"Tassie Timber",shipments:24,onTime:71,delayed:7,complaints:6,csat:2.8},
  {customer:"Metro Retail",shipments:87,onTime:95,delayed:4,complaints:0,csat:4.9},
  {customer:"Outback Supplies",shipments:61,onTime:85,delayed:9,complaints:2,csat:4.1},
];

const MONTHLY_TREND: MonthlyPoint[] = [
  {month:"Oct",actual:98400,budget:95000,prevYear:89000},
  {month:"Nov",actual:112000,budget:108000,prevYear:98000},
  {month:"Dec",actual:141600,budget:130000,prevYear:118000},
  {month:"Jan",actual:91200,budget:95000,prevYear:84000},
  {month:"Feb",actual:105600,budget:100000,prevYear:96000},
  {month:"Mar",actual:122400,budget:115000,prevYear:108000},
];

const COST_ACCOUNTS: CostAccount[] = [
  {account:"FastFreight Contracts",budget:320000,actual:311000},
  {account:"NorthRun Contracts",budget:185000,actual:198000},
  {account:"WestLink Contracts",budget:160000,actual:171000},
  {account:"SouthExpress Contracts",budget:140000,actual:134000},
  {account:"IslandRun Contracts",budget:55000,actual:58800},
  {account:"Fuel Surcharges",budget:65000,actual:72400},
  {account:"Insurance & Claims",budget:30000,actual:27600},
];

const SLA_TARGETS: SLATarget[] = [
  {kpi:"Network On-Time Rate",target:"≥ 92%",actual:"88%",status:"At Risk",note:"Delayed lanes dragging average"},
  {kpi:"MEL–SYD On-Time",target:"≥ 93%",actual:"93%",status:"Met"},
  {kpi:"Damage Rate",target:"< 1%",actual:"0.8%",status:"Met"},
  {kpi:"Exception Resolution < 24h",target:"≥ 85%",actual:"72%",status:"Missed",note:"Basslink delays unresolved"},
  {kpi:"Customer Satisfaction",target:"≥ 4.0",actual:"3.9",status:"At Risk"},
  {kpi:"Cost per Shipment",target:"< $1,500",actual:"$1,462",status:"Met"},
];

const DEFAULT_ACTIONS: Action[] = [
  {id:"a1",title:"Review WestLink on-time SLA",assignee:"J. Nguyen",dueDate:"2025-04-30",status:"In progress",priority:"High"},
  {id:"a2",title:"Negotiate fuel surcharge cap with NorthRun",assignee:"L. Smith",dueDate:"2025-05-15",status:"Not started",priority:"Medium"},
  {id:"a3",title:"Set up IslandRun weekly review",assignee:"J. Nguyen",dueDate:"2025-05-01",status:"Not started",priority:"Medium"},
];

const KPI_DATA: KPI[] = [
  {label:"Total Shipments",value:"460",sub:"This quarter",icon:"📦",status:"normal"},
  {label:"On-Time Rate",value:"88%",sub:"Target: 92%",alert:true,status:"risk",icon:"⏱"},
  {label:"Freight Cost",value:"$672,800",sub:"This quarter",icon:"💰",status:"normal"},
  {label:"Active Delays",value:"3",sub:"Exceptional",alert:true,status:"watch",icon:"⚠"},
  {label:"Active Carriers",value:"5",sub:"Under contract",icon:"🚛",status:"normal"},
  {label:"Avg Cost / Shipment",value:"$1,462",sub:"Within target",icon:"📊",status:"normal"},
];

function OverviewContent() {
  const total     = SHIPMENTS.reduce((s,r)=>s+r.cost,0);
  const onTimePct = Math.round(SHIPMENTS.filter(s=>s.onTime).length/SHIPMENTS.length*100);
  const delayed   = SHIPMENTS.filter(s=>s.status==="Delayed").length;
  const pieData   = [
    {name:"On Time",value:onTimePct,   fill:C.green},
    {name:"Late",   value:100-onTimePct, fill:C.red},
  ];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20, color:T1 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16 }}>
        <StatCard label="Total Shipments" value="460"             sub="This quarter"  />
        <StatCard label="On-Time Rate"    value={`${onTimePct}%`} sub="Target: 92%"   color={onTimePct>=92?C.green:C.amber} />
        <StatCard label="Freight Cost"    value={fmt(total*14)}   sub="This quarter"  />
        <StatCard label="Delayed"         value={String(delayed)} sub="Active delays" color={C.red} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:20 }}>
        <div style={DC}>
          <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Monthly Shipment Volume</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={MONTHLY}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="month" tick={TICK} axisLine={false} tickLine={false} />
              <YAxis tick={TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ color:T2, fontSize:12 }} />
              <Bar dataKey="shipments" fill={C.blue} name="Shipments" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={DC}>
          <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>On-Time Performance</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value">
                {pieData.map((e,i)=><Cell key={i} fill={e.fill}/>)}
              </Pie>
              <Tooltip contentStyle={TT} formatter={(v:any)=>`${v}%`} />
              <Legend wrapperStyle={{ color:T2, fontSize:12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={DC}>
        <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>On-Time Rate Trend</p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={MONTHLY}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="month" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis domain={[80,100]} tick={TICK} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TT} formatter={(v:any)=>`${v}%`} />
            <Line type="monotone" dataKey="onTime" stroke={C.green} strokeWidth={2.5} dot={{ r:4 }} name="On-Time %" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ShipmentsTab() {
  const [search, setSearch] = useState("");
  return (
    <div style={DC}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <p style={{ fontWeight:700, fontSize:16, color:T1 }}>Active Shipments</p>
        <input
          placeholder="Search…"
          value={search}
          onChange={e=>setSearch(e.target.value)}
          style={{ padding:"8px 14px", borderRadius:8, border:"1px solid rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.05)", color:T1, fontSize:13, outline:"none" }}
        />
      </div>
      <table style={tbl}>
        <thead><tr style={{ borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          {["ID","Origin","Destination","Carrier","Weight (kg)","Cost","Days","Status"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {SHIPMENTS.filter(s=>!search||s.id.toLowerCase().includes(search.toLowerCase())||s.carrier.toLowerCase().includes(search.toLowerCase())).map((s,i)=>(
            <tr key={s.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontWeight:700, fontFamily:"monospace", color:T1 }}>{s.id}</td>
              <td style={td}>{s.origin}</td>
              <td style={td}>{s.dest}</td>
              <td style={{ padding:"12px", color:T2 }}>{s.carrier}</td>
              <td style={td}>{s.weight.toLocaleString()}</td>
              <td style={{ padding:"12px", fontWeight:600, color:T1 }}>{fmt(s.cost)}</td>
              <td style={td}>{s.days}d</td>
              <td style={{ padding:"12px" }}><StatusBadge v={s.status} map={shipStatus} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CarriersTab() {
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:20 }}>
      <StatCard label="Carriers"      value={String(CARRIERS.length)} sub="Active contracts"   />
      <StatCard label="Best On-Time"  value="FastFreight"              sub="94% on-time"        color={C.green} />
      <StatCard label="Damage Claims" value="30"                       sub="This quarter"       color={C.red} />
    </div>
    <div style={{ ...DC, marginBottom:20 }}>
      <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Carrier On-Time Performance</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={CARRIERS} layout="vertical">
          <XAxis type="number" domain={[0,100]} tick={TICK} tickFormatter={v=>`${v}%`} axisLine={false} tickLine={false} />
          <YAxis dataKey="name" type="category" tick={{ fill:T2, fontSize:12 }} width={100} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT} formatter={(v:any)=>`${v}%`} />
          <Bar dataKey="onTime" fill={C.blue} name="On-Time %" radius={[0,4,4,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div style={DC}>
      <table style={tbl}>
        <thead><tr style={{ borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          {["Carrier","Shipments","On-Time %","Avg Cost","Damage Claims","Rating"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {CARRIERS.map((c,i)=>(
            <tr key={c.name} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontWeight:700, color:T1 }}>{c.name}</td>
              <td style={td}>{c.shipments}</td>
              <td style={{ padding:"12px" }}><span style={{ color:c.onTime>=90?C.green:c.onTime>=80?C.amber:C.red, fontWeight:700 }}>{c.onTime}%</span></td>
              <td style={{ padding:"12px", color:T2 }}>{fmt(c.avgCost)}</td>
              <td style={{ padding:"12px", color:c.damage>5?C.red:T3 }}>{c.damage}</td>
              <td style={{ padding:"12px", fontWeight:600, color:T1 }}>{"★".repeat(Math.round(c.rating))} {c.rating}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function LanesTab() {
  return (<>
    <div style={{ ...DC, marginBottom:20 }}>
      <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Volume by Lane</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={LANES}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="lane" tick={TICK} axisLine={false} tickLine={false} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT} />
          <Bar dataKey="vol" fill={C.purple} name="Shipments" radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div style={DC}>
      <table style={tbl}>
        <thead><tr style={{ borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          {["Lane","Volume","Avg Cost","Avg Transit (days)","On-Time %"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {LANES.map((l,i)=>(
            <tr key={l.lane} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontWeight:700, fontFamily:"monospace", color:T1 }}>{l.lane}</td>
              <td style={td}>{l.vol}</td>
              <td style={{ padding:"12px", fontWeight:600, color:T1 }}>{fmt(l.avgCost)}</td>
              <td style={td}>{l.transit}d</td>
              <td style={{ padding:"12px" }}><span style={{ color:l.onTime>=90?C.green:l.onTime>=80?C.amber:C.red, fontWeight:700 }}>{l.onTime}%</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function CostAnalysisTab() {
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:20 }}>
      <StatCard label="Quarterly Spend"   value={fmt(672800)} sub="Apr–Jun 2025"             />
      <StatCard label="Cost per Shipment" value={fmt(1462)}   sub="Avg across all carriers"  />
      <StatCard label="Budget Variance"   value="+4.2%"       sub="Over budget"              color={C.red} />
    </div>
    <div style={DC}>
      <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Monthly Freight Cost</p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={MONTHLY}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="month" tick={TICK} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={TICK} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT} formatter={(v:any)=>fmt(v)} />
          <Bar dataKey="cost" fill={C.amber} name="Freight Cost" radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </>);
}

function ExceptionsTab() {
  return (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:20 }}>
      <StatCard label="Open Exceptions" value="2"         sub="Awaiting resolution"  color={C.red} />
      <StatCard label="Avg Delay"       value="1.75 days" sub="Per exception"         />
      <StatCard label="High Impact"     value="2"         sub="Customer-affecting"    color={C.amber} />
    </div>
    <div style={DC}>
      <p style={{ fontWeight:700, marginBottom:20, fontSize:16, color:T1 }}>Exception Register</p>
      <table style={tbl}>
        <thead><tr style={{ borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          {["Ref","Shipment","Reason","Impact","Customer","Delay","Resolution"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {EXCEPTIONS.map((e,i)=>(
            <tr key={e.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontWeight:700, fontFamily:"monospace", color:T1 }}>{e.id}</td>
              <td style={td}>{e.shipment}</td>
              <td style={{ padding:"12px", color:T2 }}>{e.reason}</td>
              <td style={{ padding:"12px" }}><StatusBadge v={e.impact} map={impactStatus} /></td>
              <td style={td}>{e.customer}</td>
              <td style={{ padding:"12px", color:C.red, fontWeight:600 }}>{e.delay}d</td>
              <td style={{ padding:"12px", color:T3, fontSize:12 }}>{e.resolution}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function FuelSurchargeTab() {
  return (<>
    <div style={{ ...DC, marginBottom:20 }}>
      <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Fuel Surcharge by Carrier</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={FUEL_SURCHARGE}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="carrier" tick={TICK} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={v=>`$${v}`} tick={TICK} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT} formatter={(v:any)=>fmt(v)} />
          <Legend wrapperStyle={{ color:T2, fontSize:12 }} />
          <Bar dataKey="baseCost"      fill={C.blue}  name="Base Rate"      stackId="a" />
          <Bar dataKey="fuelSurcharge" fill={C.amber} name="Fuel Surcharge" stackId="a" radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div style={DC}>
      <table style={tbl}>
        <thead><tr style={{ borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          {["Carrier","Base Cost","Fuel Surcharge","Total","Surcharge %"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {FUEL_SURCHARGE.map((r,i)=>(
            <tr key={r.carrier} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontWeight:700, color:T1 }}>{r.carrier}</td>
              <td style={{ padding:"12px", color:T2 }}>{fmt(r.baseCost)}</td>
              <td style={{ padding:"12px", color:C.amber, fontWeight:600 }}>{fmt(r.fuelSurcharge)}</td>
              <td style={{ padding:"12px", fontWeight:700, color:T1 }}>{fmt(r.total)}</td>
              <td style={{ padding:"12px", color:r.pct>=13?C.red:C.amber, fontWeight:600 }}>{r.pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

function CustomerImpactTab() {
  return (<>
    <div style={{ ...DC, marginBottom:20 }}>
      <p style={{ fontWeight:700, marginBottom:20, color:T1 }}>Customer On-Time Rate</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={CUSTOMER_IMPACT} layout="vertical">
          <XAxis type="number" domain={[0,100]} tick={TICK} tickFormatter={v=>`${v}%`} axisLine={false} tickLine={false} />
          <YAxis dataKey="customer" type="category" tick={{ fill:T2, fontSize:12 }} width={120} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TT} formatter={(v:any)=>`${v}%`} />
          <Bar dataKey="onTime" fill={C.cyan} name="On-Time %" radius={[0,4,4,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div style={DC}>
      <table style={tbl}>
        <thead><tr style={{ borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          {["Customer","Shipments","On-Time %","Delayed","Complaints","CSAT"].map(h=>(
            <th key={h} style={th}>{h.toUpperCase()}</th>
          ))}
        </tr></thead>
        <tbody>
          {CUSTOMER_IMPACT.map((c,i)=>(
            <tr key={c.customer} style={{ borderBottom:"1px solid rgba(255,255,255,0.05)", background:i%2===0?"transparent":"rgba(255,255,255,0.02)" }}>
              <td style={{ padding:"12px", fontWeight:700, color:T1 }}>{c.customer}</td>
              <td style={td}>{c.shipments}</td>
              <td style={{ padding:"12px" }}><span style={{ color:c.onTime>=90?C.green:c.onTime>=80?C.amber:C.red, fontWeight:700 }}>{c.onTime}%</span></td>
              <td style={{ padding:"12px", color:c.delayed>5?C.red:T3 }}>{c.delayed}</td>
              <td style={{ padding:"12px", color:c.complaints>2?C.red:T3 }}>{c.complaints}</td>
              <td style={{ padding:"12px", fontWeight:700, color:c.csat>=4?C.green:c.csat>=3?C.amber:C.red }}>{c.csat}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>);
}

const INDUSTRY_TABS: IndustryTab[] = [
  {label:"Shipments",          content:<ShipmentsTab/>},
  {label:"Carrier Scorecards", content:<CarriersTab/>},
  {label:"Lane Analytics",     content:<LanesTab/>},
  {label:"Cost Analysis",      content:<CostAnalysisTab/>},
  {label:"Exceptions",         content:<ExceptionsTab/>},
  {label:"Fuel Surcharge",     content:<FuelSurchargeTab/>},
  {label:"Customer Impact",    content:<CustomerImpactTab/>},
];

export default function LogisticsDashboard() {
  return (
    <DashboardShell
      theme="dark"
      title="Logistics & Freight Intelligence"
      subtitle="Shipment tracking · Carrier performance · Lane analytics"
      headerColor="#1e293b"
      accentColor="#38bdf8"
      breadcrumbLabel="Logistics & Freight"
      kpis={KPI_DATA}
      recommendedActions={[
        {title:"Performance-manage WestLink on PER–ADL (recover $14k delay cost)",explanation:"PER–ADL on-time rate 76% — lowest lane in the network and 16 points below target. WestLink is sole carrier with no competitive pressure and no formal notice issued.",impact:"$14,000 delay cost reduction, 8–10% on-time improvement",priority:"High"},
        {title:"Replace IslandRun on MEL–HBT (eliminate $18k/quarter damage claims)",explanation:"IslandRun rated 3.4/5 with 14% damage rate — highest in fleet. Customer Tassie Timber CSAT at 2.8/5 with escalating complaints and credit note exposure.",impact:"Est. $18,000 quarterly damage claim reduction",priority:"High"},
        {title:"Cap NorthRun fuel surcharge (lock in $24k annual cost certainty)",explanation:"NorthRun fuel surcharge at 12% and rising. Multi-year cap protects against fuel price volatility and locks in a known cost base for the lane.",impact:"$24,000 annual surcharge cost certainty",priority:"Medium"},
        {title:"Resolve Basslink delay (EX-002) — CSAT at risk, credit note exposure",explanation:"Tassie Timber shipment delayed 3 days. Exception open 5+ days without resolution — customer relationship at risk and formal credit note claim likely.",impact:"Recover CSAT, avoid credit note claim",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"23% of deliveries delayed at Port transfer — costing $14k+ in annual delay penalties",cause:"Shared docking bays with commercial traffic 8–10am; no priority scheduling; average delay time 47 minutes per affected shipment",recommendation:"Negotiate 3 priority docking slots at Port for peak window — target delay reduction from 47 to under 20 minutes this quarter",severity:"High"},
        {problem:"Fuel costs 18% above FY budget for 3 consecutive months — $24k above plan year-to-date",cause:"Fleet average 7.4 years old with declining efficiency; no idle-reduction controls or telematics-based oversight in place",recommendation:"Dispose of 4 assets above 8-year threshold and enforce telematics idle policy — recover $12k–$18k annually",severity:"Medium"},
        {problem:"Average field delivery turnaround 2.1 hours above SLA — customer satisfaction declining",cause:"Manual dispatch with no dynamic route sequencing; backtracking adds 30+ minutes per job on high-density routes",recommendation:"Deploy route optimisation in dispatch this quarter — target 30-minute average turnaround reduction",severity:"Medium"},
      ]}
      overviewContent={<OverviewContent/>}
      industryTabs={INDUSTRY_TABS}
      sampleData={{Shipments:SHIPMENTS,Carriers:CARRIERS,Monthly:MONTHLY,Lanes:LANES}}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="Logistics & Freight dashboard. Key metrics: 460 shipments this quarter, 88% on-time (target 92%), $672,800 spend, 3 active delays. PER-ADL lane underperforming at 76% on-time. IslandRun carrier rated 3.4/5."
      executiveSummary="On-time performance is 4 points below the 92% target driven by WestLink on PER–ADL and port docking delays — $56k in recoverable delay cost and damage claims identified across 3 carrier relationships."
      snapshotPanel={{ topCostDriver: 'NorthRun fuel surcharge at 12% and rising', biggestRisk: 'WestLink sole-carrier exposure on PER–ADL at 76% on-time', savingsIdentified: 56000, confidence: 85, lastUpdated: 'Apr 2026' }}
    />
  );
}

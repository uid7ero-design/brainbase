'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, IndustryTab, InsightCard } from '@/components/dashboard/DashboardShell';

const SAMPLE_SUPPLIERS = [
  { id:'SUP-001', name:'Pacific Steel Co',      category:'Materials',   spend:184000, orders:24, onTime:92, quality:96 },
  { id:'SUP-002', name:'Kennards Hire',          category:'Equipment',   spend:62000,  orders:41, onTime:88, quality:94 },
  { id:'SUP-003', name:'Total Tools & Hardware', category:'Consumables', spend:29000,  orders:78, onTime:95, quality:98 },
  { id:'SUP-004', name:'SafeWork Supplies',      category:'Safety PPE',  spend:18500,  orders:32, onTime:97, quality:99 },
  { id:'SUP-005', name:'Fuel Fix Pty Ltd',       category:'Fuel',        spend:145000, orders:52, onTime:99, quality:100 },
  { id:'SUP-006', name:'Coates Civil',           category:'Equipment',   spend:94000,  orders:19, onTime:84, quality:91 },
];

const SAMPLE_ORDERS = [
  { id:'PO-2025-0881', supplier:'Pacific Steel Co',  item:'RHS 100×100×6',  qty:200, unit:'length', status:'Delivered', value:8400,  raised:'2025-04-10', eta:'2025-04-18' },
  { id:'PO-2025-0882', supplier:'Kennards Hire',     item:'Excavator 8T',    qty:1,   unit:'week',   status:'Active',    value:4200,  raised:'2025-04-20', eta:'2025-04-27' },
  { id:'PO-2025-0883', supplier:'SafeWork Supplies', item:'Safety Harness',  qty:20,  unit:'ea',     status:'Pending',   value:1900,  raised:'2025-04-22', eta:'2025-04-26' },
  { id:'PO-2025-0884', supplier:'Fuel Fix Pty Ltd',  item:'Diesel Bulk',     qty:5000,unit:'L',      status:'Delivered', value:9250,  raised:'2025-04-15', eta:'2025-04-17' },
  { id:'PO-2025-0885', supplier:'Total Tools',       item:"Angle Grinder 9\"",qty:4,  unit:'ea',     status:'Pending',   value:720,   raised:'2025-04-24', eta:'2025-04-28' },
];

const SAMPLE_INVENTORY = [
  { sku:'INV-001', description:'RHS 100×100×6 — 6m', category:'Steel',       qty:42,   reorder:20,   value:3780,  location:'Yard A' },
  { sku:'INV-002', description:'Diesel (Litres)',      category:'Fuel',        qty:3200, reorder:1000, value:5920,  location:'Tank 1' },
  { sku:'INV-003', description:'Safety Harness',       category:'Safety PPE',  qty:8,    reorder:5,    value:760,   location:'Storeroom' },
  { sku:'INV-004', description:'Concrete Bags 20kg',   category:'Materials',   qty:180,  reorder:50,   value:1260,  location:'Yard B' },
  { sku:'INV-005', description:'Hi-Vis Vests (L)',     category:'Safety PPE',  qty:35,   reorder:10,   value:350,   location:'Storeroom' },
  { sku:'INV-006', description:"Angle Grinder Disc 9\"",category:'Consumables',qty:6,    reorder:12,   value:42,    location:'Workshop' },
];

const MONTHLY_SPEND = [
  { month:'Nov', spend:98000 },{ month:'Dec', spend:124000 },
  { month:'Jan', spend:88000 },{ month:'Feb', spend:112000 },
  { month:'Mar', spend:135000 },{ month:'Apr', spend:143000 },
];

const PIE_COLORS = ['#f59e0b','#fbbf24','#fcd34d','#92400e','#78350f','#d97706'];

const totalSpend = SAMPLE_SUPPLIERS.reduce((s,r)=>s+r.spend,0);
const belowReorder = SAMPLE_INVENTORY.filter(i=>i.qty<i.reorder).length;
const pendingOrders = SAMPLE_ORDERS.filter(o=>o.status==='Pending').length;
const avgOnTime = Math.round(SAMPLE_SUPPLIERS.reduce((s,r)=>s+r.onTime,0)/SAMPLE_SUPPLIERS.length);

const categorySpendData = Object.entries(
  SAMPLE_SUPPLIERS.reduce((acc: Record<string,number>, s) => { acc[s.category]=(acc[s.category]||0)+s.spend; return acc; }, {})
).map(([name,value])=>({name,value}));

const MONTHLY_TREND: MonthlyPoint[] = [
  {month:"Nov",actual:98000,budget:90000,prevYear:82000},
  {month:"Dec",actual:124000,budget:115000,prevYear:104000},
  {month:"Jan",actual:88000,budget:95000,prevYear:78000},
  {month:"Feb",actual:112000,budget:108000,prevYear:98000},
  {month:"Mar",actual:135000,budget:128000,prevYear:112000},
  {month:"Apr",actual:143000,budget:135000,prevYear:120000},
];

const COST_ACCOUNTS: CostAccount[] = [
  {account:"Materials – Steel & Concrete",budget:220000,actual:238000},
  {account:"Equipment Hire",budget:180000,actual:156000},
  {account:"Fuel",budget:160000,actual:145000},
  {account:"Consumables & Tools",budget:48000,actual:44000},
  {account:"Safety PPE",budget:28000,actual:23000},
];

const SLA_TARGETS: SLATarget[] = [
  {kpi:"Supplier On-Time Delivery",target:"≥ 92%",actual:"92%",status:"Met"},
  {kpi:"Purchase Orders < $10K Approved",target:"< 3 days",actual:"2 days",status:"Met"},
  {kpi:"Inventory Below Reorder Point",target:"< 2 SKUs",actual:`${belowReorder} SKUs`,status:belowReorder<2?"Met":"Missed"},
  {kpi:"Supplier Quality Score",target:"≥ 90%",actual:`${Math.round(SAMPLE_SUPPLIERS.reduce((s,r)=>s+r.quality,0)/SAMPLE_SUPPLIERS.length)}%`,status:"Met"},
  {kpi:"Coates Civil On-Time",target:"≥ 90%",actual:"84%",status:"At Risk",note:"Review equipment hire schedule"},
];

const DEFAULT_ACTIONS: Action[] = [
  {id:"a1",title:"Restock angle grinder discs — below reorder",assignee:"Storeroom",dueDate:"2025-04-28",status:"Not started",priority:"High"},
  {id:"a2",title:"Performance review — Coates Civil delivery",assignee:"Procurement",dueDate:"2025-05-10",status:"Not started",priority:"Medium"},
  {id:"a3",title:"Tender for steel supply contract renewal",assignee:"Procurement",dueDate:"2025-06-30",status:"Not started",priority:"Medium"},
];

const KPI_DATA: KPI[] = [
  {label:"Total Spend YTD",value:`$${(totalSpend/1000).toFixed(0)}k`,sub:"All categories",icon:"💰",status:"normal"},
  {label:"Active Suppliers",value:String(SAMPLE_SUPPLIERS.length),sub:"Approved vendors",icon:"🤝",status:"normal"},
  {label:"Pending Orders",value:String(pendingOrders),sub:"Awaiting delivery",icon:"📦",status:"normal"},
  {label:"On-Time Delivery",value:`${avgOnTime}%`,sub:"Supplier average",icon:"⏱",status:avgOnTime<90?"watch":"normal"},
  {label:"Below Reorder",value:String(belowReorder),sub:"SKUs needing restock",alert:belowReorder>0,status:belowReorder>0?"risk":"normal",icon:"⚠"},
  {label:"Avg Quality Score",value:`${Math.round(SAMPLE_SUPPLIERS.reduce((s,r)=>s+r.quality,0)/SAMPLE_SUPPLIERS.length)}%`,sub:"Supplier quality",icon:"⭐",status:"normal"},
];

const darkCard = {background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:20};

function OverviewContent() {
  return (
    <div style={{background:"#0f0f0f",borderRadius:12,padding:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:16,marginBottom:24}}>
        {[
          {label:"Total Spend YTD",value:`$${(totalSpend/1000).toFixed(0)}k`,sub:"All categories"},
          {label:"Active Suppliers",value:SAMPLE_SUPPLIERS.length,sub:"Approved vendors"},
          {label:"Pending Orders",value:pendingOrders,sub:"Awaiting delivery"},
          {label:"On-Time Delivery",value:`${avgOnTime}%`,sub:"Supplier average"},
          {label:"Below Reorder",value:belowReorder,sub:"SKUs needing restock"},
          {label:"Avg Quality Score",value:`${Math.round(SAMPLE_SUPPLIERS.reduce((s,r)=>s+r.quality,0)/SAMPLE_SUPPLIERS.length)}%`,sub:"Supplier quality"},
        ].map(k=>(
          <div key={k.label} style={{...darkCard,padding:16}}>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>{k.label}</div>
            <div style={{fontSize:26,fontWeight:700,color:"#fbbf24"}}>{k.value}</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginTop:4}}>{k.sub}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <div style={darkCard}>
          <h3 style={{margin:"0 0 16px",fontSize:14,color:"#e5e7eb"}}>Monthly Spend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={MONTHLY_SPEND}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
              <XAxis dataKey="month" tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}}/>
              <YAxis tickFormatter={v=>`$${v/1000}k`} tick={{fill:"rgba(255,255,255,0.4)",fontSize:11}}/>
              <Tooltip formatter={(v)=>[`$${Number(v).toLocaleString()}`,"Spend"]} contentStyle={{background:"#1a1a2e",border:"none",borderRadius:8}}/>
              <Bar dataKey="spend" fill="#f59e0b" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={darkCard}>
          <h3 style={{margin:"0 0 16px",fontSize:14,color:"#e5e7eb"}}>Spend by Category</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={categorySpendData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({name})=>name}>
                {categorySpendData.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
              </Pie>
              <Tooltip formatter={(v)=>`$${Number(v).toLocaleString()}`} contentStyle={{background:"#1a1a2e",border:"none",borderRadius:8}}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function SuppliersTab() {
  return (
    <div style={{...darkCard,background:"#0f0f0f",padding:0,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,color:"#e5e7eb"}}>
        <thead><tr style={{background:"rgba(255,255,255,0.06)"}}>
          {["ID","Name","Category","YTD Spend","Orders","On-Time %","Quality %"].map(h=>(
            <th key={h} style={{padding:"12px 16px",textAlign:"left",fontSize:12,color:"rgba(255,255,255,0.5)",fontWeight:600}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>{SAMPLE_SUPPLIERS.map((s,i)=>(
          <tr key={s.id} style={{borderBottom:"1px solid rgba(255,255,255,0.05)",background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
            <td style={{padding:"12px 16px",color:"rgba(255,255,255,0.5)"}}>{s.id}</td>
            <td style={{padding:"12px 16px",fontWeight:600}}>{s.name}</td>
            <td style={{padding:"12px 16px"}}>{s.category}</td>
            <td style={{padding:"12px 16px"}}>${s.spend.toLocaleString()}</td>
            <td style={{padding:"12px 16px"}}>{s.orders}</td>
            <td style={{padding:"12px 16px"}}><span style={{color:s.onTime>=95?"#4ade80":s.onTime>=85?"#fbbf24":"#f87171"}}>{s.onTime}%</span></td>
            <td style={{padding:"12px 16px"}}>{s.quality}%</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function OrdersTab() {
  return (
    <div style={{...darkCard,background:"#0f0f0f",padding:0,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,color:"#e5e7eb"}}>
        <thead><tr style={{background:"rgba(255,255,255,0.06)"}}>
          {["PO #","Supplier","Item","Qty","Unit","Value","Raised","ETA","Status"].map(h=>(
            <th key={h} style={{padding:"12px 16px",textAlign:"left",fontSize:12,color:"rgba(255,255,255,0.5)",fontWeight:600}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>{SAMPLE_ORDERS.map((o,i)=>(
          <tr key={o.id} style={{borderBottom:"1px solid rgba(255,255,255,0.05)",background:i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
            <td style={{padding:"12px 16px",color:"rgba(255,255,255,0.5)"}}>{o.id}</td>
            <td style={{padding:"12px 16px"}}>{o.supplier}</td>
            <td style={{padding:"12px 16px"}}>{o.item}</td>
            <td style={{padding:"12px 16px"}}>{o.qty}</td>
            <td style={{padding:"12px 16px",color:"rgba(255,255,255,0.5)"}}>{o.unit}</td>
            <td style={{padding:"12px 16px"}}>${o.value.toLocaleString()}</td>
            <td style={{padding:"12px 16px",color:"rgba(255,255,255,0.5)"}}>{o.raised}</td>
            <td style={{padding:"12px 16px",color:"rgba(255,255,255,0.5)"}}>{o.eta}</td>
            <td style={{padding:"12px 16px"}}>
              <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600,background:o.status==="Delivered"?"rgba(74,222,128,0.15)":o.status==="Active"?"rgba(251,191,36,0.15)":"rgba(255,255,255,0.08)",color:o.status==="Delivered"?"#4ade80":o.status==="Active"?"#fbbf24":"rgba(255,255,255,0.5)"}}>{o.status}</span>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function InventoryTab() {
  return (
    <div style={{...darkCard,background:"#0f0f0f",padding:0,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:14,color:"#e5e7eb"}}>
        <thead><tr style={{background:"rgba(255,255,255,0.06)"}}>
          {["SKU","Description","Category","Qty on Hand","Reorder Point","Stock Value","Location","Status"].map(h=>(
            <th key={h} style={{padding:"12px 16px",textAlign:"left",fontSize:12,color:"rgba(255,255,255,0.5)",fontWeight:600}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>{SAMPLE_INVENTORY.map((item,i)=>{
          const low = item.qty<item.reorder;
          return (
            <tr key={item.sku} style={{borderBottom:"1px solid rgba(255,255,255,0.05)",background:low?"rgba(248,113,113,0.05)":i%2===0?"transparent":"rgba(255,255,255,0.02)"}}>
              <td style={{padding:"12px 16px",color:"rgba(255,255,255,0.5)"}}>{item.sku}</td>
              <td style={{padding:"12px 16px",fontWeight:600}}>{item.description}</td>
              <td style={{padding:"12px 16px"}}>{item.category}</td>
              <td style={{padding:"12px 16px",color:low?"#f87171":"#e5e7eb"}}>{item.qty}</td>
              <td style={{padding:"12px 16px",color:"rgba(255,255,255,0.5)"}}>{item.reorder}</td>
              <td style={{padding:"12px 16px"}}>${item.value.toLocaleString()}</td>
              <td style={{padding:"12px 16px",color:"rgba(255,255,255,0.5)"}}>{item.location}</td>
              <td style={{padding:"12px 16px"}}>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600,background:low?"rgba(248,113,113,0.15)":"rgba(74,222,128,0.15)",color:low?"#f87171":"#4ade80"}}>{low?"Reorder":"OK"}</span>
              </td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

const INDUSTRY_TABS: IndustryTab[] = [
  {label:"Suppliers",content:<SuppliersTab/>},
  {label:"Purchase Orders",content:<OrdersTab/>},
  {label:"Inventory",content:<InventoryTab/>},
];

export default function SupplyPage() {
  return (
    <DashboardShell
      theme="dark"
      title="Supply Chain Intelligence"
      subtitle="Suppliers · Procurement · Inventory management"
      headerColor="#78350f"
      accentColor="#f59e0b"
      breadcrumbLabel="Supply Chain"
      kpis={KPI_DATA}
      recommendedActions={[
        {title:"Issue Coates Civil performance notice (avoid $14k downstream delay cost)",explanation:"On-time delivery rate 84% — below 90% SLA for 3 consecutive months. No formal notice issued per contract terms. Delay costs are accumulating downstream across active projects.",impact:"Recover delivery SLA, avoid $14,000 downstream delay cost",priority:"High"},
        {title:"Emergency reorder angle grinders (prevent work stoppage, save $4.2k premium)",explanation:"1 SKU below reorder point with < 5 days stock remaining. Operational shutdown risk on active works if stock runs out before standard order arrives.",impact:"Prevent work stoppage, avoid $4,200 emergency order premium",priority:"High"},
        {title:"Consolidate $88k spend to preferred suppliers (save 8–12% on non-preferred)",explanation:"$88k of spend split across 4 non-preferred suppliers in Q3. Consolidation to preferred suppliers unlocks volume discounts and removes admin overhead.",impact:"Est. 8–12% cost reduction on $88,000 consolidated spend",priority:"Medium"},
        {title:"Retender 2 expiring contracts before market cost escalation",explanation:"Two supplier contracts due within 90 days. Proactive retender locks in known cost base before market rate increases — minimum 45-day lead time required.",impact:"Lock in rates before market cost escalation",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"Coates Civil contract expires in 90 days — no renewal initiated, 45-day minimum lead time already tight",cause:"Contract expiry dates not tracked in procurement system; no automated renewal trigger at 90-day mark",recommendation:"Initiate tender process immediately; implement 45-day renewal trigger for all contracts above $50k",severity:"High"},
        {problem:"Angle grinder consumables at 6 units — below 12-unit safety threshold, 5-day supply remaining",cause:"Demand spike from project surge not reflected in reorder model — stockout risk on active works",recommendation:"Raise emergency order today; recalibrate reorder points against active project schedule immediately",severity:"High"},
        {problem:"38% of purchase orders processed as reactive emergency procurement — 8–12% cost premium on each",cause:"Supply planning not integrated with project programme; forward material needs invisible until they become urgent",recommendation:"Integrate supply planning with project programme calendar; set standing orders for top 10 reactive SKUs",severity:"Medium"},
      ]}      overviewContent={<OverviewContent/>}
      industryTabs={INDUSTRY_TABS}
      sampleData={{Suppliers:SAMPLE_SUPPLIERS,Orders:SAMPLE_ORDERS,Inventory:SAMPLE_INVENTORY,"Monthly Spend":MONTHLY_SPEND}}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="Supply Chain dashboard. $532K total YTD spend across 6 suppliers. 2 pending orders. 1 SKU below reorder (angle grinder discs). Coates Civil on-time rate 84% — below target. Avg quality 96%."
      executiveSummary="A stockout risk on angle grinders is 5 days away while Coates Civil has breached SLA for 3 consecutive months with no formal notice issued — $14k in downstream delay costs accumulating and 38% of orders processed as reactive emergency procurement."
      snapshotPanel={{ topCostDriver: 'Reactive emergency procurement — 38% of POs at 8–12% cost premium', biggestRisk: 'Angle grinder stockout in 5 days — work stoppage risk on active sites', savingsIdentified: 18200, confidence: 84, lastUpdated: 'Apr 2026' }}
    />
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, ReferenceLine,
} from 'recharts';
import { Upload, Truck, DollarSign, BarChart2, AlertCircle, Gauge, Activity, Shield, Clock, Users, MapPin, Wrench } from 'lucide-react';
import DashboardShell, { KPI, MonthlyPoint, CostAccount, SLATarget, Action, InsightCard } from '@/components/dashboard/DashboardShell';
import type { FleetUploadMeta } from './page';

// ─── Constants ────────────────────────────────────────────────────────────────

const C = { wages:'#10b981',fuel:'#3b82f6',maintenance:'#f59e0b',rego:'#8b5cf6',repairs:'#ef4444',insurance:'#06b6d4',depreciation:'#64748b' };
const DEPT_C: Record<string,string> = { 'Waste Collection':'#3b82f6','Parks & Gardens':'#10b981','Roads & Drainage':'#f59e0b','Customer Service':'#8b5cf6','Facilities':'#ef4444' };
const STATUS_C: Record<string,string> = { OK:'#10b981','Due Soon':'#f59e0b',Overdue:'#ef4444' };
const CAT_C: Record<string,string> = { Breakdown:'#ef4444',Scheduled:'#f59e0b',Accident:'#8b5cf6',External:'#94a3b8' };
const ACCENT: Record<string,string> = { blue:'bg-blue-500/10 text-blue-400',emerald:'bg-emerald-500/10 text-emerald-400',violet:'bg-violet-500/10 text-violet-400',amber:'bg-amber-500/10 text-amber-400',red:'bg-red-500/10 text-red-400',slate:'bg-white/5 text-white/50' };
const STOP_C: Record<string,string> = { 'Collection':'#3b82f6','Transfer Station':'#8b5cf6','Fuel Stop':'#f59e0b','Rest Break':'#94a3b8','Depot Check-in':'#10b981','Site Inspection':'#06b6d4','Maintenance Work':'#ef4444','Road Works':'#f97316','Customer Site':'#10b981','Lunch Break':'#a78bfa','Maintenance Stop':'#ef4444' };
const TT = { borderRadius:10, border:'none', boxShadow:'0 4px 20px rgba(0,0,0,0.1)' };

const fmt  = (n:number) => `$${Number(n).toLocaleString('en-AU',{maximumFractionDigits:0})}`;
const fmtH = (n:number) => `${Number(n).toLocaleString('en-AU')} hrs`;
const fmtK = (n:number) => `${Number(n).toLocaleString('en-AU')} km`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Asset       = { id:string;type:string;make:string;year:number;department:string;driver:string;km:number;wages:number;fuel:number;maintenance:number;rego:number;repairs:number;insurance:number;depreciation:number;services:number;defects:number;total:number;totalWithDepr:number;costPerKm:number };
type SvcRecord   = { asset:string;make:string;lastService:string;nextDue:string;odometer:number;serviceType:string;cost:number;status:string;notes:string };
type HRRecord    = { asset:string;driver:string;department:string;scheduledHours:number;workedHours:number;overtime:number;absentDays:number;hourlyRate:number;totalLabour:number };
type DtRecord    = { asset:string;date:string;category:string;reason:string;hours:number;cost:number;resolved:boolean };
type UtilRecord  = { asset:string;type:string;scheduledHours:number;operatingHours:number;idleHours:number;utilisationPct:number;idleCost:number };
type TripRecord  = { asset:string;driver:string;date:string;yardDep:string;yardRet:string;hoursOut:number;stopsMade:number;areasVisited:string };
type StopRecord  = { asset:string;driver:string;date:string;area:string;arrival:string;departure:string;durationMins:number;stopType:string };
type ColocRecord = { date:string;area:string;vehicles:string;startTime:string;durationMins:number;notes:string };

const R = (json:Record<string,unknown>[]) => json;
const parseAssets = (rows:Record<string,unknown>[]): Asset[] => rows.map(r=>{ const wages=+r.Wages!||0,fuel=+r.Fuel!||0,maint=+r.Maintenance!||0,rego=+r.Rego!||0,repairs=+r.Repairs!||0,ins=+r.Insurance!||0,depr=+r.Depreciation!||0,km=+r.KM!||0; const total=wages+fuel+maint+rego+repairs+ins; return {id:String(r.Asset),type:String(r.Type||''),make:String(r.Make||''),year:+r.Year!||0,department:String(r.Department||''),driver:String(r.Driver||''),km,wages,fuel,maintenance:maint,rego,repairs,insurance:ins,depreciation:depr,services:+r.Services!||0,defects:+r.Defects!||0,total,totalWithDepr:total+depr,costPerKm:km>0?total/km:0}; });
const parseSvc   = (rows:Record<string,unknown>[]): SvcRecord[] => rows.map(r=>({asset:String(r.Asset),make:String(r.Make||''),lastService:String(r['Last Service']||''),nextDue:String(r['Next Due']||''),odometer:+r.Odometer!||0,serviceType:String(r['Service Type']||''),cost:+r.Cost!||0,status:String(r.Status||'OK'),notes:String(r.Notes||'')}));
const parseHR    = (rows:Record<string,unknown>[]): HRRecord[]  => rows.map(r=>({asset:String(r.Asset),driver:String(r.Driver||''),department:String(r.Department||''),scheduledHours:+r['Scheduled Hours']!||0,workedHours:+r['Worked Hours']!||0,overtime:+r.Overtime!||0,absentDays:+r['Absent Days']!||0,hourlyRate:+r['Hourly Rate']!||0,totalLabour:+r['Total Labour']!||0}));
const parseDt    = (rows:Record<string,unknown>[]): DtRecord[]  => rows.map(r=>({asset:String(r.Asset),date:String(r.Date||''),category:String(r.Category||''),reason:String(r.Reason||''),hours:+r.Hours!||0,cost:+r.Cost!||0,resolved:String(r.Resolved||'Yes').toLowerCase()==='yes'}));
const parseUtil  = (rows:Record<string,unknown>[]): UtilRecord[]  => rows.map(r=>({asset:String(r.Asset),type:String(r.Type||''),scheduledHours:+r['Scheduled Hours']!||0,operatingHours:+r['Operating Hours']!||0,idleHours:+r['Idle Hours']!||0,utilisationPct:+r['Utilisation %']!||0,idleCost:+r['Idle Cost']!||0}));
const parseTrips = (rows:Record<string,unknown>[]): TripRecord[]  => rows.map(r=>({asset:String(r.Asset),driver:String(r.Driver||''),date:String(r.Date||''),yardDep:String(r['Yard Departure']||''),yardRet:String(r['Yard Return']||''),hoursOut:+r['Hours Out']!||0,stopsMade:+r['Stops Made']!||0,areasVisited:String(r['Areas Visited']||'')}));
const parseStops = (rows:Record<string,unknown>[]): StopRecord[]  => rows.map(r=>({asset:String(r.Asset),driver:String(r.Driver||''),date:String(r.Date||''),area:String(r.Area||''),arrival:String(r.Arrival||''),departure:String(r.Departure||''),durationMins:+r['Duration (mins)']!||0,stopType:String(r['Stop Type']||'')}));
const parseColoc = (rows:Record<string,unknown>[]): ColocRecord[] => rows.map(r=>({date:String(r.Date||''),area:String(r.Area||''),vehicles:String(r.Vehicles||''),startTime:String(r['Start Time']||''),durationMins:+r['Duration (mins)']!||0,notes:String(r.Notes||'')}));

// ─── Shared sub-components ────────────────────────────────────────────────────

const DARK_CARD = { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:12, padding:20 } as React.CSSProperties;
function KPI2({icon,label,value,sub,accent}:{icon:React.ReactNode;label:string;value:string;sub?:string;accent:string}) {
  return (
    <div style={DARK_CARD}>
      <div style={{marginBottom:12}}><span className={`inline-flex p-2 rounded-lg ${ACCENT[accent]}`}>{icon}</span></div>
      <p style={{fontSize:10,color:'rgba(255,255,255,0.40)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:2}}>{label}</p>
      <p style={{fontSize:20,fontWeight:700,color:'#F5F7FA',lineHeight:1.2}}>{value}</p>
      {sub&&<p style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:2}}>{sub}</p>}
    </div>
  );
}
function SecTitle({children}:{children:React.ReactNode}){return<p style={{fontSize:10,fontWeight:600,color:'rgba(255,255,255,0.35)',textTransform:'uppercase',letterSpacing:'0.10em',marginBottom:14}}>{children}</p>;}
function THead({cols}:{cols:string[]}){return<thead><tr style={{background:'rgba(255,255,255,0.04)',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>{cols.map(h=><th key={h} style={{padding:'10px 16px',textAlign:'left',fontSize:10,fontWeight:600,color:'rgba(255,255,255,0.35)',textTransform:'uppercase',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>;}
function TR({children,i}:{children:React.ReactNode;i:number}){return<tr style={{borderBottom:'1px solid rgba(255,255,255,0.04)',background:i%2===1?'rgba(255,255,255,0.015)':'transparent'}}>{children}</tr>;}
function TD({children,bold}:{children:React.ReactNode;bold?:boolean}){return<td style={{padding:'10px 16px',fontWeight:bold?700:400,color:bold?'#F5F7FA':'rgba(255,255,255,0.55)',fontSize:13}}>{children}</td>;}
function Badge({label,color}:{label:string;color:string}){return<span style={{padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600,background:color+'20',color,border:`1px solid ${color}40`}}>{label}</span>;}
function Empty(){return(<div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'120px 20px',textAlign:'center'}}><div style={{background:'rgba(255,255,255,0.06)',padding:20,borderRadius:16,marginBottom:16}}><Truck size={36} color="rgba(255,255,255,0.30)"/></div><h2 style={{fontSize:18,fontWeight:600,color:'rgba(255,255,255,0.70)',marginBottom:8}}>No Fleet Data Loaded</h2><p style={{color:'rgba(255,255,255,0.35)',fontSize:13,marginBottom:16}}>Upload the multi-sheet Excel file to get started.</p><a href="/fleet-dummy-data.xlsx" download style={{background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.12)',color:'#F5F7FA',padding:'10px 20px',borderRadius:8,fontSize:13,fontWeight:500,textDecoration:'none'}}>Download Sample Data</a></div>);}

function FleetDataBanner({ meta }: { meta: FleetUploadMeta }) {
  const date = new Date(meta.uploadedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <span style={{ background: '#10b981', color: '#fff', borderRadius: 6, padding: '2px 9px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>Live Data</span>
      <span style={{ fontSize: 13, color: 'rgba(230,237,243,0.55)' }}>
        <span style={{ color: '#F5F7FA', fontWeight: 600 }}>{meta.fileName}</span>
        <span style={{ color: 'rgba(230,237,243,0.35)', margin: '0 8px' }}>·</span>
        <span>{meta.recordCount.toLocaleString()} records imported</span>
        <span style={{ color: 'rgba(230,237,243,0.35)', margin: '0 8px' }}>·</span>
        <span>Last updated {date}</span>
      </span>
    </div>
  );
}

function FleetDemoBanner() {
  return (
    <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <span style={{ background: '#f59e0b', color: '#000', borderRadius: 6, padding: '2px 9px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>Demo</span>
      <div style={{ fontSize: 13, color: 'rgba(230,237,243,0.55)', lineHeight: 1.5 }}>
        Sample data is shown below.{' '}
        <span style={{ color: '#F5F7FA', fontWeight: 600 }}>Upload an Excel file to activate this dashboard with your real fleet data.</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: 'rgba(230,237,243,0.35)' }}>
          Go to <span style={{ fontFamily: 'monospace', color: 'rgba(230,237,243,0.55)' }}>Data → Upload</span> and select service type <span style={{ fontFamily: 'monospace', color: 'rgba(230,237,243,0.55)' }}>Fleet</span>.
        </span>
      </div>
    </div>
  );
}

function ServicingTab({data}:{data:SvcRecord[]}) {
  if (!data.length) return <Empty/>;
  const totalCost=data.reduce((s,r)=>s+r.cost,0);
  const overdue=data.filter(r=>r.status==='Overdue').length;
  const dueSoon=data.filter(r=>r.status==='Due Soon').length;
  const next=[...data].sort((a,b)=>new Date(a.nextDue).getTime()-new Date(b.nextDue).getTime())[0];
  const costChart=data.map(r=>({id:r.asset,cost:r.cost}));
  const byType=Object.entries(data.reduce<Record<string,number>>((a,r)=>({...a,[r.serviceType]:(a[r.serviceType]||0)+r.cost}),{})).map(([name,value])=>({name,value}));
  return(
    <><div className="grid grid-cols-4 gap-4 mb-8">
      <KPI2 icon={<DollarSign size={16}/>} label="Total Service Cost" value={fmt(totalCost)} accent="blue"/>
      <KPI2 icon={<AlertCircle size={16}/>} label="Overdue" value={String(overdue)} sub="Immediate attention" accent="red"/>
      <KPI2 icon={<Clock size={16}/>} label="Due Soon" value={String(dueSoon)} sub="Within 30 days" accent="amber"/>
      <KPI2 icon={<Wrench size={16}/>} label="Next Service" value={next?.asset??'—'} sub={next?.nextDue} accent="violet"/>
    </div>
    <div className="grid grid-cols-3 gap-5 mb-5">
      <div className="col-span-2" style={DARK_CARD}><SecTitle>Service Cost by Asset</SecTitle><ResponsiveContainer width="100%" height={220}><BarChart data={costChart} barSize={28}><XAxis dataKey="id" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/><Tooltip formatter={(v:unknown)=>fmt(Number(v))} contentStyle={TT}/><Bar dataKey="cost" name="Service Cost" radius={[4,4,0,0]} fill="#3b82f6"/></BarChart></ResponsiveContainer></div>
      <div style={DARK_CARD}><SecTitle>By Service Type</SecTitle><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={byType} cx="50%" cy="50%" innerRadius={48} outerRadius={76} dataKey="value" paddingAngle={2}>{byType.map((_,i)=><Cell key={i} fill={['#3b82f6','#f59e0b','#10b981'][i%3]}/>)}</Pie><Tooltip formatter={(v:unknown)=>fmt(Number(v))} contentStyle={TT}/></PieChart></ResponsiveContainer><div className="space-y-2 mt-2">{byType.map((d,i)=>(<div key={d.name} className="flex justify-between text-xs"><span style={{display:'flex',alignItems:'center',gap:8,color:'rgba(230,237,243,0.55)'}}><span className="w-2 h-2 rounded-full" style={{background:['#3b82f6','#f59e0b','#10b981'][i%3]}}/>{d.name}</span><span className="font-semibold">{fmt(d.value)}</span></div>))}</div></div>
    </div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden'}}><div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}><SecTitle>Service Register</SecTitle></div>
      <table className="w-full text-sm"><THead cols={['Asset','Make','Service Type','Last Service','Next Due','Odometer','Cost','Notes','Status']}/><tbody>{data.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'10px 16px',fontWeight:600,color:'#F5F7FA'}}>{r.asset}</td><TD>{r.make}</TD><TD>{r.serviceType}</TD><TD>{r.lastService}</TD><TD>{r.nextDue}</TD><TD>{r.odometer.toLocaleString()} km</TD><TD>{fmt(r.cost)}</TD><td style={{padding:'10px 16px',color:'rgba(230,237,243,0.35)',fontSize:12}} className="max-w-xs truncate">{r.notes||'—'}</td><td className="px-5 py-3"><Badge label={r.status} color={STATUS_C[r.status]||'#94a3b8'}/></td></TR>))}</tbody></table>
    </div></>
  );
}

function HRTab({data}:{data:HRRecord[]}) {
  if (!data.length) return <Empty/>;
  const totalLabour=data.reduce((s,r)=>s+r.totalLabour,0);
  const totalWorked=data.reduce((s,r)=>s+r.workedHours,0);
  const totalOT=data.reduce((s,r)=>s+r.overtime,0);
  const totalAbsent=data.reduce((s,r)=>s+r.absentDays,0);
  const hoursChart=data.map(r=>({driver:r.driver.split(' ')[1]||r.driver,scheduled:r.scheduledHours,worked:r.workedHours,overtime:r.overtime}));
  const pie=[{name:'Regular',value:totalWorked-totalOT},{name:'Overtime',value:totalOT}];
  return(
    <><div className="grid grid-cols-4 gap-4 mb-8">
      <KPI2 icon={<DollarSign size={16}/>} label="Total Labour Cost" value={fmt(totalLabour)} accent="blue"/>
      <KPI2 icon={<Users size={16}/>} label="Total Hours Worked" value={fmtH(totalWorked)} accent="emerald"/>
      <KPI2 icon={<Clock size={16}/>} label="Total Overtime" value={fmtH(totalOT)} sub={`${((totalOT/totalWorked)*100).toFixed(1)}% of hours`} accent="amber"/>
      <KPI2 icon={<Activity size={16}/>} label="Absent Days" value={String(totalAbsent)} accent="red"/>
    </div>
    <div className="grid grid-cols-3 gap-5 mb-5">
      <div className="col-span-2" style={DARK_CARD}><SecTitle>Scheduled vs Worked vs Overtime</SecTitle><ResponsiveContainer width="100%" height={220}><BarChart data={hoursChart} barSize={18}><XAxis dataKey="driver" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/><Tooltip contentStyle={TT}/><Legend wrapperStyle={{fontSize:11}}/><Bar dataKey="scheduled" name="Scheduled" fill="#475569" radius={[2,2,0,0]}/><Bar dataKey="worked" name="Worked" fill="#3b82f6" radius={[2,2,0,0]}/><Bar dataKey="overtime" name="Overtime" fill="#f59e0b" radius={[2,2,0,0]}/></BarChart></ResponsiveContainer></div>
      <div style={DARK_CARD}><SecTitle>Hours Split</SecTitle><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={pie} cx="50%" cy="50%" innerRadius={48} outerRadius={76} dataKey="value" paddingAngle={2}>{pie.map((_,i)=><Cell key={i} fill={['#3b82f6','#f59e0b'][i]}/>)}</Pie><Tooltip formatter={(v:unknown)=>fmtH(Number(v))} contentStyle={TT}/></PieChart></ResponsiveContainer></div>
    </div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden'}}><div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}><SecTitle>HR Register</SecTitle></div>
      <table className="w-full text-sm"><THead cols={['Asset','Driver','Department','Sched. Hrs','Worked Hrs','Overtime','Absent Days','Hourly Rate','Total Labour']}/><tbody>{data.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'10px 16px',fontWeight:600,color:'#F5F7FA'}}>{r.asset}</td><TD>{r.driver}</TD><TD>{r.department}</TD><TD>{r.scheduledHours}</TD><TD>{r.workedHours}</TD><td style={{padding:'10px 16px',color:r.overtime>0?'#f59e0b':'rgba(255,255,255,0.55)',fontWeight:r.overtime>0?700:400,fontSize:13}}>{r.overtime}</td><td style={{padding:'10px 16px',color:r.absentDays>3?'#f87171':'rgba(255,255,255,0.55)',fontSize:13}}>{r.absentDays}</td><TD>{fmt(r.hourlyRate)}/hr</TD><TD bold>{fmt(r.totalLabour)}</TD></TR>))}</tbody></table>
    </div></>
  );
}

function DowntimeTab({data}:{data:DtRecord[]}) {
  if (!data.length) return <Empty/>;
  const totalHours=data.reduce((s,r)=>s+r.hours,0);
  const totalCost=data.reduce((s,r)=>s+r.cost,0);
  const open=data.filter(r=>!r.resolved).length;
  const byCat=Object.entries(data.reduce<Record<string,number>>((a,r)=>({...a,[r.category]:(a[r.category]||0)+r.hours}),{})).map(([name,value])=>({name,value}));
  return(
    <><div className="grid grid-cols-4 gap-4 mb-8">
      <KPI2 icon={<Clock size={16}/>} label="Total Downtime Hours" value={fmtH(totalHours)} accent="amber"/>
      <KPI2 icon={<DollarSign size={16}/>} label="Total Downtime Cost" value={fmt(totalCost)} accent="red"/>
      <KPI2 icon={<AlertCircle size={16}/>} label="Open Issues" value={String(open)} sub="Unresolved" accent="red"/>
      <KPI2 icon={<Shield size={16}/>} label="Resolved" value={String(data.length-open)} accent="emerald"/>
    </div>
    <div className="grid grid-cols-3 gap-5 mb-5">
      <div className="col-span-2" style={DARK_CARD}><SecTitle>Downtime Hours by Category</SecTitle><ResponsiveContainer width="100%" height={220}><BarChart data={byCat} barSize={40}><XAxis dataKey="name" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/><Tooltip contentStyle={TT}/><Bar dataKey="value" name="Hours" radius={[4,4,0,0]}>{byCat.map((_,i)=><Cell key={i} fill={Object.values(CAT_C)[i%4]}/>)}</Bar></BarChart></ResponsiveContainer></div>
      <div style={DARK_CARD}><SecTitle>Category Split</SecTitle><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={byCat} cx="50%" cy="50%" innerRadius={48} outerRadius={76} dataKey="value" paddingAngle={2}>{byCat.map((_,i)=><Cell key={i} fill={Object.values(CAT_C)[i%4]}/>)}</Pie><Tooltip formatter={(v:unknown)=>fmtH(Number(v))} contentStyle={TT}/></PieChart></ResponsiveContainer></div>
    </div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden'}}><div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}><SecTitle>Downtime Log</SecTitle></div>
      <table className="w-full text-sm"><THead cols={['Asset','Date','Category','Reason','Hours','Cost','Status']}/><tbody>{data.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'10px 16px',fontWeight:600,color:'#F5F7FA'}}>{r.asset}</td><TD>{r.date}</TD><td className="px-5 py-3"><Badge label={r.category} color={CAT_C[r.category]||'#94a3b8'}/></td><td style={{padding:'10px 16px',color:'rgba(230,237,243,0.55)',fontSize:13,maxWidth:240}} className="truncate">{r.reason}</td><TD>{r.hours} hrs</TD><TD>{fmt(r.cost)}</TD><td className="px-5 py-3"><Badge label={r.resolved?'Resolved':'Open'} color={r.resolved?'#10b981':'#ef4444'}/></td></TR>))}</tbody></table>
    </div></>
  );
}

function UtilisationTab({data}:{data:UtilRecord[]}) {
  if (!data.length) return <Empty/>;
  const avgUtil=(data.reduce((s,r)=>s+r.utilisationPct,0)/data.length).toFixed(1);
  const totalIdle=data.reduce((s,r)=>s+r.idleCost,0);
  const chartData=data.map(r=>({asset:r.asset,utilisation:r.utilisationPct,idle:100-r.utilisationPct}));
  return(
    <><div className="grid grid-cols-4 gap-4 mb-8">
      <KPI2 icon={<Gauge size={16}/>} label="Avg Utilisation" value={`${avgUtil}%`} accent="blue"/>
      <KPI2 icon={<DollarSign size={16}/>} label="Total Idle Cost" value={fmt(totalIdle)} accent="amber"/>
      <KPI2 icon={<Activity size={16}/>} label="Assets Tracked" value={String(data.length)} accent="emerald"/>
      <KPI2 icon={<AlertCircle size={16}/>} label="Below 70%" value={String(data.filter(r=>r.utilisationPct<70).length)} sub="Underutilised" accent="red"/>
    </div>
    <div style={DARK_CARD}><SecTitle>Utilisation vs Idle by Asset</SecTitle><ResponsiveContainer width="100%" height={260}><BarChart data={chartData} barSize={28}><XAxis dataKey="asset" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} domain={[0,100]} tickFormatter={v=>`${v}%`}/><Tooltip formatter={(v:unknown)=>`${Number(v).toFixed(1)}%`} contentStyle={TT}/><Legend wrapperStyle={{fontSize:11}}/><Bar dataKey="utilisation" name="Utilised %" stackId="a" fill="#10b981" radius={[0,0,0,0]}/><Bar dataKey="idle" name="Idle %" stackId="a" fill="#374151" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden',marginTop:16}}><div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}><SecTitle>Utilisation Register</SecTitle></div>
      <table className="w-full text-sm"><THead cols={['Asset','Type','Scheduled Hrs','Operating Hrs','Idle Hrs','Utilisation %','Idle Cost']}/><tbody>{data.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'10px 16px',fontWeight:600,color:'#F5F7FA'}}>{r.asset}</td><TD>{r.type}</TD><TD>{r.scheduledHours}</TD><TD>{r.operatingHours}</TD><TD>{r.idleHours}</TD><td style={{padding:'10px 16px',fontWeight:700,color:r.utilisationPct<70?'#f87171':r.utilisationPct<80?'#fbbf24':'#4ade80',fontSize:13}}>{r.utilisationPct}%</td><TD>{fmt(r.idleCost)}</TD></TR>))}</tbody></table>
    </div></>
  );
}

function GeofenceTab({trips,stops,coloc}:{trips:TripRecord[];stops:StopRecord[];coloc:ColocRecord[]}) {
  const [assetFilter,setAssetFilter]=useState('All');
  const assets=['All',...Array.from(new Set([...trips.map(t=>t.asset),...stops.map(s=>s.asset)])).sort()];
  const filteredTrips=assetFilter==='All'?trips:trips.filter(t=>t.asset===assetFilter);
  const filteredStops=assetFilter==='All'?stops:stops.filter(s=>s.asset===assetFilter);
  const totalTrips=filteredTrips.length;
  const totalStops=filteredStops.length;
  const totalHours=filteredTrips.reduce((s,t)=>s+t.hoursOut,0);
  const colocEvents=coloc.length;
  const stopByType=Object.entries(filteredStops.reduce<Record<string,number>>((a,s)=>({...a,[s.stopType]:(a[s.stopType]||0)+1}),{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  if(!trips.length&&!stops.length) return <Empty/>;
  return(
    <><div className="grid grid-cols-4 gap-4 mb-6">
      <KPI2 icon={<Truck size={16}/>} label="Total Trips" value={String(totalTrips)} accent="blue"/>
      <KPI2 icon={<MapPin size={16}/>} label="Total Stops" value={String(totalStops)} accent="violet"/>
      <KPI2 icon={<Clock size={16}/>} label="Total Hours Out" value={fmtH(totalHours)} accent="emerald"/>
      <KPI2 icon={<Activity size={16}/>} label="Co-location Events" value={String(colocEvents)} accent="amber"/>
    </div>
    <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
      {assets.map(a=>(<button key={a} onClick={()=>setAssetFilter(a)} style={{padding:'5px 14px',borderRadius:999,fontSize:11,fontWeight:600,cursor:'pointer',border:assetFilter===a?'1px solid rgba(129,140,248,0.4)':'1px solid rgba(255,255,255,0.08)',background:assetFilter===a?'rgba(129,140,248,0.2)':'rgba(255,255,255,0.03)',color:assetFilter===a?'#F5F7FA':'rgba(230,237,243,0.55)'}}>{a}</button>))}
    </div>
    <div className="grid grid-cols-3 gap-5 mb-5">
      <div className="col-span-2" style={DARK_CARD}><SecTitle>Stops by Type</SecTitle><ResponsiveContainer width="100%" height={220}><BarChart data={stopByType} layout="vertical" barSize={14} margin={{left:120}}><XAxis type="number" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="name" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} width={120}/><Tooltip contentStyle={TT}/><Bar dataKey="value" name="Stops" radius={[0,6,6,0]}>{stopByType.map((_,i)=><Cell key={i} fill={STOP_C[_.name]||'#94a3b8'}/>)}</Bar></BarChart></ResponsiveContainer></div>
      {coloc.length>0&&(<div style={DARK_CARD}><SecTitle>Co-location Events</SecTitle><div className="space-y-3">{coloc.slice(0,5).map((c,i)=>(<div key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.05)',paddingBottom:10}}><div style={{fontSize:12,fontWeight:600,color:'#F5F7FA',marginBottom:2}}>{c.area}</div><div style={{fontSize:11,color:'rgba(230,237,243,0.45)'}}>{c.vehicles}</div><div style={{fontSize:10,color:'rgba(230,237,243,0.30)',marginTop:2}}>{c.date} · {c.durationMins} min</div></div>))}</div></div>)}
    </div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden',marginBottom:20}}><div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}><SecTitle>Daily Trip Log</SecTitle></div><div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap"><THead cols={['Asset','Driver','Date','Yard Dep.','Yard Ret.','Hours Out','Stops','Areas Visited']}/><tbody>{filteredTrips.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'10px 16px',fontWeight:600,color:'#F5F7FA'}}>{r.asset}</td><td style={{padding:'10px 16px',color:'rgba(230,237,243,0.55)'}}>{r.driver}</td><TD>{r.date}</TD><td style={{padding:'10px 16px',fontWeight:500,color:'#34d399'}}>{r.yardDep}</td><td style={{padding:'10px 16px',fontWeight:500,color:'#60a5fa'}}>{r.yardRet}</td><TD>{r.hoursOut} hrs</TD><td style={{padding:'10px 16px',textAlign:'center',color:'rgba(230,237,243,0.55)'}}>{r.stopsMade}</td><td style={{padding:'10px 16px',fontSize:12,color:'rgba(230,237,243,0.35)'}}>{r.areasVisited}</td></TR>))}</tbody></table></div></div>
    <div style={{...DARK_CARD,padding:0,overflow:'hidden'}}><div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}><SecTitle>Stop Event Log</SecTitle></div><div className="overflow-x-auto max-h-96 overflow-y-auto"><table className="w-full text-sm whitespace-nowrap"><THead cols={['Asset','Driver','Date','Area / Location','Arrival','Departure','Duration','Stop Type']}/><tbody>{filteredStops.map((r,i)=>(<TR key={i} i={i}><td style={{padding:'8px 16px',fontWeight:600,color:'#F5F7FA'}}>{r.asset}</td><td style={{padding:'8px 16px',color:'rgba(230,237,243,0.55)'}}>{r.driver}</td><TD>{r.date}</TD><TD>{r.area}</TD><td style={{padding:'8px 16px',color:'rgba(230,237,243,0.45)'}}>{r.arrival}</td><td style={{padding:'8px 16px',color:'rgba(230,237,243,0.45)'}}>{r.departure}</td><td style={{padding:'8px 16px',fontWeight:500,color:'rgba(230,237,243,0.55)'}}>{r.durationMins} min</td><td className="px-5 py-2.5"><span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{background:(STOP_C[r.stopType]||'#94a3b8')+'20',color:STOP_C[r.stopType]||'#64748b'}}>{r.stopType}</span></td></TR>))}</tbody></table></div></div></>
  );
}

// ─── Lifecycle & Replacement sample data ──────────────────────────────────────

const LIFECYCLE_SAMPLE = [
  { id:'TRK-001', type:'Heavy Truck', year:2018, purchaseCost:185000, fuel:28400, maintenance:14200, insurance:6800, rego:4200, depreciation:22000, totalOwnership:260600, km:98400, costPerKm:2.65, replacementYear:2028 },
  { id:'TRK-002', type:'Heavy Truck', year:2016, purchaseCost:172000, fuel:31200, maintenance:18600, insurance:6200, rego:4100, depreciation:18000, totalOwnership:250100, km:142800, costPerKm:1.75, replacementYear:2026 },
  { id:'LV-041',  type:'Light Vehicle', year:2021, purchaseCost:42000, fuel:8400, maintenance:3200, insurance:2800, rego:1200, depreciation:6800, totalOwnership:64400, km:44200, costPerKm:1.46, replacementYear:2031 },
  { id:'EXC-007', type:'Excavator', year:2019, purchaseCost:420000, fuel:44200, maintenance:28400, insurance:12400, rego:0, depreciation:52000, totalOwnership:557000, km:0, costPerKm:0, replacementYear:2029 },
  { id:'TRK-008', type:'Heavy Truck', year:2020, purchaseCost:198000, fuel:26800, maintenance:11200, insurance:7200, rego:4400, depreciation:28000, totalOwnership:275600, km:68200, costPerKm:4.04, replacementYear:2030 },
];

const MONTHLY_TREND: MonthlyPoint[] = [
  { month: 'Jul', actual: 142000, budget: 148000 }, { month: 'Aug', actual: 156000, budget: 148000 },
  { month: 'Sep', actual: 138000, budget: 145000 }, { month: 'Oct', actual: 168000, budget: 152000 },
  { month: 'Nov', actual: 144000, budget: 148000 }, { month: 'Dec', actual: 152000, budget: 155000 },
  { month: 'Jan', actual: 131000, budget: 140000 }, { month: 'Feb', actual: 139000, budget: 140000 },
  { month: 'Mar', actual: 162000, budget: 150000 }, { month: 'Apr', actual: 148000, budget: 150000 },
];

const COST_ACCOUNTS: CostAccount[] = [
  { account: 'Wages & Labour', dept: 'Operations',  budget: 380000, actual: 412000 },
  { account: 'Fuel',           dept: 'Fleet',        budget: 280000, actual: 308000 },
  { account: 'Maintenance',    dept: 'Workshop',     budget: 140000, actual: 158000 },
  { account: 'Repairs',        dept: 'Workshop',     budget: 80000,  actual: 92000 },
  { account: 'Insurance',      dept: 'Finance',      budget: 68000,  actual: 67200 },
  { account: 'Rego & Licensing',dept:'Finance',      budget: 42000,  actual: 41800 },
  { account: 'Depreciation',   dept: 'Finance',      budget: 220000, actual: 220000 },
];

const SLA_TARGETS: SLATarget[] = [
  { kpi: 'Fleet availability rate', target: '≥ 92%', actual: '88.4%', status: 'At Risk', note: 'TRK-002 extended downtime' },
  { kpi: 'Scheduled service compliance', target: '100%', actual: '94%', status: 'Missed', note: '3 assets overdue' },
  { kpi: 'Avg cost per km', target: '< $2.50', actual: '$2.74', status: 'Missed', note: 'TRK-008 distorts avg' },
  { kpi: 'Fleet defect resolution', target: '< 48h', actual: '36h', status: 'Met' },
  { kpi: 'Utilisation rate', target: '≥ 75%', actual: '72.8%', status: 'At Risk', note: 'Idle assets — review need' },
  { kpi: 'Overtime as % of hours', target: '< 8%', actual: '6.2%', status: 'Met' },
];

const DEFAULT_ACTIONS: Action[] = [
  { id: '1', title: 'Schedule TRK-002 for major service — overdue', assignee: 'Workshop Manager', dueDate: '2026-05-10', status: 'Not started', priority: 'High' },
  { id: '2', title: 'Review replacement plan for TRK-002 (8 years old, high cost)', assignee: 'Fleet Manager', dueDate: '2026-05-31', status: 'In progress', priority: 'High' },
  { id: '3', title: 'Reduce TRK-008 idle time — reassign route', assignee: 'Operations', dueDate: '2026-06-01', status: 'Not started', priority: 'Medium' },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FleetClient({ dbAssets = [], uploadMeta = null, isDemo = false }: { dbAssets?: Asset[]; uploadMeta?: FleetUploadMeta | null; isDemo?: boolean }) {
  const router = useRouter();
  const [assets,  setAssets]  = useState<Asset[]>([]);
  const [svc,     setSvc]     = useState<SvcRecord[]>([]);
  const [hr,      setHr]      = useState<HRRecord[]>([]);
  const [dt,      setDt]      = useState<DtRecord[]>([]);
  const [util,    setUtil]    = useState<UtilRecord[]>([]);
  const [trips,   setTrips]   = useState<TripRecord[]>([]);
  const [stops,   setStops]   = useState<StopRecord[]>([]);
  const [coloc,   setColoc]   = useState<ColocRecord[]>([]);
  const [search,  setSearch]  = useState('');
  const [dept,    setDept]    = useState('All');

  // Initial load: DB data takes priority, then localStorage, then bundled dummy
  useEffect(() => {
    if (dbAssets.length > 0) {
      setAssets(dbAssets);
      return;
    }
    const saved = localStorage.getItem('fleetAll');
    if (saved) {
      const d = JSON.parse(saved);
      setAssets(d.assets||[]); setSvc(d.svc||[]); setHr(d.hr||[]); setDt(d.dt||[]);
      setUtil(d.util||[]); setTrips(d.trips||[]); setStops(d.stops||[]); setColoc(d.coloc||[]);
      return;
    }
    fetch('/fleet-dummy-data.xlsx')
      .then(r => r.arrayBuffer())
      .then(buf => {
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = (name: string) => { const s = wb.Sheets[name]; return s ? R(XLSX.utils.sheet_to_json(s) as Record<string,unknown>[]) : []; };
        const d = { assets:parseAssets(sheet('Fleet Data')), svc:parseSvc(sheet('Servicing')), hr:parseHR(sheet('HR')), dt:parseDt(sheet('Downtime')), util:parseUtil(sheet('Utilisation')), trips:parseTrips(sheet('Trip Log')), stops:parseStops(sheet('Stop Log')), coloc:parseColoc(sheet('Co-location')) };
        setAssets(d.assets); setSvc(d.svc); setHr(d.hr); setDt(d.dt); setUtil(d.util); setTrips(d.trips); setStops(d.stops); setColoc(d.coloc);
        localStorage.setItem('fleetAll', JSON.stringify(d));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync fresh DB data after router.refresh()
  useEffect(() => {
    if (dbAssets.length > 0) setAssets(dbAssets);
  }, [dbAssets]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const wb = XLSX.read(evt.target!.result, { type: 'binary' });
      const sheet = (name: string) => { const s = wb.Sheets[name]; return s ? R(XLSX.utils.sheet_to_json(s) as Record<string,unknown>[]) : []; };
      const d = { assets:parseAssets(sheet('Fleet Data')), svc:parseSvc(sheet('Servicing')), hr:parseHR(sheet('HR')), dt:parseDt(sheet('Downtime')), util:parseUtil(sheet('Utilisation')), trips:parseTrips(sheet('Trip Log')), stops:parseStops(sheet('Stop Log')), coloc:parseColoc(sheet('Co-location')) };
      setAssets(d.assets); setSvc(d.svc); setHr(d.hr); setDt(d.dt); setUtil(d.util); setTrips(d.trips); setStops(d.stops); setColoc(d.coloc);
      localStorage.setItem('fleetAll', JSON.stringify(d));
      // Persist fleet metrics to DB
      const form = new FormData();
      form.append('file', file);
      form.append('serviceType', 'fleet');
      try {
        await fetch('/api/upload', { method: 'POST', body: form });
        router.refresh();
      } catch { /* local data already set above */ }
    };
    reader.readAsBinaryString(file);
  };

  const depts = ['All', ...Array.from(new Set(assets.map(a => a.department))).sort()];
  const view = assets.filter(a => dept === 'All' || a.department === dept).filter(a => a.id.toLowerCase().includes(search.toLowerCase()) || a.driver.toLowerCase().includes(search.toLowerCase()));
  const total = view.reduce((s, a) => s + a.total, 0);
  const totalKm = view.reduce((s, a) => s + a.km, 0);
  const totalDepr = view.reduce((s, a) => s + a.depreciation, 0);
  const totalDefects = view.reduce((s, a) => s + a.defects, 0);
  const avgCpk = totalKm > 0 ? total / totalKm : 0;
  const highest = view.length ? [...view].sort((a,b)=>b.total-a.total)[0] : null;
  const worstEff = view.length ? [...view].sort((a,b)=>b.costPerKm-a.costPerKm)[0] : null;
  const pieData = (['wages','fuel','maintenance','rego','repairs','insurance'] as const).map(k=>({name:k[0].toUpperCase()+k.slice(1),key:k,value:view.reduce((s,a)=>s+a[k],0)})).filter(d=>d.value>0);
  const topCat = [...pieData].sort((a,b)=>b.value-a.value)[0];
  const deptData = Array.from(new Set(assets.map(a=>a.department))).map(d=>({name:d,cost:assets.filter(a=>a.department===d).reduce((s,a)=>s+a.total,0),assets:assets.filter(a=>a.department===d).length})).sort((a,b)=>b.cost-a.cost);
  const effData = view.map(a=>({id:a.id,cpk:+a.costPerKm.toFixed(2)}));

  const kpis: KPI[] = assets.length ? [
    { label: 'Total Fleet Cost',   value: fmt(total),               sub: `${view.length} assets`,    icon: '💰', status: 'normal' },
    { label: 'Total KM Driven',    value: fmtK(totalKm),            sub: 'This period',              icon: '🗺', status: 'normal' },
    { label: 'Avg Cost / KM',      value: `$${avgCpk.toFixed(2)}`,  sub: 'Fleet average',            icon: '📊', alert: avgCpk > 2.5, status: avgCpk > 2.5 ? 'risk' : avgCpk > 2.0 ? 'watch' : 'normal' },
    { label: 'Fleet Defects',      value: String(totalDefects),     sub: 'Open items',               icon: '🔧', alert: totalDefects > 5, status: totalDefects > 5 ? 'risk' : totalDefects > 2 ? 'watch' : 'normal' },
    { label: 'Total Depreciation', value: fmt(totalDepr),           sub: 'This period',              icon: '📉', status: 'normal' },
  ] : [];

  const P = { bg:'#07080B', card:'rgba(255,255,255,0.04)', indigo:'#818cf8', purple:'#a78bfa', cyan:'#22D3EE' };
  const NEW_C = ['#818cf8','#22D3EE','#F59E0B','#EF4444','#10B981','rgba(255,255,255,0.2)'];
  const TT2 = { borderRadius:14, border:'1px solid rgba(255,255,255,0.08)', boxShadow:'0 8px 30px rgba(0,0,0,0.5)', fontSize:12, background:'#0d0f14' };
  const card: React.CSSProperties = { background:'rgba(255,255,255,0.04)', borderRadius:16, border:'1px solid rgba(255,255,255,0.07)', padding:24 };

  const overviewContent = assets.length === 0 ? (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'80px 0', textAlign:'center' }}>
      <div style={{ background:'rgba(255,255,255,0.06)', padding:20, borderRadius:20, marginBottom:16 }}><Truck size={32} color="rgba(255,255,255,0.3)"/></div>
      <h2 style={{ fontSize:18, fontWeight:700, color:'#F5F7FA', marginBottom:8 }}>No Fleet Data Loaded</h2>
      <p style={{ fontSize:13, color:'rgba(230,237,243,0.45)', marginBottom:20 }}>Upload your multi-sheet Excel file to activate live analytics.</p>
      <label style={{ background:'rgba(129,140,248,0.15)', border:'1px solid rgba(129,140,248,0.3)', color:'#F5F7FA', padding:'10px 20px', borderRadius:10, fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>
        <Upload size={14}/> Upload Fleet Data <input type="file" hidden accept=".xlsx,.xls" onChange={handleUpload}/>
      </label>
    </div>
  ) : (
    <>
      {!isDemo && uploadMeta && <FleetDataBanner meta={uploadMeta} />}
      {isDemo && <FleetDemoBanner />}
      <div style={{ display:'flex', gap:6, marginBottom:20, flexWrap:'wrap' }}>
        {depts.map(d => (
          <button key={d} onClick={() => setDept(d)} style={{
            padding:'6px 16px', borderRadius:999, fontSize:12, fontWeight:600, cursor:'pointer',
            border: dept===d ? '1px solid rgba(129,140,248,0.4)' : '1px solid rgba(255,255,255,0.08)',
            background: dept===d ? 'rgba(129,140,248,0.2)' : 'rgba(255,255,255,0.03)',
            color: dept===d ? '#F5F7FA' : 'rgba(230,237,243,0.55)',
            boxShadow: dept===d ? '0 4px 12px rgba(129,140,248,0.2)' : 'none',
            transition:'all 0.15s ease',
          }}>{d}</button>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16, marginBottom:16 }}>
        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
            <div>
              <p style={{ fontSize:11, fontWeight:700, color:'rgba(230,237,243,0.4)', textTransform:'uppercase', letterSpacing:'0.08em', margin:0 }}>Operational Cost by Asset</p>
              <p style={{ fontSize:11, color:'rgba(230,237,243,0.3)', margin:'3px 0 0' }}>{dept==='All'?'All departments':dept} · stacked by category</p>
            </div>
            <span style={{ fontSize:13, fontWeight:800, color:P.purple }}>{fmt(total)}</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={view} barSize={26} margin={{left:10,right:10}}>
              <XAxis dataKey="id" tick={{fontSize:11,fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <Tooltip formatter={(v:unknown)=>fmt(Number(v))} contentStyle={TT2}/>
              <Legend wrapperStyle={{fontSize:11,paddingTop:14}}/>
              <Bar dataKey="wages"       stackId="a" fill={NEW_C[0]} name="Wages"/>
              <Bar dataKey="fuel"        stackId="a" fill={NEW_C[1]} name="Fuel"/>
              <Bar dataKey="maintenance" stackId="a" fill={NEW_C[2]} name="Maintenance"/>
              <Bar dataKey="repairs"     stackId="a" fill={NEW_C[3]} name="Repairs"/>
              <Bar dataKey="insurance"   stackId="a" fill={NEW_C[4]} name="Insurance"/>
              <Bar dataKey="rego"        stackId="a" fill={NEW_C[5]} name="Rego" radius={[5,5,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{...card, display:'flex', flexDirection:'column'}}>
          <p style={{ fontSize:11, fontWeight:700, color:'rgba(230,237,243,0.4)', textTransform:'uppercase', letterSpacing:'0.08em', margin:'0 0 4px' }}>Cost Category Split</p>
          <div style={{ position:'relative' }}>
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={56} outerRadius={84} dataKey="value" paddingAngle={3}>
                  {pieData.map((_,i)=><Cell key={i} fill={NEW_C[i%6]}/>)}
                </Pie>
                <Tooltip formatter={(v:unknown)=>fmt(Number(v))} contentStyle={TT2}/>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', textAlign:'center', pointerEvents:'none' }}>
              <div style={{ fontSize:13, fontWeight:800, color:'#F5F7FA', lineHeight:1.1 }}>{fmt(total)}</div>
              <div style={{ fontSize:9, color:'rgba(230,237,243,0.4)', fontWeight:700, letterSpacing:'0.06em' }}>TOTAL</div>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:7, marginTop:'auto' }}>
            {[...pieData].sort((a,b)=>b.value-a.value).map((d,i)=>(
              <div key={d.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11 }}>
                <span style={{ display:'flex', alignItems:'center', gap:7, color:'rgba(230,237,243,0.55)' }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:NEW_C[i%6], flexShrink:0 }}/>
                  {d.name}
                </span>
                <div style={{ textAlign:'right' }}>
                  <span style={{ fontWeight:700, color:'#F5F7FA' }}>{((d.value/total)*100).toFixed(1)}%</span>
                  <span style={{ fontSize:10, color:'rgba(230,237,243,0.35)', marginLeft:6 }}>{fmt(d.value)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
        <div style={card}>
          <p style={{ fontSize:11, fontWeight:700, color:'rgba(230,237,243,0.4)', textTransform:'uppercase', letterSpacing:'0.08em', margin:'0 0 14px' }}>Cost by Department</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={deptData} layout="vertical" barSize={14} margin={{left:100,right:20}}>
              <XAxis type="number" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
              <YAxis type="category" dataKey="name" tick={{fontSize:10,fill:'#475569'}} axisLine={false} tickLine={false} width={100}/>
              <Tooltip formatter={(v:unknown)=>fmt(Number(v))} contentStyle={TT2}/>
              <Bar dataKey="cost" name="Cost" radius={[0,6,6,0]}>
                {deptData.map((d,i)=><Cell key={i} fill={DEPT_C[d.name]||'#94a3b8'}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <p style={{ fontSize:11, fontWeight:700, color:'rgba(230,237,243,0.4)', textTransform:'uppercase', letterSpacing:'0.08em', margin:0 }}>Assets to Watch</p>
            <span style={{ fontSize:10, padding:'2px 10px', borderRadius:20, background:'rgba(239,68,68,0.12)', color:'#f87171', fontWeight:700, border:'1px solid rgba(239,68,68,0.2)' }}>
              {effData.filter(d=>d.cpk>avgCpk*1.1).length} over threshold
            </span>
          </div>
          {[...view].sort((a,b)=>b.costPerKm-a.costPerKm).slice(0,5).map((a,i)=>(
            <div key={a.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', borderBottom: i<4?'1px solid rgba(255,255,255,0.05)':'none' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:34, height:34, borderRadius:10, background:a.costPerKm>avgCpk*1.1?'rgba(239,68,68,0.1)':a.costPerKm>avgCpk?'rgba(245,158,11,0.08)':'rgba(16,185,129,0.08)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
                  {a.costPerKm>avgCpk*1.1?'⚠️':a.costPerKm>avgCpk?'⏱':'✅'}
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:'#F5F7FA' }}>{a.id} <span style={{ fontSize:10, color:'rgba(230,237,243,0.4)', fontWeight:400 }}>{a.make}</span></div>
                  <div style={{ fontSize:10, color:'rgba(230,237,243,0.4)' }}>{a.department} · {a.year}</div>
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:13, fontWeight:800, color:a.costPerKm>avgCpk*1.1?'#f87171':a.costPerKm>avgCpk?'#fbbf24':'#4ade80' }}>${a.costPerKm.toFixed(2)}/km</div>
                <div style={{ fontSize:9, color:'rgba(230,237,243,0.35)' }}>fleet avg ${avgCpk.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{...card, marginBottom:16}}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div>
            <p style={{ fontSize:11, fontWeight:700, color:'rgba(230,237,243,0.4)', textTransform:'uppercase', letterSpacing:'0.08em', margin:0 }}>Cost per KM by Asset</p>
            <p style={{ fontSize:11, color:'rgba(230,237,243,0.3)', margin:'3px 0 0' }}>Dashed line = fleet average ${avgCpk.toFixed(2)}/km</p>
          </div>
          <span style={{ fontSize:11, padding:'3px 10px', borderRadius:20, background:`${P.purple}12`, color:P.purple, fontWeight:700, border:`1px solid ${P.purple}30` }}>
            {effData.filter(d=>d.cpk>avgCpk*1.1).length} assets above threshold
          </span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={effData} barSize={28} margin={{left:10,right:10}}>
            <XAxis dataKey="id" tick={{fontSize:11,fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
            <Tooltip formatter={(v:unknown)=>[`$${Number(v).toFixed(2)}/km`,'Cost per KM']} contentStyle={TT2}/>
            <ReferenceLine y={+avgCpk.toFixed(2)} stroke="#94a3b8" strokeDasharray="5 4" label={{ value:'avg', fill:'#94a3b8', fontSize:10 }}/>
            <Bar dataKey="cpk" name="$/km" radius={[6,6,0,0]}>
              {effData.map((d,i)=><Cell key={i} fill={d.cpk>avgCpk*1.1?'#EF4444':d.cpk<avgCpk*0.9?'#10B981':P.purple}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background:'linear-gradient(135deg, #1e1b4b 0%, #312E81 100%)', color:'#fff', borderRadius:16, padding:'20px 28px', marginBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between', gap:24 }}>
        <div>
          <p style={{ fontSize:10, color:'rgba(255,255,255,0.45)', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:700, margin:'0 0 6px' }}>Fleet Summary · FY2025-26</p>
          <p style={{ fontSize:13, color:'rgba(255,255,255,0.88)', lineHeight:1.6, margin:0, maxWidth:800 }}>
            <strong style={{color:'#fff'}}>{view.length} assets</strong> · total cost <strong style={{color:P.cyan}}>{fmt(total)}</strong> across <strong style={{color:'#fff'}}>{fmtK(totalKm)}</strong> at <strong style={{color:avgCpk>2.5?'#FCA5A5':P.cyan}}>${avgCpk.toFixed(2)}/km</strong>.
            {highest && <> Highest cost: <strong style={{color:'#FCA5A5'}}>{highest.id}</strong> at {fmt(highest.total)}.</>}
            {topCat && <> <strong style={{color:P.cyan}}>{topCat.name}</strong> drives {((topCat.value/total)*100).toFixed(1)}% of spend.</>}
          </p>
        </div>
        <div style={{ display:'flex', gap:20, flexShrink:0 }}>
          {[{label:'Defects',value:String(totalDefects),alert:totalDefects>2},{label:'Over Budget',value:effData.filter(d=>d.cpk>avgCpk*1.1).length+' assets',alert:true}].map(m=>(
            <div key={m.label} style={{ textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:800, color:m.alert?'#FCA5A5':'#fff' }}>{m.value}</div>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.07em' }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{...card, padding:0, overflow:'hidden'}}>
        <div style={{ padding:'16px 24px', borderBottom:'1px solid rgba(255,255,255,0.07)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <p style={{ fontSize:11, fontWeight:700, color:'rgba(230,237,243,0.4)', textTransform:'uppercase', letterSpacing:'0.08em', margin:0 }}>Asset Register</p>
            <p style={{ fontSize:11, color:'rgba(230,237,243,0.3)', margin:'2px 0 0' }}>{view.length} assets · {dept==='All'?'all departments':dept}</p>
          </div>
          <input
            style={{ fontSize:12, border:'1px solid rgba(255,255,255,0.1)', borderRadius:9, padding:'7px 13px', outline:'none', color:'#F5F7FA', background:'rgba(255,255,255,0.05)', width:220 }}
            placeholder="Search asset or driver…"
            value={search}
            onChange={e=>setSearch(e.target.value)}
          />
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, whiteSpace:'nowrap' }}>
            <thead>
              <tr style={{ background:'rgba(255,255,255,0.04)', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                {['Asset','Type','Make','Yr','Department','Driver','KM','Wages','Fuel','Maint.','Repairs','Insur.','Rego','Svcs','Defects','$/km','Total'].map(h=>(
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:10, color:'rgba(255,255,255,0.35)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((a,i)=>(
                <tr key={a.id} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', background:i%2===1?'rgba(255,255,255,0.015)':'transparent', transition:'background 0.1s' }}>
                  <td style={{ padding:'10px 14px', fontWeight:700, color:'#818cf8' }}>{a.id}</td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.55)' }}>{a.type}</td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.55)' }}>{a.make}</td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.55)' }}>{a.year}</td>
                  <td style={{ padding:'10px 14px' }}><span style={{ padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:600, background:(DEPT_C[a.department]||'#94a3b8')+'20', color:DEPT_C[a.department]||'rgba(230,237,243,0.55)' }}>{a.department}</span></td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.7)' }}>{a.driver}</td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.55)' }}>{a.km.toLocaleString()}</td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.55)' }}>{fmt(a.wages)}</td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.55)' }}>{fmt(a.fuel)}</td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.55)' }}>{fmt(a.maintenance)}</td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.55)' }}>{fmt(a.repairs)}</td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.55)' }}>{fmt(a.insurance)}</td>
                  <td style={{ padding:'10px 14px', color:'rgba(230,237,243,0.55)' }}>{fmt(a.rego)}</td>
                  <td style={{ padding:'10px 14px', textAlign:'center', color:'rgba(230,237,243,0.55)' }}>{a.services}</td>
                  <td style={{ padding:'10px 14px', textAlign:'center', fontWeight:700, color:a.defects>2?'#f87171':a.defects>0?'#fbbf24':'#4ade80' }}>{a.defects}</td>
                  <td style={{ padding:'10px 14px', fontWeight:700, color:a.costPerKm>avgCpk*1.1?'#f87171':a.costPerKm<avgCpk*0.9?'#4ade80':'rgba(230,237,243,0.55)' }}>${a.costPerKm.toFixed(2)}</td>
                  <td style={{ padding:'10px 14px', fontWeight:800, color:'#F5F7FA' }}>{fmt(a.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background:'rgba(255,255,255,0.06)', borderTop:'2px solid rgba(255,255,255,0.08)' }}>
                <td style={{ padding:'10px 14px', fontWeight:700, fontSize:10, textTransform:'uppercase', color:'rgba(255,255,255,0.5)', letterSpacing:'0.06em' }} colSpan={6}>Total</td>
                <td style={{ padding:'10px 14px', color:'rgba(255,255,255,0.7)', fontSize:11 }}>{totalKm.toLocaleString()} km</td>
                {(['wages','fuel','maintenance','repairs','insurance','rego'] as const).map(k=>(
                  <td key={k} style={{ padding:'10px 14px', color:'rgba(255,255,255,0.7)', fontSize:11 }}>{fmt(view.reduce((s,a)=>s+a[k],0))}</td>
                ))}
                <td style={{ padding:'10px 14px', color:'rgba(255,255,255,0.7)', fontSize:11 }}>{view.reduce((s,a)=>s+a.services,0)}</td>
                <td style={{ padding:'10px 14px', color:'rgba(255,255,255,0.7)', fontSize:11 }}>{totalDefects}</td>
                <td style={{ padding:'10px 14px', color:'rgba(255,255,255,0.7)', fontSize:11 }}>${avgCpk.toFixed(2)}</td>
                <td style={{ padding:'10px 14px', fontWeight:800, color:'#fff', fontSize:12 }}>{fmt(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );

  const industryTabs = [
    { label: 'Servicing', content: <ServicingTab data={svc}/> },
    { label: 'HR & Labour', content: <HRTab data={hr}/> },
    { label: 'Downtime', content: <DowntimeTab data={dt}/> },
    { label: 'Plant Utilisation', content: <UtilisationTab data={util}/> },
    { label: 'Geofence', content: <GeofenceTab trips={trips} stops={stops} coloc={coloc}/> },
    {
      label: 'Lifecycle Cost',
      content: (
        <div>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: 'rgba(255,255,255,0.06)' }}>{['Asset','Type','Year','Purchase Cost','Fuel (YTD)','Maintenance','Insurance','Rego','Depreciation','Total TCO','$/km','Replacement'].map(h=><th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{h}</th>)}</tr></thead>
              <tbody>{LIFECYCLE_SAMPLE.map((a,i)=>(
                <tr key={a.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i%2===0?'transparent':'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '11px 14px', fontWeight: 700 }}>{a.id}</td>
                  <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.6)' }}>{a.type}</td>
                  <td style={{ padding: '11px 14px' }}>{a.year}</td>
                  <td style={{ padding: '11px 14px' }}>${a.purchaseCost.toLocaleString()}</td>
                  <td style={{ padding: '11px 14px' }}>${a.fuel.toLocaleString()}</td>
                  <td style={{ padding: '11px 14px' }}>${a.maintenance.toLocaleString()}</td>
                  <td style={{ padding: '11px 14px' }}>${a.insurance.toLocaleString()}</td>
                  <td style={{ padding: '11px 14px' }}>{a.rego?`$${a.rego.toLocaleString()}`:'—'}</td>
                  <td style={{ padding: '11px 14px', color: '#fbbf24' }}>${a.depreciation.toLocaleString()}</td>
                  <td style={{ padding: '11px 14px', fontWeight: 700, color: '#3b82f6' }}>${a.totalOwnership.toLocaleString()}</td>
                  <td style={{ padding: '11px 14px', color: a.costPerKm > 2.5 ? '#f87171' : a.costPerKm > 0 ? '#4ade80' : 'rgba(255,255,255,0.4)' }}>{a.costPerKm > 0 ? `$${a.costPerKm}` : '—'}</td>
                  <td style={{ padding: '11px 14px', color: a.replacementYear <= 2027 ? '#f87171' : '#e5e7eb' }}>{a.replacementYear}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>TCO by Asset</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={LIFECYCLE_SAMPLE}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="id" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                  <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                  <Tooltip formatter={(v:unknown)=>`$${Number(v).toLocaleString()}`} contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8 }} />
                  <Bar dataKey="totalOwnership" fill="#3b82f6" name="Total TCO" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>Cost Composition (TCO Split)</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={[{ name: 'Purchase', value: LIFECYCLE_SAMPLE.reduce((s,a)=>s+a.purchaseCost,0) }, { name: 'Fuel', value: LIFECYCLE_SAMPLE.reduce((s,a)=>s+a.fuel,0) }, { name: 'Maintenance', value: LIFECYCLE_SAMPLE.reduce((s,a)=>s+a.maintenance,0) }, { name: 'Insurance', value: LIFECYCLE_SAMPLE.reduce((s,a)=>s+a.insurance,0) }, { name: 'Depreciation', value: LIFECYCLE_SAMPLE.reduce((s,a)=>s+a.depreciation,0) }]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name }) => name}>
                    {[...Array(5)].map((_, i) => <Cell key={i} fill={['#6366f1','#3b82f6','#f59e0b','#10b981','#64748b'][i]} />)}
                  </Pie>
                  <Tooltip formatter={(v:unknown)=>`$${Number(v).toLocaleString()}`} contentStyle={{ background: '#1a1a2e', border: 'none', borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ),
    },
    {
      label: 'Replacement Planning',
      content: (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, marginBottom: 20 }}>
            {[['Due for Replacement', '2', 'Within 2 years', '#f87171'], ['High-Cost Assets', '2', 'Above $2.50/km', '#fbbf24'], ['Assets > 8 years', '1', 'TRK-002 (2016)', '#fbbf24'], ['EOFY Budget Required', '$523k', 'For 2 replacements', '#3b82f6']].map(([l, v, s, c]) => (
              <div key={l as string} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{l}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: c as string }}>{v}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>{s}</div>
              </div>
            ))}
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: 'rgba(255,255,255,0.06)' }}>{['Asset','Type','Year','Age (yrs)','TCO','$/km','Maint Cost','Replacement Year','Priority','Recommendation'].map(h=><th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{h}</th>)}</tr></thead>
              <tbody>{LIFECYCLE_SAMPLE.map((a,i) => {
                const age = 2026 - a.year;
                const priority = a.replacementYear <= 2027 ? 'Urgent' : a.replacementYear <= 2029 ? 'Planned' : 'Monitor';
                const rec = a.costPerKm > 3 ? 'Replace — high $/km' : age > 7 ? 'Replace — age + maintenance risk' : age > 5 ? 'Monitor — approaching end of life' : 'Keep — within useful life';
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i%2===0?'transparent':'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '11px 14px', fontWeight: 700 }}>{a.id}</td>
                    <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.6)' }}>{a.type}</td>
                    <td style={{ padding: '11px 14px' }}>{a.year}</td>
                    <td style={{ padding: '11px 14px', color: age > 7 ? '#f87171' : '#e5e7eb' }}>{age}</td>
                    <td style={{ padding: '11px 14px', fontWeight: 600 }}>${a.totalOwnership.toLocaleString()}</td>
                    <td style={{ padding: '11px 14px', color: a.costPerKm > 2.5 ? '#f87171' : a.costPerKm > 0 ? '#4ade80' : 'rgba(255,255,255,0.4)' }}>{a.costPerKm > 0 ? `$${a.costPerKm}` : '—'}</td>
                    <td style={{ padding: '11px 14px' }}>${a.maintenance.toLocaleString()}</td>
                    <td style={{ padding: '11px 14px' }}>{a.replacementYear}</td>
                    <td style={{ padding: '11px 14px' }}><span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: priority === 'Urgent' ? 'rgba(248,113,113,0.15)' : priority === 'Planned' ? 'rgba(251,191,36,0.15)' : 'rgba(74,222,128,0.15)', color: priority === 'Urgent' ? '#f87171' : priority === 'Planned' ? '#fbbf24' : '#4ade80' }}>{priority}</span></td>
                    <td style={{ padding: '11px 14px', fontSize: 12, color: rec.includes('Replace') ? '#f87171' : 'rgba(255,255,255,0.6)' }}>{rec}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      ),
    },
  ];

  return (
    <DashboardShell
      theme="dark"
      title="Fleet Management"
      subtitle="Asset lifecycle costing · Fuel & utilisation · Maintenance · HR & labour · Geofence"
      headerColor="#1E1B4B"
      accentColor="#7C3AED"
      breadcrumbLabel="Fleet Management"
      kpis={kpis}
      recommendedActions={[
        {title:"Replace high cost-per-km assets (save $45k–$80k annually)",explanation:"Top 3 vehicles exceed fleet average cost/km by more than 40%. Held past optimal disposal point due to capital budget cap — not operational cost data.",impact:"$45,000–$80,000 annual savings on replacement assets",priority:"High"},
        {title:"Clear overdue service backlog before $28k in breakdown costs land",explanation:"Multiple assets past next-service due date. Deferred maintenance increases breakdown risk, invalidates warranty, and raises insurance exposure.",impact:"Prevent est. $28,000 in breakdown repair costs",priority:"High"},
        {title:"Reduce idle time on underutilised assets (save $18k–$35k annually)",explanation:"Vehicles averaging 28% idle time accumulate $18 per idle hour in fuel and engine wear. No telematics idle-reduction policy currently enforced.",impact:"$18,000–$35,000 annual idle cost reduction",priority:"Medium"},
        {title:"Optimise high-consumption routes (save $12k–$18k in annual fuel cost)",explanation:"Fuel is the largest operating cost driver. GPS-based route coaching and driver profiling can reduce consumption by 8–12% without adding resources.",impact:"Est. $12,000–$18,000 annual fuel saving",priority:"Medium"},
      ]}
      insightCards={[
        {problem:"4 vehicles above $180K total ownership cost — held 2+ years past optimal disposal point",cause:"Replacement decisions driven by capital budget cap, not operational cost data — asset cost analysis not reviewed this FY",recommendation:"Approve disposal of the 2 highest-cost assets this quarter; net replacement benefit $45k–$80k annually",severity:"High"},
        {problem:"Fleet idle time averaging 28% — costing est. $94k annually at $18 per idle hour",cause:"No telematics-based idle reduction policy in place; drivers unaware of the financial cost of engine idling",recommendation:"Deploy idle alert thresholds in telematics; target 10% idle rate — projected saving $18k–$35k annually",severity:"Medium"},
        {problem:"6 assets past scheduled service date — WHS liability and insurance exposure rising daily",cause:"Workshop at capacity with 3 mechanics short; service backlog growing faster than throughput allows",recommendation:"Outsource overflow maintenance immediately; clear full backlog within 30 days to restore compliance",severity:"Medium"},
      ]}
      overviewContent={overviewContent}
      industryTabs={industryTabs}
      sampleData={{ 'Fleet Data': LIFECYCLE_SAMPLE }}
      monthlyTrend={MONTHLY_TREND}
      costAccounts={COST_ACCOUNTS}
      slaTargets={SLA_TARGETS}
      defaultActions={DEFAULT_ACTIONS}
      aiContext="This is a fleet management dashboard for local government. Key concerns are TRK-002 age and service overdue, TRK-008 high cost per km, and overall fleet availability."
      executiveSummary="Fleet operating costs are trending above budget with 4 assets past disposal threshold and 6 overdue service schedules — $45k–$80k in savings identified from replacement and idle reduction."
      snapshotPanel={{ topCostDriver: 'Fuel & maintenance on TRK-002 / TRK-008', biggestRisk: 'Overdue service schedules creating WHS liability across 6 assets', savingsIdentified: 103000, confidence: 87, lastUpdated: 'Apr 2026' }}
    />
  );
}

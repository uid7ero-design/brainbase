import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import pg from 'pg';
const state=vi.hoisted(()=>({pool:null as pg.Pool|null,role:'manager',org:'a',signed:true,enabled:true}));
vi.mock('@/lib/db',()=>{
 type Query={text:string;values:unknown[];then:PromiseLike<unknown>['then']};
 const tag=(strings:TemplateStringsArray,...inputs:unknown[]):Query=>{
   let text=strings[0];const values:unknown[]=[];
   inputs.forEach((value,i)=>{if(value&&typeof value==='object'&&'text' in value&&'values' in value){const q=value as Query;const offset=values.length;text+=q.text.replace(/\$(\d+)/g,(_,n)=>'$'+(Number(n)+offset));values.push(...q.values);}else{values.push(value);text+='$'+values.length;}text+=strings[i+1];});
   return {text,values,then(resolve,reject){return state.pool!.query(text,values).then(r=>r.rows).then(resolve,reject);}};
 };return {default:tag};
});
vi.mock('@/lib/org',()=>({requireSession:async()=>{if(!state.signed)throw Error();return {userId:'writer',organisationId:state.org,role:state.role};},unauthorized:()=>Response.json({error:'Unauthorized'},{status:401}),forbidden:()=>Response.json({error:'Forbidden'},{status:403})}));
vi.mock('@/lib/capabilities/requireCapability',()=>({requireCapability:async()=>{if(!state.enabled)throw Error();},CapabilityDatabaseError:class extends Error{}}));
const deals=await import('@/app/api/crm/deals/route');const deal=await import('@/app/api/crm/deals/[id]/route');
const contacts=await import('@/app/api/crm/contacts/route');const companies=await import('@/app/api/crm/companies/route');const activities=await import('@/app/api/crm/activities/route');
const {NextRequest}=await import('next/server');
const request=(body:unknown,method='POST')=>new NextRequest('http://localhost/api/crm/deals',{method,body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
const a='10000000-0000-4000-8000-000000000001',b='20000000-0000-4000-8000-000000000002';
const context=(id=a)=>({params:Promise.resolve({id})});
const suite=process.env.CRM_TEST_DATABASE_URL?describe:describe.skip;
suite('CRM actual routes and disposable SQL',()=>{
 beforeAll(async()=>{const url=process.env.CRM_TEST_DATABASE_URL!;if(!/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/crmtest$/.test(url))throw Error('Owned loopback CRM test database required');state.pool=new pg.Pool({connectionString:url});await state.pool.query(`
 CREATE TABLE users(id text PRIMARY KEY,organisation_id text,status text,name text);
 CREATE TABLE crm_companies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id text,created_by text,name text,website text,industry text,company_size text,phone text,address text,notes text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE crm_contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id text,created_by text,first_name text,last_name text,email text,phone text,job_title text,company_id uuid,notes text,classification text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE crm_deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id text,created_by text,title text,value numeric,stage text,probability numeric,expected_close date,company_id uuid,contact_id uuid,assigned_to text,notes text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 CREATE TABLE crm_activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id text,created_by text,type text,subject text,body text,activity_date timestamptz,contact_id uuid,company_id uuid,deal_id uuid);`);});
 afterAll(async()=>state.pool?.end());
 beforeEach(async()=>{state.role='manager';state.org='a';state.signed=true;state.enabled=true;await state.pool!.query(`TRUNCATE users,crm_companies,crm_contacts,crm_deals,crm_activities;INSERT INTO users VALUES('writer','a','ACTIVE','Writer'),('foreign','b','ACTIVE','Foreign'),('inactive','a','INACTIVE','Inactive');INSERT INTO crm_companies(id,organisation_id,name)VALUES('${a}','a','Local'),('${b}','b','Foreign');INSERT INTO crm_contacts(id,organisation_id,first_name,last_name)VALUES('${a}','a','Local','Contact'),('${b}','b','Foreign','Contact');INSERT INTO crm_deals(id,organisation_id,title,stage,notes,company_id,contact_id,assigned_to)VALUES('${a}','a','Keep title','lead','Keep notes','${a}','${a}','writer'),('${b}','b','Foreign','lead',null,null,null,null);`);});
 it('stage PATCH preserves all unrelated fields',async()=>{const r=await deal.PATCH(request({stage:'qualified'},'PATCH'),context());expect(r.status).toBe(200);const row=(await r.json()).deal;expect(row).toMatchObject({stage:'qualified',title:'Keep title',notes:'Keep notes',company_id:a,contact_id:a,assigned_to:'writer'});});
 it('stage PATCH refuses foreign root IDs and extra fields',async()=>{expect((await deal.PATCH(request({stage:'qualified'},'PATCH'),context(b))).status).toBe(404);expect((await deal.PATCH(request({stage:'qualified',notes:'overwrite'},'PATCH'),context())).status).toBe(400);});
 it.each(['company_id','contact_id','assigned_to'])('refuses a foreign %s on deal creation',async key=>{expect((await deals.POST(request({title:'Test',[key]:key==='assigned_to'?'foreign':b}))).status).toBe(400);expect((await state.pool!.query('SELECT count(*) FROM crm_deals')).rows[0].count).toBe('2');});
 it('allows owned links and refuses inactive assignment',async()=>{expect((await deals.POST(request({title:'Test',company_id:a,contact_id:a,assigned_to:'writer'}))).status).toBe(201);expect((await deals.POST(request({title:'Test',assigned_to:'inactive'}))).status).toBe(400);});
 it('refuses foreign contact-company and activity-deal links',async()=>{expect((await contacts.POST(request({first_name:'Test',last_name:'Contact',company_id:b}))).status).toBe(400);expect((await activities.POST(request({type:'note',subject:'Test',deal_id:b}))).status).toBe(400);});
 it('does not allow a full deal update to attach a foreign link',async()=>{expect((await deal.PUT(request({title:'Bad',contact_id:b},'PUT'),context())).status).toBe(400);expect((await state.pool!.query('SELECT title FROM crm_deals WHERE id=$1',[a])).rows[0].title).toBe('Keep title');});
 it.each(['viewer','unknown'])('refuses %s CRUD before SQL writes',async role=>{state.role=role;for(const route of [deals,contacts,companies,activities])expect((await route.POST(request({}))).status).toBe(403);expect((await deal.PATCH(request({stage:'closed_won'},'PATCH'),context())).status).toBe(403);expect((await deal.DELETE(request({},'DELETE'),context())).status).toBe(403);});
 it('handles anonymous and revoked capability without a write',async()=>{state.signed=false;expect((await deals.POST(request({title:'Test'}))).status).toBe(401);state.signed=true;state.enabled=false;expect((await deal.PATCH(request({stage:'closed_won'},'PATCH'),context())).status).toBe(403);});
 it('does not disclose foreign display values from a legacy bad link',async()=>{await state.pool!.query('UPDATE crm_deals SET company_id=$1,contact_id=$1,assigned_to=$2 WHERE id=$3',[b,'foreign',a]);const r=await deal.GET(request({},'POST'),context());const row=(await r.json()).deal;expect(row.company_name).toBeNull();expect(row.contact_name).toBeNull();expect(row.assigned_to_name).toBeNull();});
});

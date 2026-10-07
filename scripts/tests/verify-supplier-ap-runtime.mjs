import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { chromium, expect } from '@playwright/test';

// Run after next build --webpack. No application modules or route handlers are
// mocked. Ancillary prerequisite tables are minimal fixtures; bills/payments use
// their production migrations. All resources are disposable and loopback-only.
readFileSync('.next/BUILD_ID','utf8');
const container = `brainbase-ap-runtime-${process.pid}`;
const database = `ap_runtime_${process.pid}`;
const artifacts = resolve('test-results/ap-runtime'); mkdirSync(artifacts,{recursive:true});
const freePort = () => new Promise((done,reject) => {
  const server=createServer(); server.once('error',reject); server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>done(port));});
});
async function command(binary,args) {
  return new Promise((done,reject)=>{const child=spawn(binary,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('exit',code=>code===0?done(output):reject(new Error(`${binary} failed (${code}): ${output}`)));});
}
const pause = ms => new Promise(done=>setTimeout(done,ms));
let pool, next, browser; let nextLog=''; let containerCreated=false;
const supplier='00000000-0000-0000-0000-000000000101';
const bill1='00000000-0000-0000-0000-000000000201', bill2='00000000-0000-0000-0000-000000000202';
const po='00000000-0000-0000-0000-000000000301';
try {
  const postgresPort=await freePort(), httpPort=await freePort();
  await command('docker',['run','--name',container,'-e','POSTGRES_PASSWORD=test','-p',`127.0.0.1:${postgresPort}:5432`,'-d','postgres:16-alpine']);containerCreated=true;
  for(let attempt=0;attempt<30;attempt++){try{await command('docker',['exec',container,'pg_isready','-U','postgres']);break;}catch{await pause(500);}}
  await command('docker',['exec',container,'createdb','-U','postgres',database]);
  const databaseUrl=`postgresql://postgres:test@127.0.0.1:${postgresPort}/${database}`;
  pool=new Pool({connectionString:databaseUrl});
  await pool.query(`CREATE TABLE organisations(id text PRIMARY KEY,name text,slug text,industry text,logo_url text);
    CREATE TABLE users(id text PRIMARY KEY,organisation_id text REFERENCES organisations(id),role text,status text,name text,username text,password_hash text,
      email text,first_name text,last_name text,display_name text,avatar_url text,bio text,job_title text,department text,phone text,timezone text,preferences jsonb,last_seen_at timestamptz);
    CREATE TABLE modules(key text PRIMARY KEY,name text,active boolean);
    CREATE TABLE organisation_modules(organisation_id text REFERENCES organisations(id),module_key text REFERENCES modules(key),enabled boolean,config jsonb);
    CREATE TABLE commercial_suppliers(id uuid PRIMARY KEY,organisation_id text REFERENCES organisations(id),name text,active boolean,UNIQUE(id,organisation_id));
    CREATE TABLE commercial_products(id uuid PRIMARY KEY,organisation_id text,UNIQUE(id,organisation_id));
    CREATE TABLE commercial_purchase_orders(id uuid PRIMARY KEY,organisation_id text,supplier_id uuid,purchase_order_number text,status text,currency text,UNIQUE(id,organisation_id));
    CREATE TABLE commercial_purchase_order_lines(id uuid PRIMARY KEY,organisation_id text,purchase_order_id uuid,position integer,UNIQUE(id,organisation_id));
    CREATE TABLE commercial_tax_codes(id uuid,organisation_id text,active boolean,code text,sort_order integer);
    CREATE TABLE audit_logs(id text,organisation_id text,user_id text,action text,resource_type text,resource_id text,before_state jsonb,after_state jsonb,created_at timestamptz DEFAULT now());`);
  for(const file of ['create-commercial-supplier-bills.sql','create-commercial-supplier-payments.sql','create-commercial-document-attachments.sql','widen-commercial-document-attachments-for-supplier-bills.sql']) await pool.query(readFileSync(`scripts/${file}`,'utf8'));
  // Rehearse the additive existing-install upgrade twice without touching facts.
  const upgrade=readFileSync('scripts/add-commercial-supplier-payment-idempotency.sql','utf8');await pool.query(upgrade);await pool.query(upgrade);
  await pool.query(`INSERT INTO organisations VALUES ('runtime-a','Runtime purchaser','ap-runtime',NULL,NULL),('runtime-b','Other purchaser','ap-other',NULL,NULL);
    INSERT INTO modules VALUES ('purchasing','Purchasing',true);
    INSERT INTO organisation_modules VALUES ('runtime-a','purchasing',true,'{}'),('runtime-b','purchasing',true,'{}');
    INSERT INTO commercial_suppliers VALUES ('${supplier}','runtime-a','Runtime supplier',true);
    INSERT INTO commercial_purchase_orders VALUES ('${po}','runtime-a','${supplier}','PO-RUNTIME','ISSUED','AUD');
    INSERT INTO commercial_supplier_bills(id,organisation_id,source_purchase_order_id,supplier_id,supplier_invoice_number,bill_number,status,currency,subtotal_cents,total_cents,posted_at,due_date,supplier_name_snapshot,bill_date)
      VALUES ('${bill1}','runtime-a','${po}','${supplier}','INV1','SB1','POSTED','AUD',10000,10000,'2026-09-01','2026-09-05','Runtime supplier','2026-09-01'),
             ('${bill2}','runtime-a','${po}','${supplier}','INV2','SB2','POSTED','AUD',5000,5000,'2026-09-01',NULL,'Runtime supplier','2026-09-01');`);
  const password=randomBytes(16).toString('hex'); const hash=await bcrypt.hash(password,6);
  for(const [id,org,role] of [['runtime-admin','runtime-a','ADMIN'],['runtime-viewer','runtime-a','VIEWER'],['runtime-other','runtime-b','ADMIN']]) await pool.query('INSERT INTO users(id,organisation_id,role,status,name,username,password_hash,preferences) VALUES($1,$2,$3,\'ACTIVE\',$1,$1,$4,\'{}\')',[id,org,role,hash]);
  const secret=randomBytes(32).toString('hex');
  next=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(httpPort)],{windowsHide:true,env:{...process.env,DATABASE_URL:databaseUrl.replace('127.0.0.1','localhost'),SESSION_SECRET:secret,NODE_OPTIONS:`--require "${resolve('scripts/tests/helpers/localNeonFetch.cjs').replaceAll('\\','/')}"`,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  const capture = data => { nextLog+=data;writeFileSync(resolve(artifacts,'next-server.log'),nextLog); };
  next.stdout.on('data',capture);next.stderr.on('data',capture);
  const origin=`http://127.0.0.1:${httpPort}`;
  for(let attempt=0;attempt<60;attempt++){if(next.exitCode!==null) throw new Error(`Next startup failed: ${nextLog}`);try{await fetch(`${origin}/login`);break;}catch{await pause(500);}}
  const unauthorized=await fetch(`${origin}/api/commercial/purchasing/ap-overview?aging_date=2026-10-03`,{redirect:'manual'});
  if(unauthorized.status!==401) throw new Error('API must deny unauthenticated requests');
  const protectedPage=await fetch(`${origin}/commercial/purchasing/ap-overview`,{redirect:'manual'});
  if(protectedPage.status!==307 || !protectedPage.headers.get('location')?.includes('/login')) throw new Error('Middleware must redirect unauthenticated pages');
  const expired=await new SignJWT({userId:'runtime-admin',organisationId:'runtime-a',role:'admin',expiresAt:'2000-01-01'}).setProtectedHeader({alg:'HS256'}).setExpirationTime(1).sign(new TextEncoder().encode(secret));
  for(const token of ['invalid-session',expired]) {
    if((await fetch(`${origin}/api/commercial/purchasing/ap-overview?aging_date=2026-10-03`,{headers:{cookie:`session=${token}`},redirect:'manual'})).status!==401) throw new Error('Invalid or expired session accepted by API');
    if((await fetch(`${origin}/commercial/purchasing/ap-overview`,{headers:{cookie:`session=${token}`},redirect:'manual'})).status!==307) throw new Error('Invalid or expired session accepted by middleware');
  }
  browser=await chromium.launch(); const errors=[]; const failedApi=[];
  async function login(username) {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.url().includes('/api/commercial/') && response.status()>=500) failedApi.push({url:new URL(response.url()).pathname,status:response.status()});});
    await page.goto(`${origin}/login`);await page.getByLabel('Username',{exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill(password);
    const submitted=page.waitForResponse(response=>new URL(response.url()).pathname==='/login' && response.request().method()==='POST');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await submitted;
    const session=(await context.cookies()).find(cookie=>cookie.name==='session');
    if(!session?.httpOnly || !session.secure || session.sameSite!=='Lax') throw new Error('Actual login did not issue the expected secure session cookie');
    await page.goto(`${origin}/commercial/purchasing/ap-overview`);return {context,page};
  }
  const {page}=await login('runtime-admin');
  console.log('Real login and middleware checks passed.');
  await expect(page.getByRole('heading',{name:'Supplier AP Overview',exact:true})).toBeVisible();
  await page.getByLabel('Aging date').fill('2026-10-03');await expect(page.getByRole('link',{name:'SB1',exact:true})).toBeVisible();
  await page.screenshot({path:resolve(artifacts,'overview-desktop.png'),fullPage:true});
  await page.goto(`${origin}/commercial/purchasing/suppliers/${supplier}/remittance`);
  await page.getByLabel('Currency',{exact:true}).selectOption('AUD');await page.getByLabel('Allocate SB1').fill('40');await page.getByLabel('Allocate SB2').fill('50');await page.getByLabel('Payment method').selectOption('BANK_TRANSFER');
  await page.getByRole('button',{name:'Record Remittance',exact:true}).click();await expect(page.getByText('Payment recorded: $90.00',{exact:true})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('link',{name:'Download remittance PDF'}).click();await(await downloadEvent).saveAs(resolve(artifacts,'recorded.pdf'));
  await page.getByRole('link',{name:'View SB1 payment history'}).click();await expect(page.getByText('PARTIALLY PAID',{exact:true})).toBeVisible();
  await expect(page.getByText('5 Sep 2026',{exact:true})).toBeVisible();
  const billDates=await page.evaluate(async id=>(await(await fetch(`/api/commercial/supplier-bills/${id}`)).json()).supplierBill,bill1);
  if(billDates.due_date!=='2026-09-05' || billDates.bill_date!=='2026-09-01') throw new Error('Date-only bill value shifted through timezone conversion');
  await page.screenshot({path:resolve(artifacts,'bill-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Reverse Payment',exact:true}).click();await page.getByLabel('Reversal Reason').fill('Runtime verification');await page.getByRole('button',{name:'Confirm Reversal',exact:true}).click();
  await expect(page.getByText('Reversed: Runtime verification',{exact:true})).toBeVisible();
  const reversedEvent=page.waitForEvent('download');await page.getByRole('link',{name:'Download remittance PDF'}).click();await(await reversedEvent).saveAs(resolve(artifacts,'reversed.pdf'));
  const payment=(await pool.query('SELECT id FROM commercial_supplier_payments')).rows[0].id;
  const audit=(await pool.query("SELECT action FROM audit_logs WHERE resource_type='commercial_supplier_payment' ORDER BY created_at")).rows;
  if(audit.length!==2) throw new Error('Real record/reversal audit writes missing');
  // Fixed timeline fixture for reproducible historical runtime verification.
  await pool.query("UPDATE commercial_supplier_payments SET paid_at='2026-10-02',created_at='2026-10-02',reversed_at='2026-10-05'; UPDATE commercial_supplier_payment_allocations SET created_at='2026-10-02'");
  await page.goto(`${origin}/commercial/purchasing/ap-overview`);await page.getByLabel('Aging date').fill('2026-10-03');await page.getByLabel('Balance basis').selectOption('HISTORICAL_RECORDED_BALANCE');
  await expect(page.getByText(/Recorded balances at the end/)).toContainText('(UTC)');
  const csvEvent=page.waitForEvent('download');await page.getByRole('link',{name:'Export bills CSV'}).click();const csvDownload=await csvEvent;await csvDownload.saveAs(resolve(artifacts,'historical-bills.csv'));
  const csv=readFileSync(resolve(artifacts,'historical-bills.csv'),'utf8');if(!csv.includes('10000,4000,6000') || !csv.includes('5000,5000,0') || !csv.includes(',UTC')) throw new Error('Historical runtime CSV does not reconcile');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(artifacts,'overview-mobile.png'),fullPage:true});
  // The unchanged admin JWT must obey current database role/status/organisation.
  const mutation=`${origin}/api/commercial/suppliers/${supplier}/payments`;
  const status = (target,url,method='GET') => target.evaluate(async ({url,method}) => (await fetch(url,{method,headers:method==='POST'?{'Content-Type':'application/json'}:undefined,body:method==='POST'?'{}':undefined})).status,{url,method});
  await pool.query("UPDATE users SET role='VIEWER' WHERE id='runtime-admin'");
  if(await status(page,mutation,'POST')!==403) throw new Error('DB role downgrade not enforced');
  await pool.query("UPDATE users SET status='INACTIVE' WHERE id='runtime-admin'");
  if(await status(page,mutation)!==401) throw new Error('Inactive DB user not rejected');
  await pool.query("UPDATE users SET status='ACTIVE',organisation_id='runtime-b' WHERE id='runtime-admin'");
  if(await status(page,mutation)!==401) throw new Error('Reassigned user JWT not rejected');
  await pool.query("UPDATE users SET role='ADMIN',organisation_id='runtime-a' WHERE id='runtime-admin'");
  await pool.query("UPDATE organisation_modules SET enabled=false WHERE organisation_id='runtime-a'");
  if(await status(page,mutation)!==403) throw new Error('Disabled capability not enforced');
  await pool.query("UPDATE organisation_modules SET enabled=true WHERE organisation_id='runtime-a'");
  const viewer=await login('runtime-viewer');await viewer.page.goto(`${origin}/commercial/purchasing/supplier-bills/${bill1}`);
  await expect(viewer.page.getByRole('button',{name:'Record Payment',exact:true})).toHaveCount(0);
  if(await status(viewer.page,mutation,'POST')!==403) throw new Error('Viewer mutation accepted');
  const other=await login('runtime-other');
  if(await status(other.page,`${origin}/api/commercial/supplier-bills/${bill1}/payments`)!==404 || await status(other.page,`${origin}/api/commercial/supplier-payments/${payment}/remittance`)!==404) throw new Error('Foreign-tenant AP identity exposed');
  if(errors.length || failedApi.length) throw new Error(JSON.stringify({errors,failedApi}));
  const evidence={verified_at:new Date().toISOString(),build_id:readFileSync('.next/BUILD_ID','utf8').trim(),checks:['real login and secure cookie','middleware redirect','invalid and expired session denial','production styled AP pages','calendar-date round trip','multi-bill record and reversal','real audit persistence','PDF and historical CSV downloads','DB role/status/tenant revalidation','capability denial','viewer mutation denial','foreign-tenant 404'],screenshots:['overview-desktop.png','bill-desktop.png','overview-mobile.png']};
  writeFileSync(resolve(artifacts,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
} finally {
  await browser?.close();
  if(next?.pid){if(process.platform==='win32') await command('taskkill',['/PID',String(next.pid),'/T','/F']).catch(()=>{});else next.kill('SIGTERM');}
  writeFileSync(resolve(artifacts,'next-server.log'),nextLog);
  await pool?.end();if(containerCreated) await command('docker',['rm','-f',container]);
}

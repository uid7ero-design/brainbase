import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { chromium, expect } from '@playwright/test';
import { parse } from 'csv-parse/sync';

// Run after next build --webpack. No application modules or route handlers are
// mocked. Ancillary prerequisite tables are minimal fixtures; finance tables use
// their production migrations. All resources are disposable and loopback-only.
// This exercises Neon parameter parsing without Prisma's inferred parameter
// types, catching untyped JSON event parameters in prepare and period reopen.
// Requires Docker and Chromium. Run: node scripts/tests/verify-finance-controls-runtime.mjs
// Set FINANCE_RUNTIME_ARTIFACTS to override the test-results output directory.
readFileSync('.next/BUILD_ID','utf8');
const container = `brainbase-ap-runtime-${process.pid}`;
const database = `ap_runtime_${process.pid}`;
const artifacts = resolve(process.env.FINANCE_RUNTIME_ARTIFACTS || 'test-results/finance-controls-runtime'); mkdirSync(artifacts,{recursive:true});
const serverTimezone = process.env.FINANCE_RUNTIME_TIMEZONE || 'Australia/Adelaide';
const freePort = () => new Promise((done,reject) => {
  const server=createServer(); server.once('error',reject); server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>done(port));});
});
async function command(binary,args) {
  return new Promise((done,reject)=>{const child=spawn(binary,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('exit',code=>code===0?done(output):reject(new Error(`${binary} failed (${code}): ${output}`)));});
}
const pause = ms => new Promise(done=>setTimeout(done,ms));
let pool, next, browser; let nextLog=''; let containerCreated=false;
const supplier='00000000-0000-4000-8000-000000000101';
const bill1='00000000-0000-4000-8000-000000000201', bill2='00000000-0000-4000-8000-000000000202';
const po='00000000-0000-4000-8000-000000000301';
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
    CREATE TABLE crm_companies(id uuid PRIMARY KEY);
    CREATE TABLE crm_contacts(id uuid PRIMARY KEY);
    CREATE TABLE audit_logs(id text,organisation_id text,user_id text,action text,resource_type text,resource_id text,before_state jsonb,after_state jsonb,created_at timestamptz DEFAULT now());`);
  for(const file of ['create-commercial-core.sql','create-commercial-quotes.sql','create-commercial-purchasing.sql','create-commercial-document-deliveries.sql','widen-commercial-document-deliveries-for-purchase-orders.sql','create-commercial-purchase-receipts.sql','create-commercial-supplier-bills.sql','create-commercial-purchase-match-allocations.sql','create-commercial-finance-close.sql','create-commercial-budgeting.sql','create-commercial-finance-adjustments.sql','create-commercial-external-gl.sql','create-commercial-finance-reconciliation.sql','create-commercial-supplier-payments.sql','create-commercial-document-attachments.sql','widen-commercial-document-attachments-for-supplier-bills.sql','widen-commercial-document-attachments-for-purchase-receipts.sql']) await pool.query(readFileSync(`scripts/${file}`,'utf8'));
  // Rehearse the additive existing-install upgrade twice without touching facts.
  const upgrade=readFileSync('scripts/add-commercial-supplier-payment-idempotency.sql','utf8');await pool.query(upgrade);await pool.query(upgrade);
  await pool.query(`INSERT INTO organisations VALUES ('runtime-a','Runtime purchaser','ap-runtime',NULL,NULL),('runtime-b','Other purchaser','ap-other',NULL,NULL);
    INSERT INTO modules VALUES ('purchasing','Purchasing',true);
    INSERT INTO organisation_modules VALUES ('runtime-a','purchasing',true,'{}'),('runtime-b','purchasing',true,'{}');
    INSERT INTO commercial_suppliers(id,organisation_id,name,active) VALUES ('${supplier}','runtime-a','Runtime supplier',true);
    INSERT INTO commercial_purchase_orders(id,organisation_id,supplier_id,purchase_order_number,status,currency) VALUES ('${po}','runtime-a','${supplier}','PO-RUNTIME','ISSUED','AUD');
    INSERT INTO commercial_supplier_bills(id,organisation_id,source_purchase_order_id,supplier_id,supplier_invoice_number,bill_number,status,currency,subtotal_cents,total_cents,posted_at,due_date,supplier_name_snapshot,bill_date)
      VALUES ('${bill1}','runtime-a','${po}','${supplier}','INV1','SB1','POSTED','AUD',10000,10000,'2026-09-01','2026-09-05','Runtime supplier','2026-09-01'),
             ('${bill2}','runtime-a','${po}','${supplier}','INV2','SB2','POSTED','AUD',5000,5000,'2026-09-01',NULL,'Runtime supplier','2026-09-01');`);
  const password=randomBytes(16).toString('hex'); const hash=await bcrypt.hash(password,6);
  for(const [id,org,role] of [['runtime-admin','runtime-a','ADMIN'],['runtime-viewer','runtime-a','VIEWER'],['runtime-other','runtime-b','ADMIN']]) await pool.query('INSERT INTO users(id,organisation_id,role,status,name,username,password_hash,preferences) VALUES($1,$2,$3,\'ACTIVE\',$1,$1,$4,\'{}\')',[id,org,role,hash]);
  const secret=randomBytes(32).toString('hex');
  next=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(httpPort)],{windowsHide:true,env:{...process.env,TZ:serverTimezone,DATABASE_URL:databaseUrl.replace('127.0.0.1','localhost'),SESSION_SECRET:secret,NODE_OPTIONS:`--require "${resolve('scripts/tests/helpers/localNeonFetch.cjs').replaceAll('\\','/')}"`,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
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

  await pool.query(`INSERT INTO modules VALUES ('budgeting','Budgeting',true);
    INSERT INTO organisation_modules VALUES ('runtime-a','budgeting',true,'{}'),('runtime-b','budgeting',true,'{}');
    INSERT INTO commercial_financial_years(id,organisation_id,name,starts_on,ends_on,status) VALUES ('00000000-0000-4000-8000-000000000401','runtime-a','FY27','2026-07-01','2027-06-30','OPEN');
    INSERT INTO commercial_financial_periods(id,financial_year_id,organisation_id,name,starts_on,ends_on,status) VALUES ('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000401','runtime-a','September','2026-09-01','2026-09-30','OPEN');
    INSERT INTO commercial_cost_centres(id,organisation_id,code,name,active) VALUES ('00000000-0000-4000-8000-000000000403','runtime-a','OPS','Operations',true);
    INSERT INTO commercial_budget_accounts(id,organisation_id,code,name,active,created_by) VALUES ('00000000-0000-4000-8000-000000000404','runtime-a','OPEX','Operating',true,'runtime-admin');
    INSERT INTO commercial_budgets(id,organisation_id,financial_year_id,name,currency,tax_basis,periodisation_mode,created_by) VALUES ('00000000-0000-4000-8000-000000000405','runtime-a','00000000-0000-4000-8000-000000000401','Review budget','AUD','INCLUSIVE','ANNUAL_ONLY','runtime-admin');
    INSERT INTO commercial_budget_versions(id,organisation_id,budget_id,version_number,status,created_by,activated_by,activated_at) VALUES ('00000000-0000-4000-8000-000000000406','runtime-a','00000000-0000-4000-8000-000000000405',1,'ACTIVE','runtime-admin','runtime-admin',now());
    INSERT INTO commercial_budget_lines(organisation_id,budget_version_id,budget_account_id,cost_centre_id,annual_budget_cents) VALUES ('runtime-a','00000000-0000-4000-8000-000000000406','00000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000403',1000000);
    INSERT INTO commercial_budget_commitment_mappings(organisation_id,budget_version_id,cost_centre_id,budget_account_id,created_by) VALUES ('runtime-a','00000000-0000-4000-8000-000000000406','00000000-0000-4000-8000-000000000403','00000000-0000-4000-8000-000000000404','runtime-admin');
    UPDATE commercial_budgets SET active_version_id='00000000-0000-4000-8000-000000000406';
    UPDATE commercial_purchase_orders SET cost_centre_id='00000000-0000-4000-8000-000000000403',issued_at='2026-09-01';
    INSERT INTO commercial_purchase_order_lines(id,organisation_id,purchase_order_id,position,description_snapshot,cost_centre_id,line_subtotal_cents,line_total_cents) VALUES ('00000000-0000-4000-8000-000000000407','runtime-a','00000000-0000-4000-8000-000000000301',1,'Review supplies','00000000-0000-4000-8000-000000000403',10000,10000);
    INSERT INTO commercial_supplier_bill_lines(organisation_id,supplier_bill_id,source_purchase_order_line_id,position,description_snapshot,line_subtotal_cents,line_total_cents) VALUES ('runtime-a','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000407',1,'Review supplies',10000,10000);
    INSERT INTO commercial_external_gl_account_mappings(organisation_id,source_system_id,external_gl_account_code,external_gl_account_name,budget_account_id,effective_from,status,created_by) VALUES ('runtime-a','review-ledger','600','Operating','00000000-0000-4000-8000-000000000404','2026-07-01','ACTIVE','runtime-admin');
    INSERT INTO commercial_external_gl_cost_centre_mappings(organisation_id,source_system_id,external_cost_centre_code,cost_centre_id,effective_from,status,created_by) VALUES ('runtime-a','review-ledger','OPS-EXT','00000000-0000-4000-8000-000000000403','2026-07-01','ACTIVE','runtime-admin');
    INSERT INTO commercial_external_gl_entries(organisation_id,source_system_id,external_entry_id,external_account_code,external_cost_centre_code,transaction_date,currency,amount_minor_units,source_payload_hash,source_lineage_id,imported_by) VALUES ('runtime-a','review-ledger','entry-1','600','OPS-EXT','2026-09-20','AUD',10000,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','review-batch','runtime-admin');`);
  const {page}=await login('runtime-admin');
  const importPayload={sourceSystemId:'import-review',externalEntryId:'exact-large-entry',externalAccountCode:'600',transactionDate:'2026-09-10',currency:'AUD',amountMinorUnits:'9007199254740993',sourcePayloadHash:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',sourceLineageId:'import-review-batch'};
  const importEntry=body=>page.evaluate(async body=>{const response=await fetch('/api/commercial/budgeting/external-gl/entries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,payload:await response.json().catch(()=>null)};},body);
  const imported=await importEntry(importPayload);
  if(imported.status!==201||imported.payload?.outcome!=='IMPORTED')throw new Error('Ledger import failed: '+JSON.stringify(imported));
  if(imported.payload.entry.transaction_date!=='2026-09-10'||imported.payload.entry.amount_minor_units!=='9007199254740993')throw new Error('Ledger import lost calendar date or exact amount');
  const duplicate=await importEntry(importPayload);
  if(duplicate.status!==200||duplicate.payload?.outcome!=='IDEMPOTENT'||duplicate.payload.entry.id!==imported.payload.entry.id||duplicate.payload.staleReconciliationCount!==0)throw new Error('Exact duplicate import was not idempotent');
  const conflicting=await importEntry({...importPayload,amountMinorUnits:'9007199254740994'});
  if(conflicting.status!==409||conflicting.payload?.code!=='EXTERNAL_IDENTITY_CONFLICT')throw new Error('Changed immutable ledger identity was accepted');
  for(const amountMinorUnits of [9007199254740992,'1.5','9223372036854775808']){
    const invalid=await importEntry({...importPayload,externalEntryId:'invalid-amount',amountMinorUnits});
    if(invalid.status!==400)throw new Error('Unsafe or invalid ledger amount accepted');
  }
  const exactStored=(await pool.query("SELECT amount_minor_units::text,transaction_date::text FROM commercial_external_gl_entries WHERE source_system_id='import-review'")).rows;
  if(exactStored.length!==1||exactStored[0].amount_minor_units!=='9007199254740993'||exactStored[0].transaction_date!=='2026-09-10')throw new Error('Import retry/conflict changed immutable ledger facts');
  // Hold both requests inside the database before insertion. This forces the
  // overlapping-import race without depending on network timing.
  await pool.query(`CREATE FUNCTION runtime_import_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(81054177); RETURN NEW; END $$;
    CREATE TRIGGER runtime_import_gate BEFORE INSERT ON commercial_external_gl_entries FOR EACH ROW WHEN (NEW.source_system_id='concurrency-review') EXECUTE FUNCTION runtime_import_gate();`);
  const gate=await pool.connect();
  await gate.query('SELECT pg_advisory_lock(81054177)');
  const concurrentInput={...importPayload,sourceSystemId:'concurrency-review',externalEntryId:'parallel-1'};
  const concurrentRequests=Promise.all([importEntry(concurrentInput),importEntry(concurrentInput)]);
  let overlapping=false;
  try {
    for(let attempt=0;attempt<200;attempt++){
      const waiting=(await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event='advisory'",[database])).rows[0].n;
      if(waiting>=2){overlapping=true;break;}
      await pause(25);
    }
  } finally { await gate.query('SELECT pg_advisory_unlock(81054177)');gate.release(); }
  const concurrentResults=await concurrentRequests;
  await pool.query('DROP TRIGGER runtime_import_gate ON commercial_external_gl_entries; DROP FUNCTION runtime_import_gate()');
  if(!overlapping)throw new Error('Concurrent import verification did not overlap requests');
  if(concurrentResults.map(result=>result.status).sort().join(',')!=='200,201'||concurrentResults[0].payload.entry.id!==concurrentResults[1].payload.entry.id)throw new Error('Identical concurrent imports did not replay one fact: '+JSON.stringify(concurrentResults));
  const genuineConflict=await Promise.all([importEntry({...concurrentInput,externalEntryId:'parallel-conflict',amountMinorUnits:'100'}),importEntry({...concurrentInput,externalEntryId:'parallel-conflict',amountMinorUnits:'101'})]);
  if(genuineConflict.map(result=>result.status).sort().join(',')!=='201,409')throw new Error('Concurrent changed facts did not preserve conflict protection');
  const winningFact=genuineConflict.find(result=>result.status===201).payload.entry;
  const concurrentStored=(await pool.query("SELECT id,amount_minor_units::text FROM commercial_external_gl_entries WHERE source_system_id='concurrency-review' AND external_entry_id='parallel-conflict'")).rows;
  if(concurrentStored.length!==1||concurrentStored[0].id!==winningFact.id||concurrentStored[0].amount_minor_units!==winningFact.amount_minor_units)throw new Error('Concurrent conflict overwrote its winning fact');
  await page.goto(origin+'/commercial/budgeting/external-gl');
  await expect(page.getByRole('heading',{name:'External GL mappings',exact:true})).toBeVisible();
  const accountSection=page.locator('section').filter({has:page.getByRole('heading',{name:'GL account mappings',exact:true})});
  const centreSection=page.locator('section').filter({has:page.getByRole('heading',{name:'Cost-centre mappings',exact:true})});
  await expect(accountSection.getByRole('table')).toContainText('2026-07-01 → ongoing');
  await expect(centreSection.getByRole('table')).toContainText('2026-07-01 → ongoing');
  const createdMappings=[];
  for(const [section,kind,code,dimension] of [[accountSection,'mappings','601','00000000-0000-4000-8000-000000000404'],[centreSection,'cost-centre-mappings','OPS-SECOND','00000000-0000-4000-8000-000000000403']]){
    const form=section.locator('form');
    await form.getByLabel('Source system',{exact:true}).fill('flow-ledger');
    await form.getByLabel(kind==='mappings'?'External GL code':'External cost-centre code',{exact:true}).fill(code);
    await form.getByRole('combobox').selectOption(dimension);
    await form.getByLabel('Effective from',{exact:true}).fill('2026-09-01');
    await form.getByLabel('Effective to',{exact:true}).fill('2026-09-30');
    const responseEvent=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/external-gl/'+kind)&&response.request().method()==='POST');
    await form.getByRole('button',{name:'Create mapping',exact:true}).click();
    const response=await responseEvent;
    const payload=await response.json();
    if(response.status()!==201||payload.mapping.effective_from!=='2026-09-01'||payload.mapping.effective_to!=='2026-09-30')throw new Error('Mapping create response lost calendar dates: '+JSON.stringify(payload));
    createdMappings.push({id:payload.mapping.id,kind,code});
    await expect(section.getByRole('table')).toContainText('2026-09-01 → 2026-09-30');
    // An overlapping mapping must be rejected without inserting another fact.
    await form.getByLabel('Source system',{exact:true}).fill('flow-ledger');
    await form.getByLabel(kind==='mappings'?'External GL code':'External cost-centre code',{exact:true}).fill(code);
    await form.getByRole('combobox').selectOption(dimension);
    await form.getByLabel('Effective from',{exact:true}).fill('2026-09-15');
    await form.getByLabel('Effective to',{exact:true}).fill('2026-09-30');
    const conflictEvent=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/external-gl/'+kind)&&response.request().method()==='POST');
    await form.getByRole('button',{name:'Create mapping',exact:true}).click();
    if((await conflictEvent).status()!==409)throw new Error('Overlapping mapping accepted');
    await expect(page.getByRole('alert').first()).toBeVisible();
  }
  await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('flow-ledger');
  await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('ALL');
  for(const [section,mapping] of [[accountSection,createdMappings[0]],[centreSection,createdMappings[1]]]){
    const row=section.locator('tbody tr').filter({hasText:mapping.code});
    await expect(section.getByRole('table')).not.toContainText('review-ledger');
    await row.getByLabel('Effective-to date',{exact:true}).fill('2026-09-20');
    const retireEvent=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/'+mapping.id+'/retire')&&response.request().method()==='POST');
    await row.getByRole('button',{name:'Retire',exact:true}).click();
    const response=await retireEvent;const payload=await response.json();
    if(response.status()!==200||payload.mapping.status!=='RETIRED'||payload.mapping.effective_from!=='2026-09-01'||payload.mapping.effective_to!=='2026-09-20')throw new Error('Mapping retirement response lost dates or status');
    await expect(row).toContainText('2026-09-01 → 2026-09-20');
    await expect(row).toContainText('RETIRED');
  }
  const storedMappings=(await pool.query("SELECT effective_from::text,effective_to::text,status FROM commercial_external_gl_account_mappings WHERE source_system_id='flow-ledger' UNION ALL SELECT effective_from::text,effective_to::text,status FROM commercial_external_gl_cost_centre_mappings WHERE source_system_id='flow-ledger'")).rows;
  if(storedMappings.length!==2||storedMappings.some(row=>row.effective_from!=='2026-09-01'||row.effective_to!=='2026-09-20'||row.status!=='RETIRED'))throw new Error('Mapping UI changes did not persist exactly');
  await page.screenshot({path:resolve(artifacts,'external-gl-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(artifacts,'external-gl-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/commercial/budgeting/finance-controls');
  await expect(page.getByRole('heading',{name:'Finance controls',exact:true})).toBeVisible();
  await page.getByRole('combobox').nth(0).selectOption('00000000-0000-4000-8000-000000000401');
  await page.getByRole('combobox').nth(1).selectOption('00000000-0000-4000-8000-000000000402');
  await page.getByRole('combobox').nth(2).selectOption('review-ledger');
  const calendar=await page.evaluate(async()=> (await(await fetch('/api/commercial/budgeting/financial-periods')).json()).years[0]);
  if(calendar.starts_on!=='2026-07-01'||calendar.ends_on!=='2027-06-30'||calendar.periods[0].starts_on!=='2026-09-01'||calendar.periods[0].ends_on!=='2026-09-30')throw new Error('Calendar boundaries shifted during API serialization');
  for(const date of ['2026-07-01','2027-06-30','2026-09-01','2026-09-30'])await expect(page.getByText(date,{exact:true})).toBeVisible();
  await page.getByLabel('Reconciliation currency').fill('AUD'); console.log('Finance scope selected'); await page.getByRole('button',{name:'Prepare reconciliation',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('prepared');
  await expect(page.locator('[data-reconciliation-id]')).toContainText('PREPARED');
  let recon=(await pool.query('SELECT * FROM commercial_finance_reconciliations')).rows[0];
  if(recon.source_actual_cents!=='10000'||recon.external_gl_total_cents!=='10000'||recon.variance_cents!=='0'||recon.unresolved_item_count!==0)throw new Error('Totals do not reconcile: '+JSON.stringify(recon));
  await page.getByRole('button',{name:'Review',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign off',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close period',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign off',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Sign off',exact:true}).click();
  await expect(page.locator('[data-reconciliation-id]')).toContainText('SIGNED_OFF');
  const signedImport={sourceSystemId:'review-ledger',externalEntryId:'entry-1',externalAccountCode:'600',externalCostCentreCode:'OPS-EXT',transactionDate:'2026-09-20',currency:'AUD',amountMinorUnits:'10000',sourcePayloadHash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',sourceLineageId:'review-batch'};
  const signedDuplicate=await importEntry(signedImport);
  if(signedDuplicate.status!==200||signedDuplicate.payload?.outcome!=='IDEMPOTENT'||signedDuplicate.payload.staleReconciliationCount!==0)throw new Error('Duplicate import disturbed signed-off evidence');
  if((await pool.query('SELECT status FROM commercial_finance_reconciliations')).rows[0].status!=='SIGNED_OFF')throw new Error('Duplicate import invalidated reconciliation');
  await page.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('[role="region"]').forEach(element=>{element.scrollLeft=0;});});
  await page.screenshot({path:resolve(artifacts,'finance-signed-off-desktop.png'),fullPage:true});
  recon=(await pool.query('SELECT * FROM commercial_finance_reconciliations')).rows[0];
  if(!recon.close_id||recon.status!=='SIGNED_OFF')throw new Error('Sign-off not persisted');
  await page.getByRole('button',{name:'Close financial year',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Financial year closed.');
  await page.getByLabel('Year reopen reason (required)',{exact:true}).fill('Isolated finance review');
  await page.getByRole('button',{name:'Reopen financial year',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Financial year reopened.');
  await page.getByLabel('Reopen reason (required)',{exact:true}).fill('Isolated period review');
  await page.getByRole('button',{name:'Reopen period',exact:true}).click();
  await expect(page.locator('[data-reconciliation-id]')).toContainText('STALE');
  await expect(page.locator('[data-close-id]')).toContainText('INVALIDATED');
  await expect(page.locator('[data-year-close-id]')).toContainText('INVALIDATED');
  const reopened=(await pool.query('SELECT status FROM commercial_finance_reconciliations')).rows[0];
  const events=(await pool.query('SELECT event_type,details FROM commercial_finance_reconciliation_events ORDER BY event_at')).rows;
  if(reopened.status!=='STALE'||events.length!==4||events.at(-1).details.reason!=='Isolated period review')throw new Error('Durable reconciliation events did not preserve lifecycle and reopen reason');
  await page.evaluate(()=>{window.scrollTo(0,0);});
  await page.screenshot({path:resolve(artifacts,'finance-reopened-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  for(const date of ['2026-07-01','2027-06-30','2026-09-01','2026-09-30']){
    const bounds=await page.getByText(date,{exact:true}).boundingBox();
    if(!bounds||bounds.x<0||bounds.x+bounds.width>390)throw new Error('Mobile calendar metric clipped');
  }
  for(const name of ['Year-close history','Period-close history','Reconciliation control state']){
    const region=page.getByRole('region',{name,exact:true});
    await region.scrollIntoViewIfNeeded();
    const scroll=await region.evaluate(element=>{element.scrollLeft=element.scrollWidth;return {left:element.scrollLeft,width:element.clientWidth,total:element.scrollWidth};});
    if(scroll.total<=scroll.width||scroll.left<=0)throw new Error('Mobile table cannot scroll: '+name);
    await expect(region.locator('tbody tr').first().locator('td').last()).toBeInViewport();
    await region.evaluate(element=>{element.scrollLeft=0;});
  }
  await page.evaluate(()=>{window.scrollTo(0,0);});
  await page.screenshot({path:resolve(artifacts,'finance-mobile.png'),fullPage:true});
  const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  // A conflicting immutable identity must preserve the source row while
  // invalidating the current sign-off and retaining its durable history.
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Close period',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Financial period closed.');
  await page.getByRole('button',{name:'Prepare reconciliation',exact:true}).click();
  await expect(page.locator('[data-reconciliation-id]')).toContainText('PREPARED');
  await page.getByRole('button',{name:'Review',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign off',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Sign off',exact:true}).click();
  await expect(page.locator('[data-reconciliation-id]')).toContainText('SIGNED_OFF');
  const signedConflict=await importEntry({...signedImport,amountMinorUnits:'10001'});
  if(signedConflict.status!==409||signedConflict.payload?.code!=='EXTERNAL_IDENTITY_CONFLICT')throw new Error('Signed-off ledger identity conflict was accepted');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.locator('[data-reconciliation-id]')).toContainText('STALE');
  const immutable=(await pool.query("SELECT amount_minor_units::text FROM commercial_external_gl_entries WHERE source_system_id='review-ledger' AND external_entry_id='entry-1'")).rows;
  const activeCloseState=(await pool.query("SELECT reconciliation_status FROM commercial_financial_period_closes WHERE status='CLOSED'")).rows[0];
  const staleEvidence=(await pool.query("SELECT details FROM commercial_finance_reconciliation_events WHERE event_type='STALE' ORDER BY event_at DESC LIMIT 1")).rows[0].details;
  if(immutable.length!==1||immutable[0].amount_minor_units!=='10000'||activeCloseState.reconciliation_status!=='STALE'||staleEvidence.cause!=='EXTERNAL_GL_CHANGED_IDENTITY'||staleEvidence.incomingTransactionDate!=='2026-09-20')throw new Error('Conflict did not preserve source facts and stale evidence');
  await page.screenshot({path:resolve(artifacts,'finance-import-conflict.png'),fullPage:true});
  await page.getByLabel('Reopen reason (required)',{exact:true}).fill('Verify new ledger facts');
  await page.getByRole('button',{name:'Reopen period',exact:true}).click();
  await expect(page.getByRole('button',{name:'Close period',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close period',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Financial period closed.');
  await page.getByRole('button',{name:'Prepare reconciliation',exact:true}).click();
  await expect(page.locator('[data-reconciliation-id]')).toContainText('PREPARED');
  await page.getByRole('button',{name:'Review',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign off',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Sign off',exact:true}).click();
  await expect(page.locator('[data-reconciliation-id]')).toContainText('SIGNED_OFF');
  const newFact=await importEntry({...signedImport,externalEntryId:'entry-2',amountMinorUnits:'100',sourcePayloadHash:'cccccccccccccccccccccccccccccccc',sourceLineageId:'new-ledger-batch'});
  if(newFact.status!==201||newFact.payload?.staleReconciliationCount!==1)throw new Error('New ledger fact did not invalidate exactly the affected sign-off');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.locator('[data-reconciliation-id]')).toContainText('STALE');
  const newFactEvent=(await pool.query("SELECT details FROM commercial_finance_reconciliation_events WHERE event_type='STALE' ORDER BY event_at DESC LIMIT 1")).rows[0].details;
  if(newFactEvent.cause!=='EXTERNAL_GL_NEW_ENTRY'||newFactEvent.externalEntryId!=='entry-2')throw new Error('New import stale event lost its source identity');
  const viewer=await login('runtime-viewer');
  const denial=await viewer.page.evaluate(async()=> (await fetch('/api/commercial/budgeting/financial-periods')).status);
  if(denial!==403)throw new Error('Viewer finance controls accepted');
  const mappingDenial=await viewer.page.evaluate(async()=> (await fetch('/api/commercial/budgeting/external-gl/mappings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status);
  if(mappingDenial!==403)throw new Error('Viewer mapping mutation accepted');
  const importDenial=await viewer.page.evaluate(async body=>(await fetch('/api/commercial/budgeting/external-gl/entries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,importPayload);
  if(importDenial!==403)throw new Error('Viewer ledger import accepted');
  const other=await login('runtime-other');
  await other.page.goto(origin+'/commercial/budgeting/finance-controls');
  await expect(other.page.getByText('Create your financial year and periods in Finance setup before using finance controls.',{exact:true})).toBeVisible();
  await other.page.getByRole('navigation',{name:'Finance workflow',exact:true}).getByRole('link',{name:'Finance setup',exact:true}).click();
  await expect(other.page.getByRole('heading',{name:'Finance setup',exact:true})).toBeVisible();
  await other.page.getByRole('navigation',{name:'Finance workflow',exact:true}).getByRole('link',{name:'External GL mappings',exact:true}).click();
  await expect(other.page.getByText('Create active Budget accounts and cost centres in Finance setup before adding External GL mappings.',{exact:true})).toBeVisible();
  await other.page.getByRole('navigation',{name:'Finance workflow',exact:true}).getByRole('link',{name:'Budget reporting',exact:true}).click();
  await expect(other.page.getByText('No Budget rows are available. Check Finance setup for an active Budget and its lines and commitment mappings. Operational activity or ledger imports may still need to be added separately.',{exact:true})).toBeVisible();
  await other.page.getByRole('navigation',{name:'Finance workflow',exact:true}).getByRole('link',{name:'Finance setup',exact:true}).click();
  await viewer.page.goto(origin+'/commercial/budgeting/commitments');
  await expect(viewer.page.getByRole('heading',{name:'Budget vs Actual vs Committed',exact:true})).toBeVisible();
  await expect(viewer.page.getByRole('navigation',{name:'Finance workflow',exact:true})).toHaveCount(0);
  const tenant=await other.page.evaluate(async()=>await(await fetch('/api/commercial/budgeting/financial-periods')).json());
  if(tenant.years.length)throw new Error('Foreign year exposed');
  const foreignMappings=await other.page.evaluate(async()=> (await(await fetch('/api/commercial/budgeting/external-gl/mappings')).json()).mappings);
  if(foreignMappings.length)throw new Error('Foreign mapping exposed');
  const foreignRetire=await other.page.evaluate(async id=> (await fetch('/api/commercial/budgeting/external-gl/mappings/'+id+'/retire',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({effectiveTo:'2026-09-20'})})).status,createdMappings[0].id);
  if(foreignRetire!==404)throw new Error('Foreign mapping retirement accepted');
  const separateTenantImport=await other.page.evaluate(async body=>{const response=await fetch('/api/commercial/budgeting/external-gl/entries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,payload:await response.json()};},signedImport);
  if(separateTenantImport.status!==201||separateTenantImport.payload.entry.organisation_id!=='runtime-b'||separateTenantImport.payload.staleReconciliationCount!==0)throw new Error('Ledger import identity or invalidation crossed organisation boundaries');
  // A fresh organisation must create its calendar through the real setup UI.
  await other.page.goto(origin+'/commercial/budgeting/setup');
  await expect(other.page.getByText('No financial years yet. Create your first year above.')).toBeVisible();
  const yearForm=other.page.locator('form').first();
  await yearForm.getByLabel('Year name',{exact:false}).fill('Pilot FY');
  await yearForm.getByLabel('Year start date',{exact:false}).fill('31/02/2027');
  await yearForm.getByLabel('Year end date',{exact:false}).fill('30/06/2028');
  await yearForm.getByRole('button',{name:'Create year',exact:true}).click();
  await expect(other.page.getByText('Enter a valid date in DD/MM/YYYY format.',{exact:true})).toBeVisible();
  await yearForm.getByLabel('Year start date',{exact:false}).fill('01/07/2027');
  await yearForm.getByLabel('Year end date',{exact:false}).fill('30/06/2028');
  await yearForm.getByRole('button',{name:'Create year',exact:true}).click();
  await expect(other.page.getByRole('status').first()).toContainText('Financial year created.');
  const periodForm=other.page.locator('form').nth(1);
  await periodForm.getByLabel('Period name',{exact:false}).fill('July');
  await periodForm.getByLabel('Period start date',{exact:false}).fill('01/07/2027');
  await periodForm.getByLabel('Period end date',{exact:false}).fill('31/07/2027');
  await periodForm.getByRole('button',{name:'Create period',exact:true}).click();
  await expect(other.page.getByRole('region',{name:'Financial period calendar',exact:true})).toContainText('31/07/2027');
  const configured=(await pool.query("SELECT y.id,y.starts_on::text,y.ends_on::text,p.starts_on::text AS period_start,p.ends_on::text AS period_end FROM commercial_financial_years y JOIN commercial_financial_periods p ON p.financial_year_id=y.id WHERE y.organisation_id='runtime-b'")).rows;
  if(configured.length!==1||configured[0].starts_on!=='2027-07-01'||configured[0].ends_on!=='2028-06-30'||configured[0].period_start!=='2027-07-01'||configured[0].period_end!=='2027-07-31')throw new Error('Calendar setup did not persist exact dates');
  const calendarAudit=(await pool.query("SELECT action,user_id,after_state FROM audit_logs WHERE organisation_id='runtime-b' AND action IN ('commercial_financial_year.created','commercial_financial_period.created')")).rows;
  if(calendarAudit.length!==2||calendarAudit.some(row=>row.user_id!=='runtime-other'||row.after_state.starts_on!=='2027-07-01'))throw new Error('Calendar creation audit lost actor or calendar dates');
  const setupYearId=configured[0].id;
  const dimensionRows=[];
  for(const [kind,title,code] of [['accounts','Budget accounts','PILOT-ACC'],['cost-centres','Cost centres','PILOT-CC']]){
    const section=other.page.getByRole('region',{name:title,exact:true});
    const form=section.locator('form');
    await form.getByLabel('Code',{exact:false}).fill(code);
    await form.getByLabel('Name',{exact:false}).fill('Pilot '+title);
    await form.getByLabel('Description',{exact:true}).fill('Synthetic setup example');
    await form.getByRole('button',{name:kind==='accounts'?'Create account':'Create cost centre',exact:true}).click();
    await expect(section.getByRole('table')).toContainText(code);
    const saved=(await pool.query(`SELECT id,active FROM ${kind==='accounts'?'commercial_budget_accounts':'commercial_cost_centres'} WHERE organisation_id='runtime-b' AND code=$1`,[code])).rows;
    if(saved.length!==1||!saved[0].active)throw new Error('Dimension form did not create active tenant record');
    dimensionRows.push({kind,id:saved[0].id,code});
    const duplicate=await other.page.evaluate(async ({kind,code})=>(await fetch('/api/commercial/budgeting/setup/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,name:'Duplicate'})})).status,{kind,code});
    if(duplicate!==409)throw new Error('Duplicate dimension code accepted');
    await section.getByRole('button',{name:'Deactivate '+code,exact:true}).click();
    await expect(section.getByRole('table')).toContainText('Inactive');
    const foreign=await page.evaluate(async ({kind,id})=>(await fetch('/api/commercial/budgeting/setup/'+kind+'/'+id+'/deactivate',{method:'POST'})).status,{kind,id:saved[0].id});
    if(foreign!==404)throw new Error('Foreign dimension deactivation accepted');
    const viewerDenial=await viewer.page.evaluate(async kind=>(await fetch('/api/commercial/budgeting/setup/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,kind);
    if(viewerDenial!==403)throw new Error('Viewer dimension mutation accepted');
    const protectedId=kind==='accounts'?'00000000-0000-4000-8000-000000000404':'00000000-0000-4000-8000-000000000403';
    const protectedResult=await page.evaluate(async ({kind,id})=>(await fetch('/api/commercial/budgeting/setup/'+kind+'/'+id+'/deactivate',{method:'POST'})).status,{kind,id:protectedId});
    if(protectedResult!==409)throw new Error('Active Budget dimension deactivated');
  }
  const setupPost=(path,body)=>other.page.evaluate(async ({path,body})=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};},{path,body});
  for(const malformed of [{taxBasis:['INCLUSIVE'],periodisationMode:'PERIODISED'},{taxBasis:'INCLUSIVE',periodisationMode:['PERIODISED']}]){
    if((await setupPost('/api/commercial/budgeting/budgets',{name:'Malformed',financialYearId:setupYearId,currency:'AUD',...malformed})).status!==400)throw new Error('Non-string Budget enum was not rejected');
  }
  // Complete an operational Budget through the new setup forms.
  const budgetDimensions=[];
  for(const [kind,title,code] of [['accounts','Budget accounts','BUDGET-ACC'],['cost-centres','Cost centres','BUDGET-CC']]){
    const section=other.page.getByRole('region',{name:title,exact:true});
    await section.getByLabel('Code',{exact:false}).fill(code);
    await section.getByLabel('Name',{exact:false}).fill('Budget '+title);
    await section.getByRole('button',{name:kind==='accounts'?'Create account':'Create cost centre',exact:true}).click();
    await expect(section.getByRole('table')).toContainText(code);
    budgetDimensions.push((await pool.query(`SELECT id FROM ${kind==='accounts'?'commercial_budget_accounts':'commercial_cost_centres'} WHERE organisation_id='runtime-b' AND code=$1`,[code])).rows[0].id);
  }
  const budgetSection=other.page.getByRole('region',{name:'Budget setup',exact:true});
  const createBudgetForm=budgetSection.getByRole('form',{name:'Create Budget',exact:true});
  await createBudgetForm.getByLabel('Budget name',{exact:false}).fill('Pilot Budget');
  await createBudgetForm.getByLabel('Budget financial year',{exact:false}).selectOption(setupYearId);
  await createBudgetForm.getByLabel('Budget currency',{exact:false}).fill('AUD');
  await createBudgetForm.getByLabel('Tax basis',{exact:false}).selectOption('INCLUSIVE');
  await createBudgetForm.getByLabel('Periodisation',{exact:false}).selectOption('PERIODISED');
  await createBudgetForm.getByRole('button',{name:'Create draft Budget',exact:true}).click();
  await expect(budgetSection.getByRole('status')).toContainText('Budget setup saved.');
  const activationChecks=budgetSection.getByRole('region',{name:'Draft activation checks',exact:true});
  await expect(activationChecks).toContainText('Add at least one Budget line.');
  await expect(activationChecks).toContainText('Add a commitment mapping');
  await activationChecks.getByRole('link',{name:'Add Budget lines',exact:true}).click();
  await expect(other.page).toHaveURL(/#budget-line-setup$/);
  await expect(budgetSection.getByRole('region',{name:'Budget line setup',exact:true})).toBeFocused();
  const lineForm=budgetSection.getByRole('form',{name:'Budget line',exact:true});
  await lineForm.getByLabel('Line account',{exact:false}).selectOption(budgetDimensions[0]);
  await lineForm.getByLabel('Line cost centre',{exact:false}).selectOption(budgetDimensions[1]);
  await lineForm.getByLabel('Annual amount (AUD)',{exact:false}).fill('1.001');
  await lineForm.getByRole('button',{name:'Save line',exact:true}).click();
  await expect(budgetSection.getByRole('alert')).toContainText('at most two decimal places');
  await lineForm.getByLabel('Annual amount (AUD)',{exact:false}).fill('100.00');
  await lineForm.getByRole('button',{name:'Save line',exact:true}).click();
  await expect(budgetSection.getByRole('table',{name:'Budget lines and allocation checks',exact:true})).toContainText('AUD 100.00');
  await expect(activationChecks).not.toContainText('Add at least one Budget line.');
  await expect(activationChecks).toContainText('1 line needs allocation changes');
  await expect(activationChecks.getByRole('link',{name:'Add Budget lines',exact:true})).toHaveCount(0);
  await activationChecks.getByRole('link',{name:'Review allocation amounts',exact:true}).click();
  await expect(other.page).toHaveURL(/#budget-allocation-review$/);
  await expect(budgetSection.getByRole('region',{name:'Budget amount review',exact:true})).toBeFocused();
  const persistedAmount=(await pool.query("SELECT annual_budget_cents::text AS cents FROM commercial_budget_lines WHERE organisation_id='runtime-b'")).rows;
  if(persistedAmount.length!==1||persistedAmount[0].cents!=='10000')throw new Error('Dollar input did not persist exact cents');
  const mappingForm=budgetSection.getByRole('form',{name:'Commitment mapping',exact:true});
  await mappingForm.getByLabel('Mapping account',{exact:false}).selectOption(budgetDimensions[0]);
  await mappingForm.getByLabel('Mapping cost centre',{exact:false}).selectOption(budgetDimensions[1]);
  await mappingForm.getByRole('button',{name:'Save commitment mapping',exact:true}).click();
  const mappingsTable=budgetSection.getByRole('table',{name:'Commitment mappings',exact:true});
  await expect(mappingsTable).toContainText('BUDGET-CC');
  await expect(mappingsTable).toContainText('BUDGET-ACC');
  await expect(mappingsTable).toContainText('Active references');
  await expect(mappingForm.getByLabel('Mapping account',{exact:false})).toHaveValue('');
  await expect(activationChecks).not.toContainText('Add a commitment mapping');
  const budgetState=(await pool.query("SELECT b.id,v.id AS version_id,l.id AS line_id FROM commercial_budgets b JOIN commercial_budget_versions v ON v.budget_id=b.id JOIN commercial_budget_lines l ON l.budget_version_id=v.id WHERE b.organisation_id='runtime-b'")).rows[0];
  const setupPeriod=(await pool.query("SELECT id FROM commercial_financial_periods WHERE financial_year_id=$1 AND name='July'",[setupYearId])).rows[0].id;
  await budgetSection.getByText('Edit draft settings',{exact:true}).click();
  const settingsForm=budgetSection.getByRole('form',{name:'Draft Budget settings',exact:true});
  await expect(settingsForm.getByLabel('Draft Budget name',{exact:false})).toHaveValue('Pilot Budget');
  await settingsForm.getByLabel('Draft Budget name',{exact:false}).fill('Pilot Budget revised');
  await settingsForm.getByLabel('Draft tax basis',{exact:false}).selectOption('EXCLUSIVE');
  await settingsForm.getByRole('button',{name:'Save draft settings',exact:true}).click();
  await expect(budgetSection.getByRole('status')).toContainText('Budget settings saved.');
  const savedSettings=(await pool.query("SELECT b.name,b.tax_basis,l.annual_budget_cents::text AS cents FROM commercial_budgets b JOIN commercial_budget_lines l ON l.budget_version_id=$2 WHERE b.id=$1",[budgetState.id,budgetState.version_id])).rows[0];
  if(savedSettings.name!=='Pilot Budget revised'||savedSettings.tax_basis!=='EXCLUSIVE'||savedSettings.cents!=='10000')throw new Error('Draft settings did not preserve saved amounts');
  const settingsAudit=(await pool.query("SELECT before_state,after_state,user_id FROM audit_logs WHERE organisation_id='runtime-b' AND resource_id=$1 AND action='commercial_budget.settings_changed'",[budgetState.id])).rows;
  if(settingsAudit.length!==1||settingsAudit[0].user_id!=='runtime-other'||settingsAudit[0].before_state.tax_basis!=='INCLUSIVE'||settingsAudit[0].after_state.tax_basis!=='EXCLUSIVE')throw new Error('Draft settings audit is incorrect');
  await budgetSection.getByText('Edit draft settings',{exact:true}).click();
  const allocationForm=budgetSection.getByRole('form',{name:'Period allocation',exact:true});
  async function allocate(amount){await allocationForm.getByLabel('Allocation line',{exact:false}).selectOption(budgetState.line_id);await allocationForm.getByLabel('Allocation period',{exact:false}).selectOption(setupPeriod);await allocationForm.getByLabel('Period amount (AUD)',{exact:false}).fill(amount);await allocationForm.getByRole('button',{name:'Save allocation',exact:true}).click();await expect(budgetSection.getByRole('table',{name:'Period allocations',exact:true})).toContainText('AUD '+amount);}
  await allocate('90.00');
  await expect(budgetSection.getByText('AUD 10.00 left to allocate',{exact:true})).toBeVisible();
  await expect(activationChecks).toContainText('1 line needs allocation changes');
  await expect(budgetSection.getByText('1 line needs allocation changes. Each line’s period allocations must equal its annual amount before activation.',{exact:true})).toBeVisible();
  await budgetSection.getByRole('button',{name:'Activate Budget version',exact:true}).click();
  await budgetSection.getByRole('button',{name:'Confirm activation',exact:true}).click();
  await expect(budgetSection.getByRole('alert')).toContainText('period allocations');
  await allocate('110.00');
  await expect(budgetSection.getByText('AUD 10.00 over allocated',{exact:true})).toBeVisible();
  await allocate('100.00');
  await expect(budgetSection.getByText('Balanced',{exact:true})).toBeVisible();
  await expect(activationChecks).toContainText('No setup issues found in the loaded draft.');
  await expect(activationChecks.getByRole('link',{name:'Review allocation amounts',exact:true})).toHaveCount(0);
  await expect(budgetSection.getByText('All lines are fully allocated. Check tax basis and commitment mappings before activation.',{exact:true})).toBeVisible();
  await activationChecks.getByRole('link',{name:'Review commitment mappings',exact:true}).click();
  await expect(other.page).toHaveURL(/#budget-commitment-mapping$/);
  const extraAccountSection=other.page.getByRole('region',{name:'Budget accounts',exact:true});
  await extraAccountSection.getByLabel('Code',{exact:false}).fill('MAPPING-ALT');
  await extraAccountSection.getByLabel('Name',{exact:false}).fill('Alternative mapping account');
  await extraAccountSection.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(extraAccountSection.getByRole('button',{name:'Deactivate MAPPING-ALT',exact:true})).toBeVisible();
  const alternateAccount=(await pool.query("SELECT id FROM commercial_budget_accounts WHERE organisation_id='runtime-b' AND code='MAPPING-ALT'")).rows[0].id;
  const originalMapping=(await pool.query('SELECT id,budget_account_id FROM commercial_budget_commitment_mappings WHERE budget_version_id=$1',[budgetState.version_id])).rows[0];
  const editMapping=budgetSection.getByRole('button',{name:'Edit mapping BUDGET-CC',exact:true});
  await editMapping.click();
  await expect(mappingForm.getByLabel('Mapping cost centre',{exact:false})).toHaveValue('BUDGET-CC');
  await expect(mappingForm.getByLabel('Mapping cost centre',{exact:false})).toHaveAttribute('readonly','');
  await expect(mappingForm.getByLabel('Mapping account',{exact:false})).toHaveValue(budgetDimensions[0]);
  await mappingForm.getByLabel('Mapping account',{exact:false}).selectOption(alternateAccount);
  await other.page.setViewportSize({width:390,height:844});
  await mappingForm.getByRole('button',{name:'Cancel mapping editing',exact:true}).click();
  await expect(budgetSection.getByRole('region',{name:'Commitment mapping review',exact:true})).toBeFocused();
  const returnedReview=await budgetSection.getByRole('region',{name:'Commitment mapping review',exact:true}).boundingBox();
  if(!returnedReview||returnedReview.y<0||returnedReview.y>=844)throw new Error('Mapping cancellation did not return review into mobile view');
  await other.page.screenshot({path:resolve(artifacts,'mapping-review-return-mobile.png')});
  await other.page.setViewportSize({width:1440,height:1000});
  if((await pool.query('SELECT budget_account_id FROM commercial_budget_commitment_mappings WHERE id=$1',[originalMapping.id])).rows[0].budget_account_id!==budgetDimensions[0])throw new Error('Cancelling mapping editing changed saved routing');
  await editMapping.click();
  await mappingForm.getByLabel('Mapping account',{exact:false}).selectOption(alternateAccount);
  await budgetSection.getByLabel('Budget version',{exact:true}).selectOption('');
  await budgetSection.getByLabel('Budget version',{exact:true}).selectOption(budgetState.version_id);
  await expect(mappingForm.getByRole('button',{name:'Save commitment mapping',exact:true})).toBeVisible();
  await expect(mappingForm.getByLabel('Mapping account',{exact:false})).toHaveValue('');
  await editMapping.click();
  await other.page.setViewportSize({width:390,height:844});
  if(await other.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mapping editor overflows mobile viewport');
  await other.page.screenshot({path:resolve(artifacts,'draft-mapping-edit-mobile.png'),fullPage:true});
  await other.page.setViewportSize({width:1440,height:1000});
  await mappingForm.getByLabel('Mapping account',{exact:false}).selectOption(alternateAccount);
  await mappingForm.getByRole('button',{name:'Update mapping',exact:true}).click();
  await expect(mappingsTable).toContainText('MAPPING-ALT');
  await expect(budgetSection.getByRole('region',{name:'Commitment mapping review',exact:true})).toBeFocused();
  const updatedMappings=(await pool.query('SELECT id,cost_centre_id,budget_account_id FROM commercial_budget_commitment_mappings WHERE budget_version_id=$1',[budgetState.version_id])).rows;
  if(updatedMappings.length!==1||updatedMappings[0].id!==originalMapping.id||updatedMappings[0].cost_centre_id!==budgetDimensions[1]||updatedMappings[0].budget_account_id!==alternateAccount)throw new Error('Mapping update duplicated or changed cost centre identity');
  const unchangedLine=(await pool.query('SELECT annual_budget_cents::text AS cents FROM commercial_budget_lines WHERE id=$1',[budgetState.line_id])).rows[0];
  const unchangedAllocations=(await pool.query('SELECT amount_cents::text AS cents FROM commercial_budget_period_allocations WHERE budget_line_id=$1',[budgetState.line_id])).rows;
  if(unchangedLine.cents!=='10000'||unchangedAllocations.length!==1||unchangedAllocations[0].cents!=='10000')throw new Error('Mapping update changed Budget amounts or allocations');
  await editMapping.click();
  await expect(mappingForm.getByLabel('Mapping account',{exact:false})).toHaveValue(alternateAccount);
  await mappingForm.getByLabel('Mapping account',{exact:false}).selectOption(budgetDimensions[0]);
  await mappingForm.getByRole('button',{name:'Update mapping',exact:true}).click();
  await expect(mappingsTable).toContainText('BUDGET-ACC');
  const editLine=budgetSection.getByRole('button',{name:'Edit BUDGET-ACC / BUDGET-CC',exact:true});
  await editLine.click();
  await expect(lineForm.getByLabel('Annual amount (AUD)',{exact:false})).toHaveValue('100.00');
  await expect(lineForm.getByLabel('Line account',{exact:false})).toHaveValue('BUDGET-ACC');
  await expect(lineForm.getByLabel('Line account',{exact:false})).toHaveAttribute('readonly','');
  await lineForm.getByLabel('Annual amount (AUD)',{exact:false}).fill('999.00');
  // Download loaded saved records while an unsaved amount is still in the editor.
  const exportPosts=[];
  const captureExportPost=request=>{if(request.method()==='POST'&&request.url().includes('/api/commercial/budgeting/'))exportPosts.push(request.url());};
  other.page.on('request',captureExportPost);
  for(const [kind,label] of [['lines','Export Budget lines CSV'],['allocations','Export period allocations CSV'],['mappings','Export commitment mappings CSV']]){
    const downloaded=other.page.waitForEvent('download');
    await budgetSection.getByRole('button',{name:label,exact:true}).click();
    const file=await downloaded;
    if(file.suggestedFilename()!==`budget-v1-${kind}.csv`)throw new Error('Unexpected Budget export filename');
    const csv=readFileSync(await file.path(),'utf8');
    writeFileSync(resolve(artifacts,`budget-${kind}.csv`),csv);
    const rows=parse(csv,{columns:true,bom:true});
    if(rows.length!==1||rows[0].Budget!=='Pilot Budget revised'||rows[0].Status!=='DRAFT'||rows[0].Currency!=='AUD'||rows[0]['Tax basis']!=='EXCLUSIVE')throw new Error('Budget export lost selected version metadata');
    if(kind==='lines'&&(rows[0]['Annual amount']!=='100.00'||rows[0]['Allocated amount']!=='100.00'||rows[0]['Allocation check']!=='Balanced'))throw new Error('Budget export included unsaved editor amount');
    if(kind==='allocations'&&(rows[0].Amount!=='100.00'||rows[0]['Period start (DD/MM/YYYY)']!=='01/07/2027'||rows[0]['Period end (DD/MM/YYYY)']!=='31/07/2027'))throw new Error('Allocation export lost exact amount or Australian dates');
    if(kind==='mappings'&&(rows[0].Account!=='BUDGET-ACC'||rows[0]['Cost centre']!=='BUDGET-CC'||rows[0]['Account status']!=='Active'))throw new Error('Mapping export lost saved references');
  }
  other.page.off('request',captureExportPost);
  if(exportPosts.length)throw new Error('Budget exports submitted a finance mutation');
  await other.page.setViewportSize({width:390,height:844});
  if(await other.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Budget export controls overflow mobile viewport');
  await budgetSection.getByRole('region',{name:'Budget setup exports',exact:true}).screenshot({path:resolve(artifacts,'budget-export-controls-mobile.png')});
  await other.page.setViewportSize({width:1440,height:1000});
  await expect(lineForm.getByLabel('Annual amount (AUD)',{exact:false})).toHaveValue('999.00');
  await lineForm.getByRole('button',{name:'Cancel editing',exact:true}).click();
  await expect(budgetSection.getByRole('region',{name:'Budget amount review',exact:true})).toBeFocused();
  await expect(lineForm.getByRole('button',{name:'Save line',exact:true})).toBeVisible();
  const cancelledLine=(await pool.query('SELECT annual_budget_cents::text AS cents FROM commercial_budget_lines WHERE id=$1',[budgetState.line_id])).rows[0];
  if(cancelledLine.cents!=='10000')throw new Error('Cancelling line editing changed the saved amount');
  await editLine.click();
  await other.page.setViewportSize({width:390,height:844});
  if(await other.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Draft line editor overflows mobile viewport');
  await other.page.screenshot({path:resolve(artifacts,'draft-line-edit-mobile.png'),fullPage:true});
  await other.page.setViewportSize({width:1440,height:1000});
  await lineForm.getByLabel('Annual amount (AUD)',{exact:false}).fill('110.00');
  await lineForm.getByRole('button',{name:'Update line',exact:true}).click();
  await expect(budgetSection.getByText('AUD 10.00 left to allocate',{exact:true})).toBeVisible();
  await expect(budgetSection.getByRole('region',{name:'Budget amount review',exact:true})).toBeFocused();
  await expect(budgetSection.getByRole('table',{name:'Period allocations',exact:true})).toContainText('AUD 100.00');
  const editedLines=(await pool.query('SELECT id,annual_budget_cents::text AS cents FROM commercial_budget_lines WHERE budget_version_id=$1',[budgetState.version_id])).rows;
  if(editedLines.length!==1||editedLines[0].id!==budgetState.line_id||editedLines[0].cents!=='11000')throw new Error('Editing replaced or duplicated the saved line');
  await editLine.click();
  await expect(lineForm.getByLabel('Annual amount (AUD)',{exact:false})).toHaveValue('110.00');
  await lineForm.getByLabel('Annual amount (AUD)',{exact:false}).fill('100.00');
  await lineForm.getByRole('button',{name:'Update line',exact:true}).click();
  await expect(budgetSection.getByText('Balanced',{exact:true})).toBeVisible();
  const editAllocation=budgetSection.getByRole('button',{name:'Edit allocation BUDGET-ACC / BUDGET-CC / July',exact:true});
  await editAllocation.click();
  await expect(allocationForm.getByLabel('Period amount (AUD)',{exact:false})).toHaveValue('100.00');
  await expect(allocationForm.getByLabel('Allocation line',{exact:false})).toHaveValue('BUDGET-ACC / BUDGET-CC');
  await expect(allocationForm.getByLabel('Allocation period',{exact:false})).toHaveValue('July');
  await expect(allocationForm.getByLabel('Allocation period',{exact:false})).toHaveAttribute('readonly','');
  await allocationForm.getByLabel('Period amount (AUD)',{exact:false}).fill('1.001');
  await allocationForm.getByRole('button',{name:'Update allocation',exact:true}).click();
  await expect(budgetSection.getByRole('alert')).toContainText('two decimal places');
  await expect(allocationForm.getByRole('button',{name:'Update allocation',exact:true})).toBeVisible();
  await expect(budgetSection.getByRole('region',{name:'Budget amount review',exact:true})).not.toBeFocused();
  await allocationForm.getByRole('button',{name:'Cancel allocation editing',exact:true}).click();
  await expect(budgetSection.getByRole('region',{name:'Budget amount review',exact:true})).toBeFocused();
  const cancelledAllocation=(await pool.query('SELECT amount_cents::text AS cents FROM commercial_budget_period_allocations WHERE budget_line_id=$1',[budgetState.line_id])).rows;
  if(cancelledAllocation.length!==1||cancelledAllocation[0].cents!=='10000')throw new Error('Cancelled allocation editing changed saved amounts');
  await editAllocation.click();
  await allocationForm.getByLabel('Period amount (AUD)',{exact:false}).fill('999.00');
  await budgetSection.getByLabel('Budget version',{exact:true}).selectOption('');
  await budgetSection.getByLabel('Budget version',{exact:true}).selectOption(budgetState.version_id);
  await expect(allocationForm.getByRole('button',{name:'Save allocation',exact:true})).toBeVisible();
  await expect(allocationForm.getByLabel('Period amount (AUD)',{exact:false})).toHaveValue('');
  // Retain a second period to prove editing July never rewrites August.
  const siblingPeriod=(await pool.query("INSERT INTO commercial_financial_periods(financial_year_id,organisation_id,name,starts_on,ends_on,status) VALUES ($1,'runtime-b','August','2027-08-01','2027-08-31','OPEN') RETURNING id",[setupYearId])).rows[0].id;
  await pool.query("INSERT INTO commercial_budget_period_allocations(organisation_id,budget_line_id,financial_period_id,amount_cents) VALUES ('runtime-b',$1,$2,2000)",[budgetState.line_id,siblingPeriod]);
  await pool.query('UPDATE commercial_budget_period_allocations SET amount_cents=8000 WHERE budget_line_id=$1 AND financial_period_id=$2',[budgetState.line_id,setupPeriod]);
  const originalAllocationId=(await pool.query('SELECT id FROM commercial_budget_period_allocations WHERE budget_line_id=$1 AND financial_period_id=$2',[budgetState.line_id,setupPeriod])).rows[0].id;
  await other.page.reload();
  await editAllocation.waitFor({state:'visible'});
  await editAllocation.click();
  await expect(allocationForm.getByLabel('Period amount (AUD)',{exact:false})).toHaveValue('80.00');
  await other.page.setViewportSize({width:390,height:844});
  if(await other.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Allocation editor overflows mobile viewport');
  await other.page.screenshot({path:resolve(artifacts,'draft-allocation-edit-mobile.png'),fullPage:true});
  await other.page.setViewportSize({width:1440,height:1000});
  for(const [amount,check] of [['70.00','AUD 10.00 left to allocate'],['90.00','AUD 10.00 over allocated'],['80.00','Balanced']]){
    await allocationForm.getByLabel('Period amount (AUD)',{exact:false}).fill(amount);
    await allocationForm.getByRole('button',{name:'Update allocation',exact:true}).click();
    await expect(budgetSection.getByText(check,{exact:true})).toBeVisible();
    await expect(budgetSection.getByRole('region',{name:'Budget amount review',exact:true})).toBeFocused();
    const allocationRows=(await pool.query('SELECT id,financial_period_id,amount_cents::text AS cents FROM commercial_budget_period_allocations WHERE budget_line_id=$1',[budgetState.line_id])).rows;
    const annualRow=(await pool.query('SELECT annual_budget_cents::text AS cents FROM commercial_budget_lines WHERE id=$1',[budgetState.line_id])).rows[0];
    const targetAllocation=allocationRows.find(row=>row.financial_period_id===setupPeriod),siblingAllocation=allocationRows.find(row=>row.financial_period_id===siblingPeriod);
    if(allocationRows.length!==2||targetAllocation?.id!==originalAllocationId||targetAllocation?.cents!==amount.replace('.','')||siblingAllocation?.cents!=='2000'||annualRow.cents!=='10000')throw new Error('Allocation editing changed identity, another period or annual amount');
    if(amount!=='80.00'){
      await editAllocation.click();
      await expect(allocationForm.getByLabel('Period amount (AUD)',{exact:false})).toHaveValue(amount);
    }
  }
  await pool.query('DELETE FROM commercial_budget_period_allocations WHERE budget_line_id=$1 AND financial_period_id=$2',[budgetState.line_id,siblingPeriod]);
  await pool.query('DELETE FROM commercial_financial_periods WHERE id=$1',[siblingPeriod]);
  await editAllocation.click();
  await allocationForm.getByLabel('Period amount (AUD)',{exact:false}).fill('100.00');
  await allocationForm.getByRole('button',{name:'Update allocation',exact:true}).click();
  await expect(budgetSection.getByText('Balanced',{exact:true})).toBeVisible();
  await budgetSection.getByText('Edit draft settings',{exact:true}).click();
  await expect(settingsForm.getByLabel('Draft Budget name',{exact:false})).toHaveValue('Pilot Budget revised');
  await expect(settingsForm.getByLabel('Draft tax basis',{exact:false})).toHaveValue('EXCLUSIVE');
  await settingsForm.getByLabel('Draft tax basis',{exact:false}).selectOption('INCLUSIVE');
  await settingsForm.getByRole('button',{name:'Save draft settings',exact:true}).click();
  await expect(budgetSection.getByRole('status')).toContainText('Budget settings saved.');
  const retainedAllocation=(await pool.query('SELECT amount_cents::text AS cents FROM commercial_budget_period_allocations WHERE budget_line_id=$1',[budgetState.line_id])).rows;
  if(retainedAllocation.length!==1||retainedAllocation[0].cents!=='10000')throw new Error('Settings edit changed existing allocations');
  await other.page.setViewportSize({width:390,height:844});
  const settingsOverflow=await other.page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  if(settingsOverflow.scrollWidth>settingsOverflow.width)throw new Error('Draft settings editor overflows mobile viewport');
  await expect(settingsForm.getByRole('button',{name:'Save draft settings',exact:true})).toBeVisible();
  await other.page.screenshot({path:resolve(artifacts,'draft-settings-mobile.png'),fullPage:true});
  await other.page.setViewportSize({width:1440,height:1000});
  await budgetSection.getByText('Edit draft settings',{exact:true}).click();
  await other.page.screenshot({path:resolve(artifacts,'finance-setup-draft-desktop.png'),fullPage:true});
  // Recover each retained dimension without replacing the draft's identity or lines.
  for(const [index,kind,title,code] of [[0,'accounts','Budget accounts','BUDGET-ACC'],[1,'cost-centres','Cost centres','BUDGET-CC']]){
    const section=other.page.getByRole('region',{name:title,exact:true});
    await section.getByRole('button',{name:'Deactivate '+code,exact:true}).click();
    await expect(section.getByRole('button',{name:'Reactivate '+code,exact:true})).toBeVisible();
    await expect(activationChecks).toContainText('Reactivate or correct');
    await activationChecks.getByRole('link',{name:kind==='accounts'?'Review Budget accounts':'Review cost centres',exact:true}).click();
    await expect(other.page).toHaveURL(new RegExp('#dimension-'+kind+'$'));
    await expect(section.getByRole('heading',{name:title,exact:true})).toBeFocused();
    if(kind==='accounts'){
      await other.page.setViewportSize({width:390,height:844});
      await expect(activationChecks.getByRole('link',{name:'Review Budget accounts',exact:true})).toBeVisible();
      await expect(activationChecks.getByRole('link',{name:'Review cost centres',exact:true})).toBeVisible();
      const navigationOverflow=await other.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      if(navigationOverflow)throw new Error('Activation navigation overflows mobile viewport');
      await other.page.screenshot({path:resolve(artifacts,'activation-navigation-mobile.png'),fullPage:true});
      await other.page.setViewportSize({width:1440,height:1000});
    }
    await expect(mappingsTable).toContainText(kind==='accounts'?'Account inactive':'Cost centre inactive');
    await budgetSection.getByRole('button',{name:'Activate Budget version',exact:true}).click();
    await budgetSection.getByRole('button',{name:'Confirm activation',exact:true}).click();
    await expect(budgetSection.getByRole('alert')).toContainText('active same-tenant');
    const path='/api/commercial/budgeting/setup/'+kind+'/'+budgetDimensions[index]+'/reactivate';
    if((await fetch(origin+path,{method:'POST'})).status!==401)throw new Error('Unauthenticated reactivation accepted');
    if((await viewer.page.evaluate(async path=>(await fetch(path,{method:'POST'})).status,path))!==403)throw new Error('Viewer reactivation accepted');
    if((await page.evaluate(async path=>(await fetch(path,{method:'POST'})).status,path))!==404)throw new Error('Foreign reactivation accepted');
    await section.getByRole('button',{name:'Reactivate '+code,exact:true}).click();
    await expect(section.getByRole('button',{name:'Deactivate '+code,exact:true})).toBeVisible();
    if((await setupPost(path,{})).status!==200)throw new Error('Repeated reactivation failed');
    const audit=(await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE organisation_id='runtime-b' AND resource_id=$1 AND action=$2 AND user_id='runtime-other'",[budgetDimensions[index],(kind==='accounts'?'commercial_budget_account':'commercial_cost_centre')+'.reactivated'])).rows[0];
    if(audit.n!==1)throw new Error('Reactivation actor or retry audit is incorrect');
  }
  // Remove an accidental extra line through the real confirmation, preserving the original draft.
  const removalPath='/api/commercial/budgeting/budgets/'+budgetState.id+'/versions/'+budgetState.version_id+'/setup';
  // Real saves with failed readback/lost response must recover through GET without replaying mutations.
  const savedBudgetReads='**/api/commercial/budgeting/budgets';
  for(const loseSaveResponse of [false,true]){
    const auditCount=async()=>(await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE resource_id=$1 AND action='commercial_budget_line.changed'",[budgetState.line_id])).rows[0].n;
    const beforeAudit=await auditCount();let blockReads=!loseSaveResponse;
    const readFailure=route=>blockReads?route.abort('failed'):route.continue();
    await other.page.route(savedBudgetReads,readFailure);
    const lostResponse=async route=>{await route.fetch();await route.abort('failed');};
    if(loseSaveResponse)await other.page.route('**'+removalPath,lostResponse);
    await budgetSection.getByRole('button',{name:'Edit BUDGET-ACC / BUDGET-CC',exact:true}).click();
    const recoveryEditor=budgetSection.getByRole('form',{name:'Budget line',exact:true});
    await recoveryEditor.getByLabel('Annual amount (AUD)',{exact:false}).fill('123.45');
    // Two events in one browser turn exercise the synchronous submission guard.
    await recoveryEditor.evaluate(form=>{form.requestSubmit();form.requestSubmit();});
    await expect(budgetSection.getByRole('alert')).toContainText(loseSaveResponse?'save outcome could not be confirmed':'Your change was saved');
    await expect(recoveryEditor.getByRole('button',{name:'Update line',exact:true})).toBeDisabled();
    await expect(budgetSection.getByRole('button',{name:'Export Budget lines CSV',exact:true})).toBeDisabled();
    await expect(budgetSection.getByRole('button',{name:'Activate Budget version',exact:true})).toBeDisabled();
    if((await pool.query('SELECT annual_budget_cents::text AS cents FROM commercial_budget_lines WHERE id=$1',[budgetState.line_id])).rows[0].cents!=='12345'||await auditCount()!==beforeAudit+1)throw new Error('Interrupted save did not persist once');
    blockReads=true;
    await budgetSection.getByRole('button',{name:'Reload saved Budget',exact:true}).click();
    await expect(budgetSection.getByRole('button',{name:'Reload saved Budget',exact:true})).toBeEnabled();
    await expect(budgetSection.getByRole('button',{name:'Export Budget lines CSV',exact:true})).toBeDisabled();
    if(await auditCount()!==beforeAudit+1)throw new Error('Failed recovery replayed save');
    await other.page.setViewportSize({width:390,height:844});
    if(await other.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Save recovery controls overflow mobile');
    await budgetSection.getByRole('button',{name:'Reload saved Budget',exact:true}).scrollIntoViewIfNeeded();
    await budgetSection.getByRole('region',{name:'Saved Budget reload',exact:true}).screenshot({path:resolve(artifacts,'draft-save-recovery-'+(loseSaveResponse?'unknown':'saved')+'-mobile.png')});
    blockReads=false;
    await budgetSection.getByRole('button',{name:'Reload saved Budget',exact:true}).click();
    await expect(budgetSection.getByRole('status')).toContainText('Saved Budget reloaded.');
    await expect(budgetSection.getByRole('region',{name:'Budget amount review',exact:true})).toBeFocused();
    await expect(budgetSection.getByRole('table',{name:'Budget lines and allocation checks',exact:true})).toContainText('AUD 123.45');
    await expect(budgetSection.getByRole('button',{name:'Export Budget lines CSV',exact:true})).toBeEnabled();
    if(await auditCount()!==beforeAudit+1)throw new Error('Read-only recovery repeated save');
    await other.page.setViewportSize({width:1440,height:1000});
    await other.page.unroute(savedBudgetReads,readFailure);
    if(loseSaveResponse)await other.page.unroute('**'+removalPath,lostResponse);
    await budgetSection.getByRole('button',{name:'Edit BUDGET-ACC / BUDGET-CC',exact:true}).click();
    await recoveryEditor.getByLabel('Annual amount (AUD)',{exact:false}).fill('100.00');
    await recoveryEditor.getByRole('button',{name:'Update line',exact:true}).click();
    await expect(budgetSection.getByRole('status')).toContainText('Budget setup saved.');
  }

  // Bundle individual allocation and mapping corrections before publishing this draft.
  const correctionPeriod=await setupPost('/api/commercial/budgeting/financial-years/'+setupYearId+'/periods',{name:'Correction period',startsOn:'2027-09-01',endsOn:'2027-09-30'});
  if(correctionPeriod.status!==201)throw new Error('Correction period fixture failed');
  const correctionPeriodId=correctionPeriod.data.period.id;
  if((await setupPost(removalPath,{action:'allocation',budgetLineId:budgetState.line_id,financialPeriodId:correctionPeriodId,amountCents:'9007199254740993'})).status!==200)throw new Error('Correction allocation fixture failed');
  const correctionCentre=await setupPost('/api/commercial/budgeting/setup/cost-centres',{code:'REMOVE-CC',name:'Correction fixture'});
  if(correctionCentre.status!==201)throw new Error('Correction mapping centre failed');
  const correctionCentreId=(await pool.query("SELECT id FROM commercial_cost_centres WHERE organisation_id='runtime-b' AND code='REMOVE-CC'")).rows[0].id;
  if((await setupPost(removalPath,{action:'mapping',costCentreId:correctionCentreId,budgetAccountId:alternateAccount})).status!==200)throw new Error('Correction mapping fixture failed');
  for(const target of [
    {kind:'allocation',body:{action:'remove-allocation',budgetLineId:budgetState.line_id,financialPeriodId:correctionPeriodId,reason:'Accidental allocation'},button:'Remove allocation BUDGET-ACC / BUDGET-CC / Correction period',confirm:'Confirm remove allocation',keep:'Keep allocation',review:'Budget amount review',resource:'commercial_budget_period_allocation',query:'SELECT id FROM commercial_budget_period_allocations WHERE budget_line_id=$1 AND financial_period_id=$2',keys:[budgetState.line_id,correctionPeriodId]},
    {kind:'mapping',body:{action:'remove-mapping',costCentreId:correctionCentreId,reason:'Accidental mapping'},button:'Remove mapping REMOVE-CC',confirm:'Confirm remove mapping',keep:'Keep mapping',review:'Commitment mapping review',resource:'commercial_budget_commitment_mapping',query:'SELECT id FROM commercial_budget_commitment_mappings WHERE budget_version_id=$1 AND cost_centre_id=$2',keys:[budgetState.version_id,correctionCentreId]},
  ]){
    const targetId=(await pool.query(target.query,target.keys)).rows[0].id;
    for(const [testPage,status] of [[viewer.page,403],[page,404]]){
      if((await testPage.evaluate(async ({path,body})=>(await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,{path:removalPath,body:target.body}))!==status)throw new Error(target.kind+' correction crossed role/tenant');
    }
    if((await fetch(origin+removalPath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(target.body)})).status!==401)throw new Error('Unauthenticated correction accepted');
    if((await setupPost(removalPath,{...target.body,reason:'xx'})).status!==400)throw new Error('Invalid correction reason accepted');
    await pool.query("UPDATE commercial_financial_years SET status='CLOSED' WHERE id=$1",[setupYearId]);
    if((await setupPost(removalPath,target.body)).status!==409)throw new Error('Closed year correction accepted');
    await pool.query("UPDATE commercial_financial_years SET status='OPEN' WHERE id=$1",[setupYearId]);
    await other.page.reload();
    await budgetSection.getByRole('button',{name:target.button,exact:true}).click();
    const confirmation=budgetSection.getByRole('region',{name:'Draft '+target.kind+' removal confirmation',exact:true});
    await expect(confirmation.getByLabel('Removal reason',{exact:false})).toBeFocused();
    if(target.kind==='allocation')await expect(confirmation).toContainText('AUD 90,071,992,547,409.93');
    await confirmation.getByRole('button',{name:target.keep,exact:true}).click();
    if((await pool.query(target.query,target.keys)).rows.length!==1)throw new Error('Correction cancel mutated saved entry');
    await expect(budgetSection.getByRole('region',{name:target.review,exact:true})).toBeFocused();
    await budgetSection.getByRole('button',{name:target.button,exact:true}).click();
    await other.page.setViewportSize({width:390,height:844});
    if(await other.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Correction confirmation overflows mobile');
    await confirmation.screenshot({path:resolve(artifacts,'draft-'+target.kind+'-removal-mobile.png')});
    await confirmation.getByLabel('Removal reason',{exact:false}).fill(target.body.reason);
    await confirmation.getByRole('button',{name:target.confirm,exact:true}).click();
    await expect(budgetSection.getByRole('status')).toContainText(target.kind==='allocation'?'Period allocation removed.':'Commitment mapping removed.');
    await expect(budgetSection.getByRole('region',{name:target.review,exact:true})).toBeFocused();
    await expect(budgetSection.getByRole('button',{name:target.button,exact:true})).toHaveCount(0);
    await other.page.setViewportSize({width:1440,height:1000});
    if((await pool.query(target.query,target.keys)).rows.length)throw new Error('Correction persisted a removed entry');
    if((await setupPost(removalPath,target.body)).status!==404)throw new Error('Repeated correction did not return missing entry');
    const audit=(await pool.query('SELECT user_id,before_state,after_state FROM audit_logs WHERE resource_id=$1 AND action=$2',[targetId,target.resource+'.removed'])).rows;
    if(audit.length!==1||audit[0].user_id!=='runtime-other'||audit[0].after_state.reason!==target.body.reason||(target.kind==='allocation'?audit[0].before_state.amount_cents!=='9007199254740993':audit[0].before_state.budget_account_id!==alternateAccount))throw new Error('Correction audit lost actor reason or exact before-state');
    if((await pool.query('SELECT annual_budget_cents::text AS cents FROM commercial_budget_lines WHERE id=$1',[budgetState.line_id])).rows[0].cents!=='10000'||(await pool.query('SELECT amount_cents::text AS cents FROM commercial_budget_period_allocations WHERE id=$1',[originalAllocationId])).rows[0].cents!=='10000'||(await pool.query('SELECT budget_account_id FROM commercial_budget_commitment_mappings WHERE id=$1',[originalMapping.id])).rows[0].budget_account_id!==budgetDimensions[0])throw new Error('Correction changed retained Budget records');
  }

  if((await setupPost(removalPath,{action:'line',budgetAccountId:alternateAccount,costCentreId:budgetDimensions[1],annualBudgetCents:'9007199254740993'})).status!==200)throw new Error('Removal fixture creation failed');
  const removalLine=(await pool.query('SELECT id FROM commercial_budget_lines WHERE budget_version_id=$1 AND budget_account_id=$2',[budgetState.version_id,alternateAccount])).rows[0].id;
  if((await setupPost(removalPath,{action:'allocation',budgetLineId:removalLine,financialPeriodId:setupPeriod,amountCents:'9007199254740993'})).status!==200)throw new Error('Removal allocation fixture creation failed');
  const removalBody={action:'remove-line',budgetLineId:removalLine,reason:'Accidental test line'};
  for(const [testPage,status] of [[viewer.page,403],[page,404]]){
    if((await testPage.evaluate(async ({path,body})=>(await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,{path:removalPath,body:removalBody}))!==status)throw new Error('Removal crossed role/tenant boundary');
  }
  if((await fetch(origin+removalPath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(removalBody)})).status!==401)throw new Error('Unauthenticated removal accepted');
  if((await setupPost(removalPath,{...removalBody,reason:'xx'})).status!==400)throw new Error('Invalid removal reason accepted');
  if((await setupPost(removalPath,{...removalBody,budgetLineId:'00000000-0000-4000-8000-000000000000'})).status!==404)throw new Error('Missing removal line accepted');
  await pool.query("UPDATE commercial_financial_years SET status='CLOSED' WHERE id=$1",[setupYearId]);
  if((await setupPost(removalPath,removalBody)).status!==409)throw new Error('Closed year removal accepted');
  await pool.query("UPDATE commercial_financial_years SET status='OPEN' WHERE id=$1",[setupYearId]);
  await other.page.reload();
  await budgetSection.getByRole('button',{name:'Remove draft line MAPPING-ALT / BUDGET-CC',exact:true}).click();
  const removalForm=budgetSection.getByRole('form',{name:'Remove draft Budget line',exact:true});
  await expect(removalForm.getByLabel('Removal reason',{exact:false})).toBeFocused();
  await expect(budgetSection.getByRole('region',{name:'Draft line removal confirmation'})).toContainText('AUD 90,071,992,547,409.93');
  await removalForm.getByLabel('Removal reason',{exact:false}).fill('Accidental test line');
  await removalForm.getByRole('button',{name:'Keep draft line',exact:true}).click();
  if((await pool.query('SELECT count(*)::int AS n FROM commercial_budget_period_allocations WHERE budget_line_id=$1',[removalLine])).rows[0].n!==1)throw new Error('Removal cancellation changed allocations');
  await budgetSection.getByRole('button',{name:'Remove draft line MAPPING-ALT / BUDGET-CC',exact:true}).click();
  await other.page.setViewportSize({width:390,height:844});
  if(await other.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Removal confirmation overflows mobile');
  await budgetSection.getByRole('region',{name:'Draft line removal confirmation'}).screenshot({path:resolve(artifacts,'draft-line-removal-mobile.png')});
  await removalForm.getByLabel('Removal reason',{exact:false}).fill('Accidental test line');
  await removalForm.getByRole('button',{name:'Confirm remove draft line',exact:true}).click();
  await expect(budgetSection.getByRole('status')).toContainText('Draft line and its period allocations removed.');
  await expect(budgetSection.getByRole('region',{name:'Budget amount review',exact:true})).toBeFocused();
  await expect(budgetSection.getByRole('button',{name:'Remove draft line MAPPING-ALT / BUDGET-CC',exact:true})).toHaveCount(0);
  await other.page.setViewportSize({width:1440,height:1000});
  const removedCounts=(await pool.query('SELECT (SELECT count(*) FROM commercial_budget_lines WHERE id=$1)::int AS lines,(SELECT count(*) FROM commercial_budget_period_allocations WHERE budget_line_id=$1)::int AS allocations',[removalLine])).rows[0];
  if(removedCounts.lines||removedCounts.allocations)throw new Error('Removal did not delete line and allocations');
  if((await pool.query('SELECT annual_budget_cents::text AS cents FROM commercial_budget_lines WHERE id=$1',[budgetState.line_id])).rows[0].cents!=='10000'||(await pool.query('SELECT amount_cents::text AS cents FROM commercial_budget_period_allocations WHERE budget_line_id=$1',[budgetState.line_id])).rows[0].cents!=='10000')throw new Error('Removal changed another line or allocation');
  if((await pool.query('SELECT budget_account_id FROM commercial_budget_commitment_mappings WHERE id=$1',[originalMapping.id])).rows[0].budget_account_id!==budgetDimensions[0])throw new Error('Removal changed commitment mapping');
  if((await setupPost(removalPath,removalBody)).status!==404)throw new Error('Repeated removal did not report missing line');
  const removalAudit=(await pool.query("SELECT user_id,before_state,after_state FROM audit_logs WHERE resource_id=$1 AND action='commercial_budget_line.removed'",[removalLine])).rows;
  if(removalAudit.length!==1||removalAudit[0].user_id!=='runtime-other'||removalAudit[0].after_state.reason!=='Accidental test line'||removalAudit[0].before_state.annual_budget_cents!=='9007199254740993'||removalAudit[0].before_state.allocations[0].amount_cents!=='9007199254740993')throw new Error('Removal audit lost actor reason or exact before-state');
  await budgetSection.getByRole('button',{name:'Activate Budget version',exact:true}).click();
  const finalActivationReview=budgetSection.getByRole('region',{name:'Budget activation confirmation',exact:true});
  await expect(finalActivationReview).toBeFocused();
  await expect(finalActivationReview).toContainText('AUD 100.00');
  await expect(budgetSection.getByRole('button',{name:'Save line',exact:true})).toBeDisabled();
  await other.page.setViewportSize({width:390,height:844});
  await finalActivationReview.screenshot({path:resolve(artifacts,'budget-activation-confirmation-mobile.png')});
  await budgetSection.getByRole('button',{name:'Keep draft',exact:true}).click();
  await expect(budgetSection.getByRole('button',{name:'Activate Budget version',exact:true})).toBeFocused();
  if((await pool.query('SELECT status FROM commercial_budget_versions WHERE id=$1',[budgetState.version_id])).rows[0].status!=='DRAFT')throw new Error('Activation review or cancellation changed saved status');
  await other.page.setViewportSize({width:1440,height:1000});
  await budgetSection.getByRole('button',{name:'Activate Budget version',exact:true}).click();
  await budgetSection.getByRole('button',{name:'Confirm activation',exact:true}).click();
  await expect(budgetSection.getByRole('status')).toContainText('Budget version activated.');
  await expect(activationChecks).toHaveCount(0);
  await expect(budgetSection.getByRole('button',{name:/^Remove (allocation|mapping|draft line)/})).toHaveCount(0);
  await expect(budgetSection.getByRole('button',{name:'Edit mapping BUDGET-CC',exact:true})).toHaveCount(0);
  await expect(mappingsTable).toContainText('BUDGET-ACC');
  await expect(budgetSection.getByRole('button',{name:'Edit BUDGET-ACC / BUDGET-CC',exact:true})).toHaveCount(0);
  await expect(budgetSection.getByRole('button',{name:'Edit allocation BUDGET-ACC / BUDGET-CC / July',exact:true})).toHaveCount(0);
  await expect(budgetSection.getByRole('button',{name:'Save line',exact:true})).toHaveCount(0);
  const budgetSetupPath='/api/commercial/budgeting/budgets/'+budgetState.id+'/versions/'+budgetState.version_id+'/setup';
  if((await setupPost(budgetSetupPath,{action:'line',budgetAccountId:budgetDimensions[0],costCentreId:budgetDimensions[1],annualBudgetCents:'1'})).status!==409)throw new Error('Activated Budget remained editable');
  const activatedBudget=(await pool.query("SELECT b.active_version_id,v.status FROM commercial_budgets b JOIN commercial_budget_versions v ON v.id=b.active_version_id WHERE b.id=$1",[budgetState.id])).rows[0];
  if(activatedBudget.active_version_id!==budgetState.version_id||activatedBudget.status!=='ACTIVE')throw new Error('Budget activation did not persist');
  await expect(budgetSection.getByText('Edit draft settings',{exact:true})).toHaveCount(0);
  if((await setupPost(budgetSetupPath,{action:'settings',name:'Forbidden',taxBasis:'INCLUSIVE'})).status!==409)throw new Error('ACTIVE Budget settings were editable');
  // Even a new DRAFT cannot rewrite a Budget with an earlier published version.
  const laterDraft=(await pool.query("INSERT INTO commercial_budget_versions(organisation_id,budget_id,version_number,status) VALUES('runtime-b',$1,2,'DRAFT') RETURNING id",[budgetState.id])).rows[0].id;
  const laterPath='/api/commercial/budgeting/budgets/'+budgetState.id+'/versions/'+laterDraft+'/setup';
  if((await setupPost(laterPath,{action:'settings',name:'Forbidden',taxBasis:'INCLUSIVE'})).status!==409)throw new Error('A later draft rewrote published Budget settings');
  await pool.query('DELETE FROM commercial_budget_versions WHERE id=$1',[laterDraft]);
  const raceBudget=await setupPost('/api/commercial/budgeting/budgets',{name:'Race Budget',financialYearId:setupYearId,currency:'NZD',taxBasis:'INCLUSIVE',periodisationMode:'PERIODISED'});
  if(raceBudget.status!==201)throw new Error('Settings race fixture creation failed');
  const raceBudgetId=raceBudget.data.budget.id,raceVersionId=raceBudget.data.version.id;
  const racePath='/api/commercial/budgeting/budgets/'+raceBudgetId+'/versions/'+raceVersionId;
  for(const body of [{action:'line',budgetAccountId:budgetDimensions[0],costCentreId:budgetDimensions[1],annualBudgetCents:'10000'},{action:'mapping',budgetAccountId:budgetDimensions[0],costCentreId:budgetDimensions[1]}]){
    if((await setupPost(racePath+'/setup',body)).status!==200)throw new Error('Settings race fixture line/mapping failed');
  }
  const raceAllocationLine=(await pool.query('SELECT id FROM commercial_budget_lines WHERE budget_version_id=$1',[raceVersionId])).rows[0].id;
  if((await setupPost(racePath+'/setup',{action:'allocation',budgetLineId:raceAllocationLine,financialPeriodId:setupPeriod,amountCents:'10000'})).status!==200)throw new Error('Correction race allocation fixture failed');
  async function waitForBudgetLockWaiters(count){
    for(let attempt=0;attempt<100;attempt++){
      const waiting=(await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%commercial_budgets%'",[database])).rows[0].n;
      if(waiting>=count)return;
      await pause(50);
    }
    throw new Error('Budget settings requests did not reach the database lock gate');
  }
  // Hold the year until a settings request has passed its initial DRAFT check.
  const yearGate=await pool.connect();let closedSettings,closedAllocationRemoval,closedMappingRemoval;
  try{
    await yearGate.query('BEGIN');
    await yearGate.query('SELECT id FROM commercial_financial_years WHERE id=$1 FOR UPDATE',[setupYearId]);
    closedSettings=setupPost(racePath+'/setup',{action:'settings',name:'Must not save',taxBasis:'EXCLUSIVE'});
    await waitForBudgetLockWaiters(1);
    closedAllocationRemoval=setupPost(racePath+'/setup',{action:'remove-allocation',budgetLineId:raceAllocationLine,financialPeriodId:setupPeriod,reason:'Must retain allocation'});
    await waitForBudgetLockWaiters(2);
    closedMappingRemoval=setupPost(racePath+'/setup',{action:'remove-mapping',costCentreId:budgetDimensions[1],reason:'Must retain mapping'});
    await waitForBudgetLockWaiters(3);
    await yearGate.query("UPDATE commercial_financial_years SET status='CLOSED' WHERE id=$1",[setupYearId]);
    await yearGate.query('COMMIT');
    if((await closedAllocationRemoval).status!==409||(await closedMappingRemoval).status!==409)throw new Error('Corrections changed after concurrent year close');
    if((await closedSettings).status!==409)throw new Error('Settings changed after a concurrent year close');
  }finally{
    await yearGate.query('ROLLBACK');yearGate.release();
    await Promise.allSettled([closedSettings,closedAllocationRemoval,closedMappingRemoval].filter(Boolean));
    await pool.query("UPDATE commercial_financial_years SET status='OPEN' WHERE id=$1",[setupYearId]);
  }
  // Queue activation first, then settings, with both held at the Budget lock.
  const activationGate=await pool.connect();let queuedActivation,queuedSettings,queuedRemoval,queuedAllocationRemoval,queuedMappingRemoval;
  try{
    await activationGate.query('BEGIN');
    await activationGate.query('SELECT id FROM commercial_budgets WHERE id=$1 FOR UPDATE',[raceBudgetId]);
    queuedActivation=setupPost(racePath+'/activate',{});
    await waitForBudgetLockWaiters(1);
    queuedSettings=setupPost(racePath+'/setup',{action:'settings',name:'Must not save',taxBasis:'EXCLUSIVE'});
    await waitForBudgetLockWaiters(2);
    const raceLine=(await pool.query('SELECT id FROM commercial_budget_lines WHERE budget_version_id=$1',[raceVersionId])).rows[0].id;
    queuedRemoval=setupPost(racePath+'/setup',{action:'remove-line',budgetLineId:raceLine,reason:'Must not remove'});
    await waitForBudgetLockWaiters(3);
    queuedAllocationRemoval=setupPost(racePath+'/setup',{action:'remove-allocation',budgetLineId:raceLine,financialPeriodId:setupPeriod,reason:'Must not remove'});
    await waitForBudgetLockWaiters(4);
    queuedMappingRemoval=setupPost(racePath+'/setup',{action:'remove-mapping',costCentreId:budgetDimensions[1],reason:'Must not remove'});
    await waitForBudgetLockWaiters(5);
    await activationGate.query('COMMIT');
    if((await queuedRemoval).status!==409||(await pool.query('SELECT count(*)::int AS n FROM commercial_budget_lines WHERE id=$1',[raceLine])).rows[0].n!==1)throw new Error('Activation/removal race removed published line');
    if((await queuedAllocationRemoval).status!==409||(await queuedMappingRemoval).status!==409||(await pool.query('SELECT count(*)::int AS n FROM commercial_budget_period_allocations WHERE budget_line_id=$1',[raceLine])).rows[0].n!==1||(await pool.query('SELECT count(*)::int AS n FROM commercial_budget_commitment_mappings WHERE budget_version_id=$1',[raceVersionId])).rows[0].n!==1)throw new Error('Activation/correction race changed published entries');
    if((await queuedActivation).status!==200||(await queuedSettings).status!==409)throw new Error('Activation/settings race did not preserve published settings');
  }finally{
    await activationGate.query('ROLLBACK');activationGate.release();
    await Promise.allSettled([queuedActivation,queuedSettings,queuedRemoval,queuedAllocationRemoval,queuedMappingRemoval].filter(Boolean));
  }
  const raceSaved=(await pool.query('SELECT name,tax_basis FROM commercial_budgets WHERE id=$1',[raceBudgetId])).rows[0];
  if(raceSaved.name!=='Race Budget'||raceSaved.tax_basis!=='INCLUSIVE')throw new Error('Rejected concurrent settings changed Budget facts');
  if((await setupPost('/api/commercial/budgeting/budgets',{name:'Duplicate',financialYearId:setupYearId,currency:'AUD',taxBasis:'INCLUSIVE',periodisationMode:'PERIODISED'})).status!==409)throw new Error('Duplicate Budget header accepted');
  if((await page.evaluate(async path=>(await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,budgetSetupPath))!==404)throw new Error('Budget editing crossed tenants');
  for(const path of ['/api/commercial/budgeting/budgets',budgetSetupPath]){
    if((await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status!==401)throw new Error('Unauthenticated Budget mutation accepted');
    if((await viewer.page.evaluate(async path=>(await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,path))!==403)throw new Error('Viewer Budget mutation accepted');
  }
  await other.page.getByRole('navigation',{name:'Finance workflow',exact:true}).getByRole('link',{name:'External GL mappings',exact:true}).click();
  await other.page.getByLabel('BrainBase Budget account', {exact:false}).selectOption(budgetDimensions[0]);
  await expect(other.page.getByLabel('BrainBase Budget account', {exact:false})).toHaveValue(budgetDimensions[0]);
  await other.page.getByLabel('BrainBase cost centre', {exact:false}).selectOption(budgetDimensions[1]);
  await expect(other.page.getByLabel('BrainBase cost centre', {exact:false})).toHaveValue(budgetDimensions[1]);
  await expect(other.page.getByText('Create active Budget accounts and cost centres in Finance setup before adding External GL mappings.',{exact:true})).toHaveCount(0);
  await other.page.getByRole('navigation',{name:'Finance workflow',exact:true}).getByRole('link',{name:'Finance controls',exact:true}).click();
  await other.page.getByRole('combobox',{name:'Financial year',exact:true}).selectOption(setupYearId);
  await other.page.getByRole('combobox',{name:'Financial period',exact:true}).selectOption(setupPeriod);
  await expect(other.page.getByRole('combobox',{name:'Financial period',exact:true})).toHaveValue(setupPeriod);
  await other.page.getByRole('navigation',{name:'Finance workflow',exact:true}).getByRole('link',{name:'Finance setup',exact:true}).click();
  await expect(other.page.getByRole('combobox',{name:'Budget version',exact:true})).toContainText('Pilot Budget revised · AUD · v1 · ACTIVE');
  const periodPath='/api/commercial/budgeting/financial-years/'+setupYearId+'/periods';
  for(const [body,expected] of [[{name:'Overlap',startsOn:'2027-07-31',endsOn:'2027-08-15'},409],[{name:'Outside',startsOn:'2027-06-01',endsOn:'2027-06-30'},409],[{name:'Invalid',startsOn:'2028-02-30',endsOn:'2028-03-31'},400],[{name:'July',startsOn:'2027-08-01',endsOn:'2027-08-31'},409]]){
    if((await setupPost(periodPath,body)).status!==expected)throw new Error('Calendar validation failed: '+JSON.stringify(body));
  }
  const parallelPeriods=await Promise.all(['August A','August B'].map(name=>setupPost(periodPath,{name,startsOn:'2027-08-01',endsOn:'2027-08-31'})));
  if(parallelPeriods.map(result=>result.status).sort().join(',')!=='201,409')throw new Error('Concurrent calendar periods overlapped');
  const parallelYears=await Promise.all(['Next A','Next B'].map(name=>setupPost('/api/commercial/budgeting/financial-years',{name,startsOn:'2028-07-01',endsOn:'2029-06-30'})));
  if(parallelYears.map(result=>result.status).sort().join(',')!=='201,409')throw new Error('Concurrent financial years overlapped');
  const closedYearId=parallelYears.find(result=>result.status===201).data.year.id;
  if((await setupPost('/api/commercial/budgeting/financial-years/'+closedYearId+'/close',{})).status!==200)throw new Error('Demo year close failed');
  if((await setupPost('/api/commercial/budgeting/financial-years/'+closedYearId+'/periods',{name:'Blocked',startsOn:'2028-07-01',endsOn:'2028-07-31'})).data.code!=='CLOSED_YEAR')throw new Error('Closed year accepted a period');
  const racingYear=await setupPost('/api/commercial/budgeting/financial-years',{name:'Close race',startsOn:'2029-07-01',endsOn:'2030-06-30'});
  const racingId=racingYear.data.year.id;
  const racingResults=await Promise.all([setupPost('/api/commercial/budgeting/financial-years/'+racingId+'/close',{}),setupPost('/api/commercial/budgeting/financial-years/'+racingId+'/periods',{name:'Race period',startsOn:'2029-07-01',endsOn:'2029-07-31'})]);
  if(!racingResults.every(result=>[200,201,409].includes(result.status)))throw new Error('Year close/calendar race failed unexpectedly');
  const invalidClosed=(await pool.query("SELECT count(*)::int AS n FROM commercial_financial_years y JOIN commercial_financial_periods p ON p.financial_year_id=y.id WHERE y.id=$1 AND y.status='CLOSED' AND p.status='OPEN'",[racingId])).rows[0].n;
  if(invalidClosed)throw new Error('Concurrent setup created an OPEN period inside a CLOSED year');
  const foreignCalendar=await page.evaluate(async ({id})=>(await fetch('/api/commercial/budgeting/financial-years/'+id+'/periods',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Foreign',startsOn:'2027-09-01',endsOn:'2027-09-30'})})).status,{id:setupYearId});
  if(foreignCalendar!==404)throw new Error('Calendar creation crossed tenants');
  for(const path of ['/api/commercial/budgeting/financial-years',periodPath]){
    if((await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status!==401)throw new Error('Calendar accepted unauthenticated mutation');
    if((await viewer.page.evaluate(async path=>(await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,path))!==403)throw new Error('Viewer calendar mutation accepted');
  }
  await other.page.reload();
  await other.page.getByRole('combobox',{name:'Financial year',exact:true}).selectOption(setupYearId);
  for(const dimension of dimensionRows){
    const section=other.page.getByRole('region',{name:dimension.kind==='accounts'?'Budget accounts':'Cost centres',exact:true});
    await expect(section.getByRole('table')).toContainText(dimension.code);
    await expect(section.getByRole('table')).toContainText('Inactive');
  }
  await expect(other.page.getByRole('region',{name:'Financial period calendar',exact:true})).toContainText('31/08/2027');
  await other.page.setViewportSize({width:390,height:844});
  const calendarOverflow=await other.page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  if(calendarOverflow.scrollWidth>calendarOverflow.width)throw new Error('Calendar setup overflows mobile viewport');
  const mobileReview=other.page.getByRole('region',{name:'Budget setup',exact:true});
  await expect(mobileReview.getByRole('table',{name:'Period allocations',exact:true})).toContainText('AUD 100.00');
  for(const label of ['Budget setup lines','Budget period allocations']){
    const region=mobileReview.getByRole('region',{name:label,exact:true});
    const bounds=await region.boundingBox();
    if(!bounds||bounds.x<0||bounds.x+bounds.width>391)throw new Error(label+' extends beyond the mobile viewport');
    await region.evaluate(element=>{element.scrollLeft=element.scrollWidth;});
    await expect(region.getByRole('columnheader').last()).toBeVisible();
  }
  await other.page.screenshot({path:resolve(artifacts,'finance-setup-mobile.png'),fullPage:true});
  // Synthetic finance evidence in this disposable database must block deletion even on a DRAFT.
  const evidenceBudget=await setupPost('/api/commercial/budgeting/budgets',{name:'Evidence guard',financialYearId:setupYearId,currency:'EUR',taxBasis:'INCLUSIVE',periodisationMode:'PERIODISED'});
  if(evidenceBudget.status!==201)throw new Error('Evidence guard Budget creation failed');
  const evidenceBudgetId=evidenceBudget.data.budget.id,evidenceVersionId=evidenceBudget.data.version.id;
  const evidencePath='/api/commercial/budgeting/budgets/'+evidenceBudgetId+'/versions/'+evidenceVersionId+'/setup';
  if((await setupPost(evidencePath,{action:'line',budgetAccountId:budgetDimensions[0],costCentreId:budgetDimensions[1],annualBudgetCents:'100'})).status!==200)throw new Error('Evidence guard line creation failed');
  const evidenceLine=(await pool.query('SELECT id FROM commercial_budget_lines WHERE budget_version_id=$1',[evidenceVersionId])).rows[0].id;
  if((await setupPost(evidencePath,{action:'allocation',budgetLineId:evidenceLine,financialPeriodId:setupPeriod,amountCents:'100'})).status!==200)throw new Error('Evidence guard allocation creation failed');
  const evidenceAdjustment=(await pool.query("INSERT INTO commercial_finance_adjustments(organisation_id,adjustment_type,effective_financial_period_id,currency,description,reason_code,created_by) VALUES('runtime-b','MANUAL_FINANCE_ADJUSTMENT',$1,'EUR','Synthetic guard fixture','TEST','runtime-other') RETURNING id",[setupPeriod])).rows[0].id;
  await pool.query("INSERT INTO commercial_finance_adjustment_lines(organisation_id,adjustment_id,financial_period_id,position,budget_account_id,cost_centre_id,amount_exclusive_cents,tax_cents,amount_inclusive_cents,resolved_budget_id,resolved_budget_version_id,resolved_budget_line_id,resolved_tax_basis,budget_basis_cents) VALUES('runtime-b',$1,$2,1,$3,$4,100,0,100,$5,$6,$7,'INCLUSIVE',100)",[evidenceAdjustment,setupPeriod,budgetDimensions[0],budgetDimensions[1],evidenceBudgetId,evidenceVersionId,evidenceLine]);
  const evidenceAllocationRemoval=await setupPost(evidencePath,{action:'remove-allocation',budgetLineId:evidenceLine,financialPeriodId:setupPeriod,reason:'Must retain evidence'});
  if(evidenceAllocationRemoval.status!==409||!evidenceAllocationRemoval.data.error.includes('finance evidence'))throw new Error('Allocation correction altered finance evidence');
  const evidenceBefore=(await pool.query('SELECT * FROM commercial_finance_adjustment_lines WHERE adjustment_id=$1',[evidenceAdjustment])).rows;
  const guardedRemoval=await setupPost(evidencePath,{action:'remove-line',budgetLineId:evidenceLine,reason:'Must retain evidence'});
  if(guardedRemoval.status!==409||!guardedRemoval.data.error.includes('finance evidence'))throw new Error('Finance evidence deletion guard failed');
  if(JSON.stringify((await pool.query('SELECT * FROM commercial_finance_adjustment_lines WHERE adjustment_id=$1',[evidenceAdjustment])).rows)!==JSON.stringify(evidenceBefore)||(await pool.query('SELECT count(*)::int AS n FROM commercial_budget_period_allocations WHERE budget_line_id=$1',[evidenceLine])).rows[0].n!==1)throw new Error('Guarded removal changed evidence or allocations');
  await pool.query("UPDATE commercial_budget_versions SET status='SUPERSEDED',activated_at=now(),superseded_at=now(),activated_by='runtime-other' WHERE id=$1",[evidenceVersionId]);
  if((await setupPost(evidencePath,{action:'remove-line',budgetLineId:evidenceLine,reason:'Must retain history'})).status!==409)throw new Error('SUPERSEDED removal accepted');
  if((await setupPost(removalPath,{...removalBody,budgetLineId:budgetState.line_id})).status!==409)throw new Error('ACTIVE line removal accepted');
  await pool.query("UPDATE organisation_modules SET enabled=false WHERE organisation_id='runtime-b' AND module_key='budgeting'");
  if((await setupPost('/api/commercial/budgeting/financial-years',{name:'Denied',startsOn:'2029-07-01',endsOn:'2030-06-30'})).status!==403)throw new Error('Unentitled calendar creation accepted');
  if((await setupPost('/api/commercial/budgeting/setup/accounts',{code:'DENIED',name:'Denied'})).status!==403)throw new Error('Unentitled dimension creation accepted');
  for(const action of ['remove-allocation','remove-mapping']){if((await setupPost(removalPath,{action,budgetLineId:budgetState.line_id,financialPeriodId:setupPeriod,costCentreId:budgetDimensions[1],reason:'Denied'})).status!==403)throw new Error('Unentitled correction accepted');}
  if((await setupPost(removalPath,removalBody)).status!==403)throw new Error('Unentitled removal accepted');
  if((await setupPost('/api/commercial/budgeting/budgets',{})).status!==403)throw new Error('Unentitled Budget creation accepted');
  if((await setupPost('/api/commercial/budgeting/setup/accounts/'+budgetDimensions[0]+'/reactivate',{})).status!==403)throw new Error('Unentitled reactivation accepted');
  await other.page.goto(origin+'/commercial/budgeting/commitments');
  await expect(other.page.getByText('Budgeting access is required to view Budget consumption.',{exact:true})).toBeVisible();
  await expect(other.page.getByRole('navigation',{name:'Finance workflow',exact:true})).toHaveCount(0);
  if(errors.length||failedApi.length)throw new Error(JSON.stringify({errors,failedApi}));
  const externalGlChecks=['mapping list calendar dates','account and cost-centre creation through real forms','exact create response dates','overlap rejection without duplicate facts','source filter','account and cost-centre retirement through real forms','exact retire response and persisted dates','viewer mutation denial','foreign mapping read and retirement denial'];
  const evidence={verified_at:new Date().toISOString(),serverTimezone,checks:['real login and production runtime','calendar dates preserved through API and screen','mobile metrics remain inside viewport','mobile history and reconciliation tables scroll to last column','exact $100 source and ledger match','prepare and review','sign-off blocked before close','period close and durable sign-off','year close and reopen','period reopen invalidates close and reconciliation','viewer denial','tenant isolation'],overflow,build_id:readFileSync('.next/BUILD_ID','utf8').trim()};
  evidence.externalGlChecks=externalGlChecks;
  evidence.importChecks=['real authenticated import API','exact BIGINT amount beyond JavaScript safe integers','date-only import response','exact duplicate idempotency','conflict preserves immutable facts','unsafe numeric, fractional and out-of-range amounts rejected','duplicate preserves signed-off reconciliation','conflict marks current reconciliation and close evidence stale','durable conflict event preserved','new ledger fact invalidates affected sign-off','new import stale event preserves source identity','viewer import denial','import identity and invalidation stay inside organisation'];
  evidence.importConcurrencyChecks=['database-gated overlapping identical requests return IMPORTED and IDEMPOTENT for one identity','concurrent changed facts return one import and one conflict','conflicting request does not overwrite the winning immutable fact'];
  evidence.calendarSetupChecks=['fresh organisation creates year and period through UI','exact dates persist and survive reload','audit retains session actor and dates','invalid dates, overlaps, duplicate names and outside-year periods rejected','concurrent year and period overlaps rejected','closed year rejects new periods','year close and new-period race preserves close invariants','unauthenticated, viewer, unentitled and foreign-tenant mutations denied','mobile setup fits viewport'];
  evidence.dimensionSetupChecks=['account and cost-centre creation through forms','tenant duplicate-code rejection','deactivation retains inactive records after reload','active Budget references prevent deactivation','viewer, unentitled and foreign mutations denied'];
  evidence.budgetSetupChecks=['fresh Budget and DRAFT version created through form','draft line and commitment mapping through forms','period allocation mismatch blocks activation','correct allocation permits activation','ACTIVE version read-only and API rejects edits','active version pointer persisted','duplicate header rejected','unauthenticated, viewer, unentitled and foreign-tenant mutations denied'];
  evidence.budgetReviewChecks=['exact shortage and excess shown per line','corrected allocation marked balanced with remaining review guidance','saved allocation shown in named table','both review tables contained and scrollable on mobile','activation issue links focus line setup, allocation review and dimension headings','resolved issues remove corrective links'];
  evidence.budgetMappingManagementChecks=['saved mapping table shows codes and reference status','checklist link navigates to mapping form','saved account prefilled with fixed cost centre','cancel and version switch discard unsaved edit','update preserves mapping ID cost centre amounts and allocations','saved account reloads and original mapping restored','inactive references flagged','ACTIVE mappings readable without editing','mobile editor fits viewport'];
  evidence.draftSaveRecoveryChecks=['real line save persists once despite two simultaneous form events','failed refresh explicitly confirms saved outcome','lost response reports uncertain outcome','editing activation and exports paused while snapshot stale','failed reload keeps protections and does not repeat POST','successful GET reload restores authoritative amount and focus','audit count proves each interrupted save occurs only once','mobile recovery controls fit viewport'];
  evidence.draftCorrectionBundleChecks=['allocation and mapping removal through confirmation UI','cancel leaves target intact and returns focus','exact BIGINT allocation audited before removal','only selected saved entry removed; annual amount other allocations and mappings retained','missing entry retry 404','invalid reason closed year role tenant unauthenticated unentitled denial','real activation queued ahead of both correction requests preserves published entries','year close queued ahead of correction requests preserves saved entries','allocation backed by finance evidence refuses removal','both confirmations contained on mobile'];
  evidence.budgetLineRemovalChecks=['real confirmation and cancel preserve draft','exact BIGINT line and allocations removed together','actor reason and exact before-state audited once','other lines allocations and mappings unchanged','mobile confirmation contained','finance evidence and its allocations retained on rejected removal','SUPERSEDED removal rejected','missing line retry returns 404','invalid reason closed year ACTIVE viewer tenant unauthenticated unentitled denial','actual activation queued before removal preserves published line','removal followed by activation succeeds for remaining draft'];
  evidence.budgetEditReturnChecks=['mapping cancel and successful update return focus to saved mapping review','line cancel and successful update return focus to amount review','allocation failure retains editor; cancel and successful update return focus to amount review'];
  evidence.budgetSetupExportChecks=['three real CSV downloads have selected draft metadata','exact saved decimal amounts exclude unsaved editor values','allocation dates use DD/MM/YYYY','mapping codes and active status retained','downloads send no finance mutations and leave editor value intact'];
  evidence.budgetActivationGuidanceChecks=['empty draft explains missing lines and mapping','saving lines and mappings updates guidance','allocation imbalance remains visible until resolved','balanced draft still requires tax and mapping review','deactivation reveals inactive reference issue','ACTIVE version omits draft checklist'];
  evidence.budgetAllocationEditChecks=['exact saved amount and fixed line/period prefilled','invalid decimal retains editor without mutation','cancel preserves saved allocation','version switching clears unsaved editor','update retains allocation ID annual amount and another period allocation','shortage excess and recovered balance shown','mobile editor contained','ACTIVE edit action absent'];
  evidence.budgetLineEditChecks=['saved amount prefilled exactly','fixed dimension identity retained','cancel leaves saved amount unchanged','update preserves line ID and allocations','allocation mismatch shown after annual amount change','saved amount reloads and balance restores','editor fits mobile viewport'];
  evidence.budgetSettingsChecks=['draft name and tax basis changed through populated form','saved amounts and allocations preserved','editor reloads saved values and fits mobile viewport','session actor and before/after settings audited','ACTIVE version hides editor and rejects mutation','later draft cannot rewrite published Budget settings','database-gated year close rejects waiting settings','database-gated activation rejects waiting settings without rewriting published facts'];
  evidence.financeWorkflowChecks=['empty finance controls directs administrator to setup','setup links to mappings, reporting and finance controls','empty mapping and reporting screens provide setup guidance','workflow links navigate between actual screens','new dimensions are available in mapping choices and completed guidance clears','new calendar is available in finance controls','activated Budget persists when returning through workflow links','viewer and unentitled users do not see administrator workflow links'];
  evidence.activationConfirmationChecks=['review focuses saved activation context and exact annual total','draft editors disabled during confirmation','cancelling returns focus and leaves persisted version DRAFT','confirmed activation persists ACTIVE and locks editing','server rejects unbalanced allocations and inactive references through confirmation','mobile activation confirmation rendered for visual review'];
  evidence.draftRecoveryChecks=['both draft dimensions can be deactivated','inactive references still block activation','both dimensions restored through UI without replacing draft references','restored draft activates with original version pointer','reactivation retains session actor and audits transition once on retry','unauthenticated, viewer, unentitled and foreign reactivation denied','non-string Budget enums return 400'];
  writeFileSync(resolve(artifacts,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
} finally {
  await browser?.close();
  if(next?.pid){if(process.platform==='win32') await command('taskkill',['/PID',String(next.pid),'/T','/F']).catch(()=>{});else next.kill('SIGTERM');}
  writeFileSync(resolve(artifacts,'next-server.log'),nextLog);
  await pool?.end();if(containerCreated) await command('docker',['rm','-f',container]);
}

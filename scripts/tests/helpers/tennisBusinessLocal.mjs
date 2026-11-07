import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { capacityFixtureSql } from './tennisCapacityFixture.mjs';

// Called ONLY after the owning full-local runner creates its disposable schema.
export async function setupTennisBusiness(q) {
  const contactSchema = readFileSync('scripts/migrate-tennis-production.ts','utf8').match(/CREATE TABLE IF NOT EXISTS contacts \([\s\S]*?\n    \)/)?.[0];
  assert.ok(contactSchema); await q(contactSchema);
  for (const file of ['add-session-archive.sql','create-commercial-core.sql','create-commercial-quotes.sql','create-commercial-invoices.sql','create-commercial-payments.sql','create-commercial-purchasing.sql','create-commercial-purchase-receipts.sql','create-commercial-supplier-bills.sql','create-commercial-purchase-match-allocations.sql','create-commercial-finance-close.sql','create-commercial-supplier-payments.sql','add-commercial-supplier-payment-idempotency.sql']) await q(readFileSync(`scripts/${file}`,'utf8'));
  await q(capacityFixtureSql());
  await q("UPDATE organisations SET slug='ld-tennis' WHERE id='local-hr'");
  for (const key of ['scheduling','crm','invoicing','purchasing']) {
    await q('INSERT INTO modules(key,name,active,updated_at) VALUES($1,$1,true,now())',[key]);
    await q("INSERT INTO organisation_modules(organisation_id,module_key,enabled,updated_at) VALUES('local-hr',$1,true,now())",[key]);
  }
}

export async function verifyTennisBusiness({origin,context,page,q,browser,contextOptions,password,financeOnly=false}) {
  page.setDefaultTimeout(30000);
  const date=(await q("SELECT to_char(now() AT TIME ZONE 'Australia/Adelaide','YYYY-MM-DD') AS date")).rows[0].date;
  const post=async(path,data={},headers={})=>{
    console.log('Checking synthetic HTTP transition:',path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g,':id'));
    const response=await context.request.post(origin+path,{data,headers:{origin,...headers}});
    assert.ok(response.ok(),`${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  await page.goto(origin+'/business/tennis');
  await page.getByRole('heading',{name:'LD Tennis business',exact:true}).waitFor();
  await page.getByRole('link',{name:'Manage billing customers',exact:true}).waitFor();
  // Actual CRM screen creates the billing contact; no family-email identity inference.
  await page.goto(origin+'/crm/contacts');
  await page.getByRole('button',{name:'+ Add Contact',exact:true}).click();
  await page.getByLabel(/^First Name/).fill('Synthetic');
  await page.getByLabel(/^Last Name/).fill('Tennis Parent');
  await page.getByRole('button',{name:'Create Contact',exact:true}).click();
  await page.getByRole('link',{name:'Synthetic Tennis Parent',exact:true}).waitFor();
  const parent=(await q("SELECT id FROM crm_contacts WHERE organisation_id='local-hr' AND last_name='Tennis Parent'")).rows[0];
  assert.ok(parent);
  await page.goto(origin+'/commercial/customers');
  await page.getByRole('button',{name:'+ Add Customer',exact:true}).click();
  await page.getByLabel('Linked CRM billing contact',{exact:true}).selectOption(parent.id);
  await page.getByLabel(/^Customer Name/).fill('Synthetic Tennis Household');
  let customer; let customerPosts=0;
  await page.route('**/api/commercial/customers',async route=>{
    if(route.request().method()!=='POST') return route.continue();
    customerPosts++;const response=await route.fetch();assert.equal(response.status(),201,await response.text());customer=(await response.json()).customer;await route.abort();
  });
  await page.getByRole('button',{name:'Create Customer',exact:true}).click();
  await page.getByRole('button',{name:'Review saved billing customers',exact:true}).waitFor();
  await page.getByRole('button',{name:'Review saved billing customers',exact:true}).click();
  await page.getByRole('link',{name:'Synthetic Tennis Household',exact:true}).waitFor();
  await page.unroute('**/api/commercial/customers');assert.equal(customerPosts,1);
  const saved=(await q('SELECT crm_contact_id FROM commercial_customers WHERE id=$1',[customer.id])).rows[0];assert.equal(saved.crm_contact_id,parent.id);
  console.log('PASS: real CRM create and explicit billing link; lost customer response recovers without a repeated write.');

  // Actual commercial HTTP transitions. Their individual form affordances are not certified by this API portion.
  let invoice;
  if(financeOnly) {
    let writes=0;
    await page.goto(origin+'/commercial/invoices/new');
    await page.getByRole('combobox',{name:/Customer/}).selectOption(customer.id);
    await page.getByLabel('Notes (internal)',{exact:true}).fill('Coaching booking reference: synthetic-booking\nClass date reference: synthetic-date');
    await page.getByLabel('Due Date',{exact:true}).fill('2099-12-31');
    await page.route('**/api/commercial/invoices',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      writes++;const response=await route.fetch();assert.equal(response.status(),201);invoice=(await response.json()).invoice;await route.abort();
    });
    await page.getByRole('button',{name:/Create Draft/}).click();
    await page.getByRole('region',{name:'Review uncertain draft'}).waitFor();
    await page.reload();await page.getByRole('region',{name:'Review uncertain draft'}).waitFor();
    await expect(page.getByRole('button',{name:/Create Draft/})).toBeDisabled();assert.equal(writes,1);
    assert.equal((await q('SELECT count(*)::int AS n FROM commercial_invoices WHERE customer_id=$1',[customer.id])).rows[0].n,1);
    await page.unroute('**/api/commercial/invoices');
    await page.goto(origin+'/commercial/invoices?coachingBooking=synthetic-booking&coachingDate=synthetic-date');
    await expect(page.getByRole('link',{name:'Draft',exact:true})).toHaveAttribute('href',`/commercial/invoices/${invoice.id}`);
    await page.goto(origin+'/commercial/invoices?coachingBooking=another-booking&coachingDate=synthetic-date');
    await page.getByText('No saved invoice matches this booking reference.').waitFor();
    await page.getByRole('link',{name:'View all invoices',exact:true}).click();
    await page.getByRole('link',{name:'Draft',exact:true}).waitFor();
  } else invoice=(await post('/api/commercial/invoices',{customerId:customer.id,currency:'AUD',dueDate:'2099-12-31'})).invoice;
  await post(`/api/commercial/invoices/${invoice.id}/lines`,{description:'Synthetic lesson',quantity:1,unitPriceCents:6000});
  await post(`/api/commercial/invoices/${invoice.id}/issue`);
  await post(`/api/commercial/invoices/${invoice.id}/payments`,{amount_cents:2000,method:'CASH',reference:'SYNTHETIC ONLY'});
  const supplier=(await post('/api/commercial/suppliers',{name:'Synthetic tennis supplier'})).supplier;
  const po=(await post('/api/commercial/purchase-orders',{supplierId:supplier.id,currency:'AUD'})).purchaseOrder;
  const line=(await post(`/api/commercial/purchase-orders/${po.id}/lines`,{description:'Synthetic tennis balls',quantity:1,unitPriceCents:1500})).line;
  for(const step of ['submit','approve','issue'])await post(`/api/commercial/purchase-orders/${po.id}/${step}`);
  const receipt=(await post('/api/commercial/purchase-receipts',{purchaseOrderId:po.id,deliveryReference:'SYNTHETIC ONLY'})).purchaseReceipt;
  await post(`/api/commercial/purchase-receipts/${receipt.id}/lines`,{sourcePurchaseOrderLineId:line.id,quantityReceived:1});
  await post(`/api/commercial/purchase-receipts/${receipt.id}/post`);
  let bill;
  if(financeOnly) {
    let writes=0;
    await page.goto(origin+'/commercial/purchasing/supplier-bills/new');
    await page.getByRole('combobox',{name:/Purchase Order/}).selectOption(po.id);
    await page.getByLabel(/Supplier Invoice Number/).fill('SYNTHETIC-1');
    await page.getByLabel('Bill Date',{exact:true}).fill(date);
    await page.route('**/api/commercial/supplier-bills',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      writes++;const response=await route.fetch();assert.equal(response.status(),201);bill=(await response.json()).supplierBill;await route.abort();
    });
    await page.getByRole('button',{name:/Create Draft/}).click();await page.getByRole('region',{name:'Review uncertain draft'}).waitFor();
    await page.reload();await page.getByRole('region',{name:'Review uncertain draft'}).waitFor();
    await expect(page.getByRole('button',{name:/Create Draft/})).toBeDisabled();assert.equal(writes,1);
    assert.equal((await q('SELECT count(*)::int AS n FROM commercial_supplier_bills WHERE source_purchase_order_id=$1',[po.id])).rows[0].n,1);
    await page.unroute('**/api/commercial/supplier-bills');
    await page.route('**/api/commercial/supplier-bills',route=>route.fulfill({status:503,json:{error:'Synthetic unavailable'}}));
    await page.goto(origin+'/commercial/purchasing/supplier-bills');await page.getByRole('button',{name:'Retry supplier bills',exact:true}).waitFor();
    assert.equal(await page.getByText('No supplier bills yet.',{exact:true}).count(),0);
    await page.unroute('**/api/commercial/supplier-bills');
    await page.getByRole('button',{name:'Retry supplier bills',exact:true}).click();await page.getByText('SYNTHETIC-1',{exact:true}).waitFor();

  } else bill=(await post('/api/commercial/supplier-bills',{purchaseOrderId:po.id,supplierInvoiceNumber:'SYNTHETIC-1',billDate:date})).supplierBill;
  await post(`/api/commercial/supplier-bills/${bill.id}/lines`,{sourcePurchaseOrderLineId:line.id,quantity:1,unitPriceCents:1500});
  await post(`/api/commercial/supplier-bills/${bill.id}/post`);
  await post(`/api/commercial/supplier-bills/${bill.id}/payments`,{amount_cents:1500,method:'CASH',reference:'SYNTHETIC ONLY'},{'Idempotency-Key':randomUUID()});
  await page.goto(origin+'/business/tennis');
  const figures=await context.request.get(origin+'/api/business/tennis');const summary=await figures.json();
  assert.equal(summary.income.state,'ready');assert.deepEqual(summary.income.value,[{currency:'AUD',invoiced_cents:'6000',received_cents:'2000',outstanding_cents:'4000'}]);
  assert.deepEqual(summary.costs.value,[{currency:'AUD',billed_cents:'1500',paid_cents:'1500'}]);
  console.log('PASS: actual invoice issue/payment and purchase order/bill/payment routes reconcile to exact workspace totals.');

  if(!financeOnly) {
  const day=new Date(date+'T12:00:00Z').getUTCDay();
  const session=(await post('/api/business/tennis/coaching/sessions',{name:'Synthetic coaching',session_type:'SYNTHETIC',day_of_week:day,start_time:'15:00',max_capacity:2,start_date:date,end_mode:'after_weeks',end_after_weeks:1})).session;
  const instance=(await q('SELECT id FROM session_instances WHERE session_id=$1 ORDER BY date LIMIT 1',[session.id])).rows[0];assert.ok(instance);
  const booking=(await post(`/api/business/tennis/coaching/sessions/${session.id}/instances/${instance.id}`,{client_name:'Synthetic Player',client_email:'synthetic-player@example.test',frequency:'once'})).booking;
  let coachingWrites=0;
  page.on('request',request=>{if(request.url().includes('/api/business/tennis/coaching/')&&request.method()!=='GET')coachingWrites++;});
  await page.goto(origin+'/business/tennis/coaching');
  await page.getByRole('button',{name:/Synthetic coaching/}).first().click();
  await page.getByRole('button',{name:'Mark',exact:true}).waitFor();assert.equal(coachingWrites,0,'Opening a timetable must not perform repairs');
  await page.route(`**/api/business/tennis/coaching/bookings/${booking.id}`,async route=>{const result=await route.fetch();assert.equal(result.status(),200);await route.abort();});
  await page.getByRole('button',{name:'Mark',exact:true}).click();
  await page.getByRole('button',{name:'Review saved timetable',exact:true}).waitFor();
  assert.equal((await q('SELECT attendance_status FROM bookings WHERE id=$1',[booking.id])).rows[0].attendance_status,'attending');
  await page.getByRole('button',{name:'Review saved timetable',exact:true}).click();
  await page.getByRole('button',{name:/Synthetic coaching/}).first().click();
  await page.getByRole('button',{name:'✓ Here',exact:true}).waitFor();assert.equal(coachingWrites,1,'Review must not replay attendance or run repairs');await page.unroute(`**/api/business/tennis/coaching/bookings/${booking.id}`);
  await q('ALTER TABLE bookings RENAME TO bookings_fixture_unavailable');
  assert.equal((await context.request.get(origin+'/api/business/tennis/coaching/sessions')).status(),503);
  assert.equal((await context.request.get(origin+'/api/business/tennis/coaching/sessions/instances')).status(),503);
  assert.equal((await context.request.get(origin+`/api/business/tennis/coaching/sessions/${session.id}/instances/${instance.id}`)).status(),503);
  await page.reload();await page.getByRole('button',{name:'Review saved timetable',exact:true}).waitFor();
  await q('ALTER TABLE bookings_fixture_unavailable RENAME TO bookings');
  await page.getByRole('button',{name:'Review saved timetable',exact:true}).click();await page.getByRole('heading',{name:'Sessions',exact:true}).waitFor();assert.equal(coachingWrites,1);
  console.log('PASS: actual coaching creation/enrolment and rendered attendance lost-response recovery, without remount writes.');

  }

  // Managed staff login, current grant revocation, and tenant denial use real middleware/session paths.
  await q("UPDATE users SET role='MANAGER' WHERE id='local-manager'");
  await q("INSERT INTO organisation_user_access(user_id,organisation_id,permissions,updated_by) VALUES('local-manager','local-hr','{\"crm\":\"view\"}','local-admin')");
  const guest=await browser.newContext(contextOptions);const staff=await guest.newPage();
  await guest.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await staff.goto(origin+'/login');await staff.getByLabel('Username',{exact:true}).fill('local-manager');await staff.getByLabel('Password',{exact:true}).fill(password);await staff.getByRole('button',{name:'Sign in',exact:true}).click();await staff.waitForURL('**/workspace');
  if(financeOnly){await staff.goto(origin+'/business/tennis/finance');await staff.getByText('Invoicing or Purchasing access is required.').waitFor();}
  await staff.goto(origin+'/business/tennis');await staff.getByRole('link',{name:'Open CRM contacts',exact:true}).waitFor();
  assert.equal(await staff.getByRole('link',{name:'Manage billing customers',exact:true}).count(),0);
  assert.equal((await guest.request.get(origin+'/api/business/tennis/coaching/sessions')).status(),403);
  await q("UPDATE organisation_user_access SET permissions='{}' WHERE user_id='local-manager'");
  await staff.getByRole('button',{name:'Refresh saved figures',exact:true}).click();await staff.getByRole('alert').waitFor();assert.equal(await staff.getByRole('link',{name:'Open CRM contacts',exact:true}).count(),0);await guest.close();
  await q("UPDATE organisations SET slug='synthetic-other' WHERE id='local-hr'");assert.equal((await context.request.get(origin+'/api/business/tennis')).status(),404);await q("UPDATE organisations SET slug='ld-tennis' WHERE id='local-hr'");
  for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:900});await page.goto(origin+(financeOnly?'/business/tennis/finance':'/business/tennis'));await page.getByRole('link',{name:'Manage billing customers',exact:true}).waitFor();
    if(financeOnly) {await page.getByRole('link',{name:'Create a lesson invoice',exact:true}).waitFor();await page.screenshot({path:'.tennis-finance-'+width+'.png',fullPage:true});}
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}`);
  }
  await expect(page.getByRole('link',{name:'Workspace help and setup checklist',exact:true})).toBeVisible();
  console.log('PASS: real managed login, selective visibility, current revocation, foreign tenant denial and 390/768/1440 workspace layout.');
}

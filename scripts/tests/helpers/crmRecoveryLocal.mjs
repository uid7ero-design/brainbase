import assert from 'node:assert/strict';
/** Synthetic login -> rendered screens -> actual routes -> owned Postgres. */
export async function verifyCrmRecovery({origin,context,page,q,browser,contextOptions,password}){
 await q("INSERT INTO modules(key,name,active,updated_at) VALUES('crm','CRM',true,now())");
 await q("INSERT INTO organisation_modules(organisation_id,module_key,enabled,updated_at) VALUES('local-hr','crm',true,now())");
 const api=origin+'/api/crm';
 const company=await context.request.post(api+'/companies',{data:{name:'Synthetic CRM company'}});assert.equal(company.status(),201,await company.text());const co=(await company.json()).company;
 await page.goto(origin+'/crm/contacts');await page.getByRole('button',{name:'+ Add Contact',exact:true}).click();await page.getByLabel('First Name Required',{exact:true}).fill('Synthetic');await page.getByLabel('Last Name Required',{exact:true}).fill('CRM Contact');
 let committed;
 await page.route('**/api/crm/contacts',async route=>{if(route.request().method()!=='POST')return route.continue();const result=await route.fetch();assert.equal(result.status(),201);committed=await result.json();await route.abort();});
 await page.getByRole('button',{name:'Create Contact',exact:true}).click();await page.getByText('The result could not be confirmed. Do not repeat the change. Review saved records first.',{exact:true}).waitFor();
 assert.equal((await q("SELECT count(*)::int AS n FROM crm_contacts WHERE first_name='Synthetic'")).rows[0].n,1);
 await page.getByRole('button',{name:'Review saved records',exact:true}).click();await page.getByRole('link',{name:'Synthetic CRM Contact',exact:true}).waitFor();await page.unroute('**/api/crm/contacts');
 // A failed classification read never displays the previous unfiltered contacts.
 await page.route('**/api/crm/contacts?classification=*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"synthetic read failure"}'}));
 await page.getByLabel('Filter by classification',{exact:true}).selectOption('EVENT_CONTACT');await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('link',{name:'Synthetic CRM Contact',exact:true}).count(),0);await page.unroute('**/api/crm/contacts?classification=*');
 const contact=committed.contact;
 const dealResult=await context.request.post(api+'/deals',{data:{title:'Synthetic deal',stage:'lead',company_id:co.id,contact_id:contact.id,notes:'Preserve these notes'}});assert.equal(dealResult.status(),201);const deal=(await dealResult.json()).deal;
 await page.goto(origin+'/crm/deals');await page.getByRole('button',{name:'Edit deal: Synthetic deal',exact:true}).click();
 await page.getByLabel('Stage',{exact:true}).selectOption('qualified');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('button',{name:'Edit deal: Synthetic deal',exact:true}).waitFor();
 assert.equal((await q('SELECT stage FROM crm_deals WHERE id=$1',[deal.id])).rows[0].stage,'qualified');
 // Real delete commits, its HTTP response is lost, and recovery performs only a read.
 await page.getByRole('button',{name:'Edit deal: Synthetic deal',exact:true}).click();page.once('dialog',dialog=>dialog.accept());
 await page.route('**/api/crm/deals/'+deal.id,async route=>{if(route.request().method()!=='DELETE')return route.continue();const r=await route.fetch();assert.equal(r.status(),200);await route.abort();});
 await page.getByRole('button',{name:'Delete deal',exact:true}).click();await page.getByText('The result could not be confirmed. Do not repeat the change. Review saved records first.',{exact:true}).waitFor();
 assert.equal((await q('SELECT count(*)::int AS n FROM crm_deals WHERE id=$1',[deal.id])).rows[0].n,0);
 await page.getByRole('button',{name:'Review saved records',exact:true}).click();await page.unroute('**/api/crm/deals/'+deal.id);
 // Real sessions and managed grants remain authoritative on both reads and writes.
 await q("INSERT INTO organisation_user_access(user_id,organisation_id,permissions,updated_by) VALUES('local-employee','local-hr','{\"crm\":\"use\"}','local-admin')");
 const guest=await browser.newContext(contextOptions);const viewer=await guest.newPage();await viewer.goto(origin+'/login');await viewer.getByLabel('Username',{exact:true}).fill('local-employee');await viewer.getByLabel('Password',{exact:true}).fill(password);await viewer.getByRole('button',{name:'Sign in',exact:true}).click();await viewer.waitForURL('**/workspace');
 assert.equal((await guest.request.get(api+'/contacts')).status(),200);assert.equal((await guest.request.post(api+'/contacts',{data:{first_name:'Denied',last_name:'Viewer'}})).status(),403);
 await q("UPDATE organisation_user_access SET permissions='{\"crm\":\"none\"}' WHERE user_id='local-employee'");assert.equal((await guest.request.get(api+'/contacts')).status(),403);await guest.close();
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/crm/contacts');await page.getByRole('link',{name:'Synthetic CRM Contact',exact:true}).waitFor();
 console.log('PASS: CRM real login, contact lost-create recovery, failed-filter clearing, deal save, lost-delete recovery, viewer write denial, current module revocation and narrow-screen register. Only synthetic fixtures; no external providers.');
}



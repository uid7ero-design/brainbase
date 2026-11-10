import { seedDisposableStaffBooking } from './schedulingBrowserEnv.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expect} from '@playwright/test';
export const TENNIS_FIXTURE_ORG='8ecd003b-583f-4616-a830-8dbf8aa51d2c';
// Used only by the runner-owned disposable database. The production identifier
// exercises the fixed-tenant guard; every row and account here is synthetic.
export async function setupTennisScheduling(q, env) {
  const org=TENNIS_FIXTURE_ORG;
  for(const file of ['migrate-client-pipeline.ts','migrate-pipeline-messages.ts']){const ddl=readFileSync(`scripts/${file}`,'utf8').match(/CREATE TABLE IF NOT EXISTS [\s\S]*?\n    \)/)?.[0];assert.ok(ddl);await q(ddl);}
  await q("UPDATE organisations SET slug='local-hr' WHERE id='local-hr'");
  await q("INSERT INTO organisations(id,name,slug,timezone,updated_at) VALUES($1,'Synthetic Tennis','ld-tennis','Australia/Adelaide',now())",[org]);
  await q("UPDATE users SET organisation_id=$1 WHERE id='local-admin'",[org]);
  for(const key of ['scheduling','crm','invoicing','purchasing'])await q('INSERT INTO organisation_modules(organisation_id,module_key,enabled,updated_at) VALUES($1,$2,true,now())',[org,key]);
  for(const file of ['010_shared_schema.sql','030_resource_concurrency.sql','031_reservation_integrity.sql','032_schedule_archive_ordering.sql','033_occurrence_integrity.sql','034_availability_integrity.sql','035_availability_partial_closures.sql','036_availability_zones.sql','037_availability_versions.sql'])await q(readFileSync(`packages/scheduling/sql/${file}`,'utf8'));
  await q("INSERT INTO scheduling_settings(organisation_id,currency) VALUES($1,'AUD')",[org]);
  await q(readFileSync('scripts/create-coach-terms.sql','utf8'));
  await q(readFileSync('scripts/create-coach-squads.sql','utf8'));
  await q(readFileSync('scripts/create-coach-training-plans.sql','utf8'));
  await seedDisposableStaffBooking(q,org,env);
  const day=(await q("SELECT to_char((now() AT TIME ZONE 'Australia/Adelaide')::date+1,'YYYY-MM-DD') AS fixture_day")).rows[0].fixture_day;
  await q(`INSERT INTO sessions(id,organisation_id,name,day_of_week,start_time,duration_minutes,max_capacity,session_type,price_per_session,start_date,end_mode)
    VALUES('fixture-class',$1,'Synthetic Juniors',extract(dow FROM $2::date)::int,'16:00',60,3,'junior',12.50,$2::date,'ongoing')`,[org,day]);
  await q(`INSERT INTO session_instances(id,organisation_id,session_id,date,start_time,duration_minutes,max_capacity,status)
    VALUES('fixture-date',$1,'fixture-class',$2::date,'16:00',60,3,'scheduled'),('fixture-cancelled-date',$1,'fixture-class',$2::date+7,'16:00',60,3,'cancelled'),('fixture-third',$1,'fixture-class',$2::date+14,'16:00',60,3,'scheduled'),('fixture-fourth',$1,'fixture-class',$2::date+21,'16:00',60,3,'scheduled')`,[org,day]);
  await q(`INSERT INTO bookings(id,organisation_id,session_id,session_instance_id,client_name,client_email,date,time,session_type,status,paid,is_recurring)
    VALUES('fixture-player',$1,'fixture-class','fixture-date','Synthetic Original','original@example.invalid',$2::timestamp,'16:00','junior','confirmed',false,false),
    ('fixture-cancelled-player',$1,'fixture-class','fixture-date','Synthetic Cancelled','cancelled@example.invalid',$2::timestamp,'16:00','junior','cancelled',false,false)`,[org,day]);
  await q("INSERT INTO session_types(organisation_id,name,slug,colour_key) VALUES($1,'Junior','junior','blue')",[org]);
  for(const file of ['tennis-coaching-operations.sql','tennis-history-cutover.sql','tennis-canonical-import.sql','tennis-class-restoration.sql','tennis-public-booking.sql','tennis-activate-cutover.sql'])await q(readFileSync(`scripts/scheduling/${file}`,'utf8'));
  await q('SELECT scheduling_tennis_prepare_history($1)',[org]);
  const hash=(await q('SELECT scheduling_tennis_manifest($1) hash',[org])).rows[0].hash;
  await q("UPDATE scheduling_tennis_cutover SET phase='frozen' WHERE organisation_id=$1",[org]);
  await q('SELECT scheduling_tennis_capture_history($1,$2)',[org,hash]);
  const receipt=(await q("SELECT * FROM scheduling_tennis_import_history($1,$2,'Australia/Adelaide','AUD')",[org,hash])).rows[0];
  return {day,hash,target:receipt.target_hash};
}
export async function verifyTennisScheduling({origin,context,page,q,fixture}) {
  page.setDefaultTimeout(30000);const org=TENNIS_FIXTURE_ORG;
  let response=await context.request.get(origin+'/api/tennis/sessions');assert.equal(response.status(),503);
  await q("SELECT scheduling_tennis_transition($1,'scheduling',$2,$3,'Full local app acceptance')",[org,fixture.hash,fixture.target]);
  await page.goto(origin+'/business/tennis/coaching');
  await page.waitForURL('**/scheduling/coaching');await page.getByRole('heading',{name:'Coaching roster',exact:true}).waitFor();
  await page.getByRole('button',{name:new RegExp(`${fixture.day} 16:00`)}).click();
  await page.getByText('Synthetic Cancelled',{exact:true}).waitFor();
  const billingRow=page.getByRole('listitem').filter({has:page.getByText('Synthetic Original',{exact:true})});
  await billingRow.getByRole('link',{name:'Review for invoicing',exact:true}).click();
  await page.getByRole('heading',{name:'Review booking for invoicing',exact:true}).waitFor();
  await page.getByRole('button',{name:'Use booking reference in internal notes',exact:true}).click();
  await expect(page.getByLabel('Notes (internal)',{exact:true})).toHaveValue(/Coaching booking reference: fixture-player/);
  await expect(page.getByRole('combobox',{name:/^Customer/})).toHaveValue('');
  assert.equal((await q('SELECT count(*)::int n FROM commercial_invoices WHERE organisation_id=$1',[org])).rows[0].n,0);
  await page.getByRole('link',{name:'Back to roster',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(`${fixture.day} 16:00`)}).click();
  await page.getByText('Synthetic Cancelled',{exact:true}).waitFor();
  for(const width of [390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    await expect(page.getByRole('button',{name:new RegExp(`${fixture.day} 16:00`)})).toHaveAttribute('aria-pressed','true');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,`Coaching layout overflows at ${width}px`);
    await page.getByRole('heading',{name:'Coaching roster',exact:true}).scrollIntoViewIfNeeded();
    if(process.env.TENNIS_LAYOUT_SCREENSHOTS==='1')await page.screenshot({path:`.tennis-layout-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'Previous schedule',exact:true}).click();
  await expect(page.getByRole('region',{name:'Class roster',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Upcoming schedule',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(`${fixture.day} 16:00`)}).click();
  await page.getByText('Synthetic Cancelled',{exact:true}).waitFor();
  await page.getByLabel('Name',{exact:true}).fill('Synthetic Weekly');
  await page.getByLabel('Email',{exact:true}).fill('weekly@example.invalid');
  await page.getByLabel('Weekly enrolment',{exact:true}).check();
  let enrolPosts=0;
  await page.route('**/api/scheduling/coaching/actions',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    enrolPosts++;const response=await route.fetch();if(response.status()!==200){await route.fulfill({response});return;}await route.abort();
  });
  await page.getByRole('button',{name:'Enrol player',exact:true}).click();
  await page.getByRole('button',{name:'Check saved request',exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:new RegExp(`${fixture.day} 16:00`)}).click();
  await page.getByRole('button',{name:'Check saved request',exact:true}).click();
  await page.getByText('The saved change is confirmed.',{exact:true}).waitFor();
  assert.equal(enrolPosts,1);await page.unroute('**/api/scheduling/coaching/actions');
  const original=page.getByRole('listitem').filter({has:page.getByText('Synthetic Original',{exact:true})});
  await original.getByRole('button',{name:'Here',exact:true}).click();
  await expect(original).toContainText('attended');
  await original.getByText('Weekly enrolment for Synthetic Original',{exact:true}).click();
  await original.getByRole('button',{name:'Make weekly',exact:true}).click();
  await original.getByRole('button',{name:'Pause weekly enrolment',exact:true}).waitFor();
  await original.getByRole('button',{name:'Pause weekly enrolment',exact:true}).click();
  await original.getByRole('button',{name:'Resume this pause',exact:true}).click();
  await expect(original.getByRole('button',{name:'Resume this pause',exact:true})).toHaveCount(0);
  console.log('PASS: actual login, legacy handover, roster history, weekly lost-response recovery and attendance through HTTP/SQL.');
  await page.goto(origin+'/tennis/book');
  await page.getByRole('button',{name:/Synthetic Juniors/}).first().click();
  // Public labels use their visible text on the real released form.
  await page.getByLabel('Full Name *',{exact:true}).fill('Synthetic Public');
  await page.getByLabel('Email *',{exact:true}).fill('public@example.invalid');
  let publicPosts=0;
  await page.route('**/api/tennis/book',async route=>{if(route.request().method()!=='POST')return route.continue();publicPosts++;const response=await route.fetch();if(response.status()!==201){await route.fulfill({response});return;}await route.abort();});
  await page.getByRole('button',{name:'Confirm Booking',exact:true}).click();
  await page.getByRole('button',{name:'Check saved booking',exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:'Check saved booking',exact:true}).click();
  await expect(page.getByRole('button',{name:'Check saved booking',exact:true})).toHaveCount(0);assert.equal(publicPosts,1);
  await page.unroute('**/api/tennis/book');
  assert.equal((await q('SELECT count(*)::int n FROM client_pipeline WHERE organisation_id=$1',[org])).rows[0].n,1);
  assert.equal((await q('SELECT count(*)::int n FROM pipeline_messages WHERE organisation_id=$1',[org])).rows[0].n,1);
  response=await context.request.post(origin+'/api/tennis/book',{data:{session_instance_id:'fixture-date',name:'Full attempt',email:'full@example.invalid',idempotencyKey:'synthetic-full-booking'}});assert.equal(response.status(),409);
  console.log('PASS: public page handover, saved booking recovery, final-place refusal and atomic pipeline handover.');
  // The real cutover populated both active rows and history-only cancellations.
  const preserved = async () => (await q(`SELECT
    (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM scheduling_occurrences o WHERE organisation_id=$1) dates,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM scheduling_reservations r WHERE organisation_id=$1 AND customer_email IS DISTINCT FROM 'term@example.invalid') existing_bookings,
    (SELECT jsonb_agg(to_jsonb(l) ORDER BY reservation_id) FROM scheduling_coaching_series_links l WHERE organisation_id=$1) weekly_links,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM scheduling_series_pauses p WHERE organisation_id=$1) weekly_pauses,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY reservation_id) FROM scheduling_coaching_markers m WHERE organisation_id=$1) paid_markers,
    (SELECT jsonb_agg(to_jsonb(h) ORDER BY source_table,source_id) FROM scheduling_tennis_history h WHERE organisation_id=$1) history`,[org])).rows[0];
  const before = await preserved();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + '/coaching/calendar?week=' + fixture.day);
    await expect(page.getByRole('navigation', { name: 'Calendar weeks' })).toBeVisible();
    const session = page.getByRole('link', { name: 'Synthetic Juniors', exact: true });
    await expect(session.locator('xpath=ancestor::article')).toContainText('3 / 3 enrolled');
    const assertFits = async (locator) => {
      const box = await locator.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
    };
    await assertFits(session);
    if (process.env.COACH_LAYOUT_SCREENSHOTS) await page.screenshot({ path: process.env.COACH_LAYOUT_SCREENSHOTS + '/calendar-' + width + '.png' });
    await session.click();
    const roster = page.getByRole('region', { name: 'Class roster' });
    await expect(page.getByText('3 of 3 places filled')).toBeVisible();
    await expect(roster.getByText('Synthetic Cancelled', { exact: true })).toBeVisible();
    const player = roster.getByRole('listitem').filter({ has: page.getByText('Synthetic Original', { exact: true }) });
    await expect(player).toContainText('attended');
    await assertFits(player.getByRole('button', { name: 'Clear attendance' }));
    await assertFits(page.getByRole('link', { name: 'Class term review' }));
    if (process.env.COACH_LAYOUT_SCREENSHOTS) await page.screenshot({ path: process.env.COACH_LAYOUT_SCREENSHOTS + '/roster-' + width + '.png' });
  }
  await page.getByRole('link',{name:'Class term review'}).click();
  await expect(page.getByText(/This date is outside a term/)).toBeVisible();
  await page.getByRole('link',{name:'Back to class roster'}).click();
  const another=await context.newPage();
  await another.goto(origin+'/coaching/roster/fixture-third');
  await another.getByLabel('Term name').fill('Overlapping term');
  await page.getByLabel('Term name').fill('Winter juniors');
  const last=page.getByLabel('Last scheduled class');
  await last.selectOption({index:1});
  await page.getByRole('button',{name:'Create term from these dates'}).click();
  await expect(page.getByText(/Winter juniors/)).toBeVisible();
  await another.getByRole('button',{name:'Create term from these dates'}).click();
  await expect(another.getByText(/already belong to a term/)).toBeVisible();
  await another.close();
  assert.deepEqual((await q('SELECT occurrence_id FROM scheduling_coach_term_dates WHERE organisation_id=$1 ORDER BY occurrence_id',[org])).rows.map(r=>r.occurrence_id),['fixture-date','fixture-fourth','fixture-third']);
  await page.goto(origin+'/coaching/roster/fixture-third');
  const enrol=page.locator('form').filter({has:page.getByRole('button',{name:'Enrol participant'})});
  await enrol.getByLabel('Name',{exact:true}).fill('Synthetic Term');
  await enrol.getByLabel('Email',{exact:true}).fill('term@example.invalid');
  await enrol.getByRole('button',{name:'Enrol participant'}).click();
  await page.getByText('Synthetic Term',{exact:true}).waitFor();
  assert.deepEqual((await q("SELECT occurrence_id FROM scheduling_reservations WHERE organisation_id=$1 AND customer_email='term@example.invalid' AND status='confirmed' ORDER BY occurrence_id",[org])).rows.map(r=>r.occurrence_id),['fixture-fourth','fixture-third']);
  assert.deepEqual(await preserved(),before);
  const allPlaces=async()=> (await q('SELECT to_jsonb(r) AS booking FROM scheduling_reservations r WHERE organisation_id=$1 ORDER BY id',[org])).rows;
  const savedPlaces=await allPlaces();
  const invoices=async()=> (await q('SELECT count(*)::int AS n FROM commercial_invoices WHERE organisation_id=$1',[org])).rows[0].n;
  assert.equal(await invoices(),0);
  const expectedCounts=await q("SELECT occurrence_id,sum(party_size)::int AS n FROM scheduling_reservations WHERE organisation_id=$1 AND status<>'cancelled' GROUP BY occurrence_id",[org]);
  await page.getByRole('link',{name:'Class term review'}).click();
  await expect(page.getByRole('heading',{name:'Winter juniors'})).toBeVisible();
  const reviewUrl=page.url();
  for (const width of [1440,768,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto(reviewUrl);
    await expect(page.getByRole('heading',{name:'Winter juniors'})).toBeVisible();
    const rows=page.getByRole('list',{name:'Class dates'}).getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(page.getByText('Booked places across dates', { exact: true }).locator('..').locator('dd')).toHaveText(String(expectedCounts.rows.reduce((sum, row) => sum + row.n, 0)));
    await expect(rows.nth(0)).toContainText('3 booked places · 1 cancelled booking');
    await expect(rows.nth(0)).toContainText('1 attended');
    for (const [i,occurrence] of [[1,'fixture-third'],[2,'fixture-fourth']]) {
      const n=expectedCounts.rows.find(r=>r.occurrence_id===occurrence).n;
      await expect(rows.nth(i)).toContainText(n+' booked '+(n === 1 ? 'place' : 'places'));
    }
    await expect(page.getByText('0 of 3 upcoming or in-progress sessions have a saved plan.')).toBeVisible();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  await q("INSERT INTO scheduling_coach_training_plans(organisation_id,occurrence_id,version,drills) VALUES($1,'fixture-fourth',1,'[]'::jsonb)",[org]);
  await page.reload();
  await expect(page.getByText('1 of 3 upcoming or in-progress sessions have a saved plan.')).toBeVisible();
  await expect(page.getByRole('link',{name:'Open plan'})).toHaveAttribute('href','/coaching/roster/fixture-fourth/plan');
  assert.equal(await invoices(),0);
  assert.deepEqual(await allPlaces(),savedPlaces);
  assert.deepEqual(await preserved(),before);
  console.log('PASS: read-only imported Tennis term review at desktop, tablet and mobile widths, including legacy cancellations.');
  await page.setViewportSize({width:1440,height:900});
  console.log('PASS: imported class opened in Coach, archived cancellation and attendance visible, existing dates grouped and booked with original records preserved.');
  await page.goto(origin+'/scheduling/schedules/tennis-coaching');
  page.on('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Archive Synthetic Juniors',exact:true}).click();
  await page.getByLabel(/Show archived/).check();
  await page.getByRole('button',{name:'Restore Synthetic Juniors',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Class restored.'})).toHaveCount(1);
  const replacement=(await q('SELECT restored_offering_id FROM scheduling_coaching_restorations WHERE organisation_id=$1',[org])).rows[0].restored_offering_id;
  assert.ok(replacement);assert.equal((await q("SELECT status FROM scheduling_occurrences WHERE organisation_id=$1 AND id='fixture-cancelled-date'",[org])).rows[0].status,'cancelled');
  assert.equal((await q("SELECT attendance,status FROM scheduling_reservations WHERE organisation_id=$1 AND id='fixture-player'",[org])).rows[0].attendance,'attended');
  await page.goto(origin+'/coaching/calendar?week='+fixture.day);
  await page.locator('a[href="/coaching/roster/fixture-date"]').click();
  await page.getByText('Synthetic Cancelled',{exact:true}).waitFor();
  const frozen=(await q("SELECT scheduling_tennis_transition($1,'frozen',$2,NULL,'Full local freeze') result",[org,fixture.hash])).rows[0].result;
  await page.goto(origin+'/coaching/roster/fixture-date');
  await expect(page.getByText('Synthetic Original',{exact:true})).toHaveCount(0);
  response=await context.request.get(origin+'/api/tennis/sessions');assert.equal(response.status(),503);
  await assert.rejects(q("SELECT scheduling_tennis_transition($1,'legacy',$2,$3,'Unsafe rollback test')",[org,fixture.hash,frozen.targetHash]),error=>error.code==='STNEW');
  await q("SELECT scheduling_tennis_transition($1,'scheduling',$2,$3,'Full local resume')",[org,fixture.hash,frozen.targetHash]);
  await q("INSERT INTO organisation_user_access(user_id,organisation_id,permissions,updated_by) VALUES('local-admin',$1,'{\"scheduling\":\"view\"}','local-admin')",[org]);
  response=await context.request.get(origin+'/api/scheduling/coaching/roster/fixture-date');assert.equal(response.status(),403);
  await page.goto(origin+'/coaching/calendar?week='+fixture.day);
  await expect(page.getByRole('link',{name:'Synthetic Juniors',exact:true})).toHaveCount(0);
  await page.goto(origin+'/coaching/roster/fixture-date');
  await expect(page.getByText('Synthetic Original',{exact:true})).toHaveCount(0);
  await page.goto(reviewUrl);
  await expect(page.getByRole('heading',{name:'Winter juniors'})).toHaveCount(0);
  response=await context.request.get(origin+'/api/scheduling/status');assert.equal(response.status(),200);
  await q("DELETE FROM organisation_user_access WHERE user_id='local-admin'");
  await q("UPDATE organisation_modules SET enabled=false WHERE organisation_id=$1 AND module_key='scheduling'",[org]);
  response=await context.request.get(origin+'/api/scheduling/coaching/roster/fixture-date');assert.equal(response.status(),403);
  response=await context.request.post(origin+'/api/tennis/book',{data:{session_instance_id:'fixture-date',name:'Revoked attempt',email:'revoked@example.invalid',idempotencyKey:'synthetic-revoked-public'}});assert.equal(response.status(),503);
  console.log('PASS: real archive/restore screens preserve history; cutover freeze/resume and unsafe rollback refusal; entitlement revocation.');
}

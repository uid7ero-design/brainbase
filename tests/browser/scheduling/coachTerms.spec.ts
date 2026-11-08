import { expect, test } from '@playwright/test';
import { enabled, origin } from './accounts';
import { contextFor, createSchedule, createOffering, createResource, api, query } from './support';

test.skip(!enabled, 'Requires the disposable Scheduling browser harness');

test('gymnastics term enrolment, conflict recovery and attendance history across class dates', async ({
  browser,
}, info) => {
  const coach = await contextFor(browser, 'manager');
  try {
    const schedule = await createSchedule(coach.request, 'Junior gymnastics ' + info.project.name);
    const offering = await createOffering(coach.request, schedule.id, 'Floor skills ' + info.project.name, {
      durationMinutes: 45,
      capacity: 1,
      priceCents: 1800,
    });
    const room = await createResource(coach.request, 'Gym floor ' + info.project.name, 'space');
    expect(
      (
        await coach.request.post(api('/offerings/' + offering.id + '/resources'), {
          data: { resourceId: room.id },
        })
      ).status(),
    ).toBe(201);
    const future = (n: number) => new Date(Date.now() + 86400000 * n).toISOString().slice(0, 10);
    const first = future(12),
      last = future(26);
    const calendar = await coach.newPage();
    const viewport = info.project.use.viewport ?? { width: 1280, height: 800 };
    await calendar.setViewportSize(viewport);
    await calendar.goto(origin + '/coaching/calendar?week=' + first);
    const add = calendar.getByRole('button', { name: 'Add class date' }),
      create = calendar.getByRole('button', { name: 'Create term' });
    const chooseClass = () =>
      calendar.getByLabel('Class and location').selectOption(JSON.stringify([offering.id, room.id]));
    await chooseClass();
    await calendar.getByLabel('Class date', { exact: true }).fill(last);
    await calendar.getByLabel('Local start time').fill('16:00');
    await add.click();
    await expect(calendar.getByText('Saved.', { exact: true })).toBeVisible();
    const fillTerm = async (time: string) => {
      await calendar.getByLabel('Schedule type').selectOption('term');
      await chooseClass();
      await calendar.getByLabel('Class date', { exact: true }).fill(first);
      await calendar.getByLabel('Local start time').fill(time);
      await calendar.getByLabel('Term name').fill('Gymnastics foundations');
      await calendar.getByLabel('Term ends on').fill(last);
    };
    await fillTerm('16:00');
    await create.click();
    await expect(calendar.locator('form').filter({ has: create }).getByRole('alert')).toContainText('conflict');
    const count = (table: string) =>
      query<{ n: number }>('SELECT count(*)::int n FROM ' + table + ' WHERE offering_id=$1', [
        offering.id,
      ]).then((r) => r[0].n);
    expect(await count('scheduling_occurrences')).toBe(1);
    expect(await count('scheduling_coach_terms')).toBe(0);
    expect(
      await query('SELECT id FROM scheduling_resource_holds WHERE resource_id=$1', [room.id]),
    ).toHaveLength(1);
    await fillTerm('15:00');
    await create.click();
    const firstLink = calendar.getByRole('link', { name: offering.name, exact: true });
    await expect(firstLink).toBeVisible();
    const dates = await query<{ id: string; day: string; time: string }>(
      "SELECT o.id,to_char(o.local_date,'YYYY-MM-DD') AS day,to_char(o.local_start_time,'HH24:MI') AS time FROM scheduling_occurrences o JOIN scheduling_coach_term_dates d ON d.organisation_id=o.organisation_id AND d.occurrence_id=o.id WHERE o.offering_id=$1 ORDER BY o.local_date",
      [offering.id],
    );
    expect(dates.map((d) => d.day)).toEqual([first, future(19), last]);
    expect(dates.every((d) => d.time === '15:00')).toBe(true);
    expect(
      await query('SELECT id FROM scheduling_resource_holds WHERE resource_id=$1', [room.id]),
    ).toHaveLength(4);
    const page = await coach.newPage();
    await page.setViewportSize(viewport);
    await page.goto(origin + '/coaching/roster/' + dates[2].id);
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Enrol participant' }) });
    const enrol = async (name: string, email: string, term = false) => {
      await form.getByLabel('Name', { exact: true }).fill(name);
      await form.getByLabel('Email', { exact: true }).fill(email);
      if (term) await form.getByLabel('Enrolment covers').selectOption('term');
      await form.getByRole('button', { name: 'Enrol participant' }).click();
    };
    await enrol('Single attendee', 'single@example.test');
    await expect(page.getByRole('heading', { name: 'Single attendee' })).toBeVisible();
    await firstLink.click();
    await expect(calendar.getByRole('heading', { name: offering.name, exact: true })).toBeVisible();
    await page.goto(origin + '/coaching/roster/' + dates[0].id);
    await enrol('Returning attendee', 'return@example.test', true);
    await expect(form.getByRole('alert')).toContainText('No new places were booked');
    expect(await count('scheduling_series')).toBe(0);
    expect(await count('scheduling_reservations')).toBe(1);
    await page.goto(origin + '/coaching/roster/' + dates[2].id);
    await page.getByRole('button', { name: 'Cancel enrolment' }).click();
    await expect(page.locator('article').filter({ hasText: 'Single attendee' })).toContainText('cancelled');
    await page.goto(origin + '/coaching/roster/' + dates[0].id);
    const request = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/coaching/roster/'),
    );
    await enrol('Returning attendee', 'return@example.test', true);
    const original = await request;
    await expect(page.locator('article').filter({ hasText: 'Returning attendee' })).toContainText(
      'Term enrolment',
    );
    const rows = await query<{ series: string; n: number; price: number }>(
      "SELECT series_id series,count(*)::int n,sum(price_cents)::int price FROM scheduling_reservations WHERE offering_id=$1 AND customer_email='return@example.test' AND status='confirmed' AND payment_status='unpaid' GROUP BY series_id",
      [offering.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].series).toBeTruthy();
    expect(rows[0]).toMatchObject({ n: 3, price: 5400 });
    await page.goto(origin + '/coaching/roster/' + dates[1].id);
    await page.getByRole('button', { name: 'Cancel enrolment' }).click();
    await expect(page.getByText(/Term enrolment · cancelled/)).toBeVisible();
    expect((await coach.request.fetch(original)).ok()).toBe(true);
    expect(await count('scheduling_series')).toBe(1);
    expect(await count('scheduling_reservations')).toBe(4);
    await page.goto(origin + '/coaching/roster/' + dates[2].id);
    await expect(page.locator('article').filter({ hasText: 'Returning attendee' })).toContainText(
      'confirmed',
    );
    await page
      .locator('article')
      .filter({ hasText: 'Returning attendee' })
      .getByRole('button', { name: 'Cancel enrolment' })
      .click();
    await expect(page.locator('article').filter({ hasText: 'Returning attendee' })).toContainText(
      'cancelled',
    );
    await page.goto(origin + '/coaching/roster/' + dates[1].id);
    await expect(form.getByRole('option', { name: /Remaining term/ })).toHaveText(/2 classes/);
    await enrol('Mid-term entrant', 'mid@example.test', true);
    await expect(page.locator('article').filter({ hasText: 'Mid-term entrant' })).toContainText('confirmed');
    expect(
      await query(
        "SELECT occurrence_id FROM scheduling_reservations WHERE offering_id=$1 AND customer_email='mid@example.test' ORDER BY starts_at",
        [offering.id],
      ),
    ).toEqual(dates.slice(1).map((d) => ({ occurrence_id: d.id })));
    const member = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Mid-term entrant' }) });
    await member.getByRole('button', { name: 'Mark attended' }).click();
    await expect(member).toContainText('Term enrolment · confirmed · attended');
    await page.goto(origin + '/coaching/roster/' + dates[2].id);
    await expect(member).toContainText('Attendance unmarked');
    await member.getByRole('button', { name: 'Mark absent' }).click();
    await expect(member).toContainText('confirmed · absent');

    // Reopen each week's roster from the calendar, including the date before this enrolment began.
    for (const [index, date] of dates.entries()) {
      await page.goto(origin + '/coaching/calendar?week=' + date.day);
      const link = page.getByRole('link', { name: offering.name, exact: true }).and(
        page.locator('a[href="/coaching/roster/' + date.id + '"]'),
      );
      await expect(page.locator('article').filter({ has: link })).toContainText('Gymnastics foundations');
      await link.click();
      if (index === 0) {
        await expect(member).toHaveCount(0);
      } else {
        await expect(member).toContainText(index === 1 ? 'confirmed · attended' : 'confirmed · absent');
        await expect(page.locator('article').filter({ hasText: 'Returning attendee' })).toContainText('cancelled');
      }
    }
    expect(await query(
      "SELECT occurrence_id,attendance FROM scheduling_reservations WHERE offering_id=$1 AND customer_email='mid@example.test' ORDER BY starts_at",
      [offering.id],
    )).toEqual([
      { occurrence_id: dates[1].id, attendance: 'attended' },
      { occurrence_id: dates[2].id, attendance: 'absent' },
    ]);
  } finally {
    await coach.close();
  }
});

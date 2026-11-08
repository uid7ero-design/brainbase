import { expect, test } from '@playwright/test';
import { enabled, origin } from './accounts';
import { anonymousContext, contextFor, createOffering, createSchedule, query } from './support';

test.skip(!enabled, 'Requires disposable Scheduling services');
test('calendar, public and staff bookings share capacity and roster history', async ({ browser }, info) => {
  test.setTimeout(150000);
  const manager = await contextFor(browser, 'manager'),
    visitor = await anonymousContext(browser);
  const foreign = await contextFor(browser, 'foreign-manager'),
    viewer = await contextFor(browser, 'viewer');
  try {
    const schedule = await createSchedule(manager.request, 'Coach ' + info.project.name);
    const offering = await createOffering(manager.request, schedule.id, 'Workshop ' + info.project.name, {
      durationMinutes: 45,
      capacity: 1,
      priceCents: 2000,
    });
    const day = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
    const calendar = await manager.newPage();
    await calendar.setViewportSize(info.project.use.viewport ?? { width: 1280, height: 800 });
    await calendar.goto(origin + '/coaching/calendar?week=' + day);
    await calendar.getByLabel('Class and location').selectOption(JSON.stringify([offering.id, null]));
    await calendar.getByLabel('Class date', { exact: true }).fill(day);
    await calendar.getByLabel('Local start time').fill('15:00');
    await calendar.getByRole('button', { name: 'Add class date' }).click();
    const rosterLink = calendar.getByRole('link', { name: offering.name, exact: true });
    await expect(rosterLink).toBeVisible();
    expect(await calendar.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      (info.project.use.viewport?.width ?? 1280) + 1,
    );
    const rosterUrl = origin + (await rosterLink.getAttribute('href'));
    const publication = calendar.getByRole('heading', { name: schedule.name, exact: true }).locator('..');
    await publication.getByRole('button', { name: 'Enable booking link' }).click();
    const publicUrl =
      origin +
      (await publication.getByRole('link', { name: 'Open public booking page' }).getAttribute('href'));
    const roster = await manager.newPage(),
      publicPage = await visitor.newPage();
    for (const page of [roster, publicPage])
      await page.setViewportSize(info.project.use.viewport ?? { width: 1280, height: 800 });
    await roster.goto(rosterUrl);
    await publicPage.goto(publicUrl);
    await expect(publicPage.getByRole('heading', { name: offering.name })).toBeVisible();
    const staffForm = roster
      .locator('form')
      .filter({ has: roster.getByRole('button', { name: 'Enrol participant' }) });
    await staffForm.getByLabel('Name').fill('Staff entry');
    await staffForm.getByLabel('Email').fill('staff@example.test');
    await staffForm.getByRole('button').click();
    const entry = roster.locator('article').filter({ hasText: 'Staff entry' });
    await expect(entry).toContainText('confirmed');
    await entry.getByRole('button', { name: 'Cancel enrolment' }).click();
    await expect(entry).toContainText('cancelled');
    await publicPage.getByLabel('Name').fill('Public entrant');
    await publicPage.getByLabel('Email').fill('public@example.test');
    await staffForm.getByLabel('Name').fill('Other entrant');
    await staffForm.getByLabel('Email').fill('other@example.test');
    await Promise.all([
      publicPage.getByRole('button', { name: 'Book a place' }).click(),
      staffForm.getByRole('button').click(),
    ]);
    await expect(publicPage.getByText(/Booking confirmed|Booking unavailable/)).toBeVisible();
    await roster.reload();
    const confirmed = roster.locator('article').filter({ hasText: 'confirmed' });
    await expect(confirmed).toHaveCount(1);
    if ((await confirmed.innerText()).includes('Other entrant')) {
      await confirmed.getByRole('button', { name: 'Cancel enrolment' }).click();
      await expect(confirmed).toHaveCount(0);
      await publicPage.reload();
      await publicPage.getByLabel('Name').fill('Public entrant');
      await publicPage.getByLabel('Email').fill('public@example.test');
      await publicPage.getByRole('button', { name: 'Book a place' }).click();
      await expect(publicPage.getByText('Booking confirmed.')).toBeVisible();
      await roster.reload();
    }
    await expect(confirmed).toContainText('Public entrant');
    await confirmed.getByRole('button', { name: 'Mark attended' }).click();
    await expect(confirmed).toContainText('confirmed · attended');
    await expect(confirmed.getByRole('button', { name: 'Cancel enrolment' })).toHaveCount(0);
    const rows = await query(
      "SELECT customer_name,attendance FROM scheduling_reservations WHERE offering_id=$1 AND status='confirmed'",
      [offering.id],
    );
    expect(rows).toEqual([{ customer_name: 'Public entrant', attendance: 'attended' }]);
    await publicPage.reload();
    await expect(publicPage.getByText(/Full/)).toBeVisible();
    await expect(publicPage.getByText('Public entrant')).toHaveCount(0);
    for (const ctx of [viewer, foreign]) {
      const page = await ctx.newPage();
      const response = await page.goto(rosterUrl);
      expect([200, 403, 404]).toContain(response?.status());
      await expect(page.getByText('Public entrant')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: offering.name })).toHaveCount(0);
    }
    await calendar.getByLabel('Class and location').selectOption(JSON.stringify([offering.id, null]));
    await calendar.getByLabel('Class date', { exact: true }).fill(day);
    await calendar.getByLabel('Local start time').fill('18:00');
    await calendar.getByRole('button', { name: 'Add class date' }).click();
    await expect(rosterLink).toHaveCount(2);
    await publicPage.reload();
    await publicPage.getByLabel('Name').fill('Late entrant');
    await publicPage.getByLabel('Email').fill('late@example.test');
    await publication.getByRole('button', { name: 'Disable booking link' }).click();
    await expect(publication.getByRole('link')).toHaveCount(0);
    await publicPage.getByRole('button', { name: 'Book a place' }).click();
    await expect(publicPage.getByText(/Booking unavailable|404|could not be found/i).first()).toBeVisible();
    expect(
      await query(
        "SELECT id FROM scheduling_reservations WHERE offering_id=$1 AND customer_email='late@example.test'",
        [offering.id],
      ),
    ).toHaveLength(0);
    await publicPage.reload();
    await expect(publicPage.getByRole('heading', { name: schedule.name })).toHaveCount(0);
  } finally {
    await Promise.all([manager.close(), visitor.close(), viewer.close(), foreign.close()]);
  }
});

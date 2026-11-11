import { expect, test } from '@playwright/test';
import { enabled, origin } from './accounts';
import { contextFor, createOffering, createSchedule, query } from './support';

test.skip(!enabled, 'Requires disposable Scheduling harness');
test('a coach builds and runs a two-drill session and reuses the boards without player identities', async ({
  browser,
}, info) => {
  const ctx = await contextFor(browser, 'manager'),
    viewer = await contextFor(browser, 'viewer'),
    other = await contextFor(browser, 'foreign-manager');
  try {
    const page = await ctx.newPage();
    await page.setViewportSize(info.project.use.viewport ?? { width: 1440, height: 900 });
    const schedule = await createSchedule(ctx.request, 'Planning ' + info.project.name);
    const offering = await createOffering(ctx.request, schedule.id, 'Skills ' + info.project.name, {
      durationMinutes: 60,
      capacity: 8,
      priceCents: 0,
    });
    const day = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    await page.goto(origin + '/coaching/calendar?week=' + day);
    for (const time of ['09:00', '11:00']) {
      await page.getByLabel('Class and location').selectOption(JSON.stringify([offering.id, null]));
      await page.getByLabel('Class date', { exact: true }).fill(day);
      await page.getByLabel('Local start time').fill(time);
      await page.getByRole('button', { name: 'Add class date' }).click();
      await expect(page.getByRole('link', { name: offering.name, exact: true })).toHaveCount(
        time === '09:00' ? 1 : 2,
      );
    }
    const roster = page.getByRole('link', { name: offering.name, exact: true });
    const urls = await Promise.all([roster.nth(0).getAttribute('href'), roster.nth(1).getAttribute('href')]);
    await page.goto(origin + urls[0]);
    await page.getByLabel('Name', { exact: true }).fill('Synthetic athlete');
    await page.getByLabel('Email', { exact: true }).fill('athlete@example.test');
    await page.getByRole('button', { name: 'Enrol participant' }).click();
    await expect(page.getByRole('heading', { name: 'Synthetic athlete' })).toBeVisible();
    await page.getByRole('link', { name: 'Training plan' }).click();
    await expect(page.getByRole('heading', { name: offering.name + ' training plan' })).toBeVisible();
    const url = page.url();
    const stale = await ctx.newPage();
    await stale.goto(url);
    await page.getByLabel('Drill name').fill('Passing lines');
    await page.getByLabel('Minutes', { exact: true }).fill('20');
    await page.getByLabel('Ground layout').selectOption('half');
    await page.getByLabel('Place on board').selectOption({ label: 'Synthetic athlete' });
    await page.getByRole('button', { name: 'Column 3, row 4', exact: true }).click();
    await page.getByLabel('Place on board').selectOption('arrow');
    await page.getByRole('button', { name: 'Column 3, row 4', exact: true }).click();
    await page.getByRole('button', { name: 'Column 7, row 3', exact: true }).click();
    await page.getByRole('button', { name: 'Add drill' }).click();
    await page.getByLabel('Drill name').fill('Doubles recovery');
    await page.getByLabel('Ground layout').selectOption('court');
    await page.getByRole('button', { name: 'Column 5, row 4', exact: true }).click();
    await page.getByLabel('Place on board').selectOption('ball');
    await page.getByRole('button', { name: 'Column 6, row 5', exact: true }).click();
    const template = 'Club template ' + info.project.name;
    await page.getByLabel(/Save as a reusable template/).fill(template);
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.getByText('Plan saved.', { exact: true })).toBeVisible();
    await stale.getByLabel('Drill name').fill('Stale draft');
    await stale.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(stale.getByText(/session changed/i)).toBeVisible();
    await expect(stale.getByRole('button', { name: 'Save plan', exact: true })).toBeDisabled();
    stale.once('dialog', (dialog) => dialog.accept());
    await stale.getByRole('button', { name: 'Reload saved plan' }).click();
    await expect(stale.getByLabel('Drill name')).toHaveValue('Passing lines');
    await page.getByLabel('Coaching notes').fill('Recover to the centre after each volley.');
    await page.getByLabel(/Save as a reusable template/).fill(template);
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.getByText('A template already has that name. Choose another name.')).toBeVisible();
    const revision = () =>
      query<{ version: number }>(
        'SELECT version FROM scheduling_coach_training_plans WHERE occurrence_id=$1',
        [urls[0]!.split('/').pop()],
      );
    expect((await revision())[0].version).toBe(1);
    await page.getByLabel(/Save as a reusable template/).fill('');
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.getByText('Plan saved.', { exact: true })).toBeVisible();
    expect((await revision())[0].version).toBe(2);
    // Commit through the actual Server Action, then lose only its response.
    let lostResponses = 0;
    await page.route(url, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch();
      lostResponses++;
      await route.abort('connectionreset');
    });
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reload saved plan' })).toBeVisible();
    expect((await revision())[0].version).toBe(3);
    expect(lostResponses).toBe(1);
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Run session' }).click();
    await page.getByRole('button', { name: 'Previous drill', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Passing lines · 20 min' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit drills' }).click();
    await expect(page.getByRole('button', { name: 'Save plan', exact: true })).toBeDisabled();
    await page.unroute(url);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Reload saved plan' }).click();
    await expect(page.getByText('Saved plan · version 3')).toBeVisible();
    expect((await revision())[0].version).toBe(3);
    await page.reload();
    await expect(page.getByText('30 min remaining')).toBeVisible();
    await page.getByRole('button', { name: 'Run session' }).click();
    await expect(page.getByRole('img', { name: 'Football half-pitch diagram' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Board players' })).toContainText('Synthetic athlete');
    await page.getByRole('button', { name: 'Next drill', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Tennis court diagram' })).toBeVisible();
    await expect(page.getByText('Recover to the centre after each volley.')).toBeVisible();
    for (const denied of [viewer, other]) {
      const deniedPage = await denied.newPage();
      await deniedPage.goto(url);
      await expect(deniedPage.getByRole('heading', { name: offering.name + ' training plan' })).toHaveCount(
        0,
      );
    }
    const reviewUrl = origin + '/coaching/calendar?view=review&week=' + day;
    await page.goto(reviewUrl);
    const upcoming = page.getByRole('region', { name: 'Session preparation' });
    await expect(
      upcoming.getByRole('link', { name: 'Open plan' }).and(page.locator('a[href="' + urls[0] + '/plan"]')),
    ).toBeVisible();
    await expect(
      upcoming
        .getByRole('link', { name: 'Prepare plan' })
        .and(page.locator('a[href="' + urls[1] + '/plan"]')),
    ).toBeVisible();
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(reviewUrl);
    await expect(viewerPage.getByRole('heading', { name: 'Weekly coaching review' })).toHaveCount(0);
    const foreignPage = await other.newPage();
    await foreignPage.goto(reviewUrl);
    await expect(foreignPage.getByRole('heading', { name: 'Weekly coaching review' })).toBeVisible();
    await expect(foreignPage.getByText(offering.name, { exact: true })).toHaveCount(0);
    await page.goto(origin + urls[1] + '/plan');
    await page.getByLabel('Saved templates').selectOption(template);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Use template' }).click();
    await expect(page.getByLabel('Drill name')).toHaveValue('Passing lines');
    await expect(page.getByRole('list', { name: 'Board players' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save plan', exact: true }).click();
    await expect(page.getByText('Plan saved.', { exact: true })).toBeVisible();
    const rows = await query<{ kinds: string[] }>(
      "SELECT ARRAY(SELECT m->>'kind' FROM jsonb_array_elements(drills->0->'marks') m) AS kinds FROM scheduling_coach_training_plans WHERE occurrence_id=$1",
      [urls[1]!.split('/').pop()],
    );
    expect(rows[0].kinds).toEqual(['position', 'arrow']);
    // Mark this synthetic occurrence complete and use the real roster to resolve attendance.
    await query("UPDATE scheduling_occurrences SET status='completed' WHERE id=$1 AND offering_id=$2", [
      urls[0]!.split('/').pop(),
      offering.id,
    ]);
    await page.goto(reviewUrl);
    const outstanding = page.getByRole('region', { name: 'Attendance to finish' });
    const row = outstanding.getByRole('listitem').filter({ hasText: offering.name });
    await expect(row).toContainText('1 unmarked');
    await row.getByRole('link', { name: 'Open roster' }).click();
    await page.getByRole('button', { name: 'Mark attended' }).click();
    await expect(page.locator('article').filter({ hasText: 'Synthetic athlete' })).toContainText(
      'confirmed · attended',
    );
    await page.goto(reviewUrl);
    await expect(row).toHaveCount(0);
    await expect(
      page.getByRole('listitem').filter({ hasText: offering.name }).filter({ hasText: '1 attended' }),
    ).toContainText('0 unmarked');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally {
    await Promise.all([ctx.close(), viewer.close(), other.close()]);
  }
});

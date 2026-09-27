import { test, expect, type Page } from '@playwright/test';
import { BUDGET_EXPORT_CONTROLS } from '../../lib/commercial/budgetExportControls';

async function mountControls(
  page: Page,
  props: {
    legacyAvailable: boolean;
    financeAvailable: boolean;
    disabledReason?: string;
  },
) {
  const controls = [
    { ...BUDGET_EXPORT_CONTROLS.legacy, available: props.legacyAvailable },
    { ...BUDGET_EXPORT_CONTROLS.finance, available: props.financeAvailable },
  ];
  const markup = controls.map(control => control.available
    ? `<a data-export-view="${control.key}" href="${control.href}" download="${control.filename}">${control.label}</a>`
    : `<span data-export-view="${control.key}" data-export-filename="${control.filename}" aria-disabled="true">${control.label}</span>`
  ).join('');
  const reason = props.disabledReason
    ? `<span role="status">${props.disabledReason}</span>`
    : '';
  await page.setContent(`<base href="http://brainbase.local/"><section aria-label="Budget exports">${markup}${reason}</section>`);
}

async function fulfillCsvDownload(
  page: Page,
  view: 'legacy' | 'finance',
  filename: string,
) {
  await page.route(
    `http://brainbase.local/api/commercial/budgeting/consumption/export?view=${view}`,
    route => route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: 'header\r\nvalue\r\n',
    }),
  );
}

test.describe('C7.9F Budget export browser flow', () => {
  test('clicking legacy CSV requests the legacy endpoint and downloads the contracted filename', async ({ page }) => {
    await mountControls(page, { legacyAvailable: true, financeAvailable: true });
    await fulfillCsvDownload(page, 'legacy', 'brainbase-budget-consumption.csv');

    const [request, download] = await Promise.all([
      page.waitForRequest(request =>
        request.url() === 'http://brainbase.local/api/commercial/budgeting/consumption/export?view=legacy',
      ),
      page.waitForEvent('download'),
      page.locator('[data-export-view="legacy"]').click(),
    ]);

    expect(request.method()).toBe('GET');
    expect(download.suggestedFilename()).toBe('brainbase-budget-consumption.csv');
  });

  test('clicking finance CSV requests the finance endpoint and downloads the contracted filename', async ({ page }) => {
    await mountControls(page, { legacyAvailable: true, financeAvailable: true });
    await fulfillCsvDownload(page, 'finance', 'brainbase-budget-finance.csv');

    const [request, download] = await Promise.all([
      page.waitForRequest(request =>
        request.url() === 'http://brainbase.local/api/commercial/budgeting/consumption/export?view=finance',
      ),
      page.waitForEvent('download'),
      page.locator('[data-export-view="finance"]').click(),
    ]);

    expect(request.method()).toBe('GET');
    expect(download.suggestedFilename()).toBe('brainbase-budget-finance.csv');
  });

  test('disabled finance control cannot request or download while legacy remains clickable', async ({ page }) => {
    let financeRequests = 0;
    await page.route(
      'http://brainbase.local/api/commercial/budgeting/consumption/export?view=finance',
      route => {
        financeRequests += 1;
        return route.abort();
      },
    );
    await mountControls(page, { legacyAvailable: true, financeAvailable: false });

    const finance = page.locator('[data-export-view="finance"]');
    await expect(finance).toHaveAttribute('aria-disabled', 'true');
    await expect(finance).not.toHaveAttribute('href', /.+/);
    await finance.click();

    await page.waitForTimeout(100);
    expect(financeRequests).toBe(0);
    await expect(page).toHaveURL('about:blank');
    await expect(page.locator('[data-export-view="legacy"]')).toHaveAttribute(
      'href',
      '/api/commercial/budgeting/consumption/export?view=legacy',
    );
  });

  test('error state disables both controls and exposes the reason without download links', async ({ page }) => {
    await mountControls(page, {
      legacyAvailable: false,
      financeAvailable: false,
      disabledReason: 'Exports are unavailable because the report could not be loaded.',
    });

    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(2);
    await expect(page.locator('a[data-export-view]')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText(
      'Exports are unavailable because the report could not be loaded.',
    );
  });
});

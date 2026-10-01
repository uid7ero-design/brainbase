import { test, expect, type Download, type Page } from '@playwright/test';
import { buildBudgetConsumptionCsvExports } from '../../lib/commercial/budgetConsumptionExport';
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
  body: string,
) {
  await page.route(
    `http://brainbase.local/api/commercial/budgeting/consumption/export?view=${view}`,
    route => route.fulfill({
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body,
    }),
  );
}

async function readDownloadText(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function exportFixture() {
  return {
    rows: [{
      budgetAccountCode: 'OPEX',
      budgetAccountName: 'Operating costs',
      costCentreCode: 'OPS',
      costCentreName: 'Operations',
      financialYearName: 'FY26',
      financialPeriodName: 'September',
      currency: 'AUD',
      budgetCents: 12000,
      actualCents: 2500,
      committedCents: 7500,
      exposureCents: 10000,
      budgetLessActualCents: 9500,
      budgetLessActualAndCommittedCents: 2000,
    }],
    financeRows: [{
      budgetAccountCode: 'OPEX',
      budgetAccountName: 'Operating costs',
      financialYearName: 'FY26',
      financialPeriodName: 'September',
      currency: 'AUD',
      budgetCents: '12000',
      sourceActualCents: '2500',
      financeAdjustmentCents: '500',
      effectiveActualCents: '3000',
      committedCents: '7500',
      exposureCents: '10500',
      externalGlActualCents: null,
      reconciliationVarianceCents: null,
      reconciliationStatus: null,
      sourceSystemId: null,
    }],
  };
}

test.describe('C7.9F Budget export browser flow', () => {
  test('downloads the preserved legacy CSV header and row', async ({ page }) => {
    const { legacyRowsCsv } = buildBudgetConsumptionCsvExports(exportFixture());
    await mountControls(page, { legacyAvailable: true, financeAvailable: true });
    await fulfillCsvDownload(
      page,
      'legacy',
      'brainbase-budget-consumption.csv',
      legacyRowsCsv,
    );

    const [request, download] = await Promise.all([
      page.waitForRequest(request =>
        request.url() === 'http://brainbase.local/api/commercial/budgeting/consumption/export?view=legacy',
      ),
      page.waitForEvent('download'),
      page.locator('[data-export-view="legacy"]').click(),
    ]);
    const body = await readDownloadText(download);

    expect(request.method()).toBe('GET');
    expect(download.suggestedFilename()).toBe('brainbase-budget-consumption.csv');
    expect(body).toContain(
      'Budget account code,Budget account name,Cost centre code,Cost centre name,Financial year,Financial period,Currency,Budget cents,Actual cents,Committed cents,Exposure cents,Budget less Actual cents,Budget less Actual + Committed cents',
    );
    expect(body).toContain(
      'OPEX,Operating costs,OPS,Operations,FY26,September,AUD,12000,2500,7500,10000,9500,2000',
    );
    expect(body).not.toContain('Finance Adjustments cents');
  });

  test('downloads finance CSV with finance headers and empty null external GL cells', async ({ page }) => {
    const { financeRowsCsv } = buildBudgetConsumptionCsvExports(exportFixture());
    await mountControls(page, { legacyAvailable: true, financeAvailable: true });
    await fulfillCsvDownload(
      page,
      'finance',
      'brainbase-budget-finance.csv',
      financeRowsCsv,
    );

    const [request, download] = await Promise.all([
      page.waitForRequest(request =>
        request.url() === 'http://brainbase.local/api/commercial/budgeting/consumption/export?view=finance',
      ),
      page.waitForEvent('download'),
      page.locator('[data-export-view="finance"]').click(),
    ]);
    const body = await readDownloadText(download);

    expect(request.method()).toBe('GET');
    expect(download.suggestedFilename()).toBe('brainbase-budget-finance.csv');
    expect(body).toContain(
      'Source Actual cents,Finance Adjustments cents,Effective Actual cents,Committed cents,Exposure cents,External GL Actual cents,Reconciliation Variance cents,Reconciliation status,Source system',
    );
    expect(body).toContain(
      'OPEX,Operating costs,FY26,September,AUD,12000,2500,500,3000,7500,10500,,,,',
    );
  });

  test('downloads stale finance reconciliation evidence without rewriting its historical values', async ({ page }) => {
    const report = exportFixture();
    report.financeRows[0] = {
      ...report.financeRows[0],
      externalGlActualCents: '3050',
      reconciliationVarianceCents: '-50',
      reconciliationStatus: 'STALE',
      sourceSystemId: 'xero',
    };
    const { financeRowsCsv } = buildBudgetConsumptionCsvExports(report);
    await mountControls(page, { legacyAvailable: true, financeAvailable: true });
    await fulfillCsvDownload(
      page,
      'finance',
      'brainbase-budget-finance.csv',
      financeRowsCsv,
    );

    const [, download] = await Promise.all([
      page.waitForRequest(request =>
        request.url() === 'http://brainbase.local/api/commercial/budgeting/consumption/export?view=finance',
      ),
      page.waitForEvent('download'),
      page.locator('[data-export-view="finance"]').click(),
    ]);
    const body = await readDownloadText(download);

    expect(download.suggestedFilename()).toBe('brainbase-budget-finance.csv');
    expect(body).toContain(
      'OPEX,Operating costs,FY26,September,AUD,12000,2500,500,3000,7500,10500,3050',
    );
    expect(body).toContain("'-50,STALE,xero");
    expect(body).not.toContain('SIGNED_OFF');
  });

  test('keeps partial finance cells empty, preserves row order, and never infers reconciliation status', async ({ page }) => {
    const report = exportFixture();
    report.financeRows = [
      {
        ...report.financeRows[0],
        budgetAccountCode: 'FIRST',
        budgetAccountName: 'Partial row',
        financeAdjustmentCents: undefined,
        externalGlActualCents: undefined,
        reconciliationVarianceCents: undefined,
        reconciliationStatus: undefined,
        sourceSystemId: undefined,
      },
      {
        ...report.financeRows[0],
        budgetAccountCode: 'SECOND',
        budgetAccountName: 'Stale row',
        externalGlActualCents: '3050',
        reconciliationVarianceCents: '-50',
        reconciliationStatus: 'STALE',
        sourceSystemId: 'xero',
      },
      {
        ...report.financeRows[0],
        budgetAccountCode: 'THIRD',
        budgetAccountName: 'GL without status',
        externalGlActualCents: '4100',
        reconciliationVarianceCents: null,
        reconciliationStatus: null,
        sourceSystemId: 'xero',
      },
    ] as unknown as typeof report.financeRows;

    const { financeRowsCsv } = buildBudgetConsumptionCsvExports(report);
    await mountControls(page, { legacyAvailable: true, financeAvailable: true });
    await fulfillCsvDownload(
      page,
      'finance',
      'brainbase-budget-finance.csv',
      financeRowsCsv,
    );

    const [, download] = await Promise.all([
      page.waitForRequest(request =>
        request.url() === 'http://brainbase.local/api/commercial/budgeting/consumption/export?view=finance',
      ),
      page.waitForEvent('download'),
      page.locator('[data-export-view="finance"]').click(),
    ]);
    const body = await readDownloadText(download);
    const lines = body.replace(/^\uFEFF/, '').trimEnd().split('\r\n');

    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('FIRST,Partial row,FY26,September,AUD,12000,2500,,3000,7500,10500,,,,');
    expect(lines[2]).toContain("SECOND,Stale row,FY26,September,AUD,12000,2500,500,3000,7500,10500,3050,'-50,STALE,xero");
    expect(lines[3]).toContain('THIRD,GL without status,FY26,September,AUD,12000,2500,500,3000,7500,10500,4100,,,xero');

    expect(lines[1].startsWith('FIRST,')).toBe(true);
    expect(lines[2].startsWith('SECOND,')).toBe(true);
    expect(lines[3].startsWith('THIRD,')).toBe(true);
    expect(lines[3]).not.toContain('STALE');
    expect(lines[3]).not.toContain('SIGNED_OFF');
  });

  test('preserves duplicate finance rows in order without collapsing or relabelling reconciliation status', async ({ page }) => {
    const report = exportFixture();
    report.financeRows = [
      {
        ...report.financeRows[0],
        externalGlActualCents: '3000',
        reconciliationVarianceCents: '0',
        reconciliationStatus: 'SIGNED_OFF',
        sourceSystemId: 'xero',
      },
      {
        ...report.financeRows[0],
        externalGlActualCents: '3050',
        reconciliationVarianceCents: '-50',
        reconciliationStatus: 'STALE',
        sourceSystemId: 'xero',
      },
    ];

    const { financeRowsCsv } = buildBudgetConsumptionCsvExports(report);
    await mountControls(page, { legacyAvailable: true, financeAvailable: true });
    await fulfillCsvDownload(
      page,
      'finance',
      'brainbase-budget-finance.csv',
      financeRowsCsv,
    );

    const [, download] = await Promise.all([
      page.waitForRequest(request =>
        request.url() === 'http://brainbase.local/api/commercial/budgeting/consumption/export?view=finance',
      ),
      page.waitForEvent('download'),
      page.locator('[data-export-view="finance"]').click(),
    ]);
    const body = await readDownloadText(download);
    const lines = body.replace(/^\uFEFF/, '').trimEnd().split('\r\n');

    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(
      'OPEX,Operating costs,FY26,September,AUD,12000,2500,500,3000,7500,10500,3000,0,SIGNED_OFF,xero',
    );
    expect(lines[2]).toContain(
      "OPEX,Operating costs,FY26,September,AUD,12000,2500,500,3000,7500,10500,3050,'-50,STALE,xero",
    );
    expect(lines[1].endsWith('SIGNED_OFF,xero')).toBe(true);
    expect(lines[2].endsWith('STALE,xero')).toBe(true);
    expect((body.match(/OPEX,Operating costs,FY26,September,AUD/g) ?? []).length).toBe(2);
  });

  test('preserves a completely empty finance row between populated rows with blank reconciliation status', async ({ page }) => {
    const report = exportFixture();
    report.financeRows = [
      {
        ...report.financeRows[0],
        budgetAccountCode: 'BEFORE',
        budgetAccountName: 'Before row',
        externalGlActualCents: '3000',
        reconciliationVarianceCents: '0',
        reconciliationStatus: 'SIGNED_OFF',
        sourceSystemId: 'xero',
      },
      {} as unknown as typeof report.financeRows[number],
      {
        ...report.financeRows[0],
        budgetAccountCode: 'AFTER',
        budgetAccountName: 'After row',
        externalGlActualCents: '3050',
        reconciliationVarianceCents: '-50',
        reconciliationStatus: 'STALE',
        sourceSystemId: 'xero',
      },
    ];

    const { financeRowsCsv } = buildBudgetConsumptionCsvExports(report);
    await mountControls(page, { legacyAvailable: true, financeAvailable: true });
    await fulfillCsvDownload(
      page,
      'finance',
      'brainbase-budget-finance.csv',
      financeRowsCsv,
    );

    const [, download] = await Promise.all([
      page.waitForRequest(request =>
        request.url() === 'http://brainbase.local/api/commercial/budgeting/consumption/export?view=finance',
      ),
      page.waitForEvent('download'),
      page.locator('[data-export-view="finance"]').click(),
    ]);
    const body = await readDownloadText(download);
    const lines = body.replace(/^\uFEFF/, '').trimEnd().split('\r\n');

    expect(lines).toHaveLength(4);
    expect(lines[1].startsWith('BEFORE,Before row,')).toBe(true);
    expect(lines[2]).toBe(',,,,,,,,,,,,,,');
    expect(lines[3].startsWith('AFTER,After row,')).toBe(true);
    expect(lines[2]).not.toContain('STALE');
    expect(lines[2]).not.toContain('SIGNED_OFF');
  });

  test('downloads finance CSV with RFC4180 escaping and formula-safe text fields', async ({ page }) => {
    const report = exportFixture();
    report.financeRows = [{
      ...report.financeRows[0],
      budgetAccountCode: '=SUM(1,2)',
      budgetAccountName: 'Ops, "North"\nLine',
      reconciliationStatus: 'SIGNED_OFF',
      sourceSystemId: '@ledger',
    }];

    const { financeRowsCsv } = buildBudgetConsumptionCsvExports(report);
    await mountControls(page, { legacyAvailable: true, financeAvailable: true });
    await fulfillCsvDownload(
      page,
      'finance',
      'brainbase-budget-finance.csv',
      financeRowsCsv,
    );

    const [, download] = await Promise.all([
      page.waitForRequest(request =>
        request.url() === 'http://brainbase.local/api/commercial/budgeting/consumption/export?view=finance',
      ),
      page.waitForEvent('download'),
      page.locator('[data-export-view="finance"]').click(),
    ]);
    const body = await readDownloadText(download);

    expect(body.startsWith('\uFEFF')).toBe(true);
    expect(body).toContain(`"'=SUM(1,2)","Ops, ""North""\nLine"`);
    expect(body).toContain('SIGNED_OFF,\'@ledger');
    expect(body).not.toContain(',@ledger');
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

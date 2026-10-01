import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BudgetExportControls, FinanceSourceSelector } from '@/app/commercial/budgeting/commitments/page';

const pageSource = fs.readFileSync(
  path.resolve(process.cwd(), 'app/commercial/budgeting/commitments/page.tsx'),
  'utf8',
);

describe('C7.9F — Budgeting export controls UI', () => {
  it('renders finance and legacy download URLs with their contracted filenames', () => {
    const html = renderToStaticMarkup(createElement(BudgetExportControls, {
      legacyAvailable: true,
      financeAvailable: true,
    }));

    expect(html).toContain(
      'href="/api/commercial/budgeting/consumption/export?view=legacy"',
    );
    expect(html).toContain('download="brainbase-budget-consumption.csv"');
    expect(html).toContain('data-export-view="legacy"');

    expect(html).toContain(
      'href="/api/commercial/budgeting/consumption/export?view=finance"',
    );
    expect(html).toContain('download="brainbase-budget-finance.csv"');
    expect(html).toContain('data-export-view="finance"');
  });

  it('adds only an explicitly selected finance source to the finance export URL', () => {
    const html = renderToStaticMarkup(createElement(BudgetExportControls, {
      legacyAvailable: true,
      financeAvailable: true,
      sourceSystemId: 'xero au',
    }));

    expect(html).toContain(
      'href="/api/commercial/budgeting/consumption/export?view=legacy"',
    );
    expect(html).toContain(
      'href="/api/commercial/budgeting/consumption/export?view=finance&amp;sourceSystemId=xero%20au"',
    );
    expect(html).not.toContain('view=legacy&amp;sourceSystemId=');
  });

  it('renders an explicit BrainBase-only default plus tenant finance source choices', () => {
    const html = renderToStaticMarkup(createElement(FinanceSourceSelector, {
      sourceSystemIds: ['myob', 'xero'],
      selectedSourceSystemId: '',
      onChange: () => undefined,
    }));

    expect(html).toContain('aria-label="External GL source"');
    expect(html).toContain('BrainBase only (no External GL)');
    expect(html).toContain('<option value="myob">myob</option>');
    expect(html).toContain('<option value="xero">xero</option>');
    expect(html).toContain('Select a source explicitly');
  });

  it('disables only the unavailable export without emitting a broken href', () => {
    const html = renderToStaticMarkup(createElement(BudgetExportControls, {
      legacyAvailable: true,
      financeAvailable: false,
    }));

    expect(html).toContain('href="/api/commercial/budgeting/consumption/export?view=legacy"');
    expect(html).toContain('data-export-view="finance"');
    expect(html).toContain('data-export-filename="brainbase-budget-finance.csv"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href="/api/commercial/budgeting/consumption/export?view=finance"');
  });

  it('renders both exports disabled with a visible reason for report error states', () => {
    const html = renderToStaticMarkup(createElement(BudgetExportControls, {
      legacyAvailable: false,
      financeAvailable: false,
      disabledReason: 'Exports are unavailable because the report could not be loaded.',
    }));

    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(2);
    expect(html).not.toContain('href="/api/commercial/budgeting/consumption/export');
    expect(html).toContain('role="status"');
    expect(html).toContain('Exports are unavailable because the report could not be loaded.');
  });

  it('wires loading, report-error and no-report page states to disabled export controls', () => {
    expect(pageSource).toContain(
      'disabledReason="Report is still loading."',
    );
    expect(pageSource).toContain(
      'disabledReason="Exports are unavailable because the report could not be loaded."',
    );
    expect(pageSource).toContain(
      'disabledReason="No report data is available to export."',
    );
    expect(pageSource).toContain('legacyAvailable={rows.length > 0}');
    expect(pageSource).toContain('financeAvailable={financeRows.length > 0}');
    expect(pageSource).toContain("fetch('/api/commercial/budgeting/external-gl/sources')");
    expect(pageSource).toContain('?sourceSystemId=${encodeURIComponent(selectedSourceSystemId)}');
    expect(pageSource).toContain('sourceSystemId={selectedSourceSystemId || null}');
  });
});

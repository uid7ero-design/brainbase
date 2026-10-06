import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');
}

const page = source('app/commercial/budgeting/external-gl/page.tsx');
const layout = source('app/commercial/layout.tsx');
const sidebar = source('app/commercial/_components/CommercialSidebar.tsx');

describe('C7.9D — External GL mapping admin UI', () => {
  it('makes Budgeting a first-class Commercial shell capability', () => {
    expect(layout).toContain("checkCapability(session.organisationId, 'budgeting')");
    expect(layout).toContain('!budgetingCapability.allowed');
    expect(layout).toContain('budgetingEnabled={budgetingCapability.allowed}');
    expect(layout).toContain("budgetingAdminEnabled={budgetingCapability.allowed && roleGte(session.role, 'admin')}");
  });

  it('shows reporting to Budgeting viewers but mapping administration only to admins', () => {
    expect(sidebar).toContain('budgetingEnabled');
    expect(sidebar).toContain("'/commercial/budgeting/commitments'");
    expect(sidebar).toContain('budgetingAdminEnabled');
    expect(sidebar).toContain("'/commercial/budgeting/external-gl'");
  });

  it('loads governed mapping lists and active BrainBase reference data from tenant-scoped APIs', () => {
    expect(page).toContain("fetch('/api/commercial/budgeting/external-gl/sources'");
    expect(page).toContain('/api/commercial/budgeting/external-gl/mappings');
    expect(page).toContain('/api/commercial/budgeting/external-gl/cost-centre-mappings');
    expect(page).toContain("fetch('/api/commercial/budgeting/external-gl/reference-data'");
    expect(page).not.toMatch(/organisationId=/);
  });

  it('creates only explicit mappings against authoritative BrainBase IDs', () => {
    expect(page).toContain("postJson('/api/commercial/budgeting/external-gl/mappings'");
    expect(page).toContain('budgetAccountId: accountDraft.budgetAccountId');
    expect(page).toContain("postJson('/api/commercial/budgeting/external-gl/cost-centre-mappings'");
    expect(page).toContain('costCentreId: costCentreDraft.costCentreId');
    expect(page).toContain('No fuzzy or automatic matching is used.');
    expect(page).not.toMatch(/similarity\(|levenshtein|fuzzyMatch/i);
  });

  it('requires an explicit effective-to date before retiring either mapping kind', () => {
    expect(page).toContain("if (!effectiveTo)");
    expect(page).toContain('Choose an effective-to date before retiring a mapping.');
    expect(page).toContain("encodeURIComponent(id)");
    expect(page).toContain("/retire");
    expect(page).toContain('disabled={working || !value}');
  });

  it('surfaces authorization and load failures without fabricating mapping data', () => {
    expect(page).toContain('Budgeting administrator access is required to manage External GL mappings.');
    expect(page).toContain('Unable to load External GL mapping configuration.');
    expect(page).toContain('No account mappings match the current filters.');
    expect(page).toContain('No cost-centre mappings match the current filters.');
  });
});

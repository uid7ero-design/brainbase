import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
}

describe('HR-6 restricted cases UI', () => {
  const peoplePage = read('app/people/page.tsx');
  const listPage = read('app/people/restricted-cases/page.tsx');
  const detailPage = read('app/people/restricted-cases/[id]/page.tsx');

  it('surfaces Restricted Cases from People for any People-capability viewer', () => {
    expect(peoplePage).toContain('href="/people/restricted-cases"');
    expect(peoplePage).toContain('Restricted Cases');
  });

  it('loads the governed restricted-case list and creates through the existing API', () => {
    expect(listPage).toContain("fetch('/api/hr/restricted-cases')");
    expect(listPage).toContain("fetch('/api/hr/restricted-cases', {");
    expect(listPage).toContain("method: 'POST'");
    expect(listPage).not.toContain('hr_restricted_cases');
  });

  it('keeps case creation and access grant as separate explicit requests', () => {
    expect(listPage).toContain('Case creation never grants access implicitly.');
    expect(listPage).toContain('grantInitialReader');
    expect(listPage).toContain("/access`");
    expect(listPage).toContain('Retry access grant');
  });

  it('uses existing authorization-aware APIs for participants, notes, documents and access', () => {
    expect(detailPage).toContain('/participants`');
    expect(detailPage).toContain('/notes`');
    expect(detailPage).toContain('/documents`');
    expect(detailPage).toContain('/access`');
    expect(detailPage).toContain('/api/hr/administrators');
    expect(detailPage).not.toContain('hr_restricted_case_');
  });

  it('does not add note edit/delete UX and describes notes as append-only', () => {
    expect(detailPage).toContain('append-only case note');
    expect(detailPage).not.toMatch(/method:\s*['\"](?:PATCH|PUT)['\"][\s\S]*notes/);
    expect(detailPage).not.toMatch(/notes\/\$\{[^}]+\}[\s\S]*method:\s*['\"]DELETE['\"]/);
  });

  it('does not imply participants confer access', () => {
    expect(detailPage).toContain('Participants do not receive access automatically.');
  });
});

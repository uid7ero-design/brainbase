import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('HR-7G1 lifecycle templates read-only admin UI', () => {
  const src = stripComments(read('app/people/lifecycle-templates/page.tsx'));

  it('is a client page under the existing People module', () => {
    expect(read('app/people/lifecycle-templates/page.tsx').split('\n')[0]).toBe("'use client';");
  });

  it('loads template summaries only from the canonical lifecycle templates endpoint', () => {
    expect(src).toContain("fetch('/api/hr/lifecycle/templates')");
  });

  it('loads task detail only from the canonical template detail endpoint', () => {
    expect(src).toContain('/api/hr/lifecycle/templates/${template.id}');
  });

  it('limits write calls to template create/version plus capability-gated activate/retire endpoints', () => {
    expect(src).toContain("fetch('/api/hr/lifecycle/templates', {");
    expect(src).toContain('/api/hr/lifecycle/templates/\${template.id}/\${action}');
    expect(src).toMatch(/method:\s*'POST'/);
    expect(src).toContain('/api/hr/lifecycle/templates/${source.id}/versions');
    expect(src).not.toMatch(/method:\s*['\"](PATCH|PUT|DELETE)['\"]/);
  });

  it('uses only server-returned action capabilities for create and status controls', () => {
    expect(src).toContain('can_create_template');
    expect(src).toContain('can_create_version');
    expect(src).toContain('can_activate');
    expect(src).toContain('can_retire');
    expect(src).toContain('template.capabilities.can_create_version');
    expect(src).toContain('template.capabilities.can_activate');
    expect(src).toContain('template.capabilities.can_retire');
    expect(src).toContain('Activate this template version?');
    expect(src).toContain('Retire this template version?');
  });

  it('builds template task payloads from explicit operational fields only', () => {
    expect(src).toContain('template_key: templateKey');
    expect(src).toContain('lifecycle_type: newTemplateType');
    expect(src).toContain('sequence: index + 1');
    expect(src).toContain('responsibility_type: task.responsibility_type');
    expect(src).toContain('due_offset_days: task.due_offset_days.trim()');
    expect(src).toContain('employee_visible: task.internal_only ? false : task.employee_visible');
    expect(src).toContain('manager_visible: task.internal_only ? false : task.manager_visible');
    expect(src).toContain('internal_only: task.internal_only');
  });

  it('does not infer HR authority from roles in the browser', () => {
    expect(src).not.toMatch(/session\.role/);
    expect(src).not.toMatch(/role\s*===/);
    expect(src).not.toMatch(/super_admin/);
    expect(src).not.toMatch(/isHrAdministrator/);
  });

  it('does not render server-owned creator or assignment identity metadata', () => {
    expect(src).not.toMatch(/created_by/);
    expect(src).not.toMatch(/assigned_user_id/);
  });

  it('renders distinct list loading, error, and empty states', () => {
    expect(src).toContain('Loading lifecycle templates…');
    expect(src).toContain('Could not load lifecycle templates.');
    expect(src).toContain('No lifecycle templates yet.');
  });

  it('renders distinct detail loading, error, and empty states', () => {
    expect(src).toContain('Loading template tasks…');
    expect(src).toContain('Could not load lifecycle template details.');
    expect(src).toContain('No tasks in this template.');
  });

  it('projects task detail down to operational fields only', () => {
    expect(src).toContain('task.sequence');
    expect(src).toContain('task.title');
    expect(src).toContain('task.responsibility_type');
    expect(src).toContain('task.due_offset_days');
    expect(src).toContain('task.requires_approval');
    expect(src).toContain('task.approval_type');
  });
});

describe('People lifecycle templates entry point', () => {
  const src = stripComments(read('app/people/page.tsx'));

  it('links to lifecycle templates inside the existing canManage actions block', () => {
    const start = src.indexOf('{canManage && (');
    expect(start).toBeGreaterThan(-1);
    const link = src.indexOf('href="/people/lifecycle-templates"', start);
    expect(link).toBeGreaterThan(start);
    const addPerson = src.indexOf('+ Add Person', start);
    expect(addPerson).toBeGreaterThan(link);
  });
});

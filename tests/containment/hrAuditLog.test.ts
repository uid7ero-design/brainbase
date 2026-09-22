import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// HR-0.5 §4 — regression coverage for lib/hr/auditLog.ts's logHrEvent()
// contract. No HR database entity is created anywhere in this suite — it
// only proves the shape of the INSERT this helper will issue once HR-1
// mutation routes exist and start calling it.

const sqlMock = vi.fn(async () => []);
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const { logHrEvent } = await import('@/lib/hr/auditLog');

function sqlCallText(i: number): string {
  return (sqlMock.mock.calls[i] as unknown as [string[]])[0].join('');
}
function sqlCallArgs(i: number): unknown[] {
  return (sqlMock.mock.calls[i] as unknown as [string[], ...unknown[]]).slice(1);
}

beforeEach(() => {
  sqlMock.mockClear();
});

describe('logHrEvent — correct insert shape', () => {
  it('inserts into audit_logs with the expected columns', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      { action: 'hr_person.created', resourceType: 'hr_person', resourceId: 'person-1', afterState: { full_name: 'Jane' } },
    );

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const text = sqlCallText(0);
    expect(text).toContain('INSERT INTO audit_logs');
    expect(text).toContain('organisation_id');
    expect(text).toContain('user_id');
    expect(text).toContain('resource_type');
    expect(text).toContain('resource_id');
    expect(text).toContain('before_state');
    expect(text).toContain('after_state');
    expect(text).toContain('ip_address');
    expect(text).toContain('user_agent');
  });

  it('carries the correct organisation id and actor id as bound parameters', async () => {
    await logHrEvent(
      { organisationId: 'org-42', userId: 'user-99' },
      { action: 'hr_person.created', resourceType: 'hr_person', resourceId: 'person-1' },
    );

    const args = sqlCallArgs(0);
    expect(args).toContain('org-42');
    expect(args).toContain('user-99');
  });

  it('carries the correct action / resource_type / resource_id', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      { action: 'hr_person.employment_status_change', resourceType: 'hr_person', resourceId: 'person-7' },
    );

    const args = sqlCallArgs(0);
    expect(args).toContain('hr_person.employment_status_change');
    expect(args).toContain('hr_person');
    expect(args).toContain('person-7');
  });

  it('serializes before_state/after_state as JSON', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated', resourceType: 'hr_person', resourceId: 'person-1',
        beforeState: { team_id: 'team-a' }, afterState: { team_id: 'team-b' },
      },
    );

    const args = sqlCallArgs(0);
    expect(args).toContain(JSON.stringify({ team_id: 'team-a' }));
    expect(args).toContain(JSON.stringify({ team_id: 'team-b' }));
  });

  it('null before_state/after_state are passed through as null, not the string "null"', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      { action: 'hr_person.created', resourceType: 'hr_person', resourceId: 'person-1' },
    );

    const args = sqlCallArgs(0);
    expect(args).toContain(null);
    expect(args).not.toContain('null');
  });

  it('a null userId (system-initiated event) is accepted and passed through as null', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: null },
      { action: 'hr_person.employment_status_change', resourceType: 'hr_person', resourceId: 'person-1' },
    );

    const args = sqlCallArgs(0);
    expect(args).toContain(null);
  });
});

describe('logHrEvent — optional request metadata propagation', () => {
  it('propagates ipAddress and userAgent when provided', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1', ipAddress: '203.0.113.7', userAgent: 'test-agent/1.0' },
      { action: 'hr_document.access', resourceType: 'hr_document', resourceId: 'doc-1' },
    );

    const args = sqlCallArgs(0);
    expect(args).toContain('203.0.113.7');
    expect(args).toContain('test-agent/1.0');
  });

  it('omitted ipAddress/userAgent are passed through as null, not undefined or a placeholder string', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      { action: 'hr_document.access', resourceType: 'hr_document', resourceId: 'doc-1' },
    );

    const args = sqlCallArgs(0);
    expect(args).not.toContain(undefined);
    expect(args).not.toContain('unknown');
  });
});

describe('logHrEvent — redaction of disallowed sensitive fields', () => {
  it('redacts a forbidden key present on afterState rather than writing its real value', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.created', resourceType: 'hr_person', resourceId: 'person-1',
        afterState: { full_name: 'Jane', password_hash: 'sensitive-hash-value' },
      },
    );

    const args = sqlCallArgs(0);
    const afterJson = args.find(a => typeof a === 'string' && a.includes('full_name')) as string;
    expect(afterJson).toBeDefined();
    expect(afterJson).not.toContain('sensitive-hash-value');
    expect(afterJson).toContain('[redacted]');
  });

  it('redacts forbidden keys on beforeState too', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated', resourceType: 'hr_person', resourceId: 'person-1',
        beforeState: { bank_account_number: '123456789' }, afterState: { bank_account_number: '987654321' },
      },
    );

    const args = sqlCallArgs(0);
    const jsonArgs = args.filter((a): a is string => typeof a === 'string' && a.startsWith('{'));
    for (const j of jsonArgs) {
      expect(j).not.toContain('123456789');
      expect(j).not.toContain('987654321');
      expect(j).toContain('[redacted]');
    }
  });

  it('does not redact ordinary, non-sensitive keys', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      { action: 'hr_person.updated', resourceType: 'hr_person', resourceId: 'person-1', afterState: { team_id: 'team-b' } },
    );

    const args = sqlCallArgs(0);
    expect(args).toContain(JSON.stringify({ team_id: 'team-b' }));
  });

  // HR-1 addition — work_email/work_phone previously wrote their raw old
  // and new values into before_state/after_state whenever changed (PATCH
  // /api/hr/people/[id] builds these as a plain field-diff, with no
  // per-field redaction of its own). Fixed by adding both to this file's
  // own FORBIDDEN_STATE_KEYS, the single choke point every HR mutation
  // route already calls through.
  it('redacts work_email on both beforeState and afterState', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated', resourceType: 'hr_person', resourceId: 'person-1',
        beforeState: { work_email: 'old@example.com' }, afterState: { work_email: 'new@example.com' },
      },
    );

    const args = sqlCallArgs(0);
    const jsonArgs = args.filter((a): a is string => typeof a === 'string' && a.startsWith('{'));
    expect(jsonArgs.length).toBeGreaterThan(0);
    for (const j of jsonArgs) {
      expect(j).not.toContain('old@example.com');
      expect(j).not.toContain('new@example.com');
      expect(j).toContain('[redacted]');
    }
  });

  it('redacts work_phone on both beforeState and afterState', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated', resourceType: 'hr_person', resourceId: 'person-1',
        beforeState: { work_phone: '555-0100' }, afterState: { work_phone: '555-0199' },
      },
    );

    const args = sqlCallArgs(0);
    const jsonArgs = args.filter((a): a is string => typeof a === 'string' && a.startsWith('{'));
    expect(jsonArgs.length).toBeGreaterThan(0);
    for (const j of jsonArgs) {
      expect(j).not.toContain('555-0100');
      expect(j).not.toContain('555-0199');
      expect(j).toContain('[redacted]');
    }
  });

  it('redacting work_email does not suppress another real, non-sensitive field changed in the same call', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated', resourceType: 'hr_person', resourceId: 'person-1',
        afterState: { job_title: 'Engineer', work_email: 'new@example.com' },
      },
    );

    const args = sqlCallArgs(0);
    const afterJson = args.find(a => typeof a === 'string' && a.includes('job_title')) as string;
    expect(afterJson).toBeDefined();
    expect(afterJson).toContain('Engineer');
    expect(afterJson).not.toContain('new@example.com');
    expect(afterJson).toContain('[redacted]');
  });
});

describe('logHrEvent — failure semantics', () => {
  it('a write failure is caught and does not propagate to the caller (best-effort, matching ADR-0003 §11)', async () => {
    sqlMock.mockRejectedValueOnce(new Error('connection reset'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      logHrEvent(
        { organisationId: 'org-1', userId: 'user-1' },
        { action: 'hr_person.created', resourceType: 'hr_person', resourceId: 'person-1' },
      ),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('lib/hr/auditLog.ts source — no competing audit mechanism', () => {
  function read(relPath: string): string {
    return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
  }

  it('never writes to organiser_activity or any table other than audit_logs', () => {
    // The file's own header comment names organiser_activity by name (to
    // document why it deliberately is NOT used) — checking for an actual
    // SQL statement against it, not the bare word, is what proves no
    // competing mechanism was wired in.
    const src = read('lib/hr/auditLog.ts');
    expect(src).not.toMatch(/(INSERT INTO|UPDATE|FROM)\s+organiser_activity/i);
    expect(src).toContain('INSERT INTO audit_logs');
    expect((src.match(/INSERT INTO \w+/g) ?? [])).toEqual(['INSERT INTO audit_logs']);
  });

  it('imports the shared lib/db sql client, not a second database connection', () => {
    const src = read('lib/hr/auditLog.ts');
    expect(src).toContain("from '@/lib/db'");
  });
});


describe('logHrEvent — fail-closed People and Teams audit projection', () => {
  function jsonStates(): Record<string, unknown>[] {
    return sqlCallArgs(0)
      .filter((a): a is string => typeof a === 'string' && a.startsWith('{'))
      .map(a => JSON.parse(a) as Record<string, unknown>);
  }

  it('hr_person allows approved employment fields and ID-only relationships', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated',
        resourceType: 'hr_person',
        resourceId: 'person-1',
        afterState: {
          job_title: 'Operations Manager',
          worker_type: 'employee',
          employment_status: 'active',
          start_date: '2026-09-01',
          end_date: null,
          linked_user_id: 'user-2',
          team_id: 'team-1',
          manager_person_id: 'person-2',
        },
      },
    );

    expect(jsonStates()).toContainEqual({
      job_title: 'Operations Manager',
      worker_type: 'employee',
      employment_status: 'active',
      start_date: '2026-09-01',
      end_date: null,
      linked_user_id: 'user-2',
      team_id: 'team-1',
      manager_person_id: 'person-2',
    });
  });

  it('hr_person redacts direct identity/contact values but preserves the changed keys', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated',
        resourceType: 'hr_person',
        resourceId: 'person-1',
        beforeState: {
          first_name: 'Alex',
          last_name: 'Example',
          preferred_name: 'Al',
          work_email: 'alex@example.com',
          work_phone: '0400000000',
        },
        afterState: {
          first_name: 'Jordan',
          last_name: 'Example',
          preferred_name: 'J',
          work_email: 'jordan@example.com',
          work_phone: '0411111111',
        },
      },
    );

    const states = jsonStates();
    expect(states).toHaveLength(2);
    for (const state of states) {
      expect(state).toEqual({
        first_name: '[redacted]',
        last_name: '[redacted]',
        preferred_name: '[redacted]',
        work_email: '[redacted]',
        work_phone: '[redacted]',
      });
    }
  });

  it('hr_person omits duplicate audit metadata fields', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated',
        resourceType: 'hr_person',
        resourceId: 'person-1',
        afterState: {
          id: 'person-1',
          organisation_id: 'org-1',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
          job_title: 'Coordinator',
        },
      },
    );

    expect(jsonStates()).toContainEqual({ job_title: 'Coordinator' });
  });

  it('hr_person fails closed for an unclassified future field', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated',
        resourceType: 'hr_person',
        resourceId: 'person-1',
        afterState: {
          job_title: 'Coordinator',
          future_sensitive_field: 'must-never-leak',
        },
      },
    );

    const state = jsonStates()[0];
    expect(state).toEqual({
      job_title: 'Coordinator',
      future_sensitive_field: '[redacted]',
    });
    expect(JSON.stringify(state)).not.toContain('must-never-leak');
  });

  it('hr_person ID-only fields fail closed when a caller supplies a non-primitive object', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated',
        resourceType: 'hr_person',
        resourceId: 'person-1',
        afterState: {
          manager_person_id: { id: 'person-2', name: 'Sensitive Manager Name' },
        },
      },
    );

    expect(jsonStates()).toContainEqual({ manager_person_id: '[redacted]' });
  });

  it('hr_team allows name/archive lifecycle, keeps manager as ID-only, and redacts description', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_team.updated',
        resourceType: 'hr_team',
        resourceId: 'team-1',
        afterState: {
          name: 'Operations North',
          archived_at: null,
          manager_person_id: 'person-2',
          description: 'Contains free-text HR commentary',
        },
      },
    );

    expect(jsonStates()).toContainEqual({
      name: 'Operations North',
      archived_at: null,
      manager_person_id: 'person-2',
      description: '[redacted]',
    });
  });

  it('hr_team fails closed for any unclassified future field', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_team.updated',
        resourceType: 'hr_team',
        resourceId: 'team-1',
        afterState: { future_team_notes: 'private free text' },
      },
    );

    expect(jsonStates()).toContainEqual({ future_team_notes: '[redacted]' });
  });

  it('an all-omitted People snapshot becomes null rather than an empty JSON object', async () => {
    await logHrEvent(
      { organisationId: 'org-1', userId: 'user-1' },
      {
        action: 'hr_person.updated',
        resourceType: 'hr_person',
        resourceId: 'person-1',
        afterState: {
          id: 'person-1',
          organisation_id: 'org-1',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        },
      },
    );

    expect(sqlCallArgs(0)).toContain(null);
  });
});

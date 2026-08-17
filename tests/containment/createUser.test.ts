import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionMock = vi.fn();
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return { ...actual, getSession: (...args: unknown[]) => getSessionMock(...args) };
});

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const { createUser } = await import('@/app/actions/users');

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const validFields = { name: 'Luke', username: 'luke', password: 'longenoughpw', role: 'manager', orgId: 'org-ld-tennis' };

describe('createUser server action — super_admin-only guard', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    sqlMock.mockReset();
  });

  it('rejects a caller with no session', async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(createUser(undefined, formData(validFields))).rejects.toThrow('Unauthorized');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects an authenticated non-super_admin caller (manager)', async () => {
    getSessionMock.mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager', name: 'Not James' });
    await expect(createUser(undefined, formData(validFields))).rejects.toThrow('Unauthorized');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('allows a super_admin to create a user and persists the chosen role and organisation', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'bb-org', role: 'super_admin', name: 'James' });
    sqlMock
      .mockResolvedValueOnce([]) // duplicate-username check: none found
      .mockResolvedValueOnce([]); // INSERT

    const result = await createUser(undefined, formData(validFields));
    expect(result).toEqual({ success: 'User "Luke" created.' });

    const insertCallArgs = sqlMock.mock.calls[1];
    expect(insertCallArgs).toContain('MANAGER');
    expect(insertCallArgs).toContain('org-ld-tennis');
  });

  it('rejects a duplicate username without inserting', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'bb-org', role: 'super_admin', name: 'James' });
    sqlMock.mockResolvedValueOnce([{ id: 'existing-user' }]);

    const result = await createUser(undefined, formData(validFields));
    expect(result).toEqual({ error: 'Username already taken.' });
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a password under 8 characters without inserting', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'bb-org', role: 'super_admin', name: 'James' });

    const result = await createUser(undefined, formData({ ...validFields, password: 'short1' }));
    expect(result).toEqual({ error: 'Password must be at least 8 characters.' });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('stores a bcrypt hash, never the plaintext password', async () => {
    getSessionMock.mockResolvedValue({ userId: 'admin1', organisationId: 'bb-org', role: 'super_admin', name: 'James' });
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await createUser(undefined, formData(validFields));

    const insertCallArgs = sqlMock.mock.calls[1];
    const storedHash = insertCallArgs.find((v: unknown) => typeof v === 'string' && v.startsWith('$2'));
    expect(storedHash).toBeDefined();
    expect(storedHash).not.toBe(validFields.password);
    expect(insertCallArgs).not.toContain(validFields.password);
  });
});

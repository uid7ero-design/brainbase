import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

function jsonRequest(url: string, body: unknown, method = 'POST'): NextRequest {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const ADMIN = {
  ok: true as const,
  context: {
    session: {
      userId: 'hr-user',
      organisationId: 'org-a',
      homeOrganisationId: 'org-a',
      role: 'admin' as const,
      name: 'HR Admin',
    },
    isHrAdministrator: true,
  },
};

const requireAdminMock = vi.fn();
vi.mock('@/lib/hr/lifecycleTemplateRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/lifecycleTemplateRoute')>();
  return {
    ...actual,
    requireLifecycleTemplateAdmin: (...args: unknown[]) => requireAdminMock(...args),
  };
});

const createTemplateMock = vi.fn();
const createVersionMock = vi.fn();
const activateTemplateMock = vi.fn();
const retireTemplateMock = vi.fn();
vi.mock('@/lib/hr/lifecycleTemplateMutations', () => ({
  createLifecycleTemplate: (...args: unknown[]) => createTemplateMock(...args),
  createLifecycleTemplateVersion: (...args: unknown[]) => createVersionMock(...args),
  activateLifecycleTemplate: (...args: unknown[]) => activateTemplateMock(...args),
  retireLifecycleTemplate: (...args: unknown[]) => retireTemplateMock(...args),
}));

const listTemplatesMock = vi.fn();
const getTemplateMock = vi.fn();
vi.mock('@/lib/hr/lifecycleTemplateQueries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/lifecycleTemplateQueries')>();
  return {
    ...actual,
    listLifecycleTemplates: (...args: unknown[]) => listTemplatesMock(...args),
    getLifecycleTemplate: (...args: unknown[]) => getTemplateMock(...args),
  };
});

const collectionRoute = await import('@/app/api/hr/lifecycle/templates/route');
const detailRoute = await import('@/app/api/hr/lifecycle/templates/[id]/route');
const versionRoute = await import('@/app/api/hr/lifecycle/templates/[id]/versions/route');
const activateRoute = await import('@/app/api/hr/lifecycle/templates/[id]/activate/route');
const retireRoute = await import('@/app/api/hr/lifecycle/templates/[id]/retire/route');

const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const NEW_TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';

function templateView(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    organisationId: 'org-a',
    templateKey: 'standard-onboarding',
    versionNumber: 1,
    lifecycleType: 'onboarding' as const,
    name: 'Standard onboarding',
    description: null,
    status: 'DRAFT' as const,
    activatedAt: null,
    retiredAt: null,
    createdBy: 'hr-user',
    createdAt: '2026-09-26T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z',
    tasks: [],
    ...overrides,
  };
}

const validCreateBody = {
  template_key: 'standard-onboarding',
  lifecycle_type: 'onboarding',
  name: 'Standard onboarding',
  description: null,
  tasks: [{
    sequence: 1,
    title: 'Complete profile',
    description: null,
    responsibility_type: 'EMPLOYEE',
    due_offset_days: -7,
    requires_approval: false,
    approval_type: 'NONE',
    employee_visible: true,
    manager_visible: false,
    internal_only: false,
  }],
};

beforeEach(() => {
  requireAdminMock.mockReset();
  createTemplateMock.mockReset();
  createVersionMock.mockReset();
  activateTemplateMock.mockReset();
  retireTemplateMock.mockReset();
  listTemplatesMock.mockReset();
  getTemplateMock.mockReset();
  requireAdminMock.mockResolvedValue(ADMIN);
});

describe('HR-7C lifecycle template routes', () => {
  it('creates a DRAFT template and derives version/status server-side', async () => {
    createTemplateMock.mockResolvedValue({
      outcome: 'created',
      templateId: TEMPLATE_ID,
      versionNumber: 1,
    });
    getTemplateMock.mockResolvedValue(templateView());

    const res = await collectionRoute.POST(
      jsonRequest('http://localhost/api/hr/lifecycle/templates', validCreateBody),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.template).toEqual(expect.objectContaining({
      id: TEMPLATE_ID,
      template_key: 'standard-onboarding',
      version_number: 1,
      status: 'DRAFT',
    }));
    expect(createTemplateMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({
        organisationId: 'org-a',
        userId: 'hr-user',
      }),
      input: expect.objectContaining({
        templateKey: 'standard-onboarding',
        lifecycleType: 'onboarding',
      }),
    }));
  });

  it('rejects server-managed template fields', async () => {
    const res = await collectionRoute.POST(
      jsonRequest('http://localhost/api/hr/lifecycle/templates', {
        ...validCreateBody,
        status: 'ACTIVE',
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/server-managed field: status/i);
    expect(createTemplateMock).not.toHaveBeenCalled();
  });

  it('rejects incoherent approval configuration before mutation', async () => {
    const res = await collectionRoute.POST(
      jsonRequest('http://localhost/api/hr/lifecycle/templates', {
        ...validCreateBody,
        tasks: [{
          ...validCreateBody.tasks[0],
          requires_approval: true,
          approval_type: 'NONE',
        }],
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/requiring approval/i);
    expect(createTemplateMock).not.toHaveBeenCalled();
  });

  it('maps an existing template family to deterministic 409', async () => {
    createTemplateMock.mockResolvedValue({ outcome: 'family_exists' });

    const res = await collectionRoute.POST(
      jsonRequest('http://localhost/api/hr/lifecycle/templates', validCreateBody),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'A lifecycle template family with this template_key already exists.',
      code: 'template_family_exists',
    });
  });

  it('lists templates with active-org filters', async () => {
    listTemplatesMock.mockResolvedValue([templateView({ status: 'ACTIVE', activatedAt: '2026-09-26T13:00:00.000Z' })]);

    const req = new Request(
      'http://localhost/api/hr/lifecycle/templates?lifecycle_type=onboarding&status=ACTIVE&template_key=standard-onboarding',
    ) as unknown as NextRequest;
    const res = await collectionRoute.GET(req);

    expect(res.status).toBe(200);
    expect(listTemplatesMock).toHaveBeenCalledWith({
      organisationId: 'org-a',
      lifecycleType: 'onboarding',
      status: 'ACTIVE',
      templateKey: 'standard-onboarding',
    });
  });

  it('creates the next DRAFT version without accepting family identity from the client', async () => {
    createVersionMock.mockResolvedValue({
      outcome: 'created',
      templateId: NEW_TEMPLATE_ID,
      versionNumber: 2,
    });
    getTemplateMock.mockResolvedValue(templateView({
      id: NEW_TEMPLATE_ID,
      versionNumber: 2,
    }));

    const versionBody = {
      name: validCreateBody.name,
      description: validCreateBody.description,
      tasks: validCreateBody.tasks,
    };
    const res = await versionRoute.POST(
      jsonRequest('http://localhost/api/hr/lifecycle/templates/x/versions', versionBody),
      { params: Promise.resolve({ id: TEMPLATE_ID }) },
    );

    expect(res.status).toBe(201);
    expect((await res.json()).template.version_number).toBe(2);
    expect(createVersionMock).toHaveBeenCalledWith(expect.objectContaining({
      sourceTemplateId: TEMPLATE_ID,
      input: expect.not.objectContaining({
        templateKey: expect.anything(),
        lifecycleType: expect.anything(),
      }),
    }));
  });

  it('activates a DRAFT version and maps competing ACTIVE version to 409', async () => {
    activateTemplateMock.mockResolvedValue({ outcome: 'active_version_exists' });

    const res = await activateRoute.POST(
      jsonRequest('http://localhost/api/hr/lifecycle/templates/x/activate', {}),
      { params: Promise.resolve({ id: TEMPLATE_ID }) },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Another version of this template is already active.',
      code: 'active_template_exists',
    });
  });

  it('treats already ACTIVE activation as idempotent 200', async () => {
    activateTemplateMock.mockResolvedValue({
      outcome: 'already_active',
      templateId: TEMPLATE_ID,
    });
    getTemplateMock.mockResolvedValue(templateView({
      status: 'ACTIVE',
      activatedAt: '2026-09-26T13:00:00.000Z',
    }));

    const res = await activateRoute.POST(
      jsonRequest('http://localhost/api/hr/lifecycle/templates/x/activate', {}),
      { params: Promise.resolve({ id: TEMPLATE_ID }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).template.status).toBe('ACTIVE');
  });

  it('retires an ACTIVE version and keeps retirement idempotent', async () => {
    retireTemplateMock.mockResolvedValue({
      outcome: 'already_retired',
      templateId: TEMPLATE_ID,
    });
    getTemplateMock.mockResolvedValue(templateView({
      status: 'RETIRED',
      retiredAt: '2026-09-26T14:00:00.000Z',
    }));

    const res = await retireRoute.POST(
      jsonRequest('http://localhost/api/hr/lifecycle/templates/x/retire', {}),
      { params: Promise.resolve({ id: TEMPLATE_ID }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).template.status).toBe('RETIRED');
  });

  it('uses canonical 404 for malformed template ids before reads', async () => {
    const res = await detailRoute.GET(
      new Request('http://localhost/api/hr/lifecycle/templates/bad'),
      { params: Promise.resolve({ id: 'bad-id' }) },
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Lifecycle resource not found.' });
    expect(getTemplateMock).not.toHaveBeenCalled();
  });
});

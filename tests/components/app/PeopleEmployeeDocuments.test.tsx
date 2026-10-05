import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const { default: PersonDrawer } = await import('@/app/people/_components/PersonDrawer');

const PERSON = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  first_name: 'Alex',
  last_name: 'Worker',
  preferred_name: null,
  work_email: 'alex@example.test',
  work_phone: null,
  job_title: 'Operator',
  worker_type: 'employee',
  employment_status: 'active',
  team_id: null,
  manager_person_id: null,
  start_date: '2026-01-01',
  end_date: null,
  linked_user_id: 'user-a',
  team_name: null,
  manager_first_name: null,
  manager_last_name: null,
};

const DOCUMENT = {
  id: 'doc-1',
  document_type: 'policy',
  title: 'Safety policy',
  lifecycle_task_id: null,
  created_at: '2026-10-01T00:00:00.000Z',
  current_version: {
    id: 'version-2',
    version_number: 2,
    expires_at: '2027-10-01',
    created_at: '2026-10-02T00:00:00.000Z',
  },
};

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function assuranceResponse(overrides: Record<string, unknown> = {}) {
  return response({
    assurance: {
      document_version_id: 'version-2',
      capabilities: {
        can_acknowledge: false,
        can_verify: false,
      },
      employee_acknowledgement: {
        acknowledged: true,
        acknowledged_at: '2026-10-03T01:02:03.000Z',
      },
      latest_verification: {
        decision: 'VERIFIED',
        verified_at: '2026-10-03T02:03:04.000Z',
      },
      ...overrides,
    },
  });
}

function renderDrawer() {
  return renderBrainbase(
    <PersonDrawer
      personId={PERSON.id}
      canManage={false}
      onClose={vi.fn()}
      onEdit={vi.fn()}
    />,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HR-7E6C/6D PersonDrawer employee documents', () => {
  it('shows safe document metadata and current-version assurance status', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ capabilities: { can_manage_documents: false }, documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Alex Worker')).toBeTruthy();
    expect(await screen.findByText('Documents')).toBeTruthy();
    expect(screen.getByText('Safety policy')).toBeTruthy();
    expect(screen.getByText('policy · Version 2')).toBeTruthy();
    expect(screen.getByText('Expires 2027-10-01')).toBeTruthy();
    expect(await screen.findByText('Acknowledged 2026-10-03')).toBeTruthy();
    expect(screen.getByText('Verified 2026-10-03')).toBeTruthy();

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('version-2');
    expect(text).not.toContain('storage');
    expect(text).not.toContain('filename');
    expect(text).not.toContain('uploaded');
    expect(text).not.toContain('verified_by');
    expect(text).not.toContain('comment');
  });

  it('shows create controls only when the server document-management capability permits them', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [DOCUMENT],
        });
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByRole('button', { name: 'Add document' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
    expect(screen.getByLabelText('Document type')).toBeTruthy();
    expect(screen.getByLabelText('Title')).toBeTruthy();
    expect(screen.getByLabelText('Expiry date (optional)')).toBeTruthy();
    expect(screen.getByLabelText('File')).toBeTruthy();
  });

  it('creates a document with multipart form data and renders only safe returned fields', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents') && init?.method === 'POST') {
        return response({
          document: {
            id: 'doc-2',
            person_id: PERSON.id,
            document_type: 'licence',
            title: 'Forklift licence',
            lifecycle_task_id: null,
            deleted_at: null,
            created_at: '2026-10-05T07:00:00.000Z',
          },
          version: {
            id: 'version-1',
            document_id: 'doc-2',
            version_number: 1,
            uploaded_by: 'sensitive-user-id',
            original_filename: 'private-name.pdf',
            content_type: 'application/pdf',
            byte_size: 1234,
            expires_at: '2027-10-05',
            is_current: true,
            created_at: '2026-10-05T07:00:00.000Z',
          },
        }, 201);
      }
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [],
        });
      }
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: { can_acknowledge: false, can_verify: true },
          employee_acknowledgement: { acknowledged: false, acknowledged_at: null },
          latest_verification: null,
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Add document' }));
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'licence' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Forklift licence' } });
    fireEvent.change(screen.getByLabelText('Expiry date (optional)'), { target: { value: '2027-10-05' } });
    const file = new File(['pdf'], 'forklift.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));

    expect(await screen.findByText('Forklift licence')).toBeTruthy();
    expect(screen.getByText('licence · Version 1')).toBeTruthy();
    expect(screen.getByText('Expires 2027-10-05')).toBeTruthy();

    const postCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith('/documents') && init?.method === 'POST'
    );
    expect(postCall).toBeTruthy();
    const body = postCall?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('document_type')).toBe('licence');
    expect((body as FormData).get('title')).toBe('Forklift licence');
    expect((body as FormData).get('expires_at')).toBe('2027-10-05');
    expect((body as FormData).get('lifecycle_task_id')).toBeNull();
    expect((body as FormData).get('file')).toBe(file);

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('sensitive-user-id');
    expect(text).not.toContain('private-name.pdf');
  });

  it('loads only safe lifecycle task fields for optional document linking', async () => {
    const workflowId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const taskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [],
        });
      }
      if (url === `/api/hr/lifecycle/workflows?person_id=${encodeURIComponent(PERSON.id)}`) {
        return response({
          workflows: [{
            id: workflowId,
            person_id: PERSON.id,
            lifecycle_type: 'onboarding',
            status: 'ACTIVE',
            started_by: 'sensitive-starter-id',
          }],
        });
      }
      if (url === `/api/hr/lifecycle/workflows/${workflowId}`) {
        return response({
          workflow: {
            id: workflowId,
            person_id: PERSON.id,
            lifecycle_type: 'onboarding',
          },
          tasks: [{
            id: taskId,
            title: 'Provide forklift licence',
            status: 'IN_PROGRESS',
            description: 'sensitive internal task description',
            assigned_user_id: 'sensitive-assignee-id',
            internal_only: true,
          }],
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Add document' }));

    const selector = await screen.findByLabelText('Lifecycle task (optional)');
    expect(selector).toBeTruthy();
    expect(screen.getByRole('option', {
      name: 'Provide forklift licence · onboarding · IN_PROGRESS',
    })).toBeTruthy();

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('sensitive-starter-id');
    expect(text).not.toContain('sensitive internal task description');
    expect(text).not.toContain('sensitive-assignee-id');
  });

  it('includes a selected lifecycle task in the document multipart request', async () => {
    const workflowId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const taskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents') && init?.method === 'POST') {
        return response({
          document: {
            id: 'doc-linked',
            person_id: PERSON.id,
            document_type: 'licence',
            title: 'Linked forklift licence',
            lifecycle_task_id: taskId,
            deleted_at: null,
            created_at: '2026-10-05T09:00:00.000Z',
          },
          version: {
            id: 'version-linked',
            document_id: 'doc-linked',
            version_number: 1,
            uploaded_by: 'sensitive-uploader-id',
            original_filename: 'private-linked.pdf',
            content_type: 'application/pdf',
            byte_size: 1234,
            expires_at: null,
            is_current: true,
            created_at: '2026-10-05T09:00:00.000Z',
          },
        }, 201);
      }
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [],
        });
      }
      if (url === `/api/hr/lifecycle/workflows?person_id=${encodeURIComponent(PERSON.id)}`) {
        return response({
          workflows: [{
            id: workflowId,
            lifecycle_type: 'onboarding',
          }],
        });
      }
      if (url === `/api/hr/lifecycle/workflows/${workflowId}`) {
        return response({
          tasks: [{
            id: taskId,
            title: 'Provide forklift licence',
            status: 'IN_PROGRESS',
          }],
        });
      }
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: { can_acknowledge: false, can_verify: true },
          employee_acknowledgement: { acknowledged: false, acknowledged_at: null },
          latest_verification: null,
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Add document' }));
    const selector = await screen.findByLabelText('Lifecycle task (optional)');
    fireEvent.change(selector, { target: { value: taskId } });
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'licence' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Linked forklift licence' } });
    const file = new File(['pdf'], 'linked.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));

    expect(await screen.findByText('Linked forklift licence')).toBeTruthy();

    const postCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith('/documents') && init?.method === 'POST'
    );
    const body = postCall?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('lifecycle_task_id')).toBe(taskId);

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('sensitive-uploader-id');
    expect(text).not.toContain('private-linked.pdf');
  });

  it('keeps document upload available when lifecycle tasks cannot be loaded', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents') && init?.method === 'POST') {
        return response({
          document: {
            id: 'doc-unlinked',
            person_id: PERSON.id,
            document_type: 'policy',
            title: 'Unlinked policy',
            lifecycle_task_id: null,
            deleted_at: null,
            created_at: '2026-10-05T09:15:00.000Z',
          },
          version: {
            id: 'version-unlinked',
            document_id: 'doc-unlinked',
            version_number: 1,
            uploaded_by: 'sensitive-uploader-id',
            original_filename: 'private-unlinked.pdf',
            content_type: 'application/pdf',
            byte_size: 1234,
            expires_at: null,
            is_current: true,
            created_at: '2026-10-05T09:15:00.000Z',
          },
        }, 201);
      }
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [],
        });
      }
      if (url.startsWith('/api/hr/lifecycle/workflows?person_id=')) {
        return response({ error: 'sensitive lifecycle database detail' }, 500);
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Add document' }));

    expect(await screen.findByText(
      'Lifecycle tasks unavailable. You can upload without linking a task.',
    )).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'policy' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unlinked policy' } });
    const file = new File(['pdf'], 'unlinked.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));

    expect(await screen.findByText('Unlinked policy')).toBeTruthy();

    const postCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith('/documents') && init?.method === 'POST'
    );
    const body = postCall?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('lifecycle_task_id')).toBeNull();
    expect(document.body.textContent).not.toContain('sensitive lifecycle database detail');
  });

  it('hides create controls when document management capability is false', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: false },
          documents: [DOCUMENT],
        });
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Documents')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add document' })).toBeNull();
  });

  it('shows only a generic create failure and keeps the form available', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents') && init?.method === 'POST') {
        return response({ error: 'sensitive upload detail' }, 500);
      }
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [],
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Add document' }));
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'policy' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Safety policy' } });
    const file = new File(['pdf'], 'safety.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));

    expect(await screen.findByText('Could not upload document.')).toBeTruthy();
    expect(screen.getByLabelText('Document type')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive upload detail');
  });

  it('shows add-version controls only when document management capability permits them', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [DOCUMENT],
        });
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    const addVersion = await screen.findByRole('button', { name: 'Add version' });
    fireEvent.click(addVersion);

    expect(screen.getByLabelText('New version expiry (optional)')).toBeTruthy();
    expect(screen.getByLabelText('New version file')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload version' })).toBeTruthy();
  });

  it('adds a new immutable version and reloads assurance for the new current version', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [DOCUMENT],
        });
      }

      if (
        url.endsWith(`/documents/${DOCUMENT.id}/versions`)
        && init?.method === 'POST'
      ) {
        return response({
          version: {
            id: 'version-3',
            document_id: DOCUMENT.id,
            version_number: 3,
            uploaded_by: 'sensitive-uploader-id',
            original_filename: 'private-renewal.pdf',
            content_type: 'application/pdf',
            byte_size: 4567,
            expires_at: '2028-10-05',
            is_current: true,
            created_at: '2026-10-05T08:00:00.000Z',
          },
        }, 201);
      }

      if (url.endsWith('/version-3/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: false,
            can_verify: true,
          },
          employee_acknowledgement: {
            acknowledged: false,
            acknowledged_at: null,
          },
          latest_verification: null,
        });
      }

      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Add version' }));
    fireEvent.change(screen.getByLabelText('New version expiry (optional)'), {
      target: { value: '2028-10-05' },
    });
    const file = new File(['renewed'], 'renewal.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('New version file'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload version' }));

    expect(await screen.findByText('policy · Version 3')).toBeTruthy();
    expect(screen.getByText('Expires 2028-10-05')).toBeTruthy();
    expect(await screen.findByText('Not acknowledged')).toBeTruthy();
    expect(screen.getByText('Not verified')).toBeTruthy();

    const postCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith(`/documents/${DOCUMENT.id}/versions`)
      && init?.method === 'POST'
    );
    expect(postCall).toBeTruthy();
    const body = postCall?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('expires_at')).toBe('2028-10-05');
    expect((body as FormData).get('file')).toBe(file);

    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith(`/documents/${DOCUMENT.id}/versions/version-3/assurance`)
    )).toBe(true);

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('sensitive-uploader-id');
    expect(text).not.toContain('private-renewal.pdf');
    expect(text).not.toContain('version-3');
  });

  it('hides add-version controls when document management capability is false', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: false },
          documents: [DOCUMENT],
        });
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Safety policy')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add version' })).toBeNull();
  });

  it('shows only a generic add-version failure and keeps the version form open', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [DOCUMENT],
        });
      }
      if (
        url.endsWith(`/documents/${DOCUMENT.id}/versions`)
        && init?.method === 'POST'
      ) {
        return response({ error: 'sensitive version upload detail' }, 500);
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Add version' }));
    const file = new File(['renewed'], 'renewal.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('New version file'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload version' }));

    expect(await screen.findByText('Could not upload document version.')).toBeTruthy();
    expect(screen.getByLabelText('New version file')).toBeTruthy();
    expect(screen.getByText('policy · Version 2')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive version upload detail');
  });

  it('offers the current version download to an authorised viewer without management access', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: false },
          documents: [DOCUMENT],
        });
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    const link = await screen.findByRole('link', { name: 'Download' });
    expect(link.getAttribute('href')).toBe(
      `/api/hr/people/${PERSON.id}/documents/${DOCUMENT.id}/versions/${DOCUMENT.current_version.id}`,
    );
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add version' })).toBeNull();
  });

  it('does not show a download action when a document has no current version', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: false },
          documents: [{ ...DOCUMENT, current_version: null }],
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Safety policy')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/assurance'))).toBe(false);
  });

  it('requires explicit confirmation before deleting a managed employee document', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [DOCUMENT],
        });
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(screen.getByText('Delete this document?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete this document?')).toBeNull();
    expect(screen.getByText('Safety policy')).toBeTruthy();
  });

  it('soft-deletes a managed employee document and removes it from the live list', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [DOCUMENT],
        });
      }
      if (url.endsWith(`/documents/${DOCUMENT.id}`) && init?.method === 'DELETE') {
        return response({
          deleted: true,
          document_id: DOCUMENT.id,
          deleted_at: '2026-10-05T08:30:00.000Z',
        });
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => {
      expect(screen.queryByText('Safety policy')).toBeNull();
    });
    expect(screen.getByText('No documents')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/hr/people/${PERSON.id}/documents/${DOCUMENT.id}`,
      { method: 'DELETE' },
    );

    const text = document.body.textContent ?? '';
    expect(text).not.toContain(DOCUMENT.id);
    expect(text).not.toContain('2026-10-05T08:30:00.000Z');
  });

  it('hides delete controls when document management capability is false', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: false },
          documents: [DOCUMENT],
        });
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Safety policy')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('shows only a generic delete failure and preserves the live document', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({
          capabilities: { can_manage_documents: true },
          documents: [DOCUMENT],
        });
      }
      if (url.endsWith(`/documents/${DOCUMENT.id}`) && init?.method === 'DELETE') {
        return response({ error: 'sensitive delete detail' }, 500);
      }
      if (url.endsWith('/assurance')) return assuranceResponse();
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(await screen.findByText('Could not delete document.')).toBeTruthy();
    expect(screen.getByText('Safety policy')).toBeTruthy();
    expect(screen.getByText('Delete this document?')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive delete detail');
  });

  it('lets the linked employee acknowledge when the assurance capability permits it', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: true,
            can_verify: false,
          },
          employee_acknowledgement: {
            acknowledged: false,
            acknowledged_at: null,
          },
          latest_verification: null,
        });
      }
      if (url.endsWith('/acknowledgements') && init?.method === 'POST') {
        return response({
          acknowledgement: {
            id: 'ack-1',
            document_version_id: 'version-2',
            acknowledged_by: 'user-a',
            acknowledged_at: '2026-10-05T04:05:06.000Z',
          },
        }, 201);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    const button = await screen.findByRole('button', { name: 'Acknowledge' });
    fireEvent.click(button);

    expect(await screen.findByText('Acknowledged 2026-10-05')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/hr/people/${PERSON.id}/documents/${DOCUMENT.id}/versions/${DOCUMENT.current_version.id}/acknowledgements`,
      { method: 'POST' },
    );
  });

  it('keeps document details visible and shows only a generic acknowledgement failure', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: true,
            can_verify: false,
          },
          employee_acknowledgement: {
            acknowledged: false,
            acknowledged_at: null,
          },
        });
      }
      if (url.endsWith('/acknowledgements') && init?.method === 'POST') {
        return response({ error: 'sensitive mutation detail' }, 500);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));

    expect(await screen.findByText('Could not acknowledge document.')).toBeTruthy();
    expect(screen.getByText('Safety policy')).toBeTruthy();
    expect(screen.getByText('Not acknowledged')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive mutation detail');
  });

  it('does not show acknowledgement controls when the server capability denies them', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: false,
            can_verify: true,
          },
          employee_acknowledgement: {
            acknowledged: false,
            acknowledged_at: null,
          },
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Not acknowledged')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });

  it('lets an HR administrator verify when the assurance capability permits it', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: false,
            can_verify: true,
          },
          latest_verification: null,
        });
      }
      if (url.endsWith('/verifications') && init?.method === 'POST') {
        return response({
          verification: {
            id: 'verification-1',
            document_version_id: 'version-2',
            verified_by: 'hr-user',
            decision: 'VERIFIED',
            comment: 'server-only detail',
            verified_at: '2026-10-05T05:06:07.000Z',
          },
        }, 201);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Verified 2026-10-05')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/hr/people/${PERSON.id}/documents/${DOCUMENT.id}/versions/${DOCUMENT.current_version.id}/verifications`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'VERIFIED' }),
      },
    );
    expect(document.body.textContent).not.toContain('hr-user');
    expect(document.body.textContent).not.toContain('server-only detail');
  });

  it('lets an HR administrator reject and updates the latest verification status', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: false,
            can_verify: true,
          },
          latest_verification: null,
        });
      }
      if (url.endsWith('/verifications') && init?.method === 'POST') {
        return response({
          verification: {
            id: 'verification-2',
            document_version_id: 'version-2',
            verified_by: 'hr-user',
            decision: 'REJECTED',
            comment: null,
            verified_at: '2026-10-05T06:07:08.000Z',
          },
        }, 201);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));

    expect(await screen.findByText('Rejected 2026-10-05')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/hr/people/${PERSON.id}/documents/${DOCUMENT.id}/versions/${DOCUMENT.current_version.id}/verifications`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'REJECTED' }),
      }),
    );
  });

  it('does not show verification controls when the server capability denies them', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: true,
            can_verify: false,
          },
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Verified 2026-10-03')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('shows only a generic verification failure and preserves current status', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          capabilities: {
            can_acknowledge: false,
            can_verify: true,
          },
          latest_verification: null,
        });
      }
      if (url.endsWith('/verifications') && init?.method === 'POST') {
        return response({ error: 'sensitive verification detail' }, 500);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Could not record verification.')).toBeTruthy();
    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive verification detail');
  });

  it('shows explicit not-acknowledged and not-verified states', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          employee_acknowledgement: {
            acknowledged: false,
            acknowledged_at: null,
          },
          latest_verification: null,
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Not acknowledged')).toBeTruthy();
    expect(screen.getByText('Not verified')).toBeTruthy();
  });

  it('shows a rejected latest verification without exposing verifier identity or comments', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return assuranceResponse({
          latest_verification: {
            decision: 'REJECTED',
            verified_at: '2026-10-04T05:06:07.000Z',
          },
        });
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Rejected 2026-10-04')).toBeTruthy();
    expect(document.body.textContent).not.toContain('comment');
    expect(document.body.textContent).not.toContain('verified_by');
  });

  it('keeps document metadata visible when assurance status cannot be loaded', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [DOCUMENT] });
      if (url.endsWith('/assurance')) {
        return response({ error: 'sensitive assurance detail' }, 500);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Safety policy')).toBeTruthy();
    expect(await screen.findByText('Assurance status unavailable.')).toBeTruthy();
    expect(screen.queryByText('sensitive assurance detail')).toBeNull();
  });

  it('shows an authorised empty state when the documents API returns an empty list', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return response({ documents: [] });
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Documents')).toBeTruthy();
    expect(screen.getByText('No documents')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/assurance'))).toBe(false);
  });

  it('hides the entire Documents section when the documents API returns 404', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({ error: 'Employee document not found.' }, 404);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Alex Worker')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText('Loading documents…')).toBeNull();
    });
    expect(screen.queryByText('Documents')).toBeNull();
    expect(screen.queryByText('No documents')).toBeNull();
    expect(screen.queryByText(/Employee document not found/i)).toBeNull();
  });

  it('shows a generic inline error for an authorised documents fetch failure', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) {
        return response({ error: 'sensitive database detail' }, 500);
      }
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Documents')).toBeTruthy();
    expect(screen.getByText('Could not load documents.')).toBeTruthy();
    expect(screen.queryByText('sensitive database detail')).toBeNull();
  });

  it('does not let a document-list failure prevent the person profile from rendering', async () => {
    fetchMock.mockImplementation(input => {
      const url = String(input);
      if (url.endsWith('/documents')) return Promise.reject(new Error('network down'));
      return response({ person: PERSON });
    });

    renderDrawer();

    expect(await screen.findByText('Alex Worker')).toBeTruthy();
    expect(await screen.findByText('Could not load documents.')).toBeTruthy();
  });
});

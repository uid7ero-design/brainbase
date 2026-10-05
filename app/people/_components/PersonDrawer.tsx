'use client';
import { useEffect, useState } from 'react';
import SlidePanel from './SlidePanel';
import { StateMessage, buttonProps } from '@/components/ui/app';

export type PersonDetail = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name?: string | null;
  work_email?: string | null;
  work_phone?: string | null;
  job_title: string | null;
  worker_type: string;
  employment_status: string;
  team_id?: string | null;
  manager_person_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  linked_user_id?: string | null;
  team_name?: string | null;
  manager_first_name?: string | null;
  manager_last_name?: string | null;
};

type EmployeeDocumentSummary = {
  id: string;
  document_type: string;
  title: string;
  lifecycle_task_id: string | null;
  created_at: string;
  current_version: {
    id: string;
    version_number: number;
    expires_at: string | null;
    created_at: string;
  } | null;
};

type DocumentAssurance = {
  capabilities: {
    can_acknowledge: boolean;
    can_verify: boolean;
  };
  employee_acknowledgement: {
    acknowledged: boolean;
    acknowledged_at: string | null;
  };
  latest_verification: {
    decision: 'VERIFIED' | 'REJECTED';
    verified_at: string;
  } | null;
};

type AssuranceState =
  | { state: 'loading' }
  | { state: 'ready'; assurance: DocumentAssurance }
  | { state: 'error' };

type AcknowledgementActionState = 'idle' | 'submitting' | 'error';
type VerificationActionState = 'idle' | 'verifying' | 'rejecting' | 'error';
type DocumentCreateState = 'idle' | 'submitting' | 'error';
type DocumentVersionState = 'idle' | 'submitting' | 'error';
type DocumentDeleteState = 'idle' | 'submitting' | 'error';
type LifecycleTaskOptionsState = 'idle' | 'loading' | 'ready' | 'error';

type LifecycleTaskOption = {
  id: string;
  title: string;
  status: string;
  lifecycle_type: string;
};

type DocumentsState = 'idle' | 'loading' | 'ready' | 'error' | 'hidden';

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export default function PersonDrawer({ personId, canManage, onClose, onEdit }: { personId: string | null; canManage: boolean; onClose: () => void; onEdit: (person: PersonDetail) => void }) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [documents, setDocuments] = useState<EmployeeDocumentSummary[]>([]);
  const [documentsState, setDocumentsState] = useState<DocumentsState>('idle');
  const [assuranceByDocument, setAssuranceByDocument] = useState<Record<string, AssuranceState>>({});
  const [acknowledgementByDocument, setAcknowledgementByDocument] = useState<Record<string, AcknowledgementActionState>>({});
  const [verificationByDocument, setVerificationByDocument] = useState<Record<string, VerificationActionState>>({});
  const [canManageDocuments, setCanManageDocuments] = useState(false);
  const [showCreateDocument, setShowCreateDocument] = useState(false);
  const [newDocumentType, setNewDocumentType] = useState('');
  const [newDocumentTitle, setNewDocumentTitle] = useState('');
  const [newDocumentExpiry, setNewDocumentExpiry] = useState('');
  const [newDocumentFile, setNewDocumentFile] = useState<File | null>(null);
  const [documentCreateState, setDocumentCreateState] = useState<DocumentCreateState>('idle');
  const [versionDocumentId, setVersionDocumentId] = useState<string | null>(null);
  const [newVersionExpiry, setNewVersionExpiry] = useState('');
  const [newVersionFile, setNewVersionFile] = useState<File | null>(null);
  const [documentVersionState, setDocumentVersionState] = useState<DocumentVersionState>('idle');
  const [deleteDocumentId, setDeleteDocumentId] = useState<string | null>(null);
  const [documentDeleteState, setDocumentDeleteState] = useState<DocumentDeleteState>('idle');
  const [lifecycleTaskOptions, setLifecycleTaskOptions] = useState<LifecycleTaskOption[]>([]);
  const [lifecycleTaskOptionsState, setLifecycleTaskOptionsState] = useState<LifecycleTaskOptionsState>('idle');
  const [newDocumentLifecycleTaskId, setNewDocumentLifecycleTaskId] = useState('');

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (!personId) {
        setPerson(null);
        setDocuments([]);
        setDocumentsState('idle');
        setAssuranceByDocument({});
        setAcknowledgementByDocument({});
        setVerificationByDocument({});
        setCanManageDocuments(false);
        setShowCreateDocument(false);
        setDocumentCreateState('idle');
        setVersionDocumentId(null);
        setNewVersionExpiry('');
        setNewVersionFile(null);
        setDocumentVersionState('idle');
        setDeleteDocumentId(null);
        setDocumentDeleteState('idle');
        setLifecycleTaskOptions([]);
        setLifecycleTaskOptionsState('idle');
        setNewDocumentLifecycleTaskId('');
        return;
      }

      setLoading(true);
      setError('');
      setPerson(null);
      setDocuments([]);
      setDocumentsState('loading');
      setAssuranceByDocument({});
      setAcknowledgementByDocument({});
      setVerificationByDocument({});
      setCanManageDocuments(false);
      setShowCreateDocument(false);
      setDocumentCreateState('idle');
      setVersionDocumentId(null);
      setNewVersionExpiry('');
      setNewVersionFile(null);
      setDocumentVersionState('idle');
      setDeleteDocumentId(null);
      setDocumentDeleteState('idle');
      setLifecycleTaskOptions([]);
      setLifecycleTaskOptionsState('idle');
      setNewDocumentLifecycleTaskId('');

      void fetch(`/api/hr/people/${personId}`)
        .then(async response => {
          const data = await response.json();
          if (cancelled) return;
          if (!response.ok) {
            setError(data.error ?? 'Could not load person.');
            return;
          }
          setPerson(data.person);
        })
        .catch(() => {
          if (!cancelled) setError('Could not load person.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      void fetch(`/api/hr/people/${personId}/documents`)
        .then(async response => {
          if (cancelled) return;

          if (response.status === 404) {
            setDocuments([]);
            setDocumentsState('hidden');
            setAssuranceByDocument({});
            setAcknowledgementByDocument({});
            setVerificationByDocument({});
            setCanManageDocuments(false);
        setShowCreateDocument(false);
        setDocumentCreateState('idle');
        return;
          }

          const data = await response.json().catch(() => ({}));
          if (cancelled) return;

          if (!response.ok) {
            setDocuments([]);
            setDocumentsState('error');
            setAssuranceByDocument({});
            setAcknowledgementByDocument({});
            setVerificationByDocument({});
            setCanManageDocuments(false);
        setShowCreateDocument(false);
        setDocumentCreateState('idle');
        return;
          }

          const loadedDocuments = Array.isArray(data.documents)
            ? data.documents as EmployeeDocumentSummary[]
            : [];

          setDocuments(loadedDocuments);
          setDocumentsState('ready');
          setCanManageDocuments(data.capabilities?.can_manage_documents === true);

          const assuranceEntries: Record<string, AssuranceState> = {};
          for (const document of loadedDocuments) {
            if (document.current_version) assuranceEntries[document.id] = { state: 'loading' };
          }
          setAssuranceByDocument(assuranceEntries);

          for (const document of loadedDocuments) {
            const version = document.current_version;
            if (!version) continue;

            void fetch(
              `/api/hr/people/${personId}/documents/${document.id}/versions/${version.id}/assurance`,
            )
              .then(async assuranceResponse => {
                const assuranceData = await assuranceResponse.json().catch(() => ({}));
                if (cancelled) return;

                if (!assuranceResponse.ok || !assuranceData.assurance) {
                  setAssuranceByDocument(current => ({
                    ...current,
                    [document.id]: { state: 'error' },
                  }));
                  return;
                }

                setAssuranceByDocument(current => ({
                  ...current,
                  [document.id]: {
                    state: 'ready',
                    assurance: {
                      capabilities: assuranceData.assurance.capabilities,
                      employee_acknowledgement: assuranceData.assurance.employee_acknowledgement,
                      latest_verification: assuranceData.assurance.latest_verification,
                    },
                  },
                }));
              })
              .catch(() => {
                if (!cancelled) {
                  setAssuranceByDocument(current => ({
                    ...current,
                    [document.id]: { state: 'error' },
                  }));
                }
              });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDocuments([]);
            setDocumentsState('error');
            setAssuranceByDocument({});
            setAcknowledgementByDocument({});
            setVerificationByDocument({});
            setCanManageDocuments(false);
            setShowCreateDocument(false);
            setDocumentCreateState('idle');
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [personId]);

  useEffect(() => {
    let cancelled = false;

    if (!personId || !canManageDocuments || !showCreateDocument) {
      return () => {
        cancelled = true;
      };
    }

    void fetch(`/api/hr/lifecycle/workflows?person_id=${encodeURIComponent(personId)}`)
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;

        if (!response.ok || !Array.isArray(data.workflows)) {
          setLifecycleTaskOptions([]);
          setLifecycleTaskOptionsState('error');
          return;
        }

        const workflows = data.workflows
          .filter((workflow: unknown): workflow is { id: string; lifecycle_type: string } => {
            if (!workflow || typeof workflow !== 'object') return false;
            const candidate = workflow as Record<string, unknown>;
            return typeof candidate.id === 'string'
              && typeof candidate.lifecycle_type === 'string';
          })
          .map((workflow: { id: string; lifecycle_type: string }) => ({
            id: workflow.id,
            lifecycle_type: workflow.lifecycle_type,
          }));

        const taskGroups = await Promise.all(workflows.map(async workflow => {
          const detailResponse = await fetch(`/api/hr/lifecycle/workflows/${workflow.id}`);
          const detailData = await detailResponse.json().catch(() => ({}));

          if (!detailResponse.ok || !Array.isArray(detailData.tasks)) {
            throw new Error('Lifecycle workflow tasks unavailable.');
          }

          return detailData.tasks
            .filter((task: unknown): task is { id: string; title: string; status: string } => {
              if (!task || typeof task !== 'object') return false;
              const candidate = task as Record<string, unknown>;
              return typeof candidate.id === 'string'
                && typeof candidate.title === 'string'
                && typeof candidate.status === 'string';
            })
            .map((task: { id: string; title: string; status: string }) => ({
              id: task.id,
              title: task.title,
              status: task.status,
              lifecycle_type: workflow.lifecycle_type,
            }));
        }));

        if (cancelled) return;
        setLifecycleTaskOptions(taskGroups.flat());
        setLifecycleTaskOptionsState('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setLifecycleTaskOptions([]);
          setLifecycleTaskOptionsState('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [personId, canManageDocuments, showCreateDocument]);

  const editButton = buttonProps('secondary', 'sm');
  const acknowledgeButton = buttonProps('secondary', 'sm');
  const verifyButton = buttonProps('secondary', 'sm');
  const rejectButton = buttonProps('secondary', 'sm');
  const addDocumentButton = buttonProps('secondary', 'sm');
  const saveDocumentButton = buttonProps('primary', 'sm');
  const cancelDocumentButton = buttonProps('secondary', 'sm');
  const addVersionButton = buttonProps('secondary', 'sm');
  const saveVersionButton = buttonProps('primary', 'sm');
  const cancelVersionButton = buttonProps('secondary', 'sm');
  const deleteDocumentButton = buttonProps('ghost', 'sm');
  const confirmDeleteDocumentButton = buttonProps('danger', 'sm');
  const cancelDeleteDocumentButton = buttonProps('secondary', 'sm');
  const downloadDocumentButton = buttonProps('secondary', 'sm');

  async function deleteDocument(document: EmployeeDocumentSummary) {
    if (!personId || !canManageDocuments) return;

    setDocumentDeleteState('submitting');

    try {
      const response = await fetch(
        `/api/hr/people/${personId}/documents/${document.id}`,
        { method: 'DELETE' },
      );
      const data = await response.json().catch(() => ({}));

      if (
        !response.ok
        || data.deleted !== true
        || data.document_id !== document.id
      ) {
        setDocumentDeleteState('error');
        return;
      }

      setDocuments(current => current.filter(item => item.id !== document.id));
      setAssuranceByDocument(current => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });
      setAcknowledgementByDocument(current => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });
      setVerificationByDocument(current => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });

      if (versionDocumentId === document.id) {
        setVersionDocumentId(null);
        setNewVersionExpiry('');
        setNewVersionFile(null);
        setDocumentVersionState('idle');
      }

      setDeleteDocumentId(null);
      setDocumentDeleteState('idle');
    } catch {
      setDocumentDeleteState('error');
    }
  }

  async function loadDocumentAssurance(
    documentId: string,
    versionId: string,
  ) {
    if (!personId) return;

    setAssuranceByDocument(current => ({
      ...current,
      [documentId]: { state: 'loading' },
    }));

    try {
      const response = await fetch(
        `/api/hr/people/${personId}/documents/${documentId}/versions/${versionId}/assurance`,
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.assurance) {
        setAssuranceByDocument(current => ({
          ...current,
          [documentId]: { state: 'error' },
        }));
        return;
      }

      setAssuranceByDocument(current => ({
        ...current,
        [documentId]: {
          state: 'ready',
          assurance: {
            capabilities: data.assurance.capabilities,
            employee_acknowledgement: data.assurance.employee_acknowledgement,
            latest_verification: data.assurance.latest_verification,
          },
        },
      }));
    } catch {
      setAssuranceByDocument(current => ({
        ...current,
        [documentId]: { state: 'error' },
      }));
    }
  }

  async function addDocumentVersion(document: EmployeeDocumentSummary) {
    if (!personId || !canManageDocuments || !newVersionFile) {
      setDocumentVersionState('error');
      return;
    }

    setDocumentVersionState('submitting');

    const formData = new FormData();
    if (newVersionExpiry) formData.set('expires_at', newVersionExpiry);
    formData.set('file', newVersionFile);

    try {
      const response = await fetch(
        `/api/hr/people/${personId}/documents/${document.id}/versions`,
        { method: 'POST', body: formData },
      );
      const data = await response.json().catch(() => ({}));

      if (
        !response.ok
        || !data.version?.id
        || typeof data.version?.version_number !== 'number'
      ) {
        setDocumentVersionState('error');
        return;
      }

      const nextVersion = {
        id: data.version.id,
        version_number: data.version.version_number,
        expires_at: data.version.expires_at ?? null,
        created_at: data.version.created_at,
      };

      setDocuments(current => current.map(item => (
        item.id === document.id
          ? { ...item, current_version: nextVersion }
          : item
      )));

      setAcknowledgementByDocument(current => ({
        ...current,
        [document.id]: 'idle',
      }));
      setVerificationByDocument(current => ({
        ...current,
        [document.id]: 'idle',
      }));

      setVersionDocumentId(null);
      setNewVersionExpiry('');
      setNewVersionFile(null);
      setDocumentVersionState('idle');

      void loadDocumentAssurance(document.id, nextVersion.id);
    } catch {
      setDocumentVersionState('error');
    }
  }

  async function createDocument() {
    if (
      !personId
      || !canManageDocuments
      || !newDocumentType.trim()
      || !newDocumentTitle.trim()
      || !newDocumentFile
    ) {
      setDocumentCreateState('error');
      return;
    }

    setDocumentCreateState('submitting');

    const formData = new FormData();
    formData.set('document_type', newDocumentType.trim());
    formData.set('title', newDocumentTitle.trim());
    if (newDocumentExpiry) formData.set('expires_at', newDocumentExpiry);
    if (newDocumentLifecycleTaskId) {
      formData.set('lifecycle_task_id', newDocumentLifecycleTaskId);
    }
    formData.set('file', newDocumentFile);

    try {
      const response = await fetch(
        `/api/hr/people/${personId}/documents`,
        { method: 'POST', body: formData },
      );
      const data = await response.json().catch(() => ({}));

      if (
        !response.ok
        || !data.document?.id
        || !data.document?.document_type
        || !data.document?.title
        || !data.version?.id
        || typeof data.version?.version_number !== 'number'
      ) {
        setDocumentCreateState('error');
        return;
      }

      const createdDocument: EmployeeDocumentSummary = {
        id: data.document.id,
        document_type: data.document.document_type,
        title: data.document.title,
        lifecycle_task_id: data.document.lifecycle_task_id ?? null,
        created_at: data.document.created_at,
        current_version: {
          id: data.version.id,
          version_number: data.version.version_number,
          expires_at: data.version.expires_at ?? null,
          created_at: data.version.created_at,
        },
      };

      setDocuments(current => [...current, createdDocument]);
      void loadDocumentAssurance(
        createdDocument.id,
        createdDocument.current_version!.id,
      );

      setNewDocumentType('');
      setNewDocumentTitle('');
      setNewDocumentExpiry('');
      setNewDocumentFile(null);
      setNewDocumentLifecycleTaskId('');
      setLifecycleTaskOptions([]);
      setLifecycleTaskOptionsState('idle');
      setShowCreateDocument(false);
      setDocumentCreateState('idle');
    } catch {
      setDocumentCreateState('error');
    }
  }

  async function verifyDocument(
    document: EmployeeDocumentSummary,
    decision: 'VERIFIED' | 'REJECTED',
  ) {
    if (!personId || !document.current_version) return;

    const assuranceState = assuranceByDocument[document.id];
    if (
      assuranceState?.state !== 'ready'
      || !assuranceState.assurance.capabilities.can_verify
    ) {
      return;
    }

    setVerificationByDocument(current => ({
      ...current,
      [document.id]: decision === 'VERIFIED' ? 'verifying' : 'rejecting',
    }));

    try {
      const response = await fetch(
        `/api/hr/people/${personId}/documents/${document.id}/versions/${document.current_version.id}/verifications`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (
        !response.ok
        || (data.verification?.decision !== 'VERIFIED' && data.verification?.decision !== 'REJECTED')
        || !data.verification?.verified_at
      ) {
        setVerificationByDocument(current => ({
          ...current,
          [document.id]: 'error',
        }));
        return;
      }

      setAssuranceByDocument(current => {
        const existing = current[document.id];
        if (existing?.state !== 'ready') return current;

        return {
          ...current,
          [document.id]: {
            state: 'ready',
            assurance: {
              ...existing.assurance,
              latest_verification: {
                decision: data.verification.decision,
                verified_at: data.verification.verified_at,
              },
            },
          },
        };
      });
      setVerificationByDocument(current => ({
        ...current,
        [document.id]: 'idle',
      }));
    } catch {
      setVerificationByDocument(current => ({
        ...current,
        [document.id]: 'error',
      }));
    }
  }

  async function acknowledgeDocument(document: EmployeeDocumentSummary) {
    if (!personId || !document.current_version) return;

    const assuranceState = assuranceByDocument[document.id];
    if (
      assuranceState?.state !== 'ready'
      || !assuranceState.assurance.capabilities.can_acknowledge
      || assuranceState.assurance.employee_acknowledgement.acknowledged
    ) {
      return;
    }

    setAcknowledgementByDocument(current => ({
      ...current,
      [document.id]: 'submitting',
    }));

    try {
      const response = await fetch(
        `/api/hr/people/${personId}/documents/${document.id}/versions/${document.current_version.id}/acknowledgements`,
        { method: 'POST' },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.acknowledgement?.acknowledged_at) {
        setAcknowledgementByDocument(current => ({
          ...current,
          [document.id]: 'error',
        }));
        return;
      }

      setAssuranceByDocument(current => {
        const existing = current[document.id];
        if (existing?.state !== 'ready') return current;

        return {
          ...current,
          [document.id]: {
            state: 'ready',
            assurance: {
              ...existing.assurance,
              employee_acknowledgement: {
                acknowledged: true,
                acknowledged_at: data.acknowledgement.acknowledged_at,
              },
            },
          },
        };
      });
      setAcknowledgementByDocument(current => ({
        ...current,
        [document.id]: 'idle',
      }));
    } catch {
      setAcknowledgementByDocument(current => ({
        ...current,
        [document.id]: 'error',
      }));
    }
  }

  return (
    <SlidePanel open={personId !== null} onClose={onClose} title="Person">
      {loading && <StateMessage kind="loading" title="Loading person…" />}
      {error && <StateMessage kind="error" title={error} />}
      {person && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {person.first_name} {person.last_name}
                {person.preferred_name ? <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> ({person.preferred_name})</span> : null}
              </div>
              {person.job_title && <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>{person.job_title}</div>}
            </div>
            {canManage && (
              <button onClick={() => onEdit(person)} type="button" {...editButton} style={{ flexShrink: 0 }}>
                Edit
              </button>
            )}
          </div>
          <Row label="Status" value={person.employment_status} />
          <Row label="Worker Type" value={person.worker_type} />
          <Row label="Team" value={person.team_name ?? '—'} />
          <Row label="Manager" value={person.manager_first_name ? `${person.manager_first_name} ${person.manager_last_name}` : '—'} />
          <Row label="Start Date" value={person.start_date ?? '—'} />
          <Row label="End Date" value={person.end_date ?? '—'} />
          {'work_email' in person && <Row label="Work Email" value={person.work_email ?? '—'} />}
          {'work_phone' in person && <Row label="Work Phone" value={person.work_phone ?? '—'} />}
          {canManage && <Row label="Linked BrainBase Account" value={person.linked_user_id ? 'Linked' : 'Not linked'} />}

          {documentsState !== 'hidden' && documentsState !== 'idle' && (
            <section aria-labelledby="person-documents-heading" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, marginTop: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div id="person-documents-heading" style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 700 }}>
                  Documents
                </div>
                {documentsState === 'ready' && canManageDocuments && !showCreateDocument && (
                  <button
                    type="button"
                    onClick={() => {
                      setLifecycleTaskOptions([]);
                      setLifecycleTaskOptionsState('loading');
                      setNewDocumentLifecycleTaskId('');
                      setShowCreateDocument(true);
                      setDocumentCreateState('idle');
                    }}
                    {...addDocumentButton}
                  >
                    Add document
                  </button>
                )}
              </div>

              {documentsState === 'ready' && canManageDocuments && showCreateDocument && (
                <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Document type</span>
                      <input
                        value={newDocumentType}
                        onChange={event => setNewDocumentType(event.target.value)}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Title</span>
                      <input
                        value={newDocumentTitle}
                        onChange={event => setNewDocumentTitle(event.target.value)}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Expiry date (optional)</span>
                      <input
                        type="date"
                        value={newDocumentExpiry}
                        onChange={event => setNewDocumentExpiry(event.target.value)}
                      />
                    </label>
                    {lifecycleTaskOptionsState === 'loading' && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        Loading lifecycle tasks…
                      </div>
                    )}
                    {lifecycleTaskOptionsState === 'error' && (
                      <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        Lifecycle tasks unavailable. You can upload without linking a task.
                      </div>
                    )}
                    {lifecycleTaskOptionsState === 'ready' && (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Lifecycle task (optional)</span>
                        <select
                          value={newDocumentLifecycleTaskId}
                          onChange={event => setNewDocumentLifecycleTaskId(event.target.value)}
                        >
                          <option value="">No lifecycle task</option>
                          {lifecycleTaskOptions.map(option => (
                            <option key={option.id} value={option.id}>
                              {option.title} · {option.lifecycle_type} · {option.status}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>File</span>
                      <input
                        type="file"
                        onChange={event => setNewDocumentFile(event.target.files?.[0] ?? null)}
                      />
                    </label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => void createDocument()}
                        disabled={documentCreateState === 'submitting'}
                        {...saveDocumentButton}
                      >
                        {documentCreateState === 'submitting' ? 'Uploading…' : 'Upload document'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateDocument(false);
                          setDocumentCreateState('idle');
                          setNewDocumentLifecycleTaskId('');
                          setLifecycleTaskOptions([]);
                          setLifecycleTaskOptionsState('idle');
                        }}
                        disabled={documentCreateState === 'submitting'}
                        {...cancelDocumentButton}
                      >
                        Cancel
                      </button>
                    </div>
                    {documentCreateState === 'error' && (
                      <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        Could not upload document.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {documentsState === 'loading' && (
                <StateMessage kind="loading" title="Loading documents…" />
              )}

              {documentsState === 'error' && (
                <StateMessage kind="error" title="Could not load documents." />
              )}

              {documentsState === 'ready' && documents.length === 0 && (
                <StateMessage kind="empty" title="No documents" />
              )}

              {documentsState === 'ready' && documents.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {documents.map(document => {
                    const assurance = assuranceByDocument[document.id];
                    const acknowledgementAction = acknowledgementByDocument[document.id] ?? 'idle';
                    const verificationAction = verificationByDocument[document.id] ?? 'idle';
                    const addingVersion = versionDocumentId === document.id;
                    const confirmingDelete = deleteDocumentId === document.id;

                    return (
                      <div key={document.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10 }}>
                        <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 }}>
                          {document.title}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                          {document.document_type}
                          {document.current_version ? ` · Version ${document.current_version.version_number}` : ' · No current version'}
                        </div>
                        {document.current_version?.expires_at && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                            Expires {document.current_version.expires_at}
                          </div>
                        )}

                        {document.current_version && (
                          <div style={{ marginTop: 8 }}>
                            <a
                              href={`/api/hr/people/${personId}/documents/${document.id}/versions/${document.current_version.id}`}
                              {...downloadDocumentButton}
                            >
                              Download
                            </a>
                          </div>
                        )}

                        {canManageDocuments && !addingVersion && !confirmingDelete && (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteDocumentId(null);
                                setDocumentDeleteState('idle');
                                setVersionDocumentId(document.id);
                                setNewVersionExpiry('');
                                setNewVersionFile(null);
                                setDocumentVersionState('idle');
                              }}
                              {...addVersionButton}
                            >
                              Add version
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setVersionDocumentId(null);
                                setDocumentVersionState('idle');
                                setDeleteDocumentId(document.id);
                                setDocumentDeleteState('idle');
                              }}
                              {...deleteDocumentButton}
                            >
                              Delete
                            </button>
                          </div>
                        )}

                        {canManageDocuments && confirmingDelete && (
                          <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 9, paddingTop: 9 }}>
                            <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>
                              Delete this document?
                            </div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                              It will be removed from the live employee document list.
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                              <button
                                type="button"
                                onClick={() => void deleteDocument(document)}
                                disabled={documentDeleteState === 'submitting'}
                                {...confirmDeleteDocumentButton}
                              >
                                {documentDeleteState === 'submitting' ? 'Deleting…' : 'Confirm delete'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteDocumentId(null);
                                  setDocumentDeleteState('idle');
                                }}
                                disabled={documentDeleteState === 'submitting'}
                                {...cancelDeleteDocumentButton}
                              >
                                Cancel
                              </button>
                            </div>
                            {documentDeleteState === 'error' && (
                              <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 7 }}>
                                Could not delete document.
                              </div>
                            )}
                          </div>
                        )}

                        {canManageDocuments && addingVersion && (
                          <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 9, paddingTop: 9 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                                <span style={{ color: 'var(--text-secondary)' }}>New version expiry (optional)</span>
                                <input
                                  type="date"
                                  value={newVersionExpiry}
                                  onChange={event => setNewVersionExpiry(event.target.value)}
                                />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                                <span style={{ color: 'var(--text-secondary)' }}>New version file</span>
                                <input
                                  type="file"
                                  onChange={event => setNewVersionFile(event.target.files?.[0] ?? null)}
                                />
                              </label>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  onClick={() => void addDocumentVersion(document)}
                                  disabled={documentVersionState === 'submitting'}
                                  {...saveVersionButton}
                                >
                                  {documentVersionState === 'submitting' ? 'Uploading…' : 'Upload version'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVersionDocumentId(null);
                                    setNewVersionExpiry('');
                                    setNewVersionFile(null);
                                    setDocumentVersionState('idle');
                                  }}
                                  disabled={documentVersionState === 'submitting'}
                                  {...cancelVersionButton}
                                >
                                  Cancel
                                </button>
                              </div>
                              {documentVersionState === 'error' && (
                                <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                                  Could not upload document version.
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {document.current_version && assurance?.state === 'loading' && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 7 }}>
                            Loading assurance status…
                          </div>
                        )}

                        {document.current_version && assurance?.state === 'error' && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 7 }}>
                            Assurance status unavailable.
                          </div>
                        )}

                        {document.current_version && assurance?.state === 'ready' && (
                          <>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 7, color: 'var(--text-secondary)', fontSize: 12 }}>
                              <div>
                                {assurance.assurance.employee_acknowledgement.acknowledged
                                  ? `Acknowledged ${dateOnly(assurance.assurance.employee_acknowledgement.acknowledged_at!)}`
                                  : 'Not acknowledged'}
                              </div>
                              <div>
                                {assurance.assurance.latest_verification
                                  ? `${assurance.assurance.latest_verification.decision === 'VERIFIED' ? 'Verified' : 'Rejected'} ${dateOnly(assurance.assurance.latest_verification.verified_at)}`
                                  : 'Not verified'}
                              </div>
                            </div>

                            {assurance.assurance.capabilities.can_acknowledge
                              && !assurance.assurance.employee_acknowledgement.acknowledged && (
                              <div style={{ marginTop: 8 }}>
                                <button
                                  type="button"
                                  onClick={() => void acknowledgeDocument(document)}
                                  disabled={acknowledgementAction === 'submitting'}
                                  {...acknowledgeButton}
                                >
                                  {acknowledgementAction === 'submitting' ? 'Acknowledging…' : 'Acknowledge'}
                                </button>
                              </div>
                            )}

                            {acknowledgementAction === 'error' && (
                              <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 7 }}>
                                Could not acknowledge document.
                              </div>
                            )}

                            {assurance.assurance.capabilities.can_verify && (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                <button
                                  type="button"
                                  onClick={() => void verifyDocument(document, 'VERIFIED')}
                                  disabled={verificationAction === 'verifying' || verificationAction === 'rejecting'}
                                  {...verifyButton}
                                >
                                  {verificationAction === 'verifying' ? 'Verifying…' : 'Verify'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void verifyDocument(document, 'REJECTED')}
                                  disabled={verificationAction === 'verifying' || verificationAction === 'rejecting'}
                                  {...rejectButton}
                                >
                                  {verificationAction === 'rejecting' ? 'Rejecting…' : 'Reject'}
                                </button>
                              </div>
                            )}

                            {verificationAction === 'error' && (
                              <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 7 }}>
                                Could not record verification.
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </SlidePanel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ color: 'var(--text-primary)', fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}

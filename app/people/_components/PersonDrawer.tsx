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

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (!personId) {
        setPerson(null);
        setDocuments([]);
        setDocumentsState('idle');
        setAssuranceByDocument({});
        setAcknowledgementByDocument({});
        return;
      }

      setLoading(true);
      setError('');
      setPerson(null);
      setDocuments([]);
      setDocumentsState('loading');
      setAssuranceByDocument({});
      setAcknowledgementByDocument({});

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
            return;
          }

          const data = await response.json().catch(() => ({}));
          if (cancelled) return;

          if (!response.ok) {
            setDocuments([]);
            setDocumentsState('error');
            setAssuranceByDocument({});
            setAcknowledgementByDocument({});
            return;
          }

          const loadedDocuments = Array.isArray(data.documents)
            ? data.documents as EmployeeDocumentSummary[]
            : [];

          setDocuments(loadedDocuments);
          setDocumentsState('ready');

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
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [personId]);

  const editButton = buttonProps('secondary', 'sm');
  const acknowledgeButton = buttonProps('secondary', 'sm');

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
              <div id="person-documents-heading" style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
                Documents
              </div>

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

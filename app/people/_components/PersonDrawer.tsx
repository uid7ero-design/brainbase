'use client';
import { useEffect, useState } from 'react';
import SlidePanel from './SlidePanel';
import PersonAiAssistant from './PersonAiAssistant';
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
type LifecycleWorkflowsState = 'idle' | 'loading' | 'ready' | 'error';
type LifecycleTaskActionState = 'idle' | 'submitting' | 'error';
type LifecycleTaskApprovalState = 'idle' | 'approving' | 'rejecting' | 'error';
type LifecycleWorkflowMutationState = 'idle' | 'submitting' | 'error';
type LifecycleTemplatesState = 'idle' | 'loading' | 'ready' | 'error';

type LifecycleTaskOption = {
  id: string;
  title: string;
  status: string;
  lifecycle_type: string;
};

type PersonLifecycleWorkflowSummary = {
  id: string;
  lifecycle_type: string;
  status: string;
  anchor_date: string;
  started_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  capabilities: {
    can_cancel: boolean;
  };
};

type LifecycleTemplateOption = {
  id: string;
  name: string;
  lifecycle_type: string;
  version_number: number;
};

type PersonLifecycleTaskSummary = {
  id: string;
  title: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'WAIVED' | 'CANCELLED';
  due_at: string | null;
  capabilities: {
    can_execute: boolean;
    can_approve: boolean;
  };
};

type LifecycleTaskDetailsState =
  | { state: 'loading' }
  | { state: 'ready'; tasks: PersonLifecycleTaskSummary[] }
  | { state: 'error' };

type EmployeeDocumentVersionSummary = {
  id: string;
  version_number: number;
  expires_at: string | null;
  is_current: boolean;
  created_at: string;
};

type VersionHistoryState =
  | { state: 'loading' }
  | { state: 'ready'; versions: EmployeeDocumentVersionSummary[] }
  | { state: 'error' };

type DocumentsState = 'idle' | 'loading' | 'ready' | 'error' | 'hidden';

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function parseLifecycleWorkflowList(data: unknown): {
  canStartWorkflow: boolean;
  workflows: PersonLifecycleWorkflowSummary[];
} | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  if (!Array.isArray(payload.workflows)) return null;

  const rootCapabilities = (
    payload.capabilities
    && typeof payload.capabilities === 'object'
  ) ? payload.capabilities as Record<string, unknown> : {};

  const workflows = payload.workflows
    .filter((workflow: unknown): workflow is Record<string, unknown> => {
      if (!workflow || typeof workflow !== 'object') return false;
      const candidate = workflow as Record<string, unknown>;
      return typeof candidate.id === 'string'
        && typeof candidate.lifecycle_type === 'string'
        && typeof candidate.status === 'string'
        && typeof candidate.anchor_date === 'string'
        && typeof candidate.started_at === 'string'
        && (candidate.completed_at === null || typeof candidate.completed_at === 'string')
        && (candidate.cancelled_at === null || typeof candidate.cancelled_at === 'string');
    })
    .map((workflow: Record<string, unknown>): PersonLifecycleWorkflowSummary => {
      const capabilities = (
        workflow.capabilities
        && typeof workflow.capabilities === 'object'
      ) ? workflow.capabilities as Record<string, unknown> : {};

      return {
        id: workflow.id as string,
        lifecycle_type: workflow.lifecycle_type as string,
        status: workflow.status as string,
        anchor_date: workflow.anchor_date as string,
        started_at: workflow.started_at as string,
        completed_at: workflow.completed_at as string | null,
        cancelled_at: workflow.cancelled_at as string | null,
        capabilities: {
          can_cancel: capabilities.can_cancel === true,
        },
      };
    });

  return {
    canStartWorkflow: rootCapabilities.can_start_workflow === true,
    workflows,
  };
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
  const [versionHistoryDocumentId, setVersionHistoryDocumentId] = useState<string | null>(null);
  const [versionHistoryByDocument, setVersionHistoryByDocument] = useState<Record<string, VersionHistoryState>>({});
  const [lifecycleTaskOptions, setLifecycleTaskOptions] = useState<LifecycleTaskOption[]>([]);
  const [lifecycleTaskOptionsState, setLifecycleTaskOptionsState] = useState<LifecycleTaskOptionsState>('idle');
  const [newDocumentLifecycleTaskId, setNewDocumentLifecycleTaskId] = useState('');
  const [lifecycleWorkflows, setLifecycleWorkflows] = useState<PersonLifecycleWorkflowSummary[]>([]);
  const [lifecycleWorkflowsState, setLifecycleWorkflowsState] = useState<LifecycleWorkflowsState>('idle');
  const [lifecycleTaskWorkflowId, setLifecycleTaskWorkflowId] = useState<string | null>(null);
  const [lifecycleTasksByWorkflow, setLifecycleTasksByWorkflow] = useState<Record<string, LifecycleTaskDetailsState>>({});
  const [lifecycleTaskActionById, setLifecycleTaskActionById] = useState<Record<string, LifecycleTaskActionState>>({});
  const [lifecycleTaskApprovalById, setLifecycleTaskApprovalById] = useState<Record<string, LifecycleTaskApprovalState>>({});
  const [canStartLifecycleWorkflow, setCanStartLifecycleWorkflow] = useState(false);
  const [showStartLifecycleWorkflow, setShowStartLifecycleWorkflow] = useState(false);
  const [lifecycleTemplates, setLifecycleTemplates] = useState<LifecycleTemplateOption[]>([]);
  const [lifecycleTemplatesState, setLifecycleTemplatesState] = useState<LifecycleTemplatesState>('idle');
  const [newLifecycleTemplateId, setNewLifecycleTemplateId] = useState('');
  const [newLifecycleAnchorDate, setNewLifecycleAnchorDate] = useState('');
  const [lifecycleStartState, setLifecycleStartState] = useState<LifecycleWorkflowMutationState>('idle');
  const [cancelLifecycleWorkflowId, setCancelLifecycleWorkflowId] = useState<string | null>(null);
  const [lifecycleCancelState, setLifecycleCancelState] = useState<LifecycleWorkflowMutationState>('idle');

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
        setVersionHistoryDocumentId(null);
        setVersionHistoryByDocument({});
        setLifecycleTaskOptions([]);
        setLifecycleTaskOptionsState('idle');
        setNewDocumentLifecycleTaskId('');
        setLifecycleWorkflows([]);
        setLifecycleWorkflowsState('idle');
        setLifecycleTaskWorkflowId(null);
        setLifecycleTasksByWorkflow({});
        setLifecycleTaskActionById({});
        setLifecycleTaskApprovalById({});
        setCanStartLifecycleWorkflow(false);
        setShowStartLifecycleWorkflow(false);
        setLifecycleTemplates([]);
        setLifecycleTemplatesState('idle');
        setNewLifecycleTemplateId('');
        setNewLifecycleAnchorDate('');
        setLifecycleStartState('idle');
        setCancelLifecycleWorkflowId(null);
        setLifecycleCancelState('idle');
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
      setVersionHistoryDocumentId(null);
      setVersionHistoryByDocument({});
      setLifecycleTaskOptions([]);
      setLifecycleTaskOptionsState('idle');
      setNewDocumentLifecycleTaskId('');
      setLifecycleWorkflows([]);
      setLifecycleWorkflowsState('loading');
      setLifecycleTaskWorkflowId(null);
      setLifecycleTasksByWorkflow({});
      setLifecycleTaskActionById({});
      setLifecycleTaskApprovalById({});
      setCanStartLifecycleWorkflow(false);
      setShowStartLifecycleWorkflow(false);
      setLifecycleTemplates([]);
      setLifecycleTemplatesState('idle');
      setNewLifecycleTemplateId('');
      setNewLifecycleAnchorDate('');
      setLifecycleStartState('idle');
      setCancelLifecycleWorkflowId(null);
      setLifecycleCancelState('idle');

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

      void fetch(`/api/hr/lifecycle/workflows?person_id=${encodeURIComponent(personId)}`)
        .then(async response => {
          const data = await response.json().catch(() => ({}));
          if (cancelled) return;

          if (!response.ok) {
            setLifecycleWorkflows([]);
            setCanStartLifecycleWorkflow(false);
            setLifecycleWorkflowsState('error');
            return;
          }

          const parsed = parseLifecycleWorkflowList(data);
          if (!parsed) {
            setLifecycleWorkflows([]);
            setCanStartLifecycleWorkflow(false);
            setLifecycleWorkflowsState('error');
            return;
          }

          setLifecycleWorkflows(parsed.workflows);
          setCanStartLifecycleWorkflow(parsed.canStartWorkflow);
          setLifecycleWorkflowsState('ready');
        })
        .catch(() => {
          if (!cancelled) {
            setLifecycleWorkflows([]);
            setLifecycleWorkflowsState('error');
          }
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

        const taskGroups = await Promise.all(workflows.map(async (
          workflow: { id: string; lifecycle_type: string },
        ) => {
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

  useEffect(() => {
    let cancelled = false;

    if (!showStartLifecycleWorkflow || !canStartLifecycleWorkflow) {
      return () => {
        cancelled = true;
      };
    }

    void fetch('/api/hr/lifecycle/templates?status=ACTIVE')
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;

        if (!response.ok || !Array.isArray(data.templates)) {
          setLifecycleTemplates([]);
          setLifecycleTemplatesState('error');
          return;
        }

        const templates = data.templates
          .filter((template: unknown): template is Record<string, unknown> => {
            if (!template || typeof template !== 'object') return false;
            const candidate = template as Record<string, unknown>;
            return typeof candidate.id === 'string'
              && typeof candidate.name === 'string'
              && typeof candidate.lifecycle_type === 'string'
              && typeof candidate.version_number === 'number'
              && candidate.status === 'ACTIVE';
          })
          .map((template: Record<string, unknown>): LifecycleTemplateOption => ({
            id: template.id as string,
            name: template.name as string,
            lifecycle_type: template.lifecycle_type as string,
            version_number: template.version_number as number,
          }));

        setLifecycleTemplates(templates);
        setLifecycleTemplatesState('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setLifecycleTemplates([]);
          setLifecycleTemplatesState('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showStartLifecycleWorkflow, canStartLifecycleWorkflow]);

  async function refreshLifecycleWorkflows() {
    if (!personId) return false;

    try {
      const response = await fetch(
        `/api/hr/lifecycle/workflows?person_id=${encodeURIComponent(personId)}`,
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return false;

      const parsed = parseLifecycleWorkflowList(data);
      if (!parsed) return false;

      setLifecycleWorkflows(parsed.workflows);
      setCanStartLifecycleWorkflow(parsed.canStartWorkflow);
      setLifecycleWorkflowsState('ready');
      return true;
    } catch {
      return false;
    }
  }

  async function startLifecycleWorkflow() {
    if (
      !personId
      || !canStartLifecycleWorkflow
      || !newLifecycleTemplateId
      || !newLifecycleAnchorDate
    ) {
      setLifecycleStartState('error');
      return;
    }

    setLifecycleStartState('submitting');

    try {
      const response = await fetch('/api/hr/lifecycle/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_id: personId,
          template_id: newLifecycleTemplateId,
          anchor_date: newLifecycleAnchorDate,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || typeof data.workflow?.id !== 'string') {
        setLifecycleStartState('error');
        return;
      }

      if (!await refreshLifecycleWorkflows()) {
        setLifecycleStartState('error');
        return;
      }

      setLifecycleTaskWorkflowId(null);
      setLifecycleTasksByWorkflow({});
      setLifecycleTaskActionById({});
      setLifecycleTaskApprovalById({});
      setShowStartLifecycleWorkflow(false);
      setLifecycleTemplates([]);
      setLifecycleTemplatesState('idle');
      setNewLifecycleTemplateId('');
      setNewLifecycleAnchorDate('');
      setLifecycleStartState('idle');
    } catch {
      setLifecycleStartState('error');
    }
  }

  async function cancelLifecycleWorkflow(workflow: PersonLifecycleWorkflowSummary) {
    if (!workflow.capabilities.can_cancel || workflow.status !== 'ACTIVE') return;

    setLifecycleCancelState('submitting');

    try {
      const response = await fetch(
        `/api/hr/lifecycle/workflows/${workflow.id}/cancel`,
        { method: 'POST' },
      );
      const data = await response.json().catch(() => ({}));

      if (
        !response.ok
        || data.workflow?.id !== workflow.id
        || data.workflow?.status !== 'CANCELLED'
      ) {
        setLifecycleCancelState('error');
        return;
      }

      if (!await refreshLifecycleWorkflows()) {
        setLifecycleCancelState('error');
        return;
      }

      setLifecycleTaskWorkflowId(current => (
        current === workflow.id ? null : current
      ));
      setLifecycleTasksByWorkflow(current => {
        const next = { ...current };
        delete next[workflow.id];
        return next;
      });
      setCancelLifecycleWorkflowId(null);
      setLifecycleCancelState('idle');
    } catch {
      setLifecycleCancelState('error');
    }
  }

  const lifecycleTaskButton = buttonProps('secondary', 'sm');
  const lifecycleStartWorkflowButton = buttonProps('primary', 'sm');
  const lifecycleCancelWorkflowButton = buttonProps('ghost', 'sm');
  const lifecycleConfirmCancelWorkflowButton = buttonProps('danger', 'sm');
  const lifecycleCancelConfirmButton = buttonProps('secondary', 'sm');

  async function toggleLifecycleTasks(workflow: PersonLifecycleWorkflowSummary) {
    if (!personId) return;

    if (lifecycleTaskWorkflowId === workflow.id) {
      setLifecycleTaskWorkflowId(null);
      return;
    }

    setLifecycleTaskWorkflowId(workflow.id);

    const existing = lifecycleTasksByWorkflow[workflow.id];
    if (existing?.state === 'ready' || existing?.state === 'loading') return;

    setLifecycleTasksByWorkflow(current => ({
      ...current,
      [workflow.id]: { state: 'loading' },
    }));

    try {
      const response = await fetch(`/api/hr/lifecycle/workflows/${workflow.id}`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !Array.isArray(data.tasks)) {
        setLifecycleTasksByWorkflow(current => ({
          ...current,
          [workflow.id]: { state: 'error' },
        }));
        return;
      }

      const taskStatuses = new Set([
        'NOT_STARTED',
        'IN_PROGRESS',
        'AWAITING_APPROVAL',
        'COMPLETED',
        'WAIVED',
        'CANCELLED',
      ]);

      const tasks = data.tasks
        .filter((task: unknown): task is Record<string, unknown> => {
          if (!task || typeof task !== 'object') return false;
          const candidate = task as Record<string, unknown>;
          return typeof candidate.id === 'string'
            && typeof candidate.title === 'string'
            && typeof candidate.status === 'string'
            && taskStatuses.has(candidate.status)
            && (candidate.due_at === null || typeof candidate.due_at === 'string');
        })
        .map((task: Record<string, unknown>): PersonLifecycleTaskSummary => {
          const capabilities = (
            task.capabilities
            && typeof task.capabilities === 'object'
          ) ? task.capabilities as Record<string, unknown> : {};

          return {
            id: task.id as string,
            title: task.title as string,
            status: task.status as PersonLifecycleTaskSummary['status'],
            due_at: task.due_at as string | null,
            capabilities: {
              can_execute: capabilities.can_execute === true,
              can_approve: capabilities.can_approve === true,
            },
          };
        });

      setLifecycleTasksByWorkflow(current => ({
        ...current,
        [workflow.id]: { state: 'ready', tasks },
      }));
    } catch {
      setLifecycleTasksByWorkflow(current => ({
        ...current,
        [workflow.id]: { state: 'error' },
      }));
    }
  }

  async function runLifecycleTaskAction(
    workflow: PersonLifecycleWorkflowSummary,
    task: PersonLifecycleTaskSummary,
    action: 'start' | 'complete',
  ) {
    if (!task.capabilities.can_execute) return;
    if (action === 'start' && task.status !== 'NOT_STARTED') return;
    if (action === 'complete' && task.status !== 'IN_PROGRESS') return;

    setLifecycleTaskActionById(current => ({
      ...current,
      [task.id]: 'submitting',
    }));

    try {
      const response = await fetch(`/api/hr/lifecycle/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));

      const allowedStatuses = new Set([
        'NOT_STARTED',
        'IN_PROGRESS',
        'AWAITING_APPROVAL',
        'COMPLETED',
        'WAIVED',
        'CANCELLED',
      ]);

      if (
        !response.ok
        || data.task?.id !== task.id
        || typeof data.task?.status !== 'string'
        || !allowedStatuses.has(data.task.status)
      ) {
        setLifecycleTaskActionById(current => ({
          ...current,
          [task.id]: 'error',
        }));
        return;
      }

      setLifecycleTasksByWorkflow(current => {
        const detail = current[workflow.id];
        if (detail?.state !== 'ready') return current;

        return {
          ...current,
          [workflow.id]: {
            state: 'ready',
            tasks: detail.tasks.map(item => (
              item.id === task.id
                ? { ...item, status: data.task.status as PersonLifecycleTaskSummary['status'] }
                : item
            )),
          },
        };
      });

      if (
        data.workflow?.id === workflow.id
        && (data.workflow.status === 'ACTIVE'
          || data.workflow.status === 'COMPLETED'
          || data.workflow.status === 'CANCELLED')
      ) {
        setLifecycleWorkflows(current => current.map(item => (
          item.id === workflow.id
            ? {
                ...item,
                status: data.workflow.status,
                completed_at: data.workflow.completed_at ?? item.completed_at,
              }
            : item
        )));
      }

      setLifecycleTaskActionById(current => ({
        ...current,
        [task.id]: 'idle',
      }));
    } catch {
      setLifecycleTaskActionById(current => ({
        ...current,
        [task.id]: 'error',
      }));
    }
  }

  async function runLifecycleTaskApproval(
    workflow: PersonLifecycleWorkflowSummary,
    task: PersonLifecycleTaskSummary,
    decision: 'APPROVED' | 'REJECTED',
  ) {
    if (!task.capabilities.can_approve || task.status !== 'AWAITING_APPROVAL') return;

    setLifecycleTaskApprovalById(current => ({
      ...current,
      [task.id]: decision === 'APPROVED' ? 'approving' : 'rejecting',
    }));

    try {
      const response = await fetch(`/api/hr/lifecycle/tasks/${task.id}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await response.json().catch(() => ({}));

      const allowedStatuses = new Set([
        'NOT_STARTED',
        'IN_PROGRESS',
        'AWAITING_APPROVAL',
        'COMPLETED',
        'WAIVED',
        'CANCELLED',
      ]);

      if (
        !response.ok
        || data.task?.id !== task.id
        || typeof data.task?.status !== 'string'
        || !allowedStatuses.has(data.task.status)
      ) {
        setLifecycleTaskApprovalById(current => ({
          ...current,
          [task.id]: 'error',
        }));
        return;
      }

      setLifecycleTasksByWorkflow(current => {
        const detail = current[workflow.id];
        if (detail?.state !== 'ready') return current;

        return {
          ...current,
          [workflow.id]: {
            state: 'ready',
            tasks: detail.tasks.map(item => (
              item.id === task.id
                ? { ...item, status: data.task.status as PersonLifecycleTaskSummary['status'] }
                : item
            )),
          },
        };
      });

      if (
        data.workflow?.id === workflow.id
        && (data.workflow.status === 'ACTIVE'
          || data.workflow.status === 'COMPLETED'
          || data.workflow.status === 'CANCELLED')
      ) {
        setLifecycleWorkflows(current => current.map(item => (
          item.id === workflow.id
            ? {
                ...item,
                status: data.workflow.status,
                completed_at: data.workflow.completed_at ?? item.completed_at,
              }
            : item
        )));
      }

      setLifecycleTaskApprovalById(current => ({
        ...current,
        [task.id]: 'idle',
      }));
    } catch {
      setLifecycleTaskApprovalById(current => ({
        ...current,
        [task.id]: 'error',
      }));
    }
  }

  const lifecycleStartButton = buttonProps('secondary', 'sm');
  const lifecycleCompleteButton = buttonProps('primary', 'sm');
  const lifecycleApproveButton = buttonProps('primary', 'sm');
  const lifecycleRejectButton = buttonProps('secondary', 'sm');

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
  const versionHistoryButton = buttonProps('secondary', 'sm');
  const versionDownloadButton = buttonProps('secondary', 'sm');

  async function toggleVersionHistory(document: EmployeeDocumentSummary) {
    if (!personId) return;

    if (versionHistoryDocumentId === document.id) {
      setVersionHistoryDocumentId(null);
      return;
    }

    setVersionHistoryDocumentId(document.id);

    const existing = versionHistoryByDocument[document.id];
    if (existing?.state === 'ready' || existing?.state === 'loading') return;

    setVersionHistoryByDocument(current => ({
      ...current,
      [document.id]: { state: 'loading' },
    }));

    try {
      const response = await fetch(
        `/api/hr/people/${personId}/documents/${document.id}/versions`,
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !Array.isArray(data.versions)) {
        setVersionHistoryByDocument(current => ({
          ...current,
          [document.id]: { state: 'error' },
        }));
        return;
      }

      const versions = data.versions
        .filter((version: unknown): version is EmployeeDocumentVersionSummary => {
          if (!version || typeof version !== 'object') return false;
          const candidate = version as Partial<EmployeeDocumentVersionSummary>;
          return typeof candidate.id === 'string'
            && typeof candidate.version_number === 'number'
            && (candidate.expires_at === null || typeof candidate.expires_at === 'string')
            && typeof candidate.is_current === 'boolean'
            && typeof candidate.created_at === 'string';
        })
        .map((version: EmployeeDocumentVersionSummary) => ({
          id: version.id,
          version_number: version.version_number,
          expires_at: version.expires_at,
          is_current: version.is_current,
          created_at: version.created_at,
        }));

      setVersionHistoryByDocument(current => ({
        ...current,
        [document.id]: { state: 'ready', versions },
      }));
    } catch {
      setVersionHistoryByDocument(current => ({
        ...current,
        [document.id]: { state: 'error' },
      }));
    }
  }

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
      setVersionHistoryByDocument(current => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });
      if (versionHistoryDocumentId === document.id) {
        setVersionHistoryDocumentId(null);
      }

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
      setVersionHistoryByDocument(current => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });
      if (versionHistoryDocumentId === document.id) {
        setVersionHistoryDocumentId(null);
      }

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

          {!loading && person.id === personId && <PersonAiAssistant key={person.id} personId={person.id} />}

          {lifecycleWorkflowsState !== 'idle' && (
            <section aria-labelledby="person-lifecycle-heading" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, marginTop: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div id="person-lifecycle-heading" style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 700 }}>
                  Lifecycle
                </div>
                {lifecycleWorkflowsState === 'ready'
                  && canStartLifecycleWorkflow
                  && !showStartLifecycleWorkflow && (
                  <button
                    type="button"
                    onClick={() => {
                      setLifecycleTemplates([]);
                      setLifecycleTemplatesState('loading');
                      setShowStartLifecycleWorkflow(true);
                      setLifecycleStartState('idle');
                      setNewLifecycleTemplateId('');
                      setNewLifecycleAnchorDate('');
                    }}
                    {...lifecycleStartWorkflowButton}
                  >
                    Start workflow
                  </button>
                )}
              </div>

              {lifecycleWorkflowsState === 'ready'
                && canStartLifecycleWorkflow
                && showStartLifecycleWorkflow && (
                <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {lifecycleTemplatesState === 'loading' && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        Loading active templates…
                      </div>
                    )}
                    {lifecycleTemplatesState === 'error' && (
                      <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        Active lifecycle templates unavailable.
                      </div>
                    )}
                    {lifecycleTemplatesState === 'ready' && lifecycleTemplates.length === 0 && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        No active lifecycle templates
                      </div>
                    )}
                    {lifecycleTemplatesState === 'ready' && lifecycleTemplates.length > 0 && (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Template</span>
                        <select
                          value={newLifecycleTemplateId}
                          onChange={event => setNewLifecycleTemplateId(event.target.value)}
                        >
                          <option value="">Select template</option>
                          {lifecycleTemplates.map(template => (
                            <option key={template.id} value={template.id}>
                              {template.name} · {template.lifecycle_type} · v{template.version_number}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Anchor date</span>
                      <input
                        type="date"
                        value={newLifecycleAnchorDate}
                        onChange={event => setNewLifecycleAnchorDate(event.target.value)}
                      />
                    </label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => void startLifecycleWorkflow()}
                        disabled={lifecycleStartState === 'submitting'}
                        {...lifecycleStartWorkflowButton}
                      >
                        {lifecycleStartState === 'submitting' ? 'Starting…' : 'Start'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowStartLifecycleWorkflow(false);
                          setLifecycleTemplates([]);
                          setLifecycleTemplatesState('idle');
                          setNewLifecycleTemplateId('');
                          setNewLifecycleAnchorDate('');
                          setLifecycleStartState('idle');
                        }}
                        disabled={lifecycleStartState === 'submitting'}
                        {...lifecycleCancelConfirmButton}
                      >
                        Cancel
                      </button>
                    </div>
                    {lifecycleStartState === 'error' && (
                      <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        Could not start lifecycle workflow.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {lifecycleWorkflowsState === 'loading' && (
                <StateMessage kind="loading" title="Loading lifecycle…" />
              )}

              {lifecycleWorkflowsState === 'error' && (
                <StateMessage kind="error" title="Could not load lifecycle." />
              )}

              {lifecycleWorkflowsState === 'ready' && lifecycleWorkflows.length === 0 && (
                <StateMessage kind="empty" title="No lifecycle workflows" />
              )}

              {lifecycleWorkflowsState === 'ready' && lifecycleWorkflows.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {lifecycleWorkflows.map(workflow => {
                    const showingTasks = lifecycleTaskWorkflowId === workflow.id;
                    const taskDetails = lifecycleTasksByWorkflow[workflow.id];

                    return (
                      <div key={workflow.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10 }}>
                        <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                          {workflow.lifecycle_type === 'onboarding' ? 'Onboarding' : workflow.lifecycle_type === 'offboarding' ? 'Offboarding' : workflow.lifecycle_type}
                          {' · '}
                          {workflow.status}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                          Anchor {workflow.anchor_date}
                        </div>
                        {workflow.completed_at && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                            Completed {dateOnly(workflow.completed_at)}
                          </div>
                        )}
                        {workflow.cancelled_at && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                            Cancelled {dateOnly(workflow.cancelled_at)}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                          <button
                            type="button"
                            onClick={() => void toggleLifecycleTasks(workflow)}
                            {...lifecycleTaskButton}
                          >
                            {showingTasks ? 'Hide tasks' : 'View tasks'}
                          </button>
                          {workflow.capabilities.can_cancel
                            && cancelLifecycleWorkflowId !== workflow.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setCancelLifecycleWorkflowId(workflow.id);
                                setLifecycleCancelState('idle');
                              }}
                              {...lifecycleCancelWorkflowButton}
                            >
                              Cancel workflow
                            </button>
                          )}
                        </div>

                        {workflow.capabilities.can_cancel
                          && cancelLifecycleWorkflowId === workflow.id && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 6 }}>
                              Cancel this workflow?
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                onClick={() => void cancelLifecycleWorkflow(workflow)}
                                disabled={lifecycleCancelState === 'submitting'}
                                {...lifecycleConfirmCancelWorkflowButton}
                              >
                                {lifecycleCancelState === 'submitting' ? 'Cancelling…' : 'Confirm cancel'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCancelLifecycleWorkflowId(null);
                                  setLifecycleCancelState('idle');
                                }}
                                disabled={lifecycleCancelState === 'submitting'}
                                {...lifecycleCancelConfirmButton}
                              >
                                Keep workflow
                              </button>
                            </div>
                            {lifecycleCancelState === 'error' && (
                              <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 6 }}>
                                Could not cancel lifecycle workflow.
                              </div>
                            )}
                          </div>
                        )}

                        {showingTasks && taskDetails?.state === 'loading' && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 8 }}>
                            Loading tasks…
                          </div>
                        )}

                        {showingTasks && taskDetails?.state === 'error' && (
                          <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 8 }}>
                            Lifecycle tasks unavailable.
                          </div>
                        )}

                        {showingTasks && taskDetails?.state === 'ready' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border-subtle)' }}>
                            {taskDetails.tasks.length === 0 && (
                              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                                No visible tasks
                              </div>
                            )}
                            {taskDetails.tasks.map(task => {
                              const actionState = lifecycleTaskActionById[task.id] ?? 'idle';
                              const approvalState = lifecycleTaskApprovalById[task.id] ?? 'idle';

                              return (
                                <div key={task.id} style={{ padding: '5px 0' }}>
                                  <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>
                                    {task.title} · {task.status}
                                  </div>
                                  {task.due_at && (
                                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                                      Due {dateOnly(task.due_at)}
                                    </div>
                                  )}

                                  {task.capabilities.can_execute && task.status === 'NOT_STARTED' && (
                                    <div style={{ marginTop: 6 }}>
                                      <button
                                        type="button"
                                        onClick={() => void runLifecycleTaskAction(workflow, task, 'start')}
                                        disabled={actionState === 'submitting'}
                                        {...lifecycleStartButton}
                                      >
                                        {actionState === 'submitting' ? 'Starting…' : 'Start task'}
                                      </button>
                                    </div>
                                  )}

                                  {task.capabilities.can_execute && task.status === 'IN_PROGRESS' && (
                                    <div style={{ marginTop: 6 }}>
                                      <button
                                        type="button"
                                        onClick={() => void runLifecycleTaskAction(workflow, task, 'complete')}
                                        disabled={actionState === 'submitting'}
                                        {...lifecycleCompleteButton}
                                      >
                                        {actionState === 'submitting' ? 'Completing…' : 'Complete task'}
                                      </button>
                                    </div>
                                  )}

                                  {task.capabilities.can_approve && task.status === 'AWAITING_APPROVAL' && (
                                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 6 }}>
                                      <button
                                        type="button"
                                        onClick={() => void runLifecycleTaskApproval(workflow, task, 'APPROVED')}
                                        disabled={approvalState === 'approving' || approvalState === 'rejecting'}
                                        {...lifecycleApproveButton}
                                      >
                                        {approvalState === 'approving' ? 'Approving…' : 'Approve'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void runLifecycleTaskApproval(workflow, task, 'REJECTED')}
                                        disabled={approvalState === 'approving' || approvalState === 'rejecting'}
                                        {...lifecycleRejectButton}
                                      >
                                        {approvalState === 'rejecting' ? 'Rejecting…' : 'Reject'}
                                      </button>
                                    </div>
                                  )}

                                  {actionState === 'error' && (
                                    <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 5 }}>
                                      Could not update lifecycle task.
                                    </div>
                                  )}

                                  {approvalState === 'error' && (
                                    <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 5 }}>
                                      Could not record lifecycle task approval.
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

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
                    const showingVersionHistory = versionHistoryDocumentId === document.id;
                    const versionHistory = versionHistoryByDocument[document.id];

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
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                            <a
                              href={`/api/hr/people/${personId}/documents/${document.id}/versions/${document.current_version.id}`}
                              {...downloadDocumentButton}
                            >
                              Download
                            </a>
                            <button
                              type="button"
                              onClick={() => void toggleVersionHistory(document)}
                              {...versionHistoryButton}
                            >
                              {showingVersionHistory ? 'Hide version history' : 'Version history'}
                            </button>
                          </div>
                        )}

                        {showingVersionHistory && versionHistory?.state === 'loading' && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 8 }}>
                            Loading version history…
                          </div>
                        )}

                        {showingVersionHistory && versionHistory?.state === 'error' && (
                          <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 8 }}>
                            Version history unavailable.
                          </div>
                        )}

                        {showingVersionHistory && versionHistory?.state === 'ready' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border-subtle)' }}>
                            {versionHistory.versions.length === 0 && (
                              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                                No versions available.
                              </div>
                            )}
                            {versionHistory.versions.map(version => (
                              <div
                                key={version.id}
                                style={{ border: '1px solid var(--border-subtle)', borderRadius: 7, padding: 8 }}
                              >
                                <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>
                                  Version {version.version_number}{version.is_current ? ' · Current' : ''}
                                </div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                                  Added {dateOnly(version.created_at)}
                                </div>
                                {version.expires_at && (
                                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                                    Expires {dateOnly(version.expires_at)}
                                  </div>
                                )}
                                <div style={{ marginTop: 7 }}>
                                  <a
                                    href={`/api/hr/people/${personId}/documents/${document.id}/versions/${version.id}`}
                                    {...versionDownloadButton}
                                  >
                                    Download version {version.version_number}
                                  </a>
                                </div>
                              </div>
                            ))}
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

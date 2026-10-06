'use client';

import { useEffect, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';
import {
  Badge,
  Field,
  FormActions,
  FormError,
  PageHeader,
  TableContainer,
  TableStateRow,
  buttonProps,
  fieldControlClassName,
  tableStyles,
} from '@/components/ui/app';

type LifecycleTemplateSummary = {
  id: string;
  template_key: string;
  version_number: number;
  lifecycle_type: 'onboarding' | 'offboarding';
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  activated_at: string | null;
  retired_at: string | null;
  capabilities: {
    can_create_version: boolean;
    can_activate: boolean;
    can_retire: boolean;
  };
};

type LifecycleTemplateTask = {
  id: string;
  sequence: number;
  title: string;
  description: string | null;
  responsibility_type: 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';
  due_offset_days: number | null;
  requires_approval: boolean;
  approval_type: 'NONE' | 'MANAGER' | 'HR_ADMIN';
  employee_visible: boolean;
  manager_visible: boolean;
  internal_only: boolean;
};

type LifecycleTemplateDetailState =
  | { state: 'loading' }
  | {
      state: 'ready';
      template: LifecycleTemplateSummary;
      description: string | null;
      tasks: LifecycleTemplateTask[];
    }
  | { state: 'error' };

type LifecycleTemplateStatusAction = 'activate' | 'retire';
type LifecycleTemplateTypeFilter = '' | 'onboarding' | 'offboarding';
type LifecycleTemplateStatusFilter = '' | 'DRAFT' | 'ACTIVE' | 'RETIRED';
type LifecycleTemplateStatusActionState = 'idle' | 'submitting' | 'error';
type LifecycleTemplateCreateState = 'idle' | 'submitting' | 'error';
type LifecycleTemplateVersionState = 'idle' | 'submitting' | 'error';

type LifecycleTemplateDraftTask = {
  key: number;
  title: string;
  description: string;
  responsibility_type: 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';
  due_offset_days: string;
  requires_approval: boolean;
  approval_type: 'MANAGER' | 'HR_ADMIN';
  employee_visible: boolean;
  manager_visible: boolean;
  internal_only: boolean;
};

const STATUS_STATE = {
  DRAFT: 'info',
  ACTIVE: 'success',
  RETIRED: 'inactive',
} as const;

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function lifecycleTemplateListUrl(
  lifecycleType: LifecycleTemplateTypeFilter,
  status: LifecycleTemplateStatusFilter,
): string {
  const search = new URLSearchParams();
  if (lifecycleType) search.set('lifecycle_type', lifecycleType);
  if (status) search.set('status', status);
  const query = search.toString();
  return query ? `/api/hr/lifecycle/templates?${query}` : '/api/hr/lifecycle/templates';
}

function parseLifecycleTemplateList(data: unknown): {
  canCreateTemplate: boolean;
  templates: LifecycleTemplateSummary[];
} | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  if (!Array.isArray(payload.templates)) return null;

  const capabilities = (
    payload.capabilities
    && typeof payload.capabilities === 'object'
  ) ? payload.capabilities as Record<string, unknown> : {};

  const templates = payload.templates
    .filter((template: unknown): template is Record<string, unknown> => {
      if (!template || typeof template !== 'object') return false;
      const candidate = template as Record<string, unknown>;
      const capabilities = (
        candidate.capabilities
        && typeof candidate.capabilities === 'object'
      ) ? candidate.capabilities as Record<string, unknown> : null;

      return typeof candidate.id === 'string'
        && typeof candidate.template_key === 'string'
        && typeof candidate.version_number === 'number'
        && (candidate.lifecycle_type === 'onboarding' || candidate.lifecycle_type === 'offboarding')
        && typeof candidate.name === 'string'
        && (candidate.status === 'DRAFT' || candidate.status === 'ACTIVE' || candidate.status === 'RETIRED')
        && (candidate.activated_at === null || typeof candidate.activated_at === 'string')
        && (candidate.retired_at === null || typeof candidate.retired_at === 'string')
        && capabilities !== null;
    })
    .map((template: Record<string, unknown>): LifecycleTemplateSummary => {
      const capabilities = template.capabilities as Record<string, unknown>;
      return {
        id: template.id as string,
        template_key: template.template_key as string,
        version_number: template.version_number as number,
        lifecycle_type: template.lifecycle_type as 'onboarding' | 'offboarding',
        name: template.name as string,
        status: template.status as 'DRAFT' | 'ACTIVE' | 'RETIRED',
        activated_at: template.activated_at as string | null,
        retired_at: template.retired_at as string | null,
        capabilities: {
          can_create_version: capabilities.can_create_version === true,
          can_activate: capabilities.can_activate === true,
          can_retire: capabilities.can_retire === true,
        },
      };
    });

  return {
    canCreateTemplate: capabilities.can_create_template === true,
    templates,
  };
}

function draftTask(key: number): LifecycleTemplateDraftTask {
  return {
    key,
    title: '',
    description: '',
    responsibility_type: 'EMPLOYEE',
    due_offset_days: '',
    requires_approval: false,
    approval_type: 'MANAGER',
    employee_visible: true,
    manager_visible: false,
    internal_only: false,
  };
}

export default function LifecycleTemplatesPage() {
  const [templates, setTemplates] = useState<LifecycleTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [templateTypeFilter, setTemplateTypeFilter] = useState<LifecycleTemplateTypeFilter>('');
  const [templateStatusFilter, setTemplateStatusFilter] = useState<LifecycleTemplateStatusFilter>('');
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(null);
  const [detailByTemplate, setDetailByTemplate] = useState<Record<string, LifecycleTemplateDetailState>>({});
  const [confirmStatusAction, setConfirmStatusAction] = useState<{
    templateId: string;
    action: LifecycleTemplateStatusAction;
  } | null>(null);
  const [statusActionState, setStatusActionState] = useState<LifecycleTemplateStatusActionState>('idle');
  const [canCreateTemplate, setCanCreateTemplate] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [newTemplateKey, setNewTemplateKey] = useState('');
  const [newTemplateType, setNewTemplateType] = useState<'onboarding' | 'offboarding'>('onboarding');
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDescription, setNewTemplateDescription] = useState('');
  const [newTemplateTasks, setNewTemplateTasks] = useState<LifecycleTemplateDraftTask[]>([draftTask(1)]);
  const [nextTemplateTaskKey, setNextTemplateTaskKey] = useState(2);
  const [templateCreateState, setTemplateCreateState] = useState<LifecycleTemplateCreateState>('idle');
  const [versionSourceTemplateId, setVersionSourceTemplateId] = useState<string | null>(null);
  const [versionName, setVersionName] = useState('');
  const [versionDescription, setVersionDescription] = useState('');
  const [versionTasks, setVersionTasks] = useState<LifecycleTemplateDraftTask[]>([]);
  const [nextVersionTaskKey, setNextVersionTaskKey] = useState(1);
  const [templateVersionState, setTemplateVersionState] = useState<LifecycleTemplateVersionState>('idle');

  useEffect(() => {
    let cancelled = false;
    const listUrl = lifecycleTemplateListUrl(templateTypeFilter, templateStatusFilter);

    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError('');

      void fetch(listUrl)
        .then(async response => {
          const data = await response.json().catch(() => ({}));
          if (cancelled) return;

          if (!response.ok) {
            setTemplates([]);
            setError('Could not load lifecycle templates.');
            return;
          }

          const parsed = parseLifecycleTemplateList(data);
          if (!parsed) {
            setTemplates([]);
            setCanCreateTemplate(false);
            setError('Could not load lifecycle templates.');
            return;
          }

          setTemplates(parsed.templates);
          setCanCreateTemplate(parsed.canCreateTemplate);
          setError('');
        })
        .catch(() => {
          if (!cancelled) {
            setTemplates([]);
            setError('Could not load lifecycle templates.');
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [templateTypeFilter, templateStatusFilter]);

  async function refreshTemplates() {
    try {
      const response = await fetch(
        lifecycleTemplateListUrl(templateTypeFilter, templateStatusFilter),
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return false;

      const parsed = parseLifecycleTemplateList(data);
      if (!parsed) return false;

      setTemplates(parsed.templates);
      setCanCreateTemplate(parsed.canCreateTemplate);
      setError('');
      return true;
    } catch {
      return false;
    }
  }

  function resetCreateTemplateForm() {
    setNewTemplateKey('');
    setNewTemplateType('onboarding');
    setNewTemplateName('');
    setNewTemplateDescription('');
    setNewTemplateTasks([draftTask(1)]);
    setNextTemplateTaskKey(2);
    setTemplateCreateState('idle');
  }

  function updateTemplateTask(
    key: number,
    patch: Partial<Omit<LifecycleTemplateDraftTask, 'key'>>,
  ) {
    setNewTemplateTasks(current => current.map(task => (
      task.key === key ? { ...task, ...patch } : task
    )));
  }

  function addTemplateTask() {
    setNewTemplateTasks(current => [...current, draftTask(nextTemplateTaskKey)]);
    setNextTemplateTaskKey(current => current + 1);
  }

  function removeTemplateTask(key: number) {
    setNewTemplateTasks(current => (
      current.length > 1 ? current.filter(task => task.key !== key) : current
    ));
  }

  function resetVersionForm() {
    setVersionSourceTemplateId(null);
    setVersionName('');
    setVersionDescription('');
    setVersionTasks([]);
    setNextVersionTaskKey(1);
    setTemplateVersionState('idle');
  }

  function updateVersionTask(
    key: number,
    patch: Partial<Omit<LifecycleTemplateDraftTask, 'key'>>,
  ) {
    setVersionTasks(current => current.map(task => (
      task.key === key ? { ...task, ...patch } : task
    )));
  }

  function addVersionTask() {
    setVersionTasks(current => [...current, draftTask(nextVersionTaskKey)]);
    setNextVersionTaskKey(current => current + 1);
  }

  function removeVersionTask(key: number) {
    setVersionTasks(current => (
      current.length > 1 ? current.filter(task => task.key !== key) : current
    ));
  }

  function beginTemplateVersion(
    template: LifecycleTemplateSummary,
    detailState: Extract<LifecycleTemplateDetailState, { state: 'ready' }>,
  ) {
    if (!template.capabilities.can_create_version) return;

    setVersionSourceTemplateId(template.id);
    setVersionName(template.name);
    setVersionDescription(detailState.description ?? '');
    setVersionTasks(detailState.tasks.map((task, index) => ({
      key: index + 1,
      title: task.title,
      description: task.description ?? '',
      responsibility_type: task.responsibility_type,
      due_offset_days: task.due_offset_days === null ? '' : String(task.due_offset_days),
      requires_approval: task.requires_approval,
      approval_type: task.approval_type === 'HR_ADMIN' ? 'HR_ADMIN' : 'MANAGER',
      employee_visible: task.employee_visible,
      manager_visible: task.manager_visible,
      internal_only: task.internal_only,
    })));
    setNextVersionTaskKey(detailState.tasks.length + 1);
    setTemplateVersionState('idle');
    setOpenTemplateId(null);
    setConfirmStatusAction(null);
  }

  async function createTemplate() {
    if (!canCreateTemplate) return;

    const templateKey = newTemplateKey.trim();
    const name = newTemplateName.trim();
    const tasksValid = newTemplateTasks.every(task => {
      if (!task.title.trim()) return false;
      if (!task.due_offset_days.trim()) return true;
      const value = Number(task.due_offset_days);
      return Number.isInteger(value);
    });

    if (!templateKey || !name || !tasksValid) {
      setTemplateCreateState('error');
      return;
    }

    const tasks = newTemplateTasks.map((task, index) => ({
      sequence: index + 1,
      title: task.title.trim(),
      description: task.description.trim() || null,
      responsibility_type: task.responsibility_type,
      due_offset_days: task.due_offset_days.trim()
        ? Number(task.due_offset_days)
        : null,
      requires_approval: task.requires_approval,
      approval_type: task.requires_approval ? task.approval_type : 'NONE',
      employee_visible: task.internal_only ? false : task.employee_visible,
      manager_visible: task.internal_only ? false : task.manager_visible,
      internal_only: task.internal_only,
    }));

    setTemplateCreateState('submitting');

    try {
      const response = await fetch('/api/hr/lifecycle/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_key: templateKey,
          lifecycle_type: newTemplateType,
          name,
          description: newTemplateDescription.trim() || null,
          tasks,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || typeof data.template?.id !== 'string') {
        setTemplateCreateState('error');
        return;
      }

      setShowCreateTemplate(false);
      resetCreateTemplateForm();

      if (!await refreshTemplates()) {
        setError('Template was created, but the list could not be refreshed.');
      }
    } catch {
      setTemplateCreateState('error');
    }
  }

  async function createTemplateVersion() {
    const source = versionSourceTemplateId
      ? templates.find(template => template.id === versionSourceTemplateId) ?? null
      : null;
    if (!source || !source.capabilities.can_create_version) return;

    const name = versionName.trim();
    const tasksValid = versionTasks.length > 0 && versionTasks.every(task => {
      if (!task.title.trim()) return false;
      if (!task.due_offset_days.trim()) return true;
      return Number.isInteger(Number(task.due_offset_days));
    });

    if (!name || !tasksValid) {
      setTemplateVersionState('error');
      return;
    }

    const tasks = versionTasks.map((task, index) => ({
      sequence: index + 1,
      title: task.title.trim(),
      description: task.description.trim() || null,
      responsibility_type: task.responsibility_type,
      due_offset_days: task.due_offset_days.trim()
        ? Number(task.due_offset_days)
        : null,
      requires_approval: task.requires_approval,
      approval_type: task.requires_approval ? task.approval_type : 'NONE',
      employee_visible: task.internal_only ? false : task.employee_visible,
      manager_visible: task.internal_only ? false : task.manager_visible,
      internal_only: task.internal_only,
    }));

    setTemplateVersionState('submitting');

    try {
      const response = await fetch(
        `/api/hr/lifecycle/templates/${source.id}/versions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description: versionDescription.trim() || null,
            tasks,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (
        !response.ok
        || typeof data.template?.id !== 'string'
        || data.template?.template_key !== source.template_key
        || data.template?.lifecycle_type !== source.lifecycle_type
      ) {
        setTemplateVersionState('error');
        return;
      }

      resetVersionForm();

      if (!await refreshTemplates()) {
        setError('Template version was created, but the list could not be refreshed.');
      }
    } catch {
      setTemplateVersionState('error');
    }
  }

  async function runTemplateStatusAction(
    template: LifecycleTemplateSummary,
    action: LifecycleTemplateStatusAction,
  ) {
    const permitted = action === 'activate'
      ? template.capabilities.can_activate
      : template.capabilities.can_retire;
    if (!permitted) return;

    setStatusActionState('submitting');

    try {
      const response = await fetch(
        `/api/hr/lifecycle/templates/${template.id}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      const data = await response.json().catch(() => ({}));

      const expectedStatus = action === 'activate' ? 'ACTIVE' : 'RETIRED';
      if (
        !response.ok
        || data.template?.id !== template.id
        || data.template?.status !== expectedStatus
      ) {
        setStatusActionState('error');
        return;
      }

      if (!await refreshTemplates()) {
        setStatusActionState('error');
        return;
      }

      setConfirmStatusAction(null);
      setStatusActionState('idle');
    } catch {
      setStatusActionState('error');
    }
  }

  async function openTemplate(template: LifecycleTemplateSummary) {
    setOpenTemplateId(template.id);

    const existing = detailByTemplate[template.id];
    if (existing?.state === 'ready' || existing?.state === 'loading') return;

    setDetailByTemplate(current => ({
      ...current,
      [template.id]: { state: 'loading' },
    }));

    try {
      const response = await fetch(`/api/hr/lifecycle/templates/${template.id}`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.template || !Array.isArray(data.template.tasks)) {
        setDetailByTemplate(current => ({
          ...current,
          [template.id]: { state: 'error' },
        }));
        return;
      }

      const tasks = data.template.tasks
        .filter((task: unknown): task is Record<string, unknown> => {
          if (!task || typeof task !== 'object') return false;
          const candidate = task as Record<string, unknown>;
          return typeof candidate.id === 'string'
            && typeof candidate.sequence === 'number'
            && typeof candidate.title === 'string'
            && (
              candidate.responsibility_type === 'EMPLOYEE'
              || candidate.responsibility_type === 'MANAGER'
              || candidate.responsibility_type === 'HR_ADMIN'
            )
            && (candidate.description === null || typeof candidate.description === 'string')
            && (candidate.due_offset_days === null || typeof candidate.due_offset_days === 'number')
            && typeof candidate.requires_approval === 'boolean'
            && (
              candidate.approval_type === 'NONE'
              || candidate.approval_type === 'MANAGER'
              || candidate.approval_type === 'HR_ADMIN'
            )
            && typeof candidate.employee_visible === 'boolean'
            && typeof candidate.manager_visible === 'boolean'
            && typeof candidate.internal_only === 'boolean';
        })
        .map((task: Record<string, unknown>): LifecycleTemplateTask => ({
          id: task.id as string,
          sequence: task.sequence as number,
          title: task.title as string,
          description: task.description as string | null,
          responsibility_type: task.responsibility_type as 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN',
          due_offset_days: task.due_offset_days as number | null,
          requires_approval: task.requires_approval as boolean,
          approval_type: task.approval_type as 'NONE' | 'MANAGER' | 'HR_ADMIN',
          employee_visible: task.employee_visible as boolean,
          manager_visible: task.manager_visible as boolean,
          internal_only: task.internal_only as boolean,
        }));

      setDetailByTemplate(current => ({
        ...current,
        [template.id]: {
          state: 'ready',
          template,
          description: typeof data.template.description === 'string'
            ? data.template.description
            : null,
          tasks,
        },
      }));
    } catch {
      setDetailByTemplate(current => ({
        ...current,
        [template.id]: { state: 'error' },
      }));
    }
  }

  const selectedTemplate = openTemplateId
    ? templates.find(template => template.id === openTemplateId) ?? null
    : null;
  const detail = openTemplateId ? detailByTemplate[openTemplateId] : undefined;
  const versionSourceTemplate = versionSourceTemplateId
    ? templates.find(template => template.id === versionSourceTemplateId) ?? null
    : null;

  return (
    <div style={{ maxWidth: 1000 }}>
      <PageHeader
        title="Lifecycle Templates"
        description="Review the onboarding and offboarding templates available to your organisation."
        actions={canCreateTemplate ? (
          <button
            type="button"
            onClick={() => {
              setOpenTemplateId(null);
              setConfirmStatusAction(null);
              resetCreateTemplateForm();
              setShowCreateTemplate(true);
            }}
            {...buttonProps('primary')}
          >
            + Create Template
          </button>
        ) : undefined}
      />

      <div
        aria-label="Lifecycle template filters"
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Lifecycle type</span>
          <select
            aria-label="Lifecycle type filter"
            value={templateTypeFilter}
            onChange={event => setTemplateTypeFilter(
              event.target.value as LifecycleTemplateTypeFilter,
            )}
            className={fieldControlClassName}
          >
            <option value="">All types</option>
            <option value="onboarding">Onboarding</option>
            <option value="offboarding">Offboarding</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Status</span>
          <select
            aria-label="Lifecycle status filter"
            value={templateStatusFilter}
            onChange={event => setTemplateStatusFilter(
              event.target.value as LifecycleTemplateStatusFilter,
            )}
            className={fieldControlClassName}
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="RETIRED">Retired</option>
          </select>
        </label>

        {(templateTypeFilter || templateStatusFilter) && (
          <button
            type="button"
            onClick={() => {
              setTemplateTypeFilter('');
              setTemplateStatusFilter('');
            }}
            {...buttonProps('secondary', 'sm')}
          >
            Clear filters
          </button>
        )}
      </div>

      <TableContainer label="Lifecycle templates" minWidth={760}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Template</th>
              <th scope="col">Type</th>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              <th scope="col">Activated</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={6} kind="loading">Loading lifecycle templates…</TableStateRow>}
            {!loading && error && <TableStateRow colSpan={6} kind="error">{error}</TableStateRow>}
            {!loading && !error && templates.length === 0 && (
              <TableStateRow colSpan={6} kind="empty">No lifecycle templates yet.</TableStateRow>
            )}
            {!loading && !error && templates.flatMap((template, index) => {
              const previousTemplate = index > 0 ? templates[index - 1] : null;
              const startsFamily = previousTemplate?.template_key !== template.template_key;

              return [
                ...(startsFamily ? [
                  <tr key={`family-${template.template_key}`}>
                    <th
                      scope="rowgroup"
                      colSpan={6}
                      style={{
                        textAlign: 'left',
                        paddingTop: index === 0 ? 8 : 18,
                        paddingBottom: 6,
                        color: 'var(--text-secondary)',
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.02em',
                      }}
                    >
                      Family: {template.template_key}
                    </th>
                  </tr>,
                ] : []),
                <tr key={template.id}>
                  <td className={tableStyles.primary}>{template.name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{template.lifecycle_type}</td>
                  <td>v{template.version_number}</td>
                  <td><Badge state={STATUS_STATE[template.status]}>{template.status}</Badge></td>
                  <td>{template.activated_at ? dateOnly(template.activated_at) : <span className={tableStyles.muted}>—</span>}</td>
                  <td className={tableStyles.actions}>
                    <button
                      type="button"
                      className={tableStyles.link}
                      onClick={() => void openTemplate(template)}
                      aria-label={`View ${template.name}`}
                    >
                      View →
                    </button>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </TableContainer>

      <SlidePanel
        open={showCreateTemplate}
        onClose={() => {
          setShowCreateTemplate(false);
          resetCreateTemplateForm();
        }}
        title="Create lifecycle template"
      >
        <form
          onSubmit={event => {
            event.preventDefault();
            void createTemplate();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <Field label="Template key" required helper="Stable identifier for this template family.">
            {control => (
              <input
                {...control}
                required
                value={newTemplateKey}
                onChange={event => setNewTemplateKey(event.target.value)}
                className={fieldControlClassName}
                placeholder="standard-onboarding"
              />
            )}
          </Field>

          <Field label="Lifecycle type" required>
            {control => (
              <select
                {...control}
                required
                value={newTemplateType}
                onChange={event => setNewTemplateType(event.target.value as 'onboarding' | 'offboarding')}
                className={fieldControlClassName}
              >
                <option value="onboarding">Onboarding</option>
                <option value="offboarding">Offboarding</option>
              </select>
            )}
          </Field>

          <Field label="Name" required>
            {control => (
              <input
                {...control}
                required
                value={newTemplateName}
                onChange={event => setNewTemplateName(event.target.value)}
                className={fieldControlClassName}
              />
            )}
          </Field>

          <Field label="Description">
            {control => (
              <textarea
                {...control}
                rows={3}
                value={newTemplateDescription}
                onChange={event => setNewTemplateDescription(event.target.value)}
                className={fieldControlClassName}
              />
            )}
          </Field>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>
              Tasks
            </div>

            {newTemplateTasks.map((task, index) => (
              <div
                key={task.key}
                style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                    Task {index + 1}
                  </div>
                  {newTemplateTasks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTemplateTask(task.key)}
                      {...buttonProps('ghost', 'sm')}
                    >
                      Remove task
                    </button>
                  )}
                </div>

                <Field label="Task title" required>
                  {control => (
                    <input
                      {...control}
                      required
                      value={task.title}
                      onChange={event => updateTemplateTask(task.key, { title: event.target.value })}
                      className={fieldControlClassName}
                    />
                  )}
                </Field>

                <Field label="Task description">
                  {control => (
                    <textarea
                      {...control}
                      rows={2}
                      value={task.description}
                      onChange={event => updateTemplateTask(task.key, { description: event.target.value })}
                      className={fieldControlClassName}
                    />
                  )}
                </Field>

                <Field label="Responsibility" required>
                  {control => (
                    <select
                      {...control}
                      required
                      value={task.responsibility_type}
                      onChange={event => updateTemplateTask(task.key, {
                        responsibility_type: event.target.value as 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN',
                      })}
                      className={fieldControlClassName}
                    >
                      <option value="EMPLOYEE">Employee</option>
                      <option value="MANAGER">Manager</option>
                      <option value="HR_ADMIN">HR administrator</option>
                    </select>
                  )}
                </Field>

                <Field label="Due offset days" helper="Whole days relative to the workflow anchor date. Negative values are allowed.">
                  {control => (
                    <input
                      {...control}
                      type="number"
                      step="1"
                      value={task.due_offset_days}
                      onChange={event => updateTemplateTask(task.key, { due_offset_days: event.target.value })}
                      className={fieldControlClassName}
                    />
                  )}
                </Field>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={task.requires_approval}
                    onChange={event => updateTemplateTask(task.key, {
                      requires_approval: event.target.checked,
                    })}
                  />
                  Requires approval
                </label>

                {task.requires_approval && (
                  <Field label="Approval type" required>
                    {control => (
                      <select
                        {...control}
                        required
                        value={task.approval_type}
                        onChange={event => updateTemplateTask(task.key, {
                          approval_type: event.target.value as 'MANAGER' | 'HR_ADMIN',
                        })}
                        className={fieldControlClassName}
                      >
                        <option value="MANAGER">Manager</option>
                        <option value="HR_ADMIN">HR administrator</option>
                      </select>
                    )}
                  </Field>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Visibility</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={task.employee_visible}
                      disabled={task.internal_only}
                      onChange={event => updateTemplateTask(task.key, { employee_visible: event.target.checked })}
                    />
                    Employee visible
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={task.manager_visible}
                      disabled={task.internal_only}
                      onChange={event => updateTemplateTask(task.key, { manager_visible: event.target.checked })}
                    />
                    Manager visible
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={task.internal_only}
                      onChange={event => updateTemplateTask(task.key, {
                        internal_only: event.target.checked,
                        ...(event.target.checked
                          ? { employee_visible: false, manager_visible: false }
                          : {}),
                      })}
                    />
                    Internal only
                  </label>
                </div>
              </div>
            ))}

            <div>
              <button
                type="button"
                onClick={addTemplateTask}
                {...buttonProps('secondary', 'sm')}
              >
                + Add task
              </button>
            </div>
          </div>

          {templateCreateState === 'error' && (
            <FormError>Could not create lifecycle template.</FormError>
          )}

          <FormActions>
            <button
              type="button"
              onClick={() => {
                setShowCreateTemplate(false);
                resetCreateTemplateForm();
              }}
              disabled={templateCreateState === 'submitting'}
              {...buttonProps('secondary')}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={templateCreateState === 'submitting'}
              {...buttonProps('primary')}
            >
              {templateCreateState === 'submitting' ? 'Creating…' : 'Create template'}
            </button>
          </FormActions>
        </form>
      </SlidePanel>

      <SlidePanel
        open={versionSourceTemplate !== null}
        onClose={resetVersionForm}
        title="Create lifecycle template version"
      >
        {versionSourceTemplate && (
          <form
            onSubmit={event => {
              event.preventDefault();
              void createTemplateVersion();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              Family: {versionSourceTemplate.template_key} · {versionSourceTemplate.lifecycle_type} · source v{versionSourceTemplate.version_number}
            </div>

            <Field label="Name" required>
              {control => (
                <input
                  {...control}
                  required
                  value={versionName}
                  onChange={event => setVersionName(event.target.value)}
                  className={fieldControlClassName}
                />
              )}
            </Field>

            <Field label="Description">
              {control => (
                <textarea
                  {...control}
                  rows={3}
                  value={versionDescription}
                  onChange={event => setVersionDescription(event.target.value)}
                  className={fieldControlClassName}
                />
              )}
            </Field>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>
                Tasks
              </div>

              {versionTasks.map((task, index) => (
                <div
                  key={task.key}
                  style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                      Task {index + 1}
                    </div>
                    {versionTasks.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeVersionTask(task.key)}
                        {...buttonProps('ghost', 'sm')}
                      >
                        Remove task
                      </button>
                    )}
                  </div>

                  <Field label="Task title" required>
                    {control => (
                      <input
                        {...control}
                        required
                        value={task.title}
                        onChange={event => updateVersionTask(task.key, { title: event.target.value })}
                        className={fieldControlClassName}
                      />
                    )}
                  </Field>

                  <Field label="Task description">
                    {control => (
                      <textarea
                        {...control}
                        rows={2}
                        value={task.description}
                        onChange={event => updateVersionTask(task.key, { description: event.target.value })}
                        className={fieldControlClassName}
                      />
                    )}
                  </Field>

                  <Field label="Responsibility" required>
                    {control => (
                      <select
                        {...control}
                        required
                        value={task.responsibility_type}
                        onChange={event => updateVersionTask(task.key, {
                          responsibility_type: event.target.value as 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN',
                        })}
                        className={fieldControlClassName}
                      >
                        <option value="EMPLOYEE">Employee</option>
                        <option value="MANAGER">Manager</option>
                        <option value="HR_ADMIN">HR administrator</option>
                      </select>
                    )}
                  </Field>

                  <Field label="Due offset days" helper="Whole days relative to the workflow anchor date. Negative values are allowed.">
                    {control => (
                      <input
                        {...control}
                        type="number"
                        step="1"
                        value={task.due_offset_days}
                        onChange={event => updateVersionTask(task.key, { due_offset_days: event.target.value })}
                        className={fieldControlClassName}
                      />
                    )}
                  </Field>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={task.requires_approval}
                      onChange={event => updateVersionTask(task.key, {
                        requires_approval: event.target.checked,
                      })}
                    />
                    Requires approval
                  </label>

                  {task.requires_approval && (
                    <Field label="Approval type" required>
                      {control => (
                        <select
                          {...control}
                          required
                          value={task.approval_type}
                          onChange={event => updateVersionTask(task.key, {
                            approval_type: event.target.value as 'MANAGER' | 'HR_ADMIN',
                          })}
                          className={fieldControlClassName}
                        >
                          <option value="MANAGER">Manager</option>
                          <option value="HR_ADMIN">HR administrator</option>
                        </select>
                      )}
                    </Field>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Visibility</div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={task.employee_visible}
                        disabled={task.internal_only}
                        onChange={event => updateVersionTask(task.key, { employee_visible: event.target.checked })}
                      />
                      Employee visible
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={task.manager_visible}
                        disabled={task.internal_only}
                        onChange={event => updateVersionTask(task.key, { manager_visible: event.target.checked })}
                      />
                      Manager visible
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={task.internal_only}
                        onChange={event => updateVersionTask(task.key, {
                          internal_only: event.target.checked,
                          ...(event.target.checked
                            ? { employee_visible: false, manager_visible: false }
                            : {}),
                        })}
                      />
                      Internal only
                    </label>
                  </div>
                </div>
              ))}

              <div>
                <button
                  type="button"
                  onClick={addVersionTask}
                  {...buttonProps('secondary', 'sm')}
                >
                  + Add task
                </button>
              </div>
            </div>

            {templateVersionState === 'error' && (
              <FormError>Could not create lifecycle template version.</FormError>
            )}

            <FormActions>
              <button
                type="button"
                onClick={resetVersionForm}
                disabled={templateVersionState === 'submitting'}
                {...buttonProps('secondary')}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={templateVersionState === 'submitting'}
                {...buttonProps('primary')}
              >
                {templateVersionState === 'submitting' ? 'Creating…' : 'Create version'}
              </button>
            </FormActions>
          </form>
        )}
      </SlidePanel>

      <SlidePanel
        open={selectedTemplate !== null}
        onClose={() => {
          setOpenTemplateId(null);
          setConfirmStatusAction(null);
          setStatusActionState('idle');
        }}
        title={selectedTemplate?.name ?? 'Lifecycle template'}
      >
        {selectedTemplate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                {selectedTemplate.lifecycle_type} · v{selectedTemplate.version_number} · {selectedTemplate.status}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
                Key: {selectedTemplate.template_key}
              </div>
              {detail?.state === 'ready' && detail.description && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 6 }}>
                  {detail.description}
                </div>
              )}
              {selectedTemplate.retired_at && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
                  Retired {dateOnly(selectedTemplate.retired_at)}
                </div>
              )}
            </div>

            {selectedTemplate.capabilities.can_create_version && detail?.state === 'ready' && (
              <div>
                <button
                  type="button"
                  onClick={() => beginTemplateVersion(selectedTemplate, detail)}
                  {...buttonProps('secondary', 'sm')}
                >
                  Create new version
                </button>
              </div>
            )}

            {(selectedTemplate.capabilities.can_activate || selectedTemplate.capabilities.can_retire) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {confirmStatusAction?.templateId !== selectedTemplate.id && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {selectedTemplate.capabilities.can_activate && (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmStatusAction({ templateId: selectedTemplate.id, action: 'activate' });
                          setStatusActionState('idle');
                        }}
                        {...buttonProps('primary', 'sm')}
                      >
                        Activate
                      </button>
                    )}
                    {selectedTemplate.capabilities.can_retire && (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmStatusAction({ templateId: selectedTemplate.id, action: 'retire' });
                          setStatusActionState('idle');
                        }}
                        {...buttonProps('ghost', 'sm')}
                      >
                        Retire
                      </button>
                    )}
                  </div>
                )}

                {confirmStatusAction?.templateId === selectedTemplate.id && (
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 6 }}>
                      {confirmStatusAction.action === 'activate'
                        ? 'Activate this template version?'
                        : 'Retire this template version?'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => void runTemplateStatusAction(
                          selectedTemplate,
                          confirmStatusAction.action,
                        )}
                        disabled={statusActionState === 'submitting'}
                        {...buttonProps(
                          confirmStatusAction.action === 'retire' ? 'danger' : 'primary',
                          'sm',
                        )}
                      >
                        {statusActionState === 'submitting'
                          ? (confirmStatusAction.action === 'activate' ? 'Activating…' : 'Retiring…')
                          : (confirmStatusAction.action === 'activate' ? 'Confirm activate' : 'Confirm retire')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmStatusAction(null);
                          setStatusActionState('idle');
                        }}
                        disabled={statusActionState === 'submitting'}
                        {...buttonProps('secondary', 'sm')}
                      >
                        Keep template
                      </button>
                    </div>
                    {statusActionState === 'error' && (
                      <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 6 }}>
                        Could not update lifecycle template.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {detail?.state === 'loading' && (
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading template tasks…</div>
            )}

            {detail?.state === 'error' && (
              <div aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                Could not load lifecycle template details.
              </div>
            )}

            {detail?.state === 'ready' && detail.tasks.length === 0 && (
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No tasks in this template.</div>
            )}

            {detail?.state === 'ready' && detail.tasks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detail.tasks.map(task => (
                  <div
                    key={task.id}
                    style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10 }}
                  >
                    <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                      {task.sequence}. {task.title}
                    </div>
                    {task.description && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                        {task.description}
                      </div>
                    )}
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                      Responsibility: {task.responsibility_type}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                      Due offset: {task.due_offset_days === null ? 'None' : `${task.due_offset_days} days`}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                      Approval: {task.requires_approval ? task.approval_type : 'None'}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                      Visibility: {task.internal_only
                        ? 'Internal only'
                        : [
                            task.employee_visible ? 'Employee' : null,
                            task.manager_visible ? 'Manager' : null,
                          ].filter(Boolean).join(', ') || 'HR administrators only'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SlidePanel>
    </div>
  );
}

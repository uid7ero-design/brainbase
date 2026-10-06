'use client';

import { useEffect, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';
import {
  Badge,
  PageHeader,
  TableContainer,
  TableStateRow,
  buttonProps,
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
};

type LifecycleTemplateTask = {
  id: string;
  sequence: number;
  title: string;
  responsibility_type: 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';
  due_offset_days: number | null;
  requires_approval: boolean;
  approval_type: 'NONE' | 'MANAGER' | 'HR_ADMIN';
};

type LifecycleTemplateDetailState =
  | { state: 'loading' }
  | { state: 'ready'; template: LifecycleTemplateSummary; tasks: LifecycleTemplateTask[] }
  | { state: 'error' };

const STATUS_STATE = {
  DRAFT: 'info',
  ACTIVE: 'success',
  RETIRED: 'inactive',
} as const;

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export default function LifecycleTemplatesPage() {
  const [templates, setTemplates] = useState<LifecycleTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(null);
  const [detailByTemplate, setDetailByTemplate] = useState<Record<string, LifecycleTemplateDetailState>>({});

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      void fetch('/api/hr/lifecycle/templates')
        .then(async response => {
          const data = await response.json().catch(() => ({}));
          if (cancelled) return;

          if (!response.ok || !Array.isArray(data.templates)) {
            setTemplates([]);
            setError('Could not load lifecycle templates.');
            return;
          }

          const safeTemplates = data.templates
            .filter((template: unknown): template is Record<string, unknown> => {
              if (!template || typeof template !== 'object') return false;
              const candidate = template as Record<string, unknown>;
              return typeof candidate.id === 'string'
                && typeof candidate.template_key === 'string'
                && typeof candidate.version_number === 'number'
                && (candidate.lifecycle_type === 'onboarding' || candidate.lifecycle_type === 'offboarding')
                && typeof candidate.name === 'string'
                && (candidate.status === 'DRAFT' || candidate.status === 'ACTIVE' || candidate.status === 'RETIRED')
                && (candidate.activated_at === null || typeof candidate.activated_at === 'string')
                && (candidate.retired_at === null || typeof candidate.retired_at === 'string');
            })
            .map((template: Record<string, unknown>): LifecycleTemplateSummary => ({
              id: template.id as string,
              template_key: template.template_key as string,
              version_number: template.version_number as number,
              lifecycle_type: template.lifecycle_type as 'onboarding' | 'offboarding',
              name: template.name as string,
              status: template.status as 'DRAFT' | 'ACTIVE' | 'RETIRED',
              activated_at: template.activated_at as string | null,
              retired_at: template.retired_at as string | null,
            }));

          setTemplates(safeTemplates);
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
  }, []);

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
            && (candidate.due_offset_days === null || typeof candidate.due_offset_days === 'number')
            && typeof candidate.requires_approval === 'boolean'
            && (
              candidate.approval_type === 'NONE'
              || candidate.approval_type === 'MANAGER'
              || candidate.approval_type === 'HR_ADMIN'
            );
        })
        .map((task: Record<string, unknown>): LifecycleTemplateTask => ({
          id: task.id as string,
          sequence: task.sequence as number,
          title: task.title as string,
          responsibility_type: task.responsibility_type as 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN',
          due_offset_days: task.due_offset_days as number | null,
          requires_approval: task.requires_approval as boolean,
          approval_type: task.approval_type as 'NONE' | 'MANAGER' | 'HR_ADMIN',
        }));

      setDetailByTemplate(current => ({
        ...current,
        [template.id]: {
          state: 'ready',
          template,
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

  const openTemplate = openTemplateId
    ? templates.find(template => template.id === openTemplateId) ?? null
    : null;
  const detail = openTemplateId ? detailByTemplate[openTemplateId] : undefined;

  return (
    <div style={{ maxWidth: 1000 }}>
      <PageHeader
        title="Lifecycle Templates"
        description="Review the onboarding and offboarding templates available to your organisation."
      />

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
            {!loading && !error && templates.map(template => (
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
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>

      <SlidePanel
        open={openTemplate !== null}
        onClose={() => setOpenTemplateId(null)}
        title={openTemplate?.name ?? 'Lifecycle template'}
      >
        {openTemplate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                {openTemplate.lifecycle_type} · v{openTemplate.version_number} · {openTemplate.status}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
                Key: {openTemplate.template_key}
              </div>
              {openTemplate.retired_at && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
                  Retired {dateOnly(openTemplate.retired_at)}
                </div>
              )}
            </div>

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
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                      Responsibility: {task.responsibility_type}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                      Due offset: {task.due_offset_days === null ? 'None' : `${task.due_offset_days} days`}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 3 }}>
                      Approval: {task.requires_approval ? task.approval_type : 'None'}
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

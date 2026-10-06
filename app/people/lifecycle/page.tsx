'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  PageHeader,
  StateMessage,
  TableContainer,
  TableStateRow,
  tableStyles,
} from '@/components/ui/app';

type WorkloadPerson = {
  id: string;
  first_name: string;
  last_name: string;
};

type LifecycleWorkflowSummary = {
  id: string;
  person_id: string;
  lifecycle_type: 'onboarding' | 'offboarding';
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  anchor_date: string;
  started_at: string;
};

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function parsePeople(data: unknown): {
  canManage: boolean;
  people: WorkloadPerson[];
} | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  if (!Array.isArray(payload.people)) return null;

  const people = payload.people
    .filter((person: unknown): person is Record<string, unknown> => {
      if (!person || typeof person !== 'object') return false;
      const candidate = person as Record<string, unknown>;
      return typeof candidate.id === 'string'
        && typeof candidate.first_name === 'string'
        && typeof candidate.last_name === 'string';
    })
    .map((person: Record<string, unknown>): WorkloadPerson => ({
      id: person.id as string,
      first_name: person.first_name as string,
      last_name: person.last_name as string,
    }));

  return {
    canManage: payload.canManage === true,
    people,
  };
}

function parseWorkflows(data: unknown): LifecycleWorkflowSummary[] | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  if (!Array.isArray(payload.workflows)) return null;

  return payload.workflows
    .filter((workflow: unknown): workflow is Record<string, unknown> => {
      if (!workflow || typeof workflow !== 'object') return false;
      const candidate = workflow as Record<string, unknown>;
      return typeof candidate.id === 'string'
        && typeof candidate.person_id === 'string'
        && (candidate.lifecycle_type === 'onboarding' || candidate.lifecycle_type === 'offboarding')
        && candidate.status === 'ACTIVE'
        && typeof candidate.anchor_date === 'string'
        && typeof candidate.started_at === 'string';
    })
    .map((workflow: Record<string, unknown>): LifecycleWorkflowSummary => ({
      id: workflow.id as string,
      person_id: workflow.person_id as string,
      lifecycle_type: workflow.lifecycle_type as 'onboarding' | 'offboarding',
      status: 'ACTIVE',
      anchor_date: workflow.anchor_date as string,
      started_at: workflow.started_at as string,
    }));
}

export default function LifecycleWorkloadPage() {
  const [peopleById, setPeopleById] = useState<Record<string, string>>({});
  const [workflows, setWorkflows] = useState<LifecycleWorkflowSummary[]>([]);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      void (async () => {
        try {
          const peopleResponse = await fetch('/api/hr/people');
          const peopleData = await peopleResponse.json().catch(() => ({}));
          if (cancelled) return;

          const parsedPeople = peopleResponse.ok ? parsePeople(peopleData) : null;
          if (!parsedPeople) {
            setError('Could not load lifecycle workload.');
            return;
          }

          setCanManage(parsedPeople.canManage);
          if (!parsedPeople.canManage) return;

          const names: Record<string, string> = {};
          for (const person of parsedPeople.people) {
            names[person.id] = `${person.first_name} ${person.last_name}`;
          }
          setPeopleById(names);

          const workflowResponse = await fetch('/api/hr/lifecycle/workflows?status=ACTIVE');
          const workflowData = await workflowResponse.json().catch(() => ({}));
          if (cancelled) return;

          const parsedWorkflows = workflowResponse.ok ? parseWorkflows(workflowData) : null;
          if (!parsedWorkflows) {
            setError('Could not load lifecycle workload.');
            return;
          }

          setWorkflows(parsedWorkflows);
          setError('');
        } catch {
          if (!cancelled) setError('Could not load lifecycle workload.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ maxWidth: 1000 }}>
      <PageHeader
        title="Lifecycle Workload"
        description="Active onboarding and offboarding workflows across your organisation."
        eyebrow={<Link href="/people">← People</Link>}
      />

      {loading && <StateMessage kind="loading" title="Loading lifecycle workload…" />}

      {!loading && error && (
        <StateMessage kind="error" title={error} />
      )}

      {!loading && !error && canManage === false && (
        <StateMessage
          kind="empty"
          title="Lifecycle workload is available to HR administrators."
        />
      )}

      {!loading && !error && canManage && (
        <TableContainer label="Active lifecycle workflows" minWidth={720}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Anchor</th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {workflows.length === 0 && (
                <TableStateRow colSpan={5} kind="empty">
                  No active lifecycle workflows.
                </TableStateRow>
              )}
              {workflows.map(workflow => (
                <tr key={workflow.id}>
                  <td className={tableStyles.primary}>
                    {peopleById[workflow.person_id] ?? 'Person unavailable'}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{workflow.lifecycle_type}</td>
                  <td><Badge state="success">{workflow.status}</Badge></td>
                  <td>{workflow.anchor_date}</td>
                  <td>{dateOnly(workflow.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableContainer>
      )}
    </div>
  );
}

'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Metric, MetricStrip, PageHeader, StateMessage } from '@/components/ui/app';
import { getPreset } from '@scheduling/core';
import { schedulingApi, seg, type ApiProblem } from '@/lib/scheduling/dashboard/api';
import type { OfferingView, ResourceView, ScheduleView } from '@/lib/scheduling/dashboard/types';
import { LoadError } from './parts';
import { useSchedulingData } from './useSchedulingData';
import styles from './scheduling.module.css';

// The landing screen: how far set-up has got and what to do next. It reads the same API as the other screens (schedules, resources
// and each active schedule's offerings) and decides nothing on its own: the four steps are derived from what those return.

const MAX_SCHEDULES_INSPECTED = 12;

interface Setup {
  schedules: ScheduleView[];
  offeringsBySchedule: Map<string, OfferingView[]>;
  resources: ResourceView[];
}

export default function Overview({ canManage }: { canManage: boolean }) {
  const schedulesData = useSchedulingData<{ schedules: ScheduleView[] }>('/schedules');
  const resourcesData = useSchedulingData<{ resources: ResourceView[] }>('/resources');
  const [offerings, setOfferings] = useState<Map<string, OfferingView[]> | null>(null);
  const [offeringsProblem, setOfferingsProblem] = useState<ApiProblem | null>(null);

  const active = useMemo(() => (schedulesData.data?.schedules ?? []).filter(s => s.archivedAt === null), [schedulesData.data]);
  const activeKey = active.map(s => s.id).join(',');

  useEffect(() => {
    if (schedulesData.state !== 'ready') return;
    let cancelled = false;
    (async () => {
      const found = new Map<string, OfferingView[]>();
      for (const s of active.slice(0, MAX_SCHEDULES_INSPECTED)) {
        const r = await schedulingApi<{ offerings: OfferingView[] }>('GET', `/schedules/${seg(s.id)}`);
        if (cancelled) return;
        if (!r.ok) {
          setOfferingsProblem(r.problem);
          return;
        }
        found.set(s.id, r.data.offerings.filter(o => o.archivedAt === null));
      }
      if (!cancelled) {
        setOfferingsProblem(null);
        setOfferings(found);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `activeKey` stands for the list of active schedule ids
  }, [schedulesData.state, activeKey, active]);

  const header = <PageHeader title="Scheduling" description="Set up what you offer, then the resources it uses. Taking reservations is not part of this release." />;
  const failed = schedulesData.state === 'error' ? schedulesData.problem : resourcesData.state === 'error' ? resourcesData.problem : offeringsProblem;
  if (failed) {
    return (
      <div className={styles.page}>
        {header}
        <LoadError problem={failed} onRetry={() => { schedulesData.reload(); resourcesData.reload(); }} />
      </div>
    );
  }
  if (schedulesData.state === 'loading' || resourcesData.state === 'loading' || offerings === null) {
    return (
      <div className={styles.page}>
        {header}
        <StateMessage kind="loading" title="Loading your set-up…" />
      </div>
    );
  }

  const setup: Setup = { schedules: active, offeringsBySchedule: offerings, resources: resourcesData.data?.resources ?? [] };
  return (
    <div className={styles.page}>
      {header}
      {!canManage && <p className={styles.notice} role="note">You have view-only access to Scheduling. Ask a manager to make changes.</p>}
      <SetupSummary setup={setup} canManage={canManage} />
    </div>
  );
}

function SetupSummary({ setup, canManage }: { setup: Setup; canManage: boolean }) {
  const { schedules, offeringsBySchedule, resources } = setup;
  const allOfferings = schedules.flatMap(s => offeringsBySchedule.get(s.id) ?? []);
  const activeResources = resources.filter(r => r.active);
  const needsResources = schedules.flatMap(s => (getPreset(s.presetKey).resources.requirement === 'required' ? offeringsBySchedule.get(s.id) ?? [] : []));
  const unassigned = needsResources.filter(o => o.resourceKinds.length === 0);
  const emptySchedules = schedules.filter(s => (offeringsBySchedule.get(s.id) ?? []).length === 0);

  const steps = [
    {
      done: schedules.length > 0,
      title: 'Create a schedule',
      body: schedules.length > 0 ? `${schedules.length} active ${schedules.length === 1 ? 'schedule' : 'schedules'}.` : 'Choose what kind of bookings you take: classes, appointments or facility hire.',
      href: '/scheduling/schedules',
      cta: schedules.length > 0 ? 'View schedules' : canManage ? 'Create a schedule' : 'View schedules',
    },
    {
      done: schedules.length > 0 && emptySchedules.length === 0,
      title: 'Add what customers book',
      body:
        schedules.length === 0
          ? 'Once you have a schedule, add its sessions, services or facilities.'
          : emptySchedules.length === 0
            ? `${allOfferings.length} ${allOfferings.length === 1 ? 'offering' : 'offerings'} set up.`
            : `${emptySchedules.map(s => s.name).join(', ')} ${emptySchedules.length === 1 ? 'has' : 'have'} nothing to book yet.`,
      href: emptySchedules[0] ? `/scheduling/schedules/${seg(emptySchedules[0].id)}` : '/scheduling/schedules',
      cta: 'Open schedule',
    },
    {
      done: activeResources.length > 0,
      title: 'Add resources',
      body: activeResources.length > 0 ? `${activeResources.length} active ${activeResources.length === 1 ? 'resource' : 'resources'}.` : 'Add the courts, rooms, practitioners or spaces you book.',
      href: '/scheduling/resources',
      cta: activeResources.length > 0 ? 'View resources' : canManage ? 'Add a resource' : 'View resources',
    },
    {
      done: needsResources.length > 0 && unassigned.length === 0,
      title: 'Assign resources to offerings',
      body:
        needsResources.length === 0
          ? 'Appointments and facility hire need a resource on every offering.'
          : unassigned.length === 0
            ? 'Every offering that needs a resource has one.'
            : `${unassigned.length} ${unassigned.length === 1 ? 'offering needs' : 'offerings need'} a resource: ${unassigned.slice(0, 3).map(o => o.name).join(', ')}${unassigned.length > 3 ? '…' : ''}.`,
      href: unassigned[0] ? `/scheduling/schedules/${seg(unassigned[0].scheduleId)}` : '/scheduling/schedules',
      cta: 'Open schedule',
    },
  ];

  return (
    <>
      <MetricStrip>
        <Metric label="Active schedules" value={schedules.length} />
        <Metric label="Offerings" value={allOfferings.length} />
        <Metric label="Active resources" value={activeResources.length} />
      </MetricStrip>
      <ol className={`${styles.steps} ${styles.sectionGap}`} aria-label="Set-up steps">
        {steps.map((s, i) => (
          <li key={s.title} className={styles.step}>
            <span className={styles.stepMark} data-done={s.done ? 'true' : undefined} aria-hidden="true">{s.done ? '✓' : i + 1}</span>
            <div>
              <p className={styles.stepTitle}>{s.title}<span className="bb-visually-hidden">{s.done ? ' (done)' : ' (to do)'}</span></p>
              <p className={styles.stepBody}>{s.body}</p>
            </div>
            <Link href={s.href}>{s.cta}</Link>
          </li>
        ))}
      </ol>
    </>
  );
}

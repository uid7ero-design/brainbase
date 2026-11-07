'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/app';
import { ScheduleDialog } from '@/app/scheduling/_components/ScheduleDialog';
import { LoadError } from '@/app/scheduling/_components/parts';
import { useSchedulingData } from '@/app/scheduling/_components/useSchedulingData';
import type { ScheduleView } from '@/lib/scheduling/dashboard/types';
import { seg } from '@/lib/scheduling/dashboard/api';

export default function CoachSchedules({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { data, problem, reload } = useSchedulingData<{ schedules: ScheduleView[] }>('/schedules');
  const schedules = data?.schedules.filter(schedule => schedule.archivedAt === null &&
    (schedule.presetKey === 'classes_coaching' || schedule.presetKey === 'appointments'));
  return <>
    <h2>Your schedules</h2>
    {problem ? <LoadError problem={problem} onRetry={reload} /> :
      !schedules ? <p role="status">Loading schedules…</p> : <>
        {schedules.length ? <ul>{schedules.map(schedule =>
          <li key={schedule.id}><Link href={`/scheduling/schedules/${seg(schedule.id)}`}>{schedule.name}</Link>
            <small>{schedule.presetKey === 'appointments' ? 'Appointments' : 'Group classes'}</small></li>
        )}</ul> : <p>No active class or appointment schedules.</p>}
        {canManage && <Button variant="primary" onClick={() => setCreating(true)}>New coaching schedule</Button>}
      </>}
    <p><Link href="/scheduling/schedules">View all schedules and archives</Link></p>
    {creating && canManage && <ScheduleDialog mode="create" coachingOnly onClose={() => setCreating(false)}
      onSaved={schedule => { setCreating(false); router.push(`/scheduling/schedules/${seg(schedule.id)}`); }} />}
  </>;
}

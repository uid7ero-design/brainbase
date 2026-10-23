import { Panel, StateMessage } from '@/components/ui/app';

export default function SchedulingLoading() {
  return (
    <div style={{ maxWidth: 1180 }}>
      <Panel>
        <StateMessage kind="loading" title="Loading Scheduling…" size="page" />
      </Panel>
    </div>
  );
}

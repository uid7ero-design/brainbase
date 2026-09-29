import { Panel, StateMessage } from '@/components/ui/app';

export default function AssuranceLoading() {
  return (
    <div style={{ maxWidth: 1180 }}>
      <Panel>
        <StateMessage kind="loading" title="Loading Assurance…" size="page" />
      </Panel>
    </div>
  );
}

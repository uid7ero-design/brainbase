'use client';
import { Button, Panel, StateMessage } from '@/components/ui/app';

// Next 16 error boundary contract: { error, unstable_retry }.
// The underlying error message is not shown — it may carry server detail.
export default function AssuranceError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <div style={{ maxWidth: 640 }}>
      <Panel>
        <StateMessage
          kind="error"
          size="page"
          title="Something went wrong loading Assurance"
          action={<Button variant="primary" onClick={() => unstable_retry()}>Try again</Button>}
        >
          Nothing has been changed. Try again, and if this keeps happening, share the reference below with your BrainBase admin.
          {error.digest && <><br /><span style={{ fontFamily: 'var(--font-mono), monospace' }}>Ref: {error.digest}</span></>}
        </StateMessage>
      </Panel>
    </div>
  );
}

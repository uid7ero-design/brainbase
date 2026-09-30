import Link from 'next/link';
import { Panel, StateMessage, buttonProps } from '@/components/ui/app';

// Deliberately does not distinguish "does not exist", "another
// organisation's record" and "restricted from you" — all three look the same.
export default function AssuranceNotFound() {
  return (
    <div style={{ maxWidth: 640 }}>
      <Panel>
        <StateMessage
          kind="empty"
          size="page"
          title="Record not found"
          action={<Link href="/assurance" {...buttonProps('secondary')}>← Back to Assurance</Link>}
        >
          This Assurance record doesn&apos;t exist, or you don&apos;t have access to it. Restricted records are only visible to the
          people involved and organisation admins.
        </StateMessage>
      </Panel>
    </div>
  );
}

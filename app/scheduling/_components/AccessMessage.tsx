import { StateMessage } from '@/components/ui/app';

export function AccessMessage({ status }: { status: 'not_enabled' | 'unavailable' }) {
  return (
    <StateMessage
      kind={status === 'unavailable' ? 'error' : 'empty'}
      size="page"
      title={status === 'unavailable' ? 'Scheduling is temporarily unavailable' : 'Scheduling isn’t enabled for your organisation'}
    >
      {status === 'unavailable'
        ? 'We couldn’t confirm your organisation’s access right now. Please try again shortly.'
        : 'Ask a BrainBase admin to enable Scheduling for your organisation.'}
    </StateMessage>
  );
}

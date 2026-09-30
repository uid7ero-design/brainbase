import { assurancePostWithId } from '@/lib/assurance/route';
import { transitionIncident } from '@/lib/assurance/incidents';

// Floor here is 'record'; closing/cancelling additionally requires the
// 'close' floor, enforced inside transitionIncident().
export const POST = assurancePostWithId('record', (viewer, id, body) => transitionIncident(viewer, id, body), 'transition incident');

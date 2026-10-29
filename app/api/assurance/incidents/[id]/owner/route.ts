import { assurancePostWithId } from '@/lib/assurance/route';
import { assignIncidentOwner } from '@/lib/assurance/incidents';

export const POST = assurancePostWithId('record', (viewer, id, body) => assignIncidentOwner(viewer, id, body), 'assign incident owner');

import { assurancePost } from '@/lib/assurance/route';
import { createIncident } from '@/lib/assurance/incidents';

export const POST = assurancePost('record', (viewer, body) => createIncident(viewer, body), 'create incident');

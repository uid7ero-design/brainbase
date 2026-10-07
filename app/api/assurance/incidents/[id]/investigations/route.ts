import { assurancePostWithId } from '@/lib/assurance/route';
import { startInvestigationFromIncident } from '@/lib/assurance/investigations';

export const POST = assurancePostWithId('record', (viewer, id, body) => startInvestigationFromIncident(viewer, id, body), 'start investigation');

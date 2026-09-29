import { assurancePostWithId } from '@/lib/assurance/route';
import { linkIncidentToInvestigation } from '@/lib/assurance/investigations';

export const POST = assurancePostWithId('record', (viewer, id, body) => linkIncidentToInvestigation(viewer, id, body), 'link incident to investigation');

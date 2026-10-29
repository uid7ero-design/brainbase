import { assurancePostWithId } from '@/lib/assurance/route';
import { assignInvestigationLead } from '@/lib/assurance/investigations';

export const POST = assurancePostWithId('record', (viewer, id, body) => assignInvestigationLead(viewer, id, body), 'assign lead investigator');

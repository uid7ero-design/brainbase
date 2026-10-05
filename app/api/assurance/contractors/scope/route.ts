import { assurancePost } from '@/lib/assurance/route';
import { setOrganisationScope } from '@/lib/assurance/contractorAssurance';

// Brings a shared external organisation into (or out of) Assurance scope.
export const POST = assurancePost('record', (viewer, body) => setOrganisationScope(viewer, body), 'set external organisation assurance scope');

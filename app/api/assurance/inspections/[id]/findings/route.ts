import { assurancePostWithId } from '@/lib/assurance/route';
import { linkFindingToSource } from '@/lib/assurance/findings';

// Links an EXISTING finding to this inspection (same explicit link table a newly
// raised finding uses). Tenant, visibility and state rules live in the service.
export const POST = assurancePostWithId('record', (viewer, id, body) => linkFindingToSource(viewer, 'inspection', id, body), 'link finding to inspection');

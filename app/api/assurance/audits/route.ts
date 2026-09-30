import { assurancePost } from '@/lib/assurance/route';
import { createAudit } from '@/lib/assurance/audits';

// organisation comes from the session only; an ad hoc audit must name its standard_reference.
export const POST = assurancePost('record', (viewer, body) => createAudit(viewer, body), 'create audit');

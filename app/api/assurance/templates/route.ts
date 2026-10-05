import { assurancePost } from '@/lib/assurance/route';
import { createAssuranceTemplate } from '@/lib/assurance/templateLifecycle';

// Creates an Inspection or Audit template (body.kind) with version 1 as a DRAFT.
export const POST = assurancePost('administer', (viewer, body) => createAssuranceTemplate(viewer, body), 'create assurance template');

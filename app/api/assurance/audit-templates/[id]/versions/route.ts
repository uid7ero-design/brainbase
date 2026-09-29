import { assurancePostWithId } from '@/lib/assurance/route';
import { createAuditTemplateVersion } from '@/lib/assurance/auditTemplates';

// Publishes a NEW immutable version. There is deliberately no route that
// edits or deletes an existing audit template version.
export const POST = assurancePostWithId('administer', (viewer, id, body) => createAuditTemplateVersion(viewer, id, body), 'publish audit template version');

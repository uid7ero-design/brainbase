import { assurancePostWithId } from '@/lib/assurance/route';
import { createTemplateVersion } from '@/lib/assurance/templates';

// Publishes a NEW immutable version. There is deliberately no route that
// edits or deletes an existing template version.
export const POST = assurancePostWithId('administer', (viewer, id, body) => createTemplateVersion(viewer, id, body), 'publish template version');

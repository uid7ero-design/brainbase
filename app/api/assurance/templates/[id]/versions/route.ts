import { assurancePostWithId } from '@/lib/assurance/route';
import { createTemplateVersion } from '@/lib/assurance/templateLifecycle';

// Copies the current version into a new DRAFT. Published and retired
// versions are never edited; there is deliberately no route that does so.
export const POST = assurancePostWithId('administer', (viewer, id, body) => createTemplateVersion(viewer, id, body), 'create template version');

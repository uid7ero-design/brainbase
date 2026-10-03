import { assurancePostWithId } from '@/lib/assurance/route';
import { publishTemplateVersion } from '@/lib/assurance/templateLifecycle';

// Validates and publishes a DRAFT; the previously published version is retired in the same statement.
export const POST = assurancePostWithId('administer', (viewer, id, body) => publishTemplateVersion(viewer, id, body), 'publish template version');

import { assurancePostWithId } from '@/lib/assurance/route';
import { retireAssuranceTemplate } from '@/lib/assurance/templateLifecycle';

// Retires the published version; existing records keep the version they used.
export const POST = assurancePostWithId('administer', (viewer, id, body) => retireAssuranceTemplate(viewer, id, body), 'retire template');

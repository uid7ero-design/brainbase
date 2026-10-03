import { assurancePost } from '@/lib/assurance/route';
import { createRequirement } from '@/lib/assurance/contractorAssurance';

// Contractor assurance requirement library (organisation admins).
export const POST = assurancePost('administer', (viewer, body) => createRequirement(viewer, body), 'create assurance requirement');

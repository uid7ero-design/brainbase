import { assurancePost } from '@/lib/assurance/route';
import { createAssignment } from '@/lib/assurance/contractorAssurance';

// Assigns an active requirement to an in-scope external organisation.
export const POST = assurancePost('record', (viewer, body) => createAssignment(viewer, body), 'assign assurance requirement');

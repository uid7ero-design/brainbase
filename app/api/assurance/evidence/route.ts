import { assurancePost } from '@/lib/assurance/route';
import { createEvidence } from '@/lib/assurance/evidence';

export const POST = assurancePost('record', (viewer, body) => createEvidence(viewer, body), 'create evidence');

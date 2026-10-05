import { assurancePost } from '@/lib/assurance/route';
import { unlinkEvidence } from '@/lib/assurance/evidence';

// Soft unlink only: sets removed_at/removed_by/removal_reason. Nothing is deleted.
export const POST = assurancePost('record', (viewer, body) => unlinkEvidence(viewer, body), 'unlink evidence');

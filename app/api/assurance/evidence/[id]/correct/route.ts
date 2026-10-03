import { assurancePostWithId } from '@/lib/assurance/route';
import { correctEvidence } from '@/lib/assurance/evidence';

// Correct evidence details before a decision (before/after kept in the audit history).
export const POST = assurancePostWithId('record', (viewer, id, body) => correctEvidence(viewer, id, body), 'correct evidence');

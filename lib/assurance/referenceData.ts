import 'server-only';
import type { AssuranceViewer } from './policy';
import type { ReferenceDataActor } from '@/lib/referenceData/service';

// BrainBase Assurance — adapter onto the SHARED reference-data service
// (lib/referenceData). Assurance → Settings → Reference data manages the
// shared BrainBase locations, assets and external organisations; it does
// not own copies of them. The Assurance API layer has already required the
// Assurance capability and the 'administer' floor; the shared service
// independently requires the organisation-admin role for every mutation.

export function referenceActor(viewer: AssuranceViewer): ReferenceDataActor {
  return {
    organisationId: viewer.organisationId,
    userId: viewer.userId,
    role: viewer.role,
    // Usage counts include restricted records, so only viewers who may see
    // every record get them.
    canSeeUsage: viewer.canViewAllRestricted,
  };
}

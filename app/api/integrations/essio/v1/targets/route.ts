import { NextRequest } from 'next/server';
import { EssioTargetsDatabaseError, listEssioTargets } from '@/lib/essioIntegration/targets';
import {
  authenticateEssioRequest,
  contractVersionOk,
  essioError,
  essioJson,
  ESSIO_API_VERSION,
} from '@/lib/essioIntegration/http';

// Essio integration B2 — target discovery (read only).
//
//   GET /api/integrations/essio/v1/targets
//   Authorization: Bearer <integration token>     (scope targets:read)
//
// Returns the credential organisation's Organiser boards and their groups:
// ids and names only.

export async function GET(req: NextRequest) {
  if (!contractVersionOk(req)) {
    return essioError(400, 'unsupported_contract_version', 'Only Essio contract version 1 is supported.');
  }
  const auth = await authenticateEssioRequest(req, 'targets:read');
  if (!auth.ok) return auth.response;
  try {
    const targets = await listEssioTargets(auth.principal);
    return essioJson({ version: ESSIO_API_VERSION, ...targets });
  } catch (err) {
    if (err instanceof EssioTargetsDatabaseError) {
      return essioError(503, 'unavailable', 'The service is temporarily unavailable.');
    }
    return essioError(500, 'internal_error', 'The request could not be processed.');
  }
}

import { NextRequest } from 'next/server';
import { EssioStatusDatabaseError, normaliseOrganiserStatus, readEssioWork } from '@/lib/essioIntegration/status';
import {
  authenticateEssioRequest,
  contractVersionOk,
  essioError,
  essioJson,
  ESSIO_API_VERSION,
  organiserBoardUrl,
} from '@/lib/essioIntegration/http';

// Essio integration B3 — status of Essio-created Organiser work (read only).
//
//   GET /api/integrations/essio/v1/work/<idempotency key>
//   Authorization: Bearer <integration token>     (scope work:read)
//
// The key is the Essio handoff id used as Idempotency-Key when the work was
// created (B2). Only work Essio created in the credential's organisation is
// visible; any other key — unknown, another organisation's, or an arbitrary
// Organiser item — returns the same 404.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return essioError(404, 'work_not_found', 'No Essio work exists for this key.');
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ idempotencyKey: string }> }) {
  if (!contractVersionOk(req)) {
    return essioError(400, 'unsupported_contract_version', 'Only Essio contract version 1 is supported.');
  }
  const auth = await authenticateEssioRequest(req, 'work:read');
  if (!auth.ok) return auth.response;

  const { idempotencyKey } = await params;
  if (typeof idempotencyKey !== 'string' || !UUID_RE.test(idempotencyKey)) return notFound();

  let result;
  try {
    result = await readEssioWork(auth.principal, idempotencyKey);
  } catch (err) {
    if (err instanceof EssioStatusDatabaseError) {
      return essioError(503, 'unavailable', 'The service is temporarily unavailable.');
    }
    return essioError(500, 'internal_error', 'The request could not be processed.');
  }

  switch (result.state) {
    case 'linked':
      return essioJson({
        version: ESSIO_API_VERSION,
        state: 'linked',
        idempotency_key: result.idempotencyKey,
        work_item: {
          id: result.workItem.id,
          status: { raw: result.workItem.status, category: normaliseOrganiserStatus(result.workItem.status) },
          updated_at: result.workItem.updatedAt,
          url: organiserBoardUrl(result.workItem.boardId),
        },
      });
    case 'item_deleted':
      return essioJson({
        version: ESSIO_API_VERSION,
        state: 'item_deleted',
        idempotency_key: result.idempotencyKey,
        work_item: { id: null, deleted_at: result.deletedAt },
      });
    case 'not_found':
      return notFound();
  }
}

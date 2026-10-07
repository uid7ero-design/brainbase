import { NextRequest } from 'next/server';
import { createEssioWork, EssioWorkDatabaseError } from '@/lib/essioIntegration/createWork';
import { ESSIO_MAX_BODY_BYTES, validateEssioHandoffV1 } from '@/lib/essioIntegration/handoffPayload';
import {
  authenticateEssioRequest,
  contractVersionOk,
  essioError,
  essioJson,
  ESSIO_API_VERSION,
  organiserBoardUrl,
} from '@/lib/essioIntegration/http';

// Essio integration B2 — create Organiser work from a frozen Essio handoff.
//
//   POST /api/integrations/essio/v1/work
//   Authorization: Bearer <integration token>     (scope work:create)
//   Idempotency-Key: <handoff.idempotency_key>
//   Essio-Contract-Version: 1                     (optional)
//   { "target": { "board_id": "<uuid>", "group_id": "<uuid>|null" }, "handoff": { …Essio v1… } }
//
// The organisation is the credential's. See docs/integrations/essio.md for
// the full request/response/error contract.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(details: string[]) {
  return essioError(400, 'invalid_payload', 'The request body is not a valid Essio v1 work request.', {
    details: details.slice(0, 50),
  });
}

export async function POST(req: NextRequest) {
  if (!contractVersionOk(req)) {
    return essioError(400, 'unsupported_contract_version', 'Only Essio contract version 1 is supported.');
  }
  const auth = await authenticateEssioRequest(req, 'work:create');
  if (!auth.ok) return auth.response;
  const { principal } = auth;

  // Size cap before parsing or touching the database.
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > ESSIO_MAX_BODY_BYTES) {
    return essioError(413, 'payload_too_large', `The request body must be at most ${ESSIO_MAX_BODY_BYTES} bytes.`);
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > ESSIO_MAX_BODY_BYTES) {
    return essioError(413, 'payload_too_large', `The request body must be at most ${ESSIO_MAX_BODY_BYTES} bytes.`);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return essioError(400, 'invalid_json', 'The request body must be JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid(['body: must be an object']);
  const { target, handoff, ...rest } = body as Record<string, unknown>;
  const unknownKeys = Object.keys(rest).map((k) => `body.${k}: is not allowed`);

  const issues: string[] = [...unknownKeys];
  let boardId = '';
  let groupId: string | null = null;
  let requestedOrganisation: unknown;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    issues.push('target: must be an object');
  } else {
    const t = target as Record<string, unknown>;
    for (const key of Object.keys(t)) {
      if (!['board_id', 'group_id', 'organisation_id'].includes(key)) issues.push(`target.${key}: is not allowed`);
    }
    if (typeof t.board_id !== 'string' || !UUID_RE.test(t.board_id)) issues.push('target.board_id: must be a UUID');
    else boardId = t.board_id.toLowerCase();
    if (t.group_id !== undefined && t.group_id !== null) {
      if (typeof t.group_id !== 'string' || !UUID_RE.test(t.group_id)) issues.push('target.group_id: must be a UUID or null');
      else groupId = t.group_id.toLowerCase();
    }
    requestedOrganisation = t.organisation_id;
    if (requestedOrganisation !== undefined && typeof requestedOrganisation !== 'string') {
      issues.push('target.organisation_id: must be a string');
    }
  }
  const validated = validateEssioHandoffV1(handoff);
  if (!validated.ok) issues.push(...validated.issues);
  if (issues.length > 0 || !validated.ok) return invalid(issues);
  const payload = validated.value;

  const headerKey = req.headers.get('idempotency-key');
  if (headerKey === null || headerKey.trim().toLowerCase() !== payload.idempotency_key.toLowerCase()) {
    return essioError(400, 'idempotency_key_mismatch', 'The Idempotency-Key header must equal handoff.idempotency_key.');
  }

  // An organisation id in the request is never authority. If supplied, it
  // must be the credential's own organisation; otherwise the target simply
  // does not exist for this credential.
  if (typeof requestedOrganisation === 'string' && requestedOrganisation !== principal.organisationId) {
    return essioError(404, 'target_not_found', 'The target board was not found.');
  }

  let result;
  try {
    result = await createEssioWork(principal, payload, { boardId, groupId });
  } catch (err) {
    if (err instanceof EssioWorkDatabaseError) {
      return essioError(503, 'unavailable', 'The service is temporarily unavailable.');
    }
    return essioError(500, 'internal_error', 'The request could not be processed.');
  }

  switch (result.outcome) {
    case 'created':
    case 'replayed':
      return essioJson(
        {
          version: ESSIO_API_VERSION,
          created: result.outcome === 'created',
          state: 'linked',
          idempotency_key: result.idempotencyKey,
          work_item: {
            id: result.workItem.id,
            url: organiserBoardUrl(result.workItem.boardId),
            status: result.workItem.status,
          },
          accepted_at: result.acceptedAt,
        },
        result.outcome === 'created' ? 201 : 200,
      );
    case 'item_deleted':
      return essioError(410, 'work_item_deleted', 'The work item created for this request was deleted in Brainbase.', {
        idempotency_key: result.idempotencyKey,
        state: 'item_deleted',
        accepted_at: result.acceptedAt,
        deleted_at: result.deletedAt,
      });
    case 'fingerprint_conflict':
      return essioError(409, 'idempotency_conflict', 'This idempotency key was already used with a different payload.', {
        idempotency_key: result.idempotencyKey,
      });
    case 'unattached':
      return essioError(409, 'idempotency_key_unavailable', 'This idempotency key cannot be processed.', {
        idempotency_key: result.idempotencyKey,
      });
    case 'target_not_found':
      return essioError(404, 'target_not_found', 'The target board was not found.');
    case 'group_not_found':
      return essioError(404, 'target_group_not_found', 'The target group was not found on that board.');
  }
}

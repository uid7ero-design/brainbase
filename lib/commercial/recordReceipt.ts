import sql from '@/lib/db';
import { financeRegisterAccess } from './financeRegisterAccess';
import type { FinanceWorkspace } from './financeWorkspace';
import { parseReceipt, receiptToday } from '@/lib/tennisBusiness/receiptInput';

const reply = (body: object, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function recordReceipt(request: Request, workspace: FinanceWorkspace) {
  try {
    const origin = new URL(request.headers.get('origin') ?? '');
    if (origin.host !== request.headers.get('host') || !['https:', 'http:'].includes(origin.protocol)) throw new Error();
  } catch {
    return reply({ error: 'Open the receipt form in this workspace.' }, 403);
  }
  const access = await financeRegisterAccess(workspace, 'purchasing');
  if (!access.ok || !access.canRecord) return reply({ error: 'Receipt entry unavailable.' }, access.ok ? 403 : access.status);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Expected a receipt form.' }, 415);
  let receipt;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid receipt form.' }, 400);
    if ((workspace === 'commercial' || body.expectedOrganisationId !== undefined) && body.expectedOrganisationId !== access.session.organisationId) {
      return reply({ error: 'Your workspace changed. Reopen receipt expenses before recording this purchase.' }, 403);
    }
    receipt = parseReceipt(body, receiptToday());
  } catch (error) {
    return reply({ error: error instanceof SyntaxError ? 'Invalid receipt form.' : (error as Error).message }, 400);
  }
  const { organisationId, userId } = access.session;
  const { id, date, merchant, description, reference, cents } = receipt;
  try {
    const added = await sql`INSERT INTO tennis_receipt_expenses
      (organisation_id,id,recorded_by,purchase_date,merchant,description,receipt_reference,amount_cents)
      VALUES (${organisationId},${id},${userId},${date},${merchant},${description},${reference},${cents})
      ON CONFLICT (organisation_id,id) DO NOTHING RETURNING id`;
    if (added.length) return reply({ id }, 201);
    // A fresh statement also sees a concurrent insert which won the unique-key race.
    const existing = await sql`SELECT id FROM tennis_receipt_expenses WHERE organisation_id=${organisationId}
      AND id=${id} AND recorded_by=${userId} AND purchase_date=${date} AND merchant=${merchant}
      AND description=${description} AND receipt_reference IS NOT DISTINCT FROM ${reference} AND amount_cents=${cents}`;
    return existing.length ? reply({ id }, 200) : reply({ error: 'This entry already contains a saved receipt. Review it before starting another.' }, 409);
  } catch {
    return reply({ error: 'Save outcome unavailable. Check this receipt before continuing.' }, 503);
  }
}

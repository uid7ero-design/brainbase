import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/org';
import { listOrganisationUsers, saveOrganisationUser, UserAdministrationError } from '@/lib/organisationUsers/service';
const response = (body: unknown, status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET() {
  let actor;
  try { actor=await requireSession(); } catch { return response({error:'Unauthorized'},401); }
  try { return response(await listOrganisationUsers(actor)); }
  catch(e) { return response({error:e instanceof UserAdministrationError ? e.message : 'Unable to load organisation users.'}, e instanceof UserAdministrationError ? e.status : 503); }
}
export async function POST(req: NextRequest) {
  if (req.headers.get('origin') && req.headers.get('origin')!==new URL(req.url).origin) return response({error:'Forbidden'},403);
  let actor;
  try { actor=await requireSession(); } catch { return response({error:'Unauthorized'},401); }
  try { return response(await saveOrganisationUser(actor,await req.json()),200); }
  catch(e) { return response({error:e instanceof UserAdministrationError ? e.message : 'The result could not be confirmed. Refresh users before trying again.'}, e instanceof UserAdministrationError ? e.status : 503); }
}

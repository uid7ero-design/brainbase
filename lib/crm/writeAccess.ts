import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
export function canWriteCrm(session: Pick<OrgSession,'role'>){
  return ['manager','admin','super_admin'].includes(session.role);
}
/** Linked IDs are never accepted on existence alone: each must belong to this tenant. */
export async function crmLinksAllowed(organisationId:string, body:Record<string,unknown>){
  const keys=['company_id','contact_id','deal_id','assigned_to'] as const;
  if(keys.some(key=>body[key]!=null&&body[key]!==''&&typeof body[key]!=='string'))return false;
  if(['company_id','contact_id','deal_id'].some(key=>body[key] && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(body[key]))))return false;
  const [row]=await sql`SELECT
    (${body.company_id||null}::text IS NULL OR EXISTS(SELECT 1 FROM crm_companies WHERE id=${body.company_id||null} AND organisation_id=${organisationId}))
    AND (${body.contact_id||null}::text IS NULL OR EXISTS(SELECT 1 FROM crm_contacts WHERE id=${body.contact_id||null} AND organisation_id=${organisationId}))
    AND (${body.deal_id||null}::text IS NULL OR EXISTS(SELECT 1 FROM crm_deals WHERE id=${body.deal_id||null} AND organisation_id=${organisationId}))
    AND (${body.assigned_to||null}::text IS NULL OR EXISTS(SELECT 1 FROM users WHERE id=${body.assigned_to||null} AND organisation_id=${organisationId} AND status='ACTIVE')) AS allowed`;
  return row?.allowed===true;
}

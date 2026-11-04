import 'server-only';
import sql from '@/lib/db';
/** Call only after the business access gate, with its authenticated organisation. */
export async function coachingAuthority(organisationId:string):Promise<'legacy'|'frozen'|'scheduling'> {
  if(organisationId!=='8ecd003b-583f-4616-a830-8dbf8aa51d2c')return 'legacy';
  const installed=await sql`SELECT to_regclass('public.scheduling_tennis_cutover') IS NOT NULL ready`;
  if(!installed[0]?.ready)return 'legacy';
  const rows=await sql`SELECT phase FROM scheduling_tennis_cutover WHERE organisation_id=${organisationId}`;
  if(!rows[0])return 'legacy';
  const phase=rows[0].phase;if(!['legacy','frozen','scheduling'].includes(phase as string))throw Error('Coaching authority unavailable');
  return phase as 'legacy'|'frozen'|'scheduling';
}

import { schedulingJson, type SchedulingRouteContext } from '../route';
import { parseCoachingAction } from '../coachingContract';
import { badRequest, readBody } from './http';

const unavailable = () => schedulingJson({error:'The coaching roster is unavailable.',code:'COACHING_NOT_READY'},{status:503});
function query(context: SchedulingRouteContext, fields: string[]) {
  const q=new URL(context.request.url).searchParams;
  return [...q.keys()].some(k=>!fields.includes(k) || q.getAll(k).length!==1) ? null : q;
}
export async function coachingDates(context: SchedulingRouteContext): Promise<Response> {
  const q=query(context,['from','until','after']);
  if (!q?.get('from') || !q.get('until')) return badRequest(['Choose a date range.']);
  if (!context.coachingRoster) return unavailable();
  try { return schedulingJson(await context.coachingRoster.dates(q.get('from')!,q.get('until')!,q.get('after') ?? undefined)); }
  catch(error) { return (error as {code?:string}).code==='STVAL' ? badRequest(['Choose a valid range of up to 70 days.']) : unavailable(); }
}
export async function coachingRoster(context: SchedulingRouteContext): Promise<Response> {
  const q=query(context,['after']); const id=context.params.occurrenceId;
  if (!q || !id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) return badRequest(['Choose a class date.']);
  if (!context.coachingRoster) return unavailable();
  try {
    const data=await context.coachingRoster.roster(id,q.get('after') ?? undefined);
    return data ? schedulingJson(data) : schedulingJson({error:'Class date not found.'},{status:404});
  } catch { return unavailable(); }
}
export async function savedRosterAction(context: SchedulingRouteContext): Promise<Response> {
  const q=query(context,['key','kind','bookingId']);
  if (!q || !/^[A-Za-z0-9_-]{16,80}$/.test(q.get('key') ?? '') || !['enrol','attendance','paid-marker','cancel','start-weekly','stop-weekly','pause','resume'].includes(q.get('kind') ?? '')) return badRequest(['Choose a saved request.']);
  if (!context.coachingRoster) return unavailable();
  try { return schedulingJson({confirmed:await context.coachingRoster.saved(q.get('key')!,q.get('kind')!,q.get('bookingId') ?? undefined)}); }
  catch { return unavailable(); }
}
export async function changeCoachingRoster(context: SchedulingRouteContext): Promise<Response> {
  try {
    const origin=context.request.headers.get('origin'); const url=new URL(origin ?? '');
    if (url.origin!==origin || url.host!==(context.request.headers.get('host') ?? new URL(context.request.url).host)
      || !['http:','https:'].includes(url.protocol) || (process.env.NODE_ENV==='production' && url.protocol!=='https:')) throw Error();
  } catch { return schedulingJson({error:'Request refused.',code:'ORIGIN_DENIED'},{status:403}); }
  const parsed=await readBody(context.request); if (!parsed.ok) return parsed.response;
  const action=parseCoachingAction(parsed.body); if (!action) return badRequest(['Check the booking details.']);
  if (action.kind==='attendance' && !context.tenant.can('scheduling.attendance')) return schedulingJson({error:'Attendance access is required.'},{status:403});
  if (!context.coachingRoster) return unavailable();
  try { return schedulingJson({result:await context.coachingRoster.execute(action)}); }
  catch(error) {
    const code=(error as {code?:string}).code;
    if (code==='STOFF') return unavailable();
    if (['STVAL','STKEY','STCLS','STCHG','SCCAP','SCARC','SCCLS','23505'].includes(code ?? '')) return schedulingJson({error:'The booking changed or cannot be saved. Reload the roster.',code:'ROSTER_CHANGED'},{status:409});
    return schedulingJson({error:'The result is not confirmed. Check the saved request before making another change.',code:'OUTCOME_UNKNOWN'},{status:503});
  }
}

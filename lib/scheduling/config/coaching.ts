import { schedulingJson, type SchedulingRouteContext } from '../route';
import { badRequest, readBody } from './http';

export async function savedClassGeneration(context: SchedulingRouteContext): Promise<Response> {
  const id=context.params.offeringId; const query=new URL(context.request.url).searchParams;
  const key=query.get('key');
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) || !key || !/^[A-Za-z0-9_-]{16,80}$/.test(key)
    || [...query.keys()].some(k=>k!=='key') || query.getAll('key').length!==1) return badRequest(['A valid class and request key are required.']);
  if (!context.coaching) return schedulingJson({error:'Saved class dates are unavailable.'},{status:503});
  try { return schedulingJson({result:await context.coaching.savedGeneration(id,key)}); }
  catch { return schedulingJson({error:'Saved class dates could not be checked.'},{status:503}); }
}

export async function generateCoachingClasses(context: SchedulingRouteContext): Promise<Response> {
  const id=context.params.offeringId;
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) return badRequest(['Select a valid class.']);
  // A cookie-authenticated mutation must originate from this app, including
  // requests passing through its HTTPS reverse proxy.
  try {
    const origin=context.request.headers.get('origin'); const parsed=new URL(origin ?? '');
    if (parsed.origin!==origin || parsed.host!==(context.request.headers.get('host') ?? new URL(context.request.url).host)
      || !['http:','https:'].includes(parsed.protocol) || (process.env.NODE_ENV==='production' && parsed.protocol!=='https:')) throw Error();
  } catch { return schedulingJson({error:'Request refused.',code:'ORIGIN_DENIED'},{status:403}); }
  const parsed=await readBody(context.request); if (!parsed.ok) return parsed.response;
  const key=parsed.body.idempotencyKey;
  if (Object.keys(parsed.body).some(k=>k!=='idempotencyKey') || typeof key!=='string' || !/^[A-Za-z0-9_-]{16,80}$/.test(key)) return badRequest(['A valid request key is required.']);
  if (!context.coaching) return schedulingJson({error:'Coaching integration is not available.',code:'COACHING_NOT_READY'},{status:503});
  try { return schedulingJson(await context.coaching.generateClasses(id,key)); }
  catch (error) {
    const code=(error as {code?:string}).code;
    if (code==='STOFF') return schedulingJson({error:'Coaching integration is not available.',code:'COACHING_NOT_READY'},{status:503});
    if (['STCHG','STKEY','STCLS','STVAL'].includes(code ?? '')) return schedulingJson({error:'The class or request changed. Reload the saved class before trying again.',code:'CLASS_CHANGED'},{status:409});
    return schedulingJson({error:'The result could not be confirmed. Review saved class dates before trying again.',code:'OUTCOME_UNKNOWN'},{status:503});
  }
}

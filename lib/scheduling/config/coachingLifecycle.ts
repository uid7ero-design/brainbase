import {schedulingJson,type SchedulingRouteContext} from '../route';
import {badRequest,readBody} from './http';
const validId=(v:unknown)=>typeof v==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const validKey=(v:unknown)=>typeof v==='string' && /^[A-Za-z0-9_-]{16,80}$/.test(v);
export async function savedCoachingClassChange(context:SchedulingRouteContext) {
  const q=new URL(context.request.url).searchParams;const id=context.params.offeringId;const action=q.get('action');const key=q.get('key');
  if(!validId(id) || !validKey(key) || !['archive','restore'].includes(action ?? '') || [...q.keys()].some(k=>!['action','key'].includes(k) || q.getAll(k).length!==1))return badRequest(['Choose a saved class request.']);
  if(!context.coachingLifecycle)return schedulingJson({error:'Class history is unavailable.'},{status:503});
  try{return schedulingJson({result:await context.coachingLifecycle.saved(id,key!,action!)});}
  catch{return schedulingJson({error:'The saved request could not be checked.'},{status:503});}
}
export async function changeCoachingClass(context:SchedulingRouteContext) {
  const id=context.params.offeringId;if(!validId(id))return badRequest(['Choose a class.']);
  try{const origin=context.request.headers.get('origin');const url=new URL(origin ?? '');if(url.origin!==origin || url.host!==(context.request.headers.get('host') ?? new URL(context.request.url).host) || !['http:','https:'].includes(url.protocol) || (process.env.NODE_ENV==='production' && url.protocol!=='https:'))throw Error();}
  catch{return schedulingJson({error:'Request refused.',code:'ORIGIN_DENIED'},{status:403});}
  const parsed=await readBody(context.request);if(!parsed.ok)return parsed.response;
  const {action,idempotencyKey:key}=parsed.body;
  if(!['archive','restore'].includes(action as string) || !validKey(key) || Object.keys(parsed.body).some(k=>!['action','idempotencyKey'].includes(k)))return badRequest(['Check the class request.']);
  if(!context.coachingLifecycle)return schedulingJson({error:'Class changes are unavailable.',code:'COACHING_NOT_READY'},{status:503});
  try{return schedulingJson({result:action==='restore' ? await context.coachingLifecycle.restore(id,key as string) : await context.coachingLifecycle.archive(id,key as string)});}
  catch(error){const code=(error as {code?:string}).code;
    if(code==='STOFF')return schedulingJson({error:'The handover is not active.',code:'COACHING_NOT_READY'},{status:503});
    if(['STVAL','STCLS','STCHG','STKEY','STCFG'].includes(code ?? ''))return schedulingJson({error:code==='STCFG' ? 'This class has resource or availability settings that need review before restoration.' : 'The class changed. Reload its saved history.',code:'CLASS_CHANGED'},{status:409});
    return schedulingJson({error:'The result is unconfirmed. Check the saved request before repeating it.',code:'OUTCOME_UNKNOWN'},{status:503});}
}

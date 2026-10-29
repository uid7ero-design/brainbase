'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** No old scope response, failed read or unmounted request can publish rows. */
export function useCrmList<T>(url: string, field: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{url:string; revision:number; rows:T[]; loading:boolean; error:string}>({url,revision,rows:[],loading:true,error:''});
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    void (async () => {
      try {
        const response = await fetch(url,{signal:controller.signal,cache:'no-store'});
        if (!response.ok) throw new Error('Unable to load saved records. Refresh to check current access.');
        const body = await response.json();
        if (!Array.isArray(body[field])) throw new Error('Invalid saved-record response. Refresh to try again.');
        if (active) setState({url,revision,rows:body[field],loading:false,error:''});
      } catch (error) {
        if (active) setState({url,revision,rows:[],loading:false,error:error instanceof Error?error.message:'Unable to load saved records.'});
      }
    })();
    return () => {active=false;controller.abort();};
  },[url,field,revision]);
  const current=state.url===url&&state.revision===revision?state:{url,revision,rows:[],loading:true,error:''};
  const reload=useCallback(()=>setRevision(v=>v+1),[]);
  return {...current,reload};
}

const uncertainMessage='The result could not be confirmed. Do not repeat the change. Review saved records first.';
/** Session-local locks survive drawer dismissal and page reload, without storing drafts or personal data. */
export function useCrmMutation(scope:string) {
  const [pending,setPending]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const [error,setError]=useState('');
  const busy=useRef(false);
  const storageKey='crm-uncertain:'+scope;
  // Synchronize a browser-only recovery lock after hydration; no record data is stored.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(sessionStorage.getItem(storageKey)){setUncertain(true);setError(uncertainMessage);}},[storageKey]);
  async function run<T>(url:string,method:string,body?:unknown,field?:string):Promise<T|undefined> {
    if(busy.current||sessionStorage.getItem(storageKey)) return;
    busy.current=true;setPending(true);setError('');sessionStorage.setItem(storageKey,'1');
    try {
      const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
      if(!response.ok){
        if(response.status>=500||response.status===408)throw new Error(uncertainMessage);
        const data=await response.json().catch(()=>({}));
        sessionStorage.removeItem(storageKey);setError(data.error??'Change refused. Refresh to check current access.');return;
      }
      const data=field?await response.json():{ok:true};
      if(field&&(!data[field]||typeof data[field].id!=='string'))throw new Error(uncertainMessage);
      sessionStorage.removeItem(storageKey);setUncertain(false);return (field?data[field]:data) as T;
    }catch{setUncertain(true);setError(uncertainMessage);return;}
    finally{busy.current=false;setPending(false);}
  }
  async function review(url:string,field:string,onReviewed:()=>void){
    if(busy.current)return;busy.current=true;setPending(true);
    try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();if(!Array.isArray(data[field]))throw new Error();sessionStorage.removeItem(storageKey);setUncertain(false);setError('');onReviewed();}
    catch{setError('Saved records could not be loaded. Access may have changed. The change remains locked.');}
    finally{busy.current=false;setPending(false);}
  }
  return {run,review,pending,uncertain,error,locked:pending||uncertain};
}

export function useCrmDetail<T extends {id:string}>(url:string,field:string){
  const [revision,setRevision]=useState(0);
  const [state,setState]=useState<{url:string;revision:number;data:Record<string,unknown>|null;error:string;loading:boolean}>({url,revision,data:null,error:'',loading:true});
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    void(async()=>{try{const r=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error('Unable to load this record. Refresh to check current access.');const body=await r.json();if(!body[field]||typeof body[field].id!=='string'||!Array.isArray(body.deals)||!Array.isArray(body.activities))throw Error('Invalid record response.');if(active)setState({url,revision,data:body,error:'',loading:false});}catch(e){if(active)setState({url,revision,data:null,error:e instanceof Error?e.message:'Unable to load record.',loading:false});}})();
    return()=>{active=false;controller.abort();};
  },[url,field,revision]);
  const current=state.url===url&&state.revision===revision?state:{url,revision,data:null,error:'',loading:true};
  return {...current,record:current.data?.[field] as T|undefined,reload:useCallback(()=>setRevision(n=>n+1),[])};
}

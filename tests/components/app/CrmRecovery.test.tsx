import React from 'react';
import {act,renderHook,waitFor,render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {useCrmList,useCrmMutation,useCrmDetail} from '@/app/crm/_components/useCrmRecovery';
import DealForm from '@/app/crm/_components/DealForm';
const response=(body:unknown,status=200)=>({ok:status<400,status,json:async()=>body});
beforeEach(()=>{sessionStorage.clear();vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('CRM read recovery',()=>{
 it('removes detail and related history after access is revoked, then permits a fresh read',async()=>{
  const saved={contact:{id:'a'},deals:[{id:'d'}],activities:[{id:'h'}]};
  vi.mocked(fetch).mockResolvedValueOnce(response(saved) as Response).mockResolvedValueOnce(response({},403) as Response).mockResolvedValueOnce(response(saved) as Response);
  const {result}=renderHook(()=>useCrmDetail('/contacts/a','contact'));
  await waitFor(()=>expect(result.current.record?.id).toBe('a'));
  act(()=>result.current.reload());expect(result.current.data).toBeNull();
  await waitFor(()=>expect(result.current.error).not.toBe(''));expect(result.current.record).toBeUndefined();
  act(()=>result.current.reload());await waitFor(()=>expect(result.current.record?.id).toBe('a'));expect(result.current.data?.activities).toEqual([{id:'h'}]);
 });
 it('hides previous rows on filter changes and ignores a late previous response',async()=>{
  let old!:(value:unknown)=>void;
  vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{old=resolve as typeof old;})).mockResolvedValueOnce(response({contacts:[{id:'new'}]}) as Response);
  const {result,rerender}=renderHook(({url})=>useCrmList<{id:string}>(url,'contacts'),{initialProps:{url:'/contacts?old'}});
  rerender({url:'/contacts?new'});await waitFor(()=>expect(result.current.rows).toEqual([{id:'new'}]));
  await act(async()=>old(response({contacts:[{id:'old'}]})));expect(result.current.rows).toEqual([{id:'new'}]);
 });
 it('clears retained rows on a denied refresh and recovers only through a successful read',async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(response({contacts:[{id:'a'}]}) as Response).mockResolvedValueOnce(response({},403) as Response).mockResolvedValueOnce(response({contacts:[]}) as Response);
  const {result}=renderHook(()=>useCrmList('/contacts','contacts'));
  await waitFor(()=>expect(result.current.rows).toHaveLength(1));act(()=>result.current.reload());await waitFor(()=>expect(result.current.error).not.toBe(''));expect(result.current.rows).toEqual([]);
  act(()=>result.current.reload());await waitFor(()=>expect(result.current.loading).toBe(false));expect(result.current.error).toBe('');
 });
 it('handles thrown reads and malformed success bodies',async()=>{
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response({wrong:[]}) as Response);
  const {result}=renderHook(()=>useCrmList('/contacts','contacts'));await waitFor(()=>expect(result.current.error).toBe('offline'));act(()=>result.current.reload());await waitFor(()=>expect(result.current.error).toMatch(/Invalid/));
 });
});
describe('CRM uncertain mutations',()=>{
 it.each(['network','server','malformed'])('locks %s outcomes across remount and failed recovery without another write',async kind=>{
  if(kind==='network')vi.mocked(fetch).mockRejectedValueOnce(new Error('lost'));
  else vi.mocked(fetch).mockResolvedValueOnce(response(kind==='server'?{}:{},kind==='server'?503:200) as Response);
  const first=renderHook(()=>useCrmMutation('/deals'));
  await act(async()=>{await first.result.current.run('/deals','POST',{title:'test'},'deal');});expect(first.result.current.uncertain).toBe(true);first.unmount();
  const second=renderHook(()=>useCrmMutation('/deals'));await waitFor(()=>expect(second.result.current.uncertain).toBe(true));await act(async()=>{await second.result.current.run('/deals','POST',{},'deal');});expect(fetch).toHaveBeenCalledTimes(1);
  vi.mocked(fetch).mockResolvedValueOnce(response({},403) as Response);const reviewed=vi.fn();await act(async()=>second.result.current.review('/deals','deals',reviewed));expect(reviewed).not.toHaveBeenCalled();expect(second.result.current.uncertain).toBe(true);
  vi.mocked(fetch).mockResolvedValueOnce(response({deals:[]}) as Response);await act(async()=>second.result.current.review('/deals','deals',reviewed));expect(reviewed).toHaveBeenCalledOnce();expect(second.result.current.locked).toBe(false);
 });
 it('refuses overlapping writes before React renders and accepts known validation rejection',async()=>{
  let finish!:(value:unknown)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve as typeof finish;}));
  const {result}=renderHook(()=>useCrmMutation('/deals'));let request:Promise<unknown>;
  act(()=>{request=result.current.run('/deals','POST',{},'deal');});await act(async()=>{await result.current.run('/deals','POST',{},'deal');});expect(fetch).toHaveBeenCalledOnce();
  await act(async()=>{finish(response({error:'Invalid stage'},400));await request;});expect(result.current.locked).toBe(false);expect(result.current.error).toBe('Invalid stage');
 });
 it('does not report a failed deletion as completed',async()=>{
  vi.stubGlobal('confirm',()=>true);vi.mocked(fetch).mockImplementation(async(url,options)=>options?.method==='DELETE'?response({error:'Forbidden'},403) as Response:response(String(url).includes('companies')?{companies:[]}:{contacts:[]}) as Response);
  const deleted=vi.fn();render(<DealForm initial={{id:'a',title:'Test'}} onSaved={vi.fn()} onDelete={deleted}/>);
  fireEvent.click(screen.getByRole('button',{name:'Delete deal'}));await screen.findByText('Forbidden');expect(deleted).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Delete deal'})).toBeEnabled();
 });
});

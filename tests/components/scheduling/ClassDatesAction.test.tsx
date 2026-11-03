import { cleanup,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { ClassDatesAction } from '@/app/scheduling/_components/ClassDatesAction';

const result={created:[{id:'date-1',date:'2099-11-03'}],existing:0,skipped:[]};
beforeEach(()=>sessionStorage.clear());
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('saves dates once and clears its recovery key only after a confirmed result',async()=>{
  const fetch=vi.fn().mockResolvedValue(Response.json(result)); vi.stubGlobal('fetch',fetch);
  const saved=vi.fn(); render(<ClassDatesAction offeringId="class" name="Juniors" onGenerated={saved}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Create upcoming dates for Juniors'}));
  await screen.findByText(/1 new date saved/);
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].method).toBe('POST');
  expect(sessionStorage.getItem('coaching-class-generation:class')).toBeNull(); expect(saved).toHaveBeenCalledOnce();
});
it('preserves an uncertain request across remount and checks it with GET without another mutation',async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(Error('lost response')).mockResolvedValueOnce(Response.json({result})); vi.stubGlobal('fetch',fetch);
  const props={offeringId:'class',name:'Juniors',onGenerated:vi.fn()};
  const first=render(<ClassDatesAction {...props}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Create upcoming dates for Juniors'}));
  await screen.findByText(/save could not be confirmed/);
  const key=sessionStorage.getItem('coaching-class-generation:class'); expect(key).toBeTruthy(); first.unmount();
  render(<ClassDatesAction {...props}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Check saved dates for Juniors'}));
  await screen.findByText(/1 new date saved/);
  expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1][0]).toContain(`?key=${key}`);
  expect(fetch.mock.calls[1][1]).toEqual({cache:'no-store'});
});
it('keeps an unconfirmed receipt pending and never turns a missing read into another write',async()=>{
  sessionStorage.setItem('coaching-class-generation:class','pending-class-generation');
  const fetch=vi.fn().mockResolvedValue(Response.json({result:null})); vi.stubGlobal('fetch',fetch);
  render(<ClassDatesAction offeringId="class" name="Juniors" onGenerated={vi.fn()}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Check saved dates for Juniors'}));
  await screen.findByText(/not confirmed yet/);
  expect(sessionStorage.getItem('coaching-class-generation:class')).toBe('pending-class-generation');
  await waitFor(()=>expect(screen.getByRole('button',{name:'Check saved dates for Juniors'})).toBeEnabled());
  expect(fetch.mock.calls[0][1]).toEqual({cache:'no-store'});
});

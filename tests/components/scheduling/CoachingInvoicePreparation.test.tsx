import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import CoachingInvoicePreparation from '@/app/commercial/_components/CoachingInvoicePreparation';
const source={occurrence:{name:'Juniors',date:'2099-11-03',startTime:'16:00',status:'scheduled'},rows:[{id:'booking',name:'Synthetic player',status:'confirmed',historyOnly:false,attendance:'attended',paidMarker:true,priceCents:1250,currency:'AUD'}]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('reads the authorized page, requires an explicit notes action and never writes an invoice or payment',async()=>{
  const fetch=vi.fn(async()=>Response.json(source));vi.stubGlobal('fetch',fetch);const useNotes=vi.fn();
  render(<CoachingInvoicePreparation occurrenceId="date" bookingId="booking" after="cursor" onUseNotes={useNotes}/>);
  await screen.findByText(/AUD recorded booking price/);
  expect(useNotes).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button',{name:'Use booking reference in internal notes'}));
  expect(useNotes).toHaveBeenCalledWith(expect.stringContaining('Coaching booking reference: booking'));
  expect(useNotes).toHaveBeenCalledWith(expect.stringContaining('$12.50 AUD'));
  expect(fetch).toHaveBeenCalledWith('/api/scheduling/coaching/roster/date?after=cursor',expect.objectContaining({cache:'no-store'}));
  expect(screen.getByText(/not a Commercial payment/)).toBeInTheDocument();
});
it.each(['denied','cancelled','missing','history','unknown-price'])('handles %s without inventing a payer, charge or saved result',async(mode)=>{
  const data=structuredClone(source);
  if(mode==='cancelled')data.rows[0].status='cancelled';
  if(mode==='missing')data.rows=[];
  if(mode==='history')data.rows[0].historyOnly=true;
  if(mode==='unknown-price')Object.assign(data.rows[0],{priceCents:null});
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(mode==='denied'?{}:data,{status:mode==='denied'?403:200})));
  const useNotes=vi.fn();render(<CoachingInvoicePreparation occurrenceId="date" bookingId="booking" after={null} onUseNotes={useNotes}/>);
  if(mode==='unknown-price')await screen.findByText(/Historical price not recorded/);
  else {await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Use booking reference in internal notes'})).not.toBeInTheDocument();}
  expect(useNotes).not.toHaveBeenCalled();
});

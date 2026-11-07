import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NewInvoice from '@/app/commercial/invoices/new/page';
import NewBill from '@/app/commercial/purchasing/supplier-bills/new/page';
import SupplierBills from '@/app/commercial/purchasing/supplier-bills/page';
import Invoices from '@/app/commercial/invoices/page';
import TennisBusiness from '@/app/business/tennis/TennisBusiness';
import { currentBusinessMonth } from '@/lib/tennisBusiness/model';
const { push, params } = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => params }));
vi.mock('@/app/commercial/_components/SlidePanel', () => ({ default: () => null }));
beforeEach(() => { sessionStorage.clear(); push.mockReset(); params.delete('coachingBooking'); params.delete('coachingDate'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const choices = (bill: boolean) => bill ? { purchaseOrders: [{ id:'order',status:'ISSUED',purchase_order_number:'PO-1',supplier_name_snapshot:'Synthetic supplier' }] } : { customers:[{id:'payer',name:'Synthetic parent',active:true}] };
const mount = (bill: boolean) => render(bill ? <NewBill/> : <NewInvoice/>);
async function complete(bill: boolean) {
  await screen.findByRole('option', {name: bill ? /PO-1/ : 'Synthetic parent'});
  fireEvent.change(screen.getByRole('combobox'), {target:{value:bill ? 'order' : 'payer'}});
  if(bill) fireEvent.change(screen.getByLabelText(/Supplier Invoice Number/), {target:{value:'SUP-1'}});
}
it.each([false,true])('keeps %s draft creation locked after read failure and recovers explicitly', async bill => {
  const fetch=vi.fn().mockResolvedValueOnce(Response.json({}, {status:503})).mockResolvedValueOnce(Response.json(choices(bill)));vi.stubGlobal('fetch',fetch);
  mount(bill);await screen.findByRole('alert');expect(screen.getByRole('button',{name:/Create Draft/})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Retry saved choices'}));await complete(bill);
  expect(screen.getByRole('button',{name:/Create Draft/})).toBeEnabled();expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([false,true])('blocks repeat and remounted %s writes after committed-but-lost response', async bill => {
  let writes=0; const fetch=vi.fn(async (_url, options) => {
    if(options?.method==='POST'){writes++;throw new Error('lost response');}
    return Response.json(choices(bill));
  });vi.stubGlobal('fetch',fetch);
  const first=mount(bill);await complete(bill);fireEvent.click(screen.getByRole('button',{name:/Create Draft/}));
  await screen.findByRole('region',{name:'Review uncertain draft'});expect(writes).toBe(1);
  expect(screen.getByRole('button',{name:/Create Draft/})).toBeDisabled();first.unmount();mount(bill);
  await screen.findByRole('region',{name:'Review uncertain draft'});expect(screen.getByRole('button',{name:/Create Draft/})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:/I checked saved records/}));
  await screen.findByText('Saved records could not be confirmed. Creation remains locked.');expect(writes).toBe(1);expect(push).not.toHaveBeenCalled();
});
it.each([false,true])('allows a corrected %s draft after explicit rejection, but navigates only for a confirmed id', async bill => {
  let writes=0;vi.stubGlobal('fetch',vi.fn(async (_url,options) => {
    if(options?.method==='POST'){writes++;return writes===1?Response.json({error:'Check details'},{status:400}):Response.json({[bill?'supplierBill':'invoice']:{id:'saved'}});}
    return Response.json(choices(bill));
  }));mount(bill);await complete(bill);fireEvent.click(screen.getByRole('button',{name:/Create Draft/}));await screen.findByText('Check details');
  fireEvent.click(screen.getByRole('button',{name:/Create Draft/}));await waitFor(()=>expect(push).toHaveBeenCalledWith(bill?'/commercial/purchasing/supplier-bills/saved':'/commercial/invoices/saved'));
});
it('never reports a failed invoice read as an empty ledger',async()=>{
  let fail=true;vi.stubGlobal('fetch',vi.fn(async url=>fail?Response.json({},{status:500}):Response.json(String(url).endsWith('invoices')?{invoices:[]}:{customers:[]})));
  render(<Invoices/>);await screen.findByRole('alert');expect(screen.queryByText('No invoices yet.')).not.toBeInTheDocument();
  fail=false;fireEvent.click(screen.getByRole('button',{name:'Retry invoices'}));await screen.findByText('No invoices yet.');
});
it('shows separate revenue, receipt and cost paths without a synthetic profit or automatic payment',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({month:currentBusinessMonth(),modules:['invoicing','purchasing'],coaching:{state:'not_enabled'},crm:{state:'not_enabled'},income:{state:'ready',value:[{currency:'AUD',invoiced_cents:'10000',received_cents:'2500',outstanding_cents:'7500'}]},costs:{state:'ready',value:[{currency:'AUD',billed_cents:'1500',paid_cents:'500'}]}})));
  render(<TennisBusiness financeOnly/>);await screen.findByRole('link',{name:'Create a lesson invoice'});
  expect(screen.getByText('Payments recorded this month')).toBeVisible();expect(screen.getByText('Supplier payments recorded this month')).toBeVisible();
  expect(screen.getByRole('link',{name:'Review unpaid supplier bills'})).toHaveAttribute('href','/commercial/purchasing/ap-overview');
  expect(screen.queryByText('Coaching today')).not.toBeInTheDocument();expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps an unreadable supplier ledger distinct from no expenses',async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({supplierBills:[]}));vi.stubGlobal('fetch',fetch);
  render(<SupplierBills/>);await screen.findByRole('alert');expect(screen.queryByText('No supplier bills yet.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retry supplier bills'}));await screen.findByText('No supplier bills yet.');
});

it.each([500,200])('locks invoice creation after an ambiguous %s response',async status=>{
  vi.stubGlobal('fetch',vi.fn(async (_url,options)=> options?.method==='POST'?Response.json({}, {status}):Response.json(choices(false))));
  mount(false);await complete(false);fireEvent.click(screen.getByRole('button',{name:/Create Draft/}));
  await screen.findByRole('region',{name:'Review uncertain draft'});expect(push).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:/Create Draft/})).toBeDisabled();
});
it.each([false,true])('unlocks %s only after explicit acknowledgement and a fresh successful ledger read, without replay',async bill=>{
  sessionStorage.setItem(`brainbase:commercial:${bill?'supplierBill':'invoice'}:unconfirmed`,'1');
  const fetch=vi.fn(async (url, options: RequestInit = {})=> { expect(options.method).not.toBe('POST'); return String(url).endsWith(bill?'supplier-bills':'invoices')?Response.json({[bill?'supplierBills':'invoices']:[]}):Response.json(choices(bill)); });vi.stubGlobal('fetch',fetch);
  mount(bill);await screen.findByRole('region',{name:'Review uncertain draft'});
  fireEvent.click(screen.getByRole('button',{name:/I checked saved records/}));await waitFor(()=>expect(screen.queryByRole('region',{name:'Review uncertain draft'})).not.toBeInTheDocument());
  expect(fetch).toHaveBeenCalledTimes(2);expect(push).not.toHaveBeenCalled();
});
it('finds saved invoices by exact booking and class date, including older multiline notes', async () => {
  params.set('coachingBooking', 'booking-1');
  params.set('coachingDate', 'date-1');
  const invoice = (name: string, notes: string | null) => ({
    id: name, invoice_number: name, status: 'ISSUED', total_cents: 1000, currency: 'AUD', notes,
  });
  const records = [
    invoice('MATCH', 'Original notes\r\nCoaching booking reference: booking-1\r\nClass date reference: date-1\r\nPlayer details'),
    invoice('OTHER-BOOKING', 'Coaching booking reference: booking-10\nClass date reference: date-1'),
    invoice('OTHER-DATE', 'Coaching booking reference: booking-1\nClass date reference: date-10'),
    invoice('MANUAL', null),
  ];
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('invoices') ? { invoices: records } : { customers: [] })));
  const view = render(<Invoices/>);
  await screen.findByRole('link', { name: 'MATCH' });
  expect(screen.getByText('1 with this booking reference')).toBeVisible();
  for (const name of ['OTHER-BOOKING', 'OTHER-DATE', 'MANUAL']) expect(screen.queryByText(name)).toBeNull();
  expect(screen.getByRole('link', { name: 'View all invoices' })).toHaveAttribute('href', '/commercial/invoices');
  params.delete('coachingDate');
  view.rerender(<Invoices/>);
  expect(screen.getByText('No saved invoice matches this booking reference.')).toBeVisible();
});

import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TennisBusiness from '@/app/business/tennis/TennisBusiness';
import CoachingRecovery from '@/app/business/tennis/coaching/CoachingRecovery';
import CustomerForm from '@/app/commercial/_components/CustomerForm';
import CustomersPage from '@/app/commercial/customers/page';
import { coachingFetch, clearCoachingLock, COACHING_LOCK } from '@/lib/tennisBusiness/coachingFetch';
import { currentBusinessMonth, type BusinessOverview } from '@/lib/tennisBusiness/model';
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock('@/app/dashboard/sessions/page', () => ({ default: () => <p>Saved coaching timetable</p> }));
const overview = (month = currentBusinessMonth()): BusinessOverview => ({ month, timezone:'Australia/Adelaide',modules:['scheduling','crm','invoicing','purchasing'],coaching:{state:'ready',value:{today:'2026-11-03',sessions:2,players:5}},crm:{state:'ready',value:{contacts:7,openDeals:1}},income:{state:'ready',value:[{currency:'AUD',invoiced_cents:'10000',received_cents:'3000',outstanding_cents:'7000'}]},receiptSpending:{state:'ready',value:'0'},costs:{state:'unavailable'} });
beforeEach(() => { sessionStorage.clear(); clearCoachingLock(); history.replaceState({}, '', '/business/tennis'); vi.stubGlobal('fetch',vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Business saved-state and capability rendering', () => {
  it('shows unavailable spending as an error, never zero, while other saved figures remain visible', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json(overview())); render(<TennisBusiness />);
    await screen.findByText('7 CRM contacts · 1 open opportunities');
    expect(screen.getByText('Saved figures could not be loaded. Refresh before making a decision.')).toBeVisible();
    expect(screen.queryByText('No posted supplier bills or recorded supplier payments in this month.')).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Open invoices and record a payment'})).toBeVisible();
  });
  it('hides old figures immediately on refresh and keeps them hidden after revoked access', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(overview())).mockResolvedValueOnce(Response.json({}, {status:403})); render(<TennisBusiness />);
    await screen.findByText('7 CRM contacts · 1 open opportunities'); fireEvent.click(screen.getByRole('button',{name:'Refresh saved figures'}));
    expect(screen.queryByText('7 CRM contacts · 1 open opportunities')).not.toBeInTheDocument(); await screen.findByText('Unable to load the business workspace. Your access may have changed.');
  });
  it('ignores a late previous-period response and offers no link to a disabled financial area', async () => {
    let release!:(response:Response)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const next={...overview('2026-08'),income:{state:'not_enabled' as const},costs:{state:'not_enabled' as const}};
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(next)); render(<TennisBusiness />);
    fireEvent.change(screen.getByLabelText('Financial month'),{target:{value:'2026-08'}});await screen.findByText('7 CRM contacts · 1 open opportunities');
    await act(async()=>release(Response.json(overview())));expect(screen.queryByRole('link',{name:'Open invoices and record a payment'})).not.toBeInTheDocument();
    expect(screen.getByLabelText('Financial month')).toHaveValue('2026-08');
  });
});
describe('Coaching uncertain-write recovery', () => {
  it('refuses malformed successful reads instead of rendering an empty timetable', async () => {
    history.replaceState({}, '', '/business/tennis/coaching');vi.mocked(fetch).mockResolvedValueOnce(Response.json({unknown:[]}));render(<CoachingRecovery/>);await screen.findByText('Saved coaching timetable');
    await act(async()=>{expect((await coachingFetch('/api/dashboard/sessions')).status).toBe(503);});
    await screen.findByRole('button',{name:'Review saved timetable'});expect(screen.queryByText('Saved coaching timetable')).not.toBeInTheDocument();
  });
  it('unmounts write controls after a lost response, preserves the lock across remount and never repeats the write on review', async () => {
    history.replaceState({}, '', '/business/tennis/coaching');vi.mocked(fetch).mockRejectedValueOnce(new Error('lost after commit'));
    const first=render(<CoachingRecovery/>);await screen.findByText('Saved coaching timetable');
    await act(async()=>{await coachingFetch('/api/bookings/a',{method:'PATCH',body:'{"paid":true}'});});
    expect(screen.queryByText('Saved coaching timetable')).not.toBeInTheDocument();expect(sessionStorage.getItem(COACHING_LOCK)).toBe('1');first.unmount();
    render(<CoachingRecovery/>);await screen.findByRole('button',{name:'Review saved timetable'});
    await act(async()=>{await coachingFetch('/api/bookings/a',{method:'PATCH'});});expect(fetch).toHaveBeenCalledOnce();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, {status:403}));fireEvent.click(screen.getByRole('button',{name:'Review saved timetable'}));await screen.findByText('Saved coaching records are unavailable. Check your access and try again.');expect(sessionStorage.getItem(COACHING_LOCK)).toBe('1');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({sessions:[]})).mockResolvedValueOnce(Response.json({instances:[]})).mockResolvedValueOnce(Response.json({contacts:[]}));
    fireEvent.click(screen.getByRole('button',{name:'Review saved timetable'}));await screen.findByText('Saved coaching timetable');expect(sessionStorage.getItem(COACHING_LOCK)).toBeNull();
    expect(vi.mocked(fetch).mock.calls.filter(([,options])=>options?.method==='PATCH')).toHaveLength(1);
  });
});
describe('Explicit CRM billing contact and customer save recovery', () => {
  it('cannot clear a pending customer save by closing and reopening the drawer', async () => {
    let finish!:(response:Response)=>void;
    vi.mocked(fetch).mockImplementation(async(_url,options)=>options?.method==='POST'?new Promise(resolve=>{finish=resolve;}):Response.json({contacts:[]}));
    const first=render(<CustomerForm onSaved={vi.fn()}/>);fireEvent.change(screen.getByLabelText(/Customer Name/),{target:{value:'Family'}});fireEvent.click(screen.getByRole('button',{name:'Create Customer'}));first.unmount();
    render(<CustomerForm onSaved={vi.fn()}/>);await screen.findByRole('button',{name:'Review saved billing customers'});fireEvent.click(screen.getByRole('button',{name:'Review saved billing customers'}));await screen.findByText('The previous save is still running. Wait for it to finish before reviewing.');
    expect(sessionStorage.getItem('brainbase:commercial:customer-unconfirmed')).toBe('1');
    await act(async()=>finish(Response.json({}, {status:503})));expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/commercial/customers')).toHaveLength(1);
  });
  it('clears billing customer rows after an uncertain status write and requires a successful saved-state read', async () => {
    const customer={id:'c',name:'Synthetic Family',active:true,billing_email:null};
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({customers:[customer]})).mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(Response.json({}, {status:503})).mockResolvedValueOnce(Response.json({customers:[{...customer,active:false}]}));
    render(<CustomersPage/>);await screen.findByRole('link',{name:'Synthetic Family'});
    fireEvent.click(screen.getByRole('button',{name:'Deactivate customer Synthetic Family'}));await screen.findByText('The status change could not be confirmed. Review saved records before trying again.');
    expect(screen.queryByRole('link',{name:'Synthetic Family'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'+ Add Customer'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Review saved records'}));await screen.findByText('Saved billing customers could not be loaded. Review saved records before making changes.');expect(screen.queryByText('No customers yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Review saved records'}));await screen.findByRole('button',{name:'Reactivate customer Synthetic Family'});expect(vi.mocked(fetch).mock.calls.filter(([,options])=>options?.method==='PATCH')).toHaveLength(1);
  });
  it('sends the selected contact ID without changing or combining CRM records', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({contacts:[{id:'parent',first_name:'Synthetic',last_name:'Parent',email:'shared@example.test'}]})).mockResolvedValueOnce(Response.json({customer:{id:'bill'}}));const saved=vi.fn();render(<CustomerForm onSaved={saved}/>);
    await screen.findByRole('option',{name:'Synthetic Parent — shared@example.test'});fireEvent.change(screen.getByLabelText('Linked CRM billing contact'),{target:{value:'parent'}});
    fireEvent.change(screen.getByLabelText(/Customer Name/),{target:{value:'Family billing'}});fireEvent.click(screen.getByRole('button',{name:'Create Customer'}));await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({crmContactId:'parent',name:'Family billing'});
  });
  it('does not replay an unconfirmed customer create after dismissal and requires a successful fresh list', async () => {
    vi.mocked(fetch).mockImplementation(async(url,options)=>{if(options?.method==='POST')throw new Error('lost');return Response.json(String(url).includes('/crm/')?{contacts:[]}:{customers:[]});});
    const saved=vi.fn(),reviewed=vi.fn();const first=render(<CustomerForm onSaved={saved}/>);fireEvent.change(screen.getByLabelText(/Customer Name/),{target:{value:'Family'}});fireEvent.click(screen.getByRole('button',{name:'Create Customer'}));await screen.findByText('The customer save could not be confirmed. Review saved billing customers before repeating it.');first.unmount();
    render(<CustomerForm onSaved={saved} onReview={reviewed}/>);await screen.findByRole('button',{name:'Review saved billing customers'});expect(screen.getByRole('button',{name:'Create Customer'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Review saved billing customers'}));await waitFor(()=>expect(reviewed).toHaveBeenCalledOnce());expect(saved).not.toHaveBeenCalled();expect(vi.mocked(fetch).mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);
  });
});

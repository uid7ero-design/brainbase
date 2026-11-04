import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import CoachingWorkspaceScreen from '@/app/scheduling/_components/CoachingWorkspaceScreen';
const dates={phase:'scheduling',dates:[{id:'i',name:'Juniors',date:'2099-11-03',startTime:'16:00',status:'scheduled',archived:false,enrolled:1,capacity:3}],next:null};
const roster={occurrence:{name:'Juniors',date:'2099-11-03',startTime:'16:00',status:'scheduled'},rows:[{id:'b',name:'Synthetic player',email:'synthetic@example.invalid',status:'confirmed',attendance:null,attendanceVersion:0,paidMarker:false,markerVersion:0,historyOnly:false,priceCents:null,currency:'AUD'}],next:null};
beforeEach(()=>sessionStorage.clear());afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('retains a lost-response request across remount and recovers without another mutation',async()=>{
  const fetch=vi.fn(async(url:string,options?:RequestInit)=>{
    if(options?.method==='POST')throw Error('lost response');
    if(url.includes('/actions?'))return Response.json({confirmed:true});
    return Response.json(url.includes('/roster/')?roster:dates);
  });vi.stubGlobal('fetch',fetch);
  const first=render(<CoachingWorkspaceScreen today="2099-11-03"/>);
  await userEvent.click(await screen.findByRole('button',{name:/2099-11-03 16:00/}));
  await userEvent.click(await screen.findByRole('button',{name:'Here'}));
  await screen.findByText(/save is not confirmed/);expect(sessionStorage.getItem('coaching-roster:i')).toBeTruthy();first.unmount();
  render(<CoachingWorkspaceScreen today="2099-11-03"/>);
  await userEvent.click(await screen.findByRole('button',{name:/2099-11-03 16:00/}));
  expect(await screen.findByRole('button',{name:'Here'})).toBeDisabled();
  await userEvent.click(await screen.findByRole('button',{name:'Check saved request'}));
  await screen.findByText('The saved change is confirmed.');
  expect(fetch.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);
  expect(sessionStorage.getItem('coaching-roster:i')).toBeNull();
});
it('hides stale personal rows after a revoked refresh and blocks further changes',async()=>{
  let revoked=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
    if(options?.method==='POST'){revoked=true;return Response.json({result:{id:'b'}});}
    if(url.includes('/roster/'))return revoked ? Response.json({error:'Denied'},{status:403}) : Response.json(roster);
    return Response.json(dates);
  }));
  render(<CoachingWorkspaceScreen today="2099-11-03"/>);
  await userEvent.click(await screen.findByRole('button',{name:/2099-11-03 16:00/}));
  await userEvent.click(await screen.findByRole('button',{name:'Here'}));
  await screen.findByText(/Saved rows are hidden/);
  await waitFor(()=>expect(screen.queryByText('Synthetic player')).not.toBeInTheDocument());
  expect(screen.queryByRole('button',{name:'Here'})).not.toBeInTheDocument();
});

it('loads previous schedules, clears the selected roster and returns to upcoming dates without writes',async()=>{
  const fetch=vi.fn(async(url:string)=>Response.json(url.includes('/roster/')?roster:dates));
  vi.stubGlobal('fetch',fetch);
  render(<CoachingWorkspaceScreen today="2099-11-03"/>);
  await userEvent.click(await screen.findByRole('button',{name:/2099-11-03 16:00/}));
  await screen.findByRole('button',{name:'Here'});
  await userEvent.click(screen.getByRole('button',{name:'Previous schedule'}));
  await waitFor(()=>expect(fetch.mock.calls.some(([url])=>url.includes('from=2099-10-06&until=2099-11-02'))).toBe(true));
  expect(screen.queryByRole('button',{name:'Here'})).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Previous schedule'}));
  await waitFor(()=>expect(fetch.mock.calls.some(([url])=>url.includes('from=2099-09-08&until=2099-10-05'))).toBe(true));
  await userEvent.click(screen.getByRole('button',{name:'Upcoming schedule'}));
  expect(screen.getByRole('status')).toHaveTextContent('2099-11-03 to 2099-12-01');
});

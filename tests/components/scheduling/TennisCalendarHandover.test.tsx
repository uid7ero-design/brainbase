import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import CalendarScreen from '@/app/scheduling/_components/CalendarScreen';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams('date=2026-11-05')}));
vi.mock('@/app/scheduling/_components/useSchedulingData',()=>({useSchedulingData:()=>({state:'ready',data:{offering:{id:'class',name:'Cardio',scheduleId:'tennis-coaching'},timezone:'Australia/Adelaide',lanes:[],days:[],reasons:['no_offering_availability'],adjustments:[]},problem:null,reload:vi.fn()})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function open(canManage:boolean){vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));render(<CalendarScreen kind="offering" id="class" canManage={canManage} organisationTimezone="Australia/Adelaide"/>);}
it('hands old Tennis calendar links to authoritative coaching dates instead of false no-availability warnings',()=>{
 open(true);
 expect(screen.getByRole('link',{name:'Open Tennis schedule, bookings and previous schedules'})).toHaveAttribute('href','/scheduling/coaching');
 expect(screen.queryByText(/nothing can be booked/i)).not.toBeInTheDocument();
 expect(screen.queryByTestId('calendar-screen')).not.toBeInTheDocument();
});
it('does not expose roster navigation to view-only users',()=>{
 open(false);
 expect(screen.queryByRole('link',{name:/Open Tennis schedule/})).not.toBeInTheDocument();
 expect(screen.getByText(/Ask a coaching manager/)).toBeInTheDocument();
});

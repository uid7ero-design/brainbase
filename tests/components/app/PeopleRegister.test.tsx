import type { ReactNode } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { hrRegisterFixture } from '../../helpers/hrRegisterFixture';
import Page from '@/app/people/page';
import type { PersonDetail } from '@/app/people/_components/PersonDrawer';
vi.mock('@/app/people/_components/SlidePanel', () => ({ default: ({open,children,title}: {open:boolean;children:ReactNode;title:string}) => open ? <section aria-label={title}>{children}</section> : null }));
vi.mock('@/app/people/_components/PersonForm', () => ({ default: ({initial,onSaved,canManage}: {initial?:PersonDetail;onSaved:()=>void;canManage:boolean}) => <div>{initial ? `Editing ${initial.id}` : 'Creating person'}<span>Manage {String(canManage)}</span><button onClick={onSaved}>Save fixture</button></div> }));
vi.mock('@/app/people/_components/PersonDrawer', () => ({ default: ({personId,onClose,onEdit,canManage}: {personId:string|null;onClose:()=>void;onEdit:(value:PersonDetail)=>void;canManage:boolean}) => personId ? <div>Selected {personId}<button onClick={onClose}>Close person</button>{canManage && <button onClick={()=>onEdit({id:personId} as PersonDetail)}>Edit fixture</button>}</div> : null }));
const people = Array.from({length:61},(_,i)=>({id:`p-${i}`,first_name:`Worker ${String(i+1).padStart(3,'0')}`,last_name:'Fixture',job_title:i===60?'Special engineer':'Coordinator',team_name:i===59?'Unique delivery':'Operations',manager_first_name:null,manager_last_name:null,employment_status:i%2?'inactive':'active',worker_type:i%2?'contractor':'employee'}));
const fetchMock = vi.fn();
let canManage:boolean;
beforeEach(()=>{
  canManage=true;fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);
  fetchMock.mockImplementation((url:string)=>Promise.resolve(new Response(JSON.stringify(hrRegisterFixture({people,canManage},url)))));
});
afterEach(()=>vi.unstubAllGlobals());
describe('bounded People browsing and refresh',()=>{
  it('loads 25 display rows, uses server totals and requests the next page',async()=>{
    renderBrainbase(<Page/>);await screen.findByRole('button',{name:'Worker 001 Fixture'});
    expect(screen.getAllByRole('row')).toHaveLength(26);expect(screen.getByRole('status').textContent).toContain('61 matching rows');
    expect(screen.getByRole('button',{name:'+ Add Person'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Next'}));await screen.findByRole('button',{name:'Worker 026 Fixture'});
    expect(fetchMock.mock.calls[1][0]).toContain('page=2');expect(screen.queryByRole('button',{name:'Worker 001 Fixture'})).toBeNull();
    expect(fetchMock.mock.calls.every(call=>call[0].startsWith('/api/hr/people/register?')&&call[1].cache==='no-store')).toBe(true);
  });
  it.each([['Worker 061','Worker 061 Fixture'],['special engineer','Worker 061 Fixture'],['unique delivery','Worker 060 Fixture']])('searches %s across the full authorized result and resets paging',async(search,name)=>{
    renderBrainbase(<Page/>);await screen.findByRole('button',{name:'Worker 001 Fixture'});
    fireEvent.click(screen.getByRole('button',{name:'Next'}));await screen.findByRole('button',{name:'Worker 026 Fixture'});
    fireEvent.change(screen.getByLabelText('Search people, job titles or teams'),{target:{value:search}});
    await screen.findByRole('button',{name});expect(screen.getByRole('status').textContent).toContain('Page 1 of 1');
  });
  it('combines employment and worker filters without turning empty results into a create prompt',async()=>{
    renderBrainbase(<Page/>);await screen.findByRole('button',{name:'Worker 001 Fixture'});
    fireEvent.change(screen.getByLabelText('Employment status'),{target:{value:'inactive'}});
    await screen.findByRole('button',{name:'Worker 002 Fixture'});expect(screen.getByRole('status').textContent).toContain('30 matching rows');
    fireEvent.change(screen.getByLabelText('Worker type'),{target:{value:'employee'}});
    expect(await screen.findByText('No people match your search.')).toBeTruthy();expect(screen.queryByText('No people yet. Add your first person to get started.')).toBeNull();
  });
  it('clears old rows and management controls on a failed refresh, then recovers using current permission',async()=>{
    renderBrainbase(<Page/>);await screen.findByRole('button',{name:'Worker 001 Fixture'});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({error:'database secret'}),{status:503}));
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByText('Unable to load People. Please refresh to try again.');
    expect(screen.queryByRole('button',{name:'Worker 001 Fixture'})).toBeNull();expect(screen.queryByRole('button',{name:'+ Add Person'})).toBeNull();
    expect(screen.queryByText('database secret')).toBeNull();expect(screen.queryByRole('status')).toBeNull();
    canManage=false;fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByRole('button',{name:'Worker 001 Fixture'});
    expect(screen.queryByRole('button',{name:'+ Add Person'})).toBeNull();expect(screen.queryByRole('link',{name:'Manage Teams'})).toBeNull();
  });
  it('ignores late rows and management permission from an aborted page read',async()=>{
    renderBrainbase(<Page/>);await screen.findByRole('button',{name:'Worker 001 Fixture'});
    let finish!:(value:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
    fireEvent.click(screen.getByRole('button',{name:'Next'}));await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
    const pending=fetchMock.mock.calls[1];canManage=false;
    fireEvent.change(screen.getByLabelText('Search people, job titles or teams'),{target:{value:'Worker 061'}});
    await screen.findByRole('button',{name:'Worker 061 Fixture'});expect(pending[1].signal.aborted).toBe(true);
    finish(new Response(JSON.stringify(hrRegisterFixture({people,canManage:true},pending[0]))));
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('1 matching rows'));
    expect(screen.queryByRole('button',{name:'+ Add Person'})).toBeNull();expect(screen.queryByRole('button',{name:'Worker 026 Fixture'})).toBeNull();
  });
  it('opens the selected person, refreshes on close and preserves separate create/edit save flows',async()=>{
    renderBrainbase(<Page/>);await screen.findByRole('button',{name:'Worker 001 Fixture'});
    fireEvent.click(screen.getByRole('button',{name:'Worker 001 Fixture'}));expect(screen.getByText('Selected p-0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Close person'}));await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByRole('button',{name:'+ Add Person'});fireEvent.click(screen.getByRole('button',{name:'+ Add Person'}));
    expect(screen.getByText('Creating person')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Save fixture'}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(3));await screen.findByRole('button',{name:'Worker 001 Fixture'});
    fireEvent.click(screen.getByRole('button',{name:'Worker 001 Fixture'}));fireEvent.click(screen.getByRole('button',{name:'Edit fixture'}));
    expect(screen.getByText('Editing p-0')).toBeTruthy();expect(screen.queryByText('Creating person')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Save fixture'}));await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(4));
  });
  it('rejects malformed management flags and cancels reads on unmount',async()=>{
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({people:[],canManage:'true',pagination:{page:1,page_size:25,total:0}})));
    const view=renderBrainbase(<Page/>);await screen.findByText('Unable to load People. Please refresh to try again.');
    expect(screen.queryByRole('button',{name:'+ Add Person'})).toBeNull();view.unmount();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

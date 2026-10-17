import type { OrganiserEvent } from '@/lib/ticketing/gateway';

// A no-JavaScript GET form: choosing an event reloads the page with ?event=.
export function EventPicker({ events, selectedId }: { events: OrganiserEvent[]; selectedId: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="event" className="block text-sm font-medium">Event</label>
        <select id="event" name="event" defaultValue={selectedId} className="mt-1 min-h-11 rounded-lg border border-eve-line bg-white px-3 text-sm">
          {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      <button type="submit" className="min-h-11 rounded-full border border-eve-line px-4 text-sm font-semibold">Show</button>
    </form>
  );
}

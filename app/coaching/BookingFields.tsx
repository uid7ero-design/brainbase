import { randomUUID } from 'node:crypto';
import type { ClassDate } from '@/lib/scheduling/coachClasses';
export default function BookingFields({ date }: { date: ClassDate }) {
  return (
    <>
      <input type="hidden" name="class" value={date.id} />
      <input type="hidden" name="key" value={randomUUID()} />
      <input type="hidden" name="price" value={date.cents + '/' + date.currency} />
      <label>
        Name <input name="name" autoComplete="name" maxLength={200} required />
      </label>
      <label>
        Email <input name="email" type="email" autoComplete="email" maxLength={320} required />
      </label>
    </>
  );
}

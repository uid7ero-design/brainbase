'use client';
import { useState, type ComponentProps } from 'react';
import ClassForm from './ClassForm';

export default function ClassDateForm({
  action,
  children,
}: Pick<ComponentProps<typeof ClassForm>, 'action' | 'children'>) {
  const [weekly, setWeekly] = useState(false);
  return (
    <ClassForm action={action} label={weekly ? 'Create term' : 'Add class date'}>
      <input type="hidden" name="action" value={weekly ? 'term' : 'date'} />
      <label>
        Schedule type{' '}
        <select value={weekly ? 'term' : 'single'} onChange={(e) => setWeekly(e.target.value === 'term')}>
          <option value="single">Single class date</option>
          <option value="term">Weekly term</option>
        </select>
      </label>
      {children}
      {weekly && (
        <>
          <label>
            Term name <input name="termName" required maxLength={120} />
          </label>
          <label>
            Term ends on <input type="date" name="end" required />
          </label>
          <p>Repeat weekly from the class date through the end date, for up to 26 weeks.</p>
        </>
      )}
    </ClassForm>
  );
}

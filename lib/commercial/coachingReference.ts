export function coachingReference(bookingId: string, occurrenceId: string) {
  return `Coaching booking reference: ${bookingId}\nClass date reference: ${occurrenceId}`;
}

export function hasCoachingReference(notes: string | null, bookingId: string, occurrenceId: string) {
  const validId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  if (typeof notes !== 'string' || !validId.test(bookingId) || !validId.test(occurrenceId)) return false;
  const normalized = notes.replace(/\r\n/g, '\n');
  return `\n${normalized}\n`.includes(`\n${coachingReference(bookingId, occurrenceId)}\n`);
}

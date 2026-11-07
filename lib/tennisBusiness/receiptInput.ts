export const receiptIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function field(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || value.includes('\0')) {
    throw new Error(`Enter a valid ${label} (up to ${max} characters).`);
  }
  return value.trim();
}

export function parseReceipt(input: Record<string, unknown>, today: string) {
  const { id, date, amount } = input;
  if (typeof id !== 'string' || !receiptIdPattern.test(id)) throw new Error('Open a new receipt entry.');
  if (typeof date !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(date) || date > today) throw new Error('Choose a valid purchase date up to today.');
  const parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Choose a valid purchase date.');
  if (typeof amount !== 'string' || !/^\d{1,8}(\.\d{1,2})?$/.test(amount)) throw new Error('Enter the AUD total with up to two decimal places.');
  const [whole, fraction = ''] = amount.split('.');
  const cents = Number(whole + fraction.padEnd(2, '0'));
  if (cents < 1 || cents > 2147483647) throw new Error('Enter an amount between $0.01 and $21,474,836.47.');
  return { id, date, cents, merchant: field(input.merchant, 160, 'merchant'), description: field(input.description, 300, 'description'),
    reference: input.reference == null || input.reference === '' ? null : field(input.reference, 100, 'receipt number') };
}

export function receiptToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Adelaide', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

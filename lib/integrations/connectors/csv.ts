import type { Connector, ConnectorConfig, RawRecord } from '../types';

export const csvConnector: Connector = {
  id: 'csv-url',
  label: 'CSV URL',
  description: 'Fetch a CSV file from a public URL and parse it.',

  async fetch(config: ConnectorConfig): Promise<RawRecord[]> {
    const res = await fetch(config.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`CSV fetch ${res.status}`);
    const text = await res.text();
    return parseCsv(text);
  },
};

function parseCsv(text: string): RawRecord[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    const row: RawRecord = {};
    headers.forEach((h, i) => {
      const raw = values[i]?.trim().replace(/^"|"$/g, '') ?? null;
      row[h] = raw === '' ? null : raw;
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

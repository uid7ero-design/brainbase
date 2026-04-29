import type { Connector, ConnectorConfig, RawRecord } from '../types';

export const restConnector: Connector = {
  id: 'rest',
  label: 'REST API',
  description: 'Fetch data from a JSON REST endpoint.',

  async fetch(config: ConnectorConfig): Promise<RawRecord[]> {
    const res = await fetch(config.url, {
      method: config.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers ?? {}),
      },
      ...(config.body ? { body: config.body } : {}),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`REST ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();

    if (Array.isArray(data))           return data as RawRecord[];
    if (Array.isArray(data?.data))     return data.data as RawRecord[];
    if (Array.isArray(data?.records))  return data.records as RawRecord[];
    if (Array.isArray(data?.results))  return data.results as RawRecord[];
    if (Array.isArray(data?.items))    return data.items as RawRecord[];

    throw new Error('REST response is not an array or a recognised wrapper ({ data, records, results, items }).');
  },
};

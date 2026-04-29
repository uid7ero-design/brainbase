import type { Connector, ConnectorId } from './types';
import { restConnector } from './connectors/rest';
import { csvConnector }  from './connectors/csv';

const REGISTRY: Record<ConnectorId, Connector> = {
  'rest':    restConnector,
  'csv-url': csvConnector,
};

export function getConnector(id: ConnectorId): Connector {
  const c = REGISTRY[id];
  if (!c) throw new Error(`Unknown connector: ${id}`);
  return c;
}

export function listConnectors(): Connector[] {
  return Object.values(REGISTRY);
}

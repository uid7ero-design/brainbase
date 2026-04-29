export type ConnectorId = 'rest' | 'csv-url';
export type TargetTable = 'waste_records' | 'fleet_metrics' | 'service_requests';
export type SyncStatus = 'success' | 'error' | 'running';

export interface ConnectorConfig {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  financial_year?: string;
  month?: string;
}

export interface Integration {
  id: string;
  organisation_id: string;
  connector_id: ConnectorId;
  name: string;
  config: ConnectorConfig;
  target_table: TargetTable;
  schedule: string;
  enabled: boolean;
  last_synced_at: string | null;
  last_sync_status: SyncStatus | null;
  last_sync_count: number | null;
  created_at: string;
}

export interface SyncJob {
  id: string;
  integration_id: string;
  organisation_id: string;
  started_at: string;
  completed_at: string | null;
  status: SyncStatus | 'running';
  records_synced: number;
  error_message: string | null;
}

export type RawRecord = Record<string, unknown>;

export interface Connector {
  id: ConnectorId;
  label: string;
  description: string;
  fetch(config: ConnectorConfig): Promise<RawRecord[]>;
}

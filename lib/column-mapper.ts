import { SchemaType } from "@prisma/client";

// Canonical field → list of raw column name variants to try (all lowercase/normalised)
const FIELD_ALIASES: Record<string, string[]> = {
  // Shared
  address:          ["address", "streetaddress", "location", "addr"],
  suburb:           ["suburb", "city", "town", "locality"],
  zone:             ["zone", "area", "district", "region"],
  status:           ["status", "state", "disposition"],
  notes:            ["notes", "comments", "remarks", "description"],

  // Dates
  scheduled_date:   ["scheduleddate", "scheduledate", "date", "pickupdate"],
  report_date:      ["reportdate", "date", "incidentdate", "logdate"],
  request_date:     ["requestdate", "date", "lodgeddate", "createddate"],
  collection_date:  ["collectiondate", "date", "servicedate"],
  resolution_date:  ["resolutiondate", "resolveddate", "closeddate"],

  // Missed collections
  service_type:     ["servicetype", "service", "type", "collectiontype"],
  route:            ["route", "routeid", "routecode"],
  property_id:      ["propertyid", "property", "propid", "assessmentnumber"],
  driver_id:        ["driverid", "driver", "operatorid"],
  reason:           ["reason", "cause", "missreason"],
  complaint_raised: ["complaintraised", "complaint", "hascomplaints"],

  // Illegal dumping
  location:         ["location", "address", "site", "incidentlocation"],
  waste_type:       ["wastetype", "type", "material", "category"],
  volume_estimate:  ["volumeestimate", "volume", "quantity", "size"],
  severity:         ["severity", "priority", "level"],
  crew_assigned:    ["crewassigned", "crew", "assignedto", "operator"],
  cost_estimate:    ["costestimate", "cost", "estimatedcost"],

  // Debtors
  account_number:   ["accountnumber", "accountno", "acctno", "id"],
  account_name:     ["accountname", "name", "customer", "ratepayer"],
  outstanding_amount:["outstandingamount", "outstanding", "balance", "amountowing"],
  original_amount:  ["originalamount", "invoiceamount", "amount"],
  days_overdue:     ["daysoverdue", "overdue", "agingdays"],
  aging_bucket:     ["agingbucket", "aging", "bucket"],
  last_payment_date:["lastpaymentdate", "lastpayment", "paymentdate"],
  last_payment_amount:["lastpaymentamount", "paymentamount"],
  collection_stage: ["collectionstage", "stage", "recoveryaction"],

  // Service requests
  request_type:     ["requesttype", "type", "issuetype", "category"],
  asset_id:         ["assetid", "asset", "equipmentid"],
  priority:         ["priority", "urgency"],
  repeat_issue:     ["repeatissue", "repeat", "isrepeat", "recurring"],
  complaint_count:  ["complaintcount", "complaints", "numcomplaints"],
  units_affected:   ["unitsaffected", "units", "properties"],
  response_hours:   ["responsehours", "responsetime", "timetoresolve"],

  // Bin maintenance
  bin_type:         ["bintype", "binsize", "containertype"],

  // Metrics
  metric_key:       ["metrickey", "metric", "kpi", "indicator"],
  metric_value:     ["metricvalue", "value", "count", "amount"],
  period_start:     ["periodstart", "startdate", "from"],
  period_end:       ["periodend", "enddate", "to"],
  module:           ["module", "department", "category"],
};

// Required canonical fields per schema type
const SCHEMA_FIELDS: Partial<Record<SchemaType, string[]>> = {
  MISSED_COLLECTIONS: ["address", "scheduled_date", "service_type", "status", "suburb", "route", "property_id", "driver_id", "reason", "complaint_raised"],
  ILLEGAL_DUMPING:    ["location", "report_date", "waste_type", "severity", "zone", "suburb", "volume_estimate", "crew_assigned", "resolution_date", "cost_estimate", "notes"],
  DEBTORS:            ["account_number", "account_name", "outstanding_amount", "original_amount", "days_overdue", "aging_bucket", "last_payment_date", "last_payment_amount", "status", "collection_stage"],
  SERVICE_REQUESTS:   ["request_date", "request_type", "service_type", "zone", "suburb", "address", "asset_id", "priority", "severity", "status", "repeat_issue", "complaint_count", "units_affected", "response_hours", "resolution_date", "notes"],
  BIN_MAINTENANCE:    ["property_id", "collection_date", "bin_type", "status", "suburb", "route", "notes"],
  WASTE_METRICS:      ["period_start", "period_end", "metric_key", "metric_value", "module", "zone"],
  FINANCIAL:          ["account_number", "account_name", "outstanding_amount", "original_amount", "status"],
  GENERIC:            [],
};

function normalise(col: string): string {
  return col.toLowerCase().replace(/[\s_\-]/g, "");
}

export function mapColumns(
  rawColumns: string[],
  schemaType: SchemaType
): Record<string, string | null> {
  const normToRaw = new Map<string, string>();
  for (const col of rawColumns) normToRaw.set(normalise(col), col);

  const fields = SCHEMA_FIELDS[schemaType] ?? [];
  const mappings: Record<string, string | null> = {};

  for (const canonical of fields) {
    const aliases = FIELD_ALIASES[canonical] ?? [canonical];
    let matched: string | null = null;

    for (const alias of aliases) {
      const raw = normToRaw.get(normalise(alias));
      if (raw) { matched = raw; break; }
    }

    mappings[canonical] = matched;
  }

  return mappings;
}

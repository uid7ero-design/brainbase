// BrainBase shared reference data — field rules for locations, assets and
// external organisations. ZERO imports (client-safe): shared by the
// Assurance Settings → Reference data UI and lib/referenceData/service.ts.
//
// These are SHARED BrainBase platform entities (A0.1B tables `locations`,
// `assets`, `external_organisations` + `external_organisation_roles`).
// Assurance consumes them; it never keeps its own copies. The database is
// the authority (A0.1B CHECK constraints: allowed types / statuses / roles,
// non-blank optional text, 2-letter country code, UNIQUE per-organisation
// reference). These rules add product conventions on top: an upper-case,
// immutable reference, bounded lengths, and light format checks.

export type ReferenceKind = 'location' | 'asset' | 'external_organisation';

export const REFERENCE_KINDS: readonly ReferenceKind[] = ['location', 'asset', 'external_organisation'];

// ── Allowed values (mirror the A0.1B CHECK constraints exactly) ───────────

export const LOCATION_TYPES = ['SITE', 'DEPOT', 'FACILITY', 'OFFICE', 'PROPERTY', 'WORK_AREA', 'ROAD', 'PROJECT_SITE', 'OTHER'] as const;
export const ASSET_TYPES = ['VEHICLE', 'PLANT', 'EQUIPMENT', 'FACILITY', 'BUILDING', 'INFRASTRUCTURE', 'DEVICE', 'OTHER'] as const;
export const EXTERNAL_ORGANISATION_ROLES = [
  'CONTRACTOR', 'SUBCONTRACTOR', 'SUPPLIER', 'SERVICE_PROVIDER', 'CONSULTANT', 'CUSTOMER', 'PARTNER', 'INSURER', 'OTHER',
] as const;

/** Every status the shared tables allow. Only ACTIVE records are offered for new Assurance records. */
export const REFERENCE_STATUSES: Record<ReferenceKind, readonly string[]> = {
  location: ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
  asset: ['ACTIVE', 'INACTIVE', 'RETIRED', 'ARCHIVED'],
  external_organisation: ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
};

/**
 * Reactivation is offered from INACTIVE only. ARCHIVED / RETIRED are
 * lifecycle states owned by the shared platform (no BrainBase screen sets
 * them today); this settings surface does not reverse them.
 */
export const REACTIVATABLE_STATUS = 'INACTIVE';

// ── Shared limits ────────────────────────────────────────────────────────

export const REFERENCE_MAX = 40;
export const REFERENCE_NAME_MAX = 160;
export const REFERENCE_DESCRIPTION_MAX = 1000;

/** Upper-case letter or digit first, then letters, digits, dot, dash, underscore or slash. */
export const REFERENCE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]*$/;

/** Trims and upper-cases a proposed reference. Pure; never throws. */
export function normaliseReference(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/** Null when the (already normalised) reference is acceptable, else a user-facing reason. */
export function referenceProblem(reference: string): string | null {
  if (!reference) return 'Reference is required.';
  if (reference.length > REFERENCE_MAX) return `Reference must be at most ${REFERENCE_MAX} characters.`;
  if (!REFERENCE_PATTERN.test(reference)) {
    return 'Reference must start with a letter or number and use only letters, numbers, dots, dashes, underscores or slashes.';
  }
  return null;
}

/** Human label for an upper-snake value (e.g. WORK_AREA → "Work area"). */
export function referenceValueLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const words = value.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) return value;
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

// ── Field model ──────────────────────────────────────────────────────────

export type ReferenceField = {
  /** Request-body key (camelCase). */
  key: string;
  label: string;
  control: 'text' | 'textarea' | 'select' | 'multiselect';
  required?: boolean;
  max?: number;
  options?: readonly string[];
  inputType?: 'text' | 'email' | 'tel' | 'url';
  helper?: string;
  /** Applies a format check after trimming; returns a reason or null. */
  format?: 'country_code' | 'email' | 'website';
  /** Shown in the list/cards summary. */
  summary?: boolean;
};

export type ReferenceKindConfig = {
  kind: ReferenceKind;
  singular: string;
  plural: string;
  /** API / page path segment. */
  segment: 'locations' | 'assets' | 'external-organisations';
  typeKey: string | null;
  typeLabel: string | null;
  fields: readonly ReferenceField[];
  emptyMessage: string;
  purpose: string;
  usedOn: string;
};

const DESCRIPTION: ReferenceField = { key: 'description', label: 'Description', control: 'textarea', max: REFERENCE_DESCRIPTION_MAX };

export const REFERENCE_CONFIG: Record<ReferenceKind, ReferenceKindConfig> = {
  location: {
    kind: 'location',
    singular: 'location',
    plural: 'Locations',
    segment: 'locations',
    typeKey: 'locationType',
    typeLabel: 'Location type',
    fields: [
      { key: 'locationType', label: 'Location type', control: 'select', required: true, options: LOCATION_TYPES, summary: true },
      DESCRIPTION,
      { key: 'addressLine1', label: 'Address line 1', control: 'text', max: 200 },
      { key: 'addressLine2', label: 'Address line 2', control: 'text', max: 200 },
      { key: 'suburb', label: 'Suburb', control: 'text', max: 100, summary: true },
      { key: 'state', label: 'State', control: 'text', max: 50, summary: true },
      { key: 'postcode', label: 'Postcode', control: 'text', max: 12 },
      { key: 'countryCode', label: 'Country code', control: 'text', max: 2, format: 'country_code', helper: 'Two letters, for example AU.' },
    ],
    emptyMessage: 'No locations have been configured for this organisation.',
    purpose: 'The places Assurance records can reference: sites, depots, offices, roads and work areas.',
    usedOn: 'incidents, inspections, audits, findings and evidence',
  },
  asset: {
    kind: 'asset',
    singular: 'asset',
    plural: 'Assets',
    segment: 'assets',
    typeKey: 'assetType',
    typeLabel: 'Asset type',
    fields: [
      { key: 'assetType', label: 'Asset type', control: 'select', required: true, options: ASSET_TYPES, summary: true },
      DESCRIPTION,
      {
        key: 'externalIdentifier', label: 'External identifier', control: 'text', max: 100, summary: true,
        helper: 'An identifier from another system, such as a fleet number or registration.',
      },
    ],
    emptyMessage: 'No assets are available.',
    purpose: 'Vehicles, plant, equipment, buildings and other assets Assurance records can reference.',
    usedOn: 'incidents, inspections, audits and findings',
  },
  external_organisation: {
    kind: 'external_organisation',
    singular: 'external organisation',
    plural: 'External organisations',
    segment: 'external-organisations',
    typeKey: null,
    typeLabel: 'Roles',
    fields: [
      {
        key: 'roles', label: 'Roles', control: 'multiselect', options: EXTERNAL_ORGANISATION_ROLES, summary: true,
        helper: 'How this organisation relates to yours. Choose any that apply.',
      },
      { key: 'legalName', label: 'Legal name', control: 'text', max: 200 },
      { key: 'businessIdentifier', label: 'Business identifier', control: 'text', max: 50, helper: 'For example an ABN or company number.' },
      {
        key: 'email', label: 'General email', control: 'text', inputType: 'email', max: 254, format: 'email',
        helper: 'A general business address, not a personal one.',
      },
      { key: 'phone', label: 'General phone', control: 'text', inputType: 'tel', max: 40 },
      // Plain text (not type="url"): browsers reject "example.com" without a
      // scheme, which the server accepts. The server format check is the rule.
      { key: 'website', label: 'Website', control: 'text', max: 300, format: 'website', helper: 'For example example.com or https://example.com.' },
    ],
    emptyMessage: 'No external organisations have been configured.',
    purpose: 'Contractors, suppliers, service providers, customers and other external parties.',
    usedOn: 'incidents, inspections, audits, findings and actions',
  },
};

export function referenceConfigForSegment(segment: string): ReferenceKindConfig | null {
  return REFERENCE_KINDS.map(k => REFERENCE_CONFIG[k]).find(c => c.segment === segment) ?? null;
}

// ── Validation (pure; the server is the authority and calls this) ─────────

export type ParsedReferenceValues = {
  name: string;
  /** Present on create only (the reference is immutable afterwards). */
  reference?: string;
  /** Field values keyed by ReferenceField.key; strings, null, or a sorted string[] for multiselect. */
  fields: Record<string, string | null | string[]>;
};

export type ParseResult = { ok: true; values: ParsedReferenceValues } | { ok: false; error: string };

function formatProblem(format: ReferenceField['format'], value: string, label: string): string | null {
  if (format === 'country_code') return /^[A-Z]{2}$/.test(value) ? null : `${label} must be two letters, for example AU.`;
  if (format === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : `${label} must be a valid email address.`;
  if (format === 'website') return /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(value) ? null : `${label} must be a web address, for example https://example.com.`;
  return null;
}

/**
 * Validates a create/update body for `kind`. On update (`create: false`)
 * every field is optional and only supplied keys are returned, so a partial
 * body never blanks fields it did not mention.
 */
export function parseReferenceInput(kind: ReferenceKind, raw: Record<string, unknown>, create: boolean): ParseResult {
  const cfg = REFERENCE_CONFIG[kind];
  const values: ParsedReferenceValues = { name: '', fields: {} };

  if (create) {
    const reference = normaliseReference(raw.reference);
    const problem = referenceProblem(reference);
    if (problem) return { ok: false, error: problem };
    values.reference = reference;
  }

  if (create || raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.trim() === '') return { ok: false, error: 'Name is required.' };
    const name = raw.name.trim();
    if (name.length > REFERENCE_NAME_MAX) return { ok: false, error: `Name must be ${REFERENCE_NAME_MAX} characters or fewer.` };
    values.name = name;
  }

  for (const f of cfg.fields) {
    const v = raw[f.key];
    if (!create && v === undefined) continue;
    if (f.control === 'multiselect') {
      if (v === undefined || v === null) { values.fields[f.key] = []; continue; }
      if (!Array.isArray(v) || v.length > (f.options?.length ?? 0) || !v.every(x => typeof x === 'string' && (f.options ?? []).includes(x))) {
        return { ok: false, error: `${f.label} contains a value that is not allowed.` };
      }
      values.fields[f.key] = [...new Set(v as string[])].sort();
      continue;
    }
    if (v !== undefined && v !== null && typeof v !== 'string') return { ok: false, error: `${f.label} must be text.` };
    let t = typeof v === 'string' ? v.trim() : '';
    if (f.format === 'country_code') t = t.toUpperCase();
    if (t === '') {
      if (f.required) return { ok: false, error: `${f.label} is required.` };
      values.fields[f.key] = null;
      continue;
    }
    if (f.control === 'select') {
      if (!(f.options ?? []).includes(t)) return { ok: false, error: `${f.label} is not a recognised value.` };
    } else {
      // Format first: "must be two letters" is clearer than a length limit.
      const fp = formatProblem(f.format, t, f.label);
      if (fp) return { ok: false, error: fp };
      if (f.max && t.length > f.max) return { ok: false, error: `${f.label} must be ${f.max} characters or fewer.` };
    }
    values.fields[f.key] = t;
  }
  return { ok: true, values };
}

// BrainBase Assurance — contextual Help targets. ZERO imports (pure data).
//
// Each Assurance page links to the most useful Help page (and section) for
// the task on that screen. Targets are registry slugs + heading anchors; a
// containment test resolves every one against the real documents, so a
// renamed heading or document fails the build's tests instead of producing
// a dead link.

export type HelpTopic =
  | 'dashboard'
  | 'incidents' | 'incident-new' | 'incident'
  | 'investigations' | 'investigation-new' | 'investigation'
  | 'inspections' | 'inspection-new' | 'inspection' | 'inspection-templates'
  | 'audits' | 'audit-new' | 'audit' | 'audit-templates'
  | 'findings' | 'finding'
  | 'actions' | 'action'
  | 'evidence' | 'evidence-record'
  | 'verification'
  | 'settings' | 'risk-levels' | 'reference-data';

export type HelpTarget = { slug: string; anchor?: string; label: string };

export const HELP_TOPICS: Record<HelpTopic, HelpTarget> = {
  dashboard: { slug: 'user-guide', anchor: 'dashboard-what-needs-attention', label: 'Using the dashboard' },

  incidents: { slug: 'user-guide', anchor: 'incidents', label: 'Incidents' },
  'incident-new': { slug: 'report-an-incident', label: 'Report an incident' },
  incident: { slug: 'user-guide', anchor: 'status-and-lifecycle', label: 'Incident status and closure' },

  investigations: { slug: 'user-guide', anchor: 'investigations', label: 'Investigations' },
  'investigation-new': { slug: 'start-an-investigation', label: 'Start an investigation' },
  investigation: { slug: 'start-an-investigation', label: 'Investigation steps' },

  inspections: { slug: 'user-guide', anchor: 'inspections', label: 'Inspections' },
  'inspection-new': { slug: 'run-an-inspection', label: 'Run an inspection' },
  inspection: { slug: 'run-an-inspection', label: 'Run an inspection' },
  'inspection-templates': { slug: 'manage-templates', label: 'Manage templates' },

  audits: { slug: 'user-guide', anchor: 'audits', label: 'Audits' },
  'audit-new': { slug: 'create-and-run-an-audit', label: 'Create and run an audit' },
  audit: { slug: 'create-and-run-an-audit', label: 'Create and run an audit' },
  'audit-templates': { slug: 'manage-templates', label: 'Manage templates' },

  findings: { slug: 'user-guide', anchor: 'findings-2', label: 'Findings' },
  finding: { slug: 'raise-and-manage-a-finding', label: 'Raise and manage a finding' },

  actions: { slug: 'user-guide', anchor: 'actions', label: 'Actions' },
  action: { slug: 'create-and-manage-an-action', label: 'Create and manage an action' },

  evidence: { slug: 'user-guide', anchor: 'evidence-2', label: 'Evidence' },
  'evidence-record': { slug: 'add-and-link-evidence', label: 'Add and link evidence' },

  verification: { slug: 'perform-verification', label: 'Perform verification' },

  settings: { slug: 'admin-guide', anchor: 'assurance-settings', label: 'Assurance settings' },
  'risk-levels': { slug: 'manage-risk-levels', label: 'Manage risk levels' },
  'reference-data': { slug: 'manage-reference-data', label: 'Manage reference data' },
};

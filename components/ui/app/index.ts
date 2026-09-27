// Authenticated-application primitives.
//   Phase A: Button, Field, Panel (+ semantic status re-exports)
//   Phase C: PageHeader, WorkToolbar, Table contract, StateMessage,
//            SlidePanel, FormActions/FormError, buttonProps
//   Phase D1: ModuleSidebar / ModuleNavItem / ModuleNavSection, Dialog,
//             MetricStrip / Metric
// Status and notices use components/ui/semantic (StatusDot, Badge, Banner,
// Alert, LiveRegion) — re-exported here as the app's canonical status set.
export { Button, buttonProps, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export {
  Field,
  FormActions,
  FormError,
  fieldControlClassName,
  type FieldProps,
  type FieldControlProps,
} from './Field';
export { Panel, type PanelProps } from './Panel';
export { PageHeader, type PageHeaderProps } from './PageHeader';
export {
  WorkToolbar,
  ToolbarSearch,
  toolbarControlClassName,
  type WorkToolbarProps,
  type ToolbarSearchProps,
} from './WorkToolbar';
export {
  TableContainer,
  TableStateRow,
  tableStyles,
  type TableContainerProps,
  type TableStateRowProps,
} from './Table';
export { StateMessage, type StateMessageProps } from './StateMessage';
export { SlidePanel, type SlidePanelProps } from './SlidePanel';
export { Dialog, type DialogProps } from './Dialog';
export { MetricStrip, Metric, type MetricProps, type MetricTone, type MetricChange } from './Metric';
export {
  ModuleSidebar,
  ModuleNavItem,
  ModuleNavSection,
  moduleNavItemProps,
  moduleNavFooterItemClassName,
  type ModuleSidebarProps,
  type ModuleNavItemProps,
} from './ModuleNav';
export {
  StatusDot,
  Badge,
  Banner,
  Alert,
  LiveRegion,
  SEMANTIC_STATES,
  type SemanticState,
} from '@/components/ui/semantic';

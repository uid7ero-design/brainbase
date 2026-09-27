'use client';

// People slide panel. Phase C: CRM, People and Commercial each kept a
// byte-identical private copy of this shell (same API, same close
// behaviour). The shell now lives in the shared, module-neutral
// components/ui/app/SlidePanel so its visual treatment and dialog
// semantics are defined once. This file stays as the module's own import
// point — call sites (`import SlidePanel from '../_components/SlidePanel'`)
// are unchanged, and no module imports another module's _components.
export { SlidePanel as default } from '@/components/ui/app/SlidePanel';

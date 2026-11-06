/**
 * checklist-photos fail-fast config validation (Spec 19).
 *
 * The canonical parsing + validation lives in `checklist.constants.ts` (all `CHECKLIST_*` tunables
 * derive from env with sensible defaults, no hardcoded values in logic). This module re-exports the
 * validator so the module's `onModuleInit` and the design's file tree (`config/`) reference a
 * dedicated entry point. Skipped under NODE_ENV=test.
 */
export { validateChecklistPhotosConfig } from '../checklist.constants';

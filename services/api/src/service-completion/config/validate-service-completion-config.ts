/**
 * Fail-fast config entry point for service-completion (Spec 20).
 *
 * Re-exports the validator defined alongside the parsed constants so the module's `config/` folder
 * has a single, discoverable entry point (mirrors the sibling specs' layout).
 */
export { validateServiceCompletionConfig } from '../completion.constants';

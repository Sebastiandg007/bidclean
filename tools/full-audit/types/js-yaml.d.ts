/**
 * Minimal ambient declaration for `js-yaml` (hoisted at the repo root, no
 * `@types/js-yaml` installed). We only use `load` to parse the registry YAML
 * into `unknown`, which the loader then validates field-by-field — so a loose
 * `unknown` return is exactly the contract we want.
 */
declare module 'js-yaml' {
  export function load(input: string): unknown;
}

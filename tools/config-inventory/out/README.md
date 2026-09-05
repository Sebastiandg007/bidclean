# config-inventory / out

## Purpose

Scratch and generated-artifact directory for the `config-inventory` tool. Nothing here is part of the shipped tool or its runtime behavior. These files are produced while reconciling the committed `.env.example` against the canonical inventory model, and are kept for review and traceability of a reconciliation run.

## Files

| File | Responsibility |
|------|---------------|
| `gen-missing-block.ts` | Ad-hoc, run-once generator. Emits the `.env.example` append-block for variables that a source reads but `.env.example` is missing, grouped by `surface:group`. Not imported by the tool. |
| `annotate-required.ts` | Ad-hoc, run-once script. Inserts a `# required (validated at startup)` marker above each validator-required entry in `.env.example` that lacks a required/optional marker, so the documented required-ness matches the validators. Not imported by the tool. |
| `.env.example.reconciled` | Generated reconciled projection of `.env.example`. |
| `catalog.json` | Serialized canonical inventory model (`ConfigVariable[]`) from a run. |
| `findings.json` | Serialized reconciliation / exposure findings from a run. |
| `missing.txt` | Names read by a source but absent from `.env.example`. |
| `missing-block.txt` | Rendered append-block output of `gen-missing-block.ts`. |
| `mismatch.txt` | Names whose declared required-ness / classification disagrees with `.env.example`. |
| `err.txt` | Captured stderr from a run. |
| `cli.err` | Captured stderr from a CLI run. |

## Notes

- Regenerate rather than hand-edit. The authority chain is `CODE / CONFIG SOURCES → CANONICAL INVENTORY MODEL → .env.example`; files here are one-directional projections and never feed back into the model.
- The ad-hoc scripts (`gen-missing-block.ts`, `annotate-required.ts`) read from `process.cwd()`, so run them from the repo root.

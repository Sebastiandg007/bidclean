# config-inventory / out

## Purpose

Generated-artifact directory for the `config-inventory` tool. Nothing here is part
of the shipped tool or its runtime behavior — everything is produced by the CLI and
is git-ignored. Regenerate with:

```
npx ts-node --project tools/config-inventory/tsconfig.json tools/config-inventory/inventory.cli.ts
```

## Files

| File | Responsibility |
|------|---------------|
| `.env.example.reconciled` | Generated reconciled projection of the canonical model (shape only, placeholders). |
| `catalog.json` | Serialized canonical inventory model (`{ variableCount, variables }`) from a run. |
| `findings.json` | Serialized reconciliation / boundary / exposure findings from a run. |

## Notes

- Regenerate rather than hand-edit. The authority chain is
  `CODE / CONFIG SOURCES → CANONICAL INVENTORY MODEL → .env.example`; files here are
  one-directional projections and never feed back into the model.

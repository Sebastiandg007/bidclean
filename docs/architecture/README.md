# Architecture Viewer

## Purpose
Offline, interactive HTML viewer of the BidClean architecture, written in Spanish for formal presentations. It shows every component, how they integrate, the end-to-end service flow, what is still pending and which credentials are exposed (names only). `docs/ARCHITECTURE.md` remains the English source of truth.

## How to open
Double-click `index.html` (or open it in any modern browser). It works over `file://` with no server and no internet connection.

## Files
| File | Responsibility |
|------|---------------|
| `index.html` | Page shell; loads the vendored Mermaid, the assets, every tab file and finally `app.js` |
| `vendor/mermaid.min.js` | Mermaid 11.4.1, vendored so the viewer works offline |
| `assets/styles.css` | Dark theme of the viewer (BidClean palette) |
| `assets/registry.js` | `BidCleanArch.registerTab / listTabs / findTab` — tab registry |
| `assets/status.js` | `BidCleanStatus` — status catalog (`hecho`, `parcial`, `falta`, `externo`, `alerta`) and Mermaid `classDef`s |
| `assets/tooltip.js` | `BidCleanTooltip` — hover box that shows on enter and hides on leave; escapes all data |
| `assets/render.js` | `BidCleanRender` — renders a diagram, applies status colors and binds tooltips by node id |
| `assets/app.js` | `BidCleanApp` — grouped side menu, `#id` routing, lazy rendering, per-tab component table |
| `tabs/NN-name.js` | One tab each: summary, Mermaid diagrams, node tooltip data and extra sections |

## Adding or editing a tab
1. Create `tabs/NN-name.js` calling `BidCleanArch.registerTab({ id, group, order, title, summary, diagrams, nodes, sections })`.
2. Add a `<script src="tabs/NN-name.js">` line in `index.html` before `assets/app.js`.
3. Every node id used in a diagram must be a key of `nodes` (that is how tooltips bind), and every node needs an `estado`.
4. Use `flowchart` diagrams, quoted labels (`A["text"]`) and no `classDef` lines (colors are applied automatically).

## Dependencies
- None at runtime besides the vendored Mermaid. No build step.

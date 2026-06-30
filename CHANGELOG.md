# Changelog

## 0.1.0

v0.1.0 hardens the initial printspec foundation for public review:

- JSON Schema files are the intended source of truth for structural validation, with TypeScript and Python validation APIs exposing matching `{ valid, errors }` result shapes.
- Added semantic validation for duplicate IDs, broken composable/project references, basic geometry sanity, and BOM supplier/reference sanity.
- Normalization now deep-clones input, defaults hole axis/depth where documented, and normalizes common supplier names without clamping or silently fixing invalid dimensions.
- OpenSCAD and CadQuery generators validate before emitting deterministic source and return a structured unsupported result for invalid or unsupported specs.
- BOM helpers cover top-level, part, project, and nested project hardware, with Markdown, CSV, and supplier order-list output helpers.
- Added shared valid/invalid fixtures used by both TypeScript and Python tests.
- Documentation clarifies v0.1 stability, experimental composable/project support, generator safety, supplier non-goals, and the PartPilot/PartCAD relationship.

No packages are published by this repository workflow without explicit manual release action.

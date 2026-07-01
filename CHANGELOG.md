# Changelog

## 0.1.0

v0.1.0 hardens the initial printspec foundation for public review:

- JSON Schema files are the intended source of truth for structural validation, with TypeScript and Python validation APIs exposing matching `{ valid, errors }` result shapes.
- Added semantic validation for duplicate IDs, broken composable/project references, basic geometry sanity, and BOM supplier/reference sanity.
- Normalization now deep-clones input, defaults hole axis/depth where documented, and normalizes common supplier names without clamping or silently fixing invalid dimensions.
- OpenSCAD and CadQuery generators validate before emitting deterministic source and return a structured unsupported result for invalid or unsupported specs.
- BOM helpers cover top-level, part, project, and nested project hardware, with Markdown, CSV, and supplier order-list output helpers.
- Added shared valid/invalid fixtures used by both TypeScript and Python tests.
- Fixed TypeScript Ajv ESM loading for NodeNext/Node 20 compiled output and hardened offline schema registration under `$id`, filename, and hosted URL aliases.
- Fixed the cable clip schema so its clip sizing `anyOf` constraint is valid Draft 2020-12 and added regression coverage for missing clip sizing fields.
- Added TypeScript and Python schema meta-validation tests so every `schemas/*.schema.json` file is checked against the Draft 2020-12 meta-schema before fixture validation.
- Clarified that hosted schema URLs are public references only; TypeScript uses Ajv Draft 2020-12 offline and Python uses `jsonschema`/`referencing` offline.
- Documentation clarifies v0.1 stability, experimental composable/project support, generator safety, supplier non-goals, and the PartPilot/PartCAD relationship.

No packages are published by this repository workflow without explicit manual release action.

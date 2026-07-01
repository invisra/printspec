# printspec

printspec is an experimental open-source specification and toolkit for practical parametric 3D-printable parts. It provides JSON Schemas, offline validators, BOM helpers, CLI commands, and starter code generators for OpenSCAD and CadQuery source.

**Release status:** `v0.1.0 experimental`. Packages are being prepared for public release; if npm or PyPI packages are not available yet, use this repository directly.

## Install

```sh
npm install @invisra/printspec
python -m pip install printspec
```

From a checkout:

```sh
npm install
python -m pip install -e "packages/python[test]"
```

## Quick validation

```js
import { validatePrintSpec } from "@invisra/printspec";
import spec from "./examples/part-families/rounded-rectangular-plate.basic.json" assert { type: "json" };

const result = validatePrintSpec(spec);
console.log(result.valid, result.errors);
```

```sh
printspec validate examples/part-families/rounded-rectangular-plate.basic.json
printspec to-openscad examples/part-families/round-spacer.basic.json --output round-spacer.scad
```

## Hosted and bundled schemas

Hosted schemas are intended for public reference:

- Project index: <https://schemas.invisra.ai/printspec/>
- v0.1.0 schemas: <https://schemas.invisra.ai/printspec/0.1.0/>
- Manifest: <https://schemas.invisra.ai/printspec/0.1.0/manifest.json>

Validators resolve package-bundled schemas offline and should not fetch hosted schemas during normal validation.

## Supported starter generator families

- `rounded_rectangular_plate`
- `spacer_block`
- `round_spacer`
- `electronics_standoff`

Generated CAD source is a starting point. Review dimensions, clearances, materials, printer settings, and mechanical suitability before printing or using any part.

## Safety and non-goals

printspec is not a CAD runtime, supplier scraper, AI design agent, or purchasing automation tool. It does not execute OpenSCAD, CadQuery, or FreeCAD in CI. Do not use generated designs without engineering review for safety-critical, load-bearing, medical, electrical, or regulated applications.

## Release readiness

See [docs/release-process.md](docs/release-process.md) for dry-run checks and manual publishing notes.

## Browser/editor form metadata

Printspec schemas now include `x-printspec-*` browser-editor metadata for parameter ordering, grouping, units, controls, steps, priorities, examples, and documentation-only warnings. See `docs/form-metadata.md` for the convention plus TypeScript, Python, and CLI usage. This metadata helps tools render forms; it is not a web app and does not execute CAD.


# getting started

## v0.1.0 release-candidate usage

Install and test from a checkout:

```sh
npm install
npm run sync:schemas
npm run build
npm test
python -m pip install --upgrade pip
python -m pip install -e "packages/python[test]"
pytest
python -m pip install build
python -m build packages/python
```

`schemas/` is the source of truth. `npm run sync:schemas` updates `public/printspec/0.1.0/` for hosted references, `packages/python/printspec/schemas/` for bundled Python package data, and `packages/typescript/schemas/` for bundled TypeScript package data. The Python and TypeScript packages validate offline from those bundled schemas; hosted schema URLs are public references only, and validators do not fetch remote schemas.


Both packages provide a `printspec` CLI. The Python CLI is available after the editable install; the TypeScript CLI can be run from `packages/typescript/dist/cli.js` after `npm run build`:

```sh
printspec validate examples/part-families/rounded-rectangular-plate.basic.json
printspec to-openscad examples/part-families/round-spacer.basic.json --output model.scad
printspec to-cadquery examples/part-families/electronics-standoff.m3.json --output model.py
printspec bom examples/projects/simple-enclosure-project.json --format markdown
node packages/typescript/dist/cli.js validate examples/part-families/rounded-rectangular-plate.basic.json
```

Generators currently emit source code only and do not require or execute OpenSCAD, CadQuery, FreeCAD, or any CAD runtime. Supported generator families are `rounded_rectangular_plate`, `spacer_block`, `round_spacer`, and `electronics_standoff`. Validation runs before generation. Valid but unsupported optional generator features, such as spacer chamfers or fillets, produce stable warnings rather than being silently ignored. BOM helpers format local spec hardware data only; printspec does not scrape suppliers or create carts. The v0.1.0 line is experimental and intended for review before manufacturing.


## TypeScript package

```sh
npm install @invisra/printspec
```

```ts
import { validatePrintSpec } from "@invisra/printspec";

const result = validatePrintSpec(spec);
```

```sh
npx printspec validate spec.json
npx printspec to-openscad spec.json --output model.scad
npx printspec bom project.json --format markdown
```

## Hosted schemas

Browsable schemas are published at `https://schemas.invisra.ai/printspec/`, with the current version at `https://schemas.invisra.ai/printspec/0.1.0/`. Manifests are available at `https://schemas.invisra.ai/printspec/manifest.json` and `https://schemas.invisra.ai/printspec/0.1.0/manifest.json`. `schemas/` is the source of truth, and `npm run sync:schemas` regenerates hosted public files, Python package schemas, TypeScript package schemas, HTML indexes, and manifests. Normal validators resolve bundled schemas offline rather than fetching hosted URLs.

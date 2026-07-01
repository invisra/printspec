# printspec

**A simple open JSON spec for practical parametric 3D-printable parts.**

printspec defines portable JSON schemas, examples, validators, and starter generators for common 3D-printable utility parts such as plates, spacers, brackets, standoffs, cable guides, and simple enclosures.

## Why it exists

printspec is a small spec layer between browser parameter editors, AI-assisted parameter extraction, deterministic CAD generators, PartCAD-style project packaging, and STL / STEP / 3MF export pipelines. It is millimeter-first, deterministic, explicit, backend-neutral, safe for simple utility parts, and easy to inspect.

## JSON example

```json
{"printspecVersion":"0.1.0","units":"mm","part":{"type":"rounded_rectangular_plate","label":"Example plate","parameters":{"length":80,"width":50,"thickness":3,"cornerRadius":5}}}
```

## Supported part families

`rounded_rectangular_plate`, `spacer_block`, `round_spacer`, `electronics_standoff`, `l_bracket`, `cable_comb`, `cable_clip`, `drill_guide`, `simple_box`, and `simple_lid`.

## Composable parts preview

Composable parts use a limited set of primitives (`box`, `rounded_box`, `cylinder`, `tube`, `plate`, `tab`, `boss`, `rib`, `wedge`), features, relations, and patterns. This is not arbitrary CAD-in-JSON.

## Supplier hardware and BOMs

Specs can reference purchased hardware with supplier, part number, URL, role, and quantity fields. Helpers extract BOM items, normalize quantities, and emit CSV, Markdown, or copyable supplier order lists. printspec does not scrape suppliers or create carts.

## Install

```bash
npm install @invisra/printspec
pip install printspec
```

## Hosted schemas

The canonical schema sources live in `schemas/`. Run `npm run sync:schemas` to copy every `schemas/*.schema.json` file into `public/printspec/0.1.0/` for static hosting, `packages/python/printspec/schemas/` for Python package data, and `packages/typescript/schemas/` for NPM package data; synced copies must not be edited by hand. Vercel can serve those files at stable public references such as `https://schemas.invisra.ai/printspec/0.1.0/printspec.schema.json`. These URLs are useful for documentation and external tooling, but the Python and TypeScript validators bundle/register local schema files and do not require network access during validation.

## Validation and generation

JSON Schema is the structural source of truth for printspec validation. TypeScript validation uses Ajv Draft 2020-12 with local schema registration, and Python validation uses `jsonschema`/`referencing` with the same offline schema set. Semantic validation runs after schema validation and catches cross-reference and geometry sanity issues that schemas should not encode. The v0.1.0 schemas use hosted `$id` URLs for public reference, but Python validators use bundled `printspec/schemas` package data and TypeScript validators load/register local schema files, resolving references offline; validation does not require network access. If a validator tries to fetch `schemas.invisra.ai`, local schema registration is broken. Tests now meta-validate every schema against Draft 2020-12 so invalid schema files fail directly. The v0.1.0 schema set remains experimental until 1.0.


TypeScript package usage:

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

```ts
import { validatePrintSpec, generateOpenScad, generateCadQuery } from "@invisra/printspec";
const result = validatePrintSpec(spec);
const scad = generateOpenScad(spec);
const cq = generateCadQuery(spec); // code defines final variable `part`
```

```py
from printspec import validate_printspec, generate_openscad, generate_cadquery
result = validate_printspec(spec)
scad = generate_openscad(spec)
cq = generate_cadquery(spec)
```

## Design goals

Millimeter-first, deterministic, explicit, backend-neutral, browser-editor friendly, easy for generators to consume, and limited enough to validate reliably.

## Non-goals and safety

printspec is not a full CAD replacement, slicer, AI app, or PartPilot SaaS product. Out of scope: weapons, firearm parts, ammunition, explosives, suppressors/silencers, weaponized drones, lockpicking/bypass tools, medical devices/implants, vehicle safety-critical parts, aerospace/flight-critical parts, pressure vessels, life-safety load-bearing parts, mains/high-voltage electrical safety enclosures, and anything requiring certification or professional engineering review.

## PartPilot relationship

printspec is an open spec/toolkit. PartPilot is Invisra’s hosted product that may use printspec-compatible structures internally.

## PartCAD relationship

printspec describes parametric geometry intent. PartCAD can package generated CAD source, outputs, supplier files, BOMs, and assembly notes. printspec is not a replacement for PartCAD.

## Roadmap

0.1.0 establishes schemas, examples, validators, BOM helpers, starter generators, and docs. Before 1.0 schemas may change and breaking changes are possible.

## License

Apache-2.0.

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

The Python and TypeScript packages validate offline using bundled schemas copied into `packages/python/printspec/schemas/` and `packages/typescript/schemas/`; hosted schema URLs are public references only and validators must not fetch them during normal validation.


Both packages provide a `printspec` CLI. The Python CLI is available after the editable install; the TypeScript CLI can be run from `packages/typescript/dist/cli.js` after `npm run build`:

```sh
printspec validate examples/part-families/rounded-rectangular-plate.basic.json
printspec to-openscad examples/part-families/round-spacer.basic.json --output model.scad
printspec to-cadquery examples/part-families/electronics-standoff.m3.json --output model.py
printspec bom examples/projects/simple-enclosure-project.json --format markdown
node packages/typescript/dist/cli.js validate examples/part-families/rounded-rectangular-plate.basic.json
```

Generators currently emit source code only and do not require or execute OpenSCAD, CadQuery, FreeCAD, or any CAD runtime. Supported generator families are `rounded_rectangular_plate`, `spacer_block`, `round_spacer`, and `electronics_standoff`. Validation runs before generation. Valid but unsupported optional generator features, such as spacer chamfers or fillets, produce stable warnings rather than being silently ignored. BOM helpers format local spec hardware data only; printspec does not scrape suppliers or create carts. The v0.1.0 line is experimental and intended for review before manufacturing.

## Hosted schema site

The hosted schema site is available at `https://schemas.invisra.ai`, with the printspec index at `https://schemas.invisra.ai/printspec/`, version indexes such as `https://schemas.invisra.ai/printspec/0.1.0/`, and manifests at `https://schemas.invisra.ai/printspec/manifest.json` and `https://schemas.invisra.ai/printspec/0.1.0/manifest.json`. `schemas/` remains the source of truth; `npm run sync:schemas` regenerates public schemas, Python package schemas, TypeScript package schemas, static HTML indexes, and manifests. Validators use bundled schemas offline and do not fetch hosted schemas during normal validation. See `docs/hosted-schemas.md` for version immutability and optional Vercel Analytics behavior.

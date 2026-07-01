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

The canonical schema sources live in `schemas/`. Run `npm run sync:schemas` to copy every `schemas/*.schema.json` file into `public/printspec/0.1.0/` before deployment; the generated `public/` copies must not be edited by hand. Vercel can serve those files at stable public references such as `https://schemas.invisra.ai/printspec/0.1.0/printspec.schema.json`. These URLs are useful for documentation and external tooling, but the Python and TypeScript validators bundle/register local schema files and do not require network access during validation.

## Validation and generation

JSON Schema is the structural source of truth for printspec validation. TypeScript validation uses Ajv Draft 2020-12 with local schema registration, and Python validation uses `jsonschema`/`referencing` with the same offline schema set. Semantic validation runs after schema validation and catches cross-reference and geometry sanity issues that schemas should not encode. The v0.1.0 schemas use hosted `$id` URLs for public reference, but Python and TypeScript validators bundle/load the local `schemas/` files and resolve references offline; validation does not require network access. If a validator tries to fetch `schemas.invisra.ai`, local schema registration is broken. Tests now meta-validate every schema against Draft 2020-12 so invalid schema files fail directly. The v0.1.0 schema set remains experimental until 1.0.

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

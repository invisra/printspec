# Roadmap

## v0.1 hardening

- Source-first package hygiene and CI commands.
- JSON Schema-led validation in TypeScript and Python.
- Semantic validation for references and obvious geometry issues.
- Deterministic source-only OpenSCAD/CadQuery generators for the initial supported families.
- BOM extraction and text/CSV output helpers.

## v0.2

- More generator coverage for existing safe utility part families.
- Browser-editor metadata improvements.
- Better diagnostics and fixture compatibility checks.

## v0.3

- Project bundle conventions.
- Deeper PartCAD compatibility for packaging generated source, outputs, BOMs, and assembly notes.

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

Both packages provide a `printspec` CLI. The Python CLI is available after the editable install; the TypeScript CLI can be run from `packages/typescript/dist/cli.js` after `npm run build`:

```sh
printspec validate examples/part-families/rounded-rectangular-plate.basic.json
printspec to-openscad examples/part-families/round-spacer.basic.json --output model.scad
printspec to-cadquery examples/part-families/electronics-standoff.m3.json --output model.py
printspec bom examples/projects/simple-enclosure-project.json --format markdown
node packages/typescript/dist/cli.js validate examples/part-families/rounded-rectangular-plate.basic.json
```

Generators currently emit source code only and do not require or execute OpenSCAD, CadQuery, FreeCAD, or any CAD runtime. Supported generator families are `rounded_rectangular_plate`, `spacer_block`, `round_spacer`, and `electronics_standoff`. Validation runs before generation. Valid but unsupported optional generator features, such as spacer chamfers or fillets, produce stable warnings rather than being silently ignored. BOM helpers format local spec hardware data only; printspec does not scrape suppliers or create carts. The v0.1.0 line is experimental and intended for review before manufacturing.

## Hosted schema release readiness

The static schema site now has generated indexes and manifests. Before a release, regenerating the active version directory is expected; after release, published version directories should be treated as immutable. Meaningful schema changes should move to a new path such as `/printspec/0.1.1/`, `/printspec/0.2.0/`, or `/printspec/1.0.0/`. Optional Vercel Analytics, when enabled for generated HTML, tracks HTML page views only and not direct JSON fetches.

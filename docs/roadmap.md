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

## v0.2.0 release-candidate usage

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

Generators currently emit source code only and do not require or execute OpenSCAD, CadQuery, FreeCAD, or any CAD runtime. See [docs/generators.md](generators.md) for the current supported family list, which is the same for both the TypeScript and Python packages. Validation runs before generation. Optional finishing features are built where a generator supports them and otherwise produce stable warnings rather than being silently ignored: the OpenSCAD generator builds `chamfer` and `fillet` for the `round_spacer`, `spacer_block`, `rounded_rectangular_plate`, `electronics_standoff`, `drawer_divider`, and `cable_comb` families — applied to the whole part, or to a `top` or `bottom` `target` (for a standoff with a base, `top` finishes the shaft top and `bottom` the base bottom) — while `project_enclosure_tray` builds `chamfer`/`fillet` only for a `bottom` target (the floor's outer bottom edge, the tray's one closed solid perimeter — whole-part and `top` still warn) `wall_mount_bracket` only for a `top` target (the back plate's top edge, its one closed solid perimeter away from the foot tab — whole-part and `bottom` still warn), `cable_clip` only for a `bottom` target (the base plate's bottom edge, clear of the cable arch — whole-part and `top` still warn), and `l_bracket` only for a `top` target (the standing leg's top edge, clear of the shared corner and distinct from the `rib` gusset — whole-part and `bottom` still warn). The OpenSCAD generator also builds the `l_bracket` `rib` — a reinforcing gusset along the inner corner, `rib_thickness` wide (defaulting to the bracket thickness) and sized symbolically to the shorter leg — while CadQuery and brepjs still warn it is unimplemented. The brepjs generator (TypeScript only) builds `chamfer`/`fillet` using the real OCCT kernel — the same whole-part / `top` / `bottom` vocabulary — for the box and cylinder families (`round_spacer`, `electronics_standoff`, `spacer_block`, `rounded_rectangular_plate`, `drawer_divider`, `cable_comb`), identifying each target face by a center point and finishing that face's edges (before any cut that would split the face, and, for the plate, stacked on the cornerRadius fillet); the remaining bespoke families (`cable_clip`, `wall_mount_bracket`, `l_bracket`, `project_enclosure_tray`) still warn under brepjs. Other targets and these features on the remaining families still warn. BOM helpers format local spec hardware data only; printspec does not scrape suppliers or create carts. The v0.2.0 line is experimental and intended for review before manufacturing.

## Hosted schema release readiness

The static schema site now has generated indexes and manifests. Before a release, regenerating the active version directory is expected; after release, published version directories should be treated as immutable. Meaningful schema changes should move to a new path such as `/printspec/0.1.1/`, `/printspec/0.2.0/`, or `/printspec/1.0.0/`. Optional Vercel Analytics, when enabled for generated HTML, tracks HTML page views only and not direct JSON fetches.

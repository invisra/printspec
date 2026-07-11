# Generators

The generators produce source code only. They do not execute OpenSCAD, CadQuery, filesystem exports, subprocesses, or CAD runtimes in tests.

Supported part families are `rounded_rectangular_plate`, `spacer_block`, `round_spacer`, `electronics_standoff`, `cable_comb`, `cable_clip`, `wall_mount_bracket`, `l_bracket`, `drawer_divider`, and `project_enclosure_tray` for both OpenSCAD and CadQuery, in both the TypeScript and Python packages. `drill_guide`, `simple_box`, `simple_lid`, and `composable_part` have schemas and examples but no generator support yet in either language.

The TypeScript and Python generators are independent implementations and are expected to report the same `supported` result for every part family; `tests/python/test_generator_parity.py` runs both against every example under `examples/part-families/` and fails if they diverge.

APIs:

```ts
generateOpenScad(spec)
generateCadQuery(spec)
```

```py
generate_openscad(spec)
generate_cadquery(spec)
```

Each returns `{ supported, code, message?, warnings? }`. Generators validate first; invalid specs return `supported: false` and empty code. Generated CadQuery defines a final `part` variable and intentionally omits export commands. Generated CAD must be reviewed before manufacturing.

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

Generators currently emit source code only and do not require or execute OpenSCAD, CadQuery, FreeCAD, or any CAD runtime. See the supported family list above; it is the same for both the TypeScript and Python packages. Validation runs before generation. Valid but unsupported optional generator features, such as spacer chamfers or fillets, produce stable warnings rather than being silently ignored. BOM helpers format local spec hardware data only; printspec does not scrape suppliers or create carts. The v0.1.0 line is experimental and intended for review before manufacturing.

## Browser/editor form metadata

Printspec schemas now include `x-printspec-*` browser-editor metadata for parameter ordering, grouping, units, controls, steps, priorities, examples, and documentation-only warnings. See `docs/form-metadata.md` for the convention plus TypeScript, Python, and CLI usage. This metadata helps tools render forms; it is not a web app and does not execute CAD.


## Bundle generation

Bundle export reuses the OpenSCAD and CadQuery source generators when they support a part family. Unsupported generators are recorded as warnings in the bundle README and manifest; no CAD runtime is executed and no STL, STEP, or 3MF files are produced.

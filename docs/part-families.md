# part families

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

Generators currently emit source code only and do not require or execute OpenSCAD, CadQuery, FreeCAD, or any CAD runtime. See [docs/generators.md](generators.md) for the current supported family list, which is the same for both the TypeScript and Python packages. Validation runs before generation. Valid but unsupported optional generator features, such as spacer chamfers or fillets, produce stable warnings rather than being silently ignored. BOM helpers format local spec hardware data only; printspec does not scrape suppliers or create carts. The v0.1.0 line is experimental and intended for review before manufacturing.

## Supported part families

printspec 0.2.0 includes these practical, low-risk alpha part families. Generated OpenSCAD/CadQuery source should be reviewed before manufacturing, and preview geometry is visual/non-authoritative.

- `round_spacer` — cylindrical spacer with optional center hole; key parameters: outerDiameter, innerDiameter, height.
- `spacer_block` — rectangular spacer block with optional holes; key parameters: length, width, height, holes.
- `electronics_standoff` — low-voltage electronics standoff; key parameters: outerDiameter, height, holeDiameter, optional base.
- `rounded_rectangular_plate` — rounded utility plate; key parameters: length, width, thickness, cornerRadius, holes.
- `cable_comb` — flat wire/cable routing comb; key parameters: slotCount, slotWidth, slotDepth, spacing/thickness.
- `cable_clip` — simple cable retaining clip; key parameters: baseLength, base size, clip diameter/wall.
- `wall_mount_bracket` — light-duty wall plate with shelf/tab; key parameters: width, height, thickness, tabDepth, screw holes.
- `l_bracket` — light-duty, non-structural organization/prototyping bracket; key parameters: leg lengths, width, thickness, holes.
- `drawer_divider` — customizable drawer divider strip; key parameters: length, height, thickness, notches, end tabs.
- `project_enclosure_tray` — open tray for low-voltage projects; key parameters: outer size, wall/floor thickness, mount holes.

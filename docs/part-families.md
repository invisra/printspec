# part families

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

Generators currently emit source code only and do not require or execute OpenSCAD, CadQuery, FreeCAD, or any CAD runtime. See [docs/generators.md](generators.md) for the current supported family list, which is the same for both the TypeScript and Python packages. Validation runs before generation. Optional finishing features are built where a generator supports them and otherwise produce stable warnings rather than being silently ignored: the OpenSCAD generator builds `chamfer` and `fillet` for the `round_spacer`, `spacer_block`, `rounded_rectangular_plate`, `electronics_standoff`, `drawer_divider`, and `cable_comb` families — applied to the whole part, or to a `top` or `bottom` `target` (for a standoff with a base, `top` finishes the shaft top and `bottom` the base bottom) — while `project_enclosure_tray` builds `chamfer`/`fillet` only for a `bottom` target (the floor's outer bottom edge, the tray's one closed solid perimeter — whole-part and `top` still warn) `wall_mount_bracket` only for a `top` target (the back plate's top edge, its one closed solid perimeter away from the foot tab — whole-part and `bottom` still warn), `cable_clip` only for a `bottom` target (the base plate's bottom edge, clear of the cable arch — whole-part and `top` still warn), and `l_bracket` only for a `top` target (the standing leg's top edge, clear of the shared corner and distinct from the `rib` gusset — whole-part and `bottom` still warn). The OpenSCAD generator also builds the `l_bracket` `rib` — a reinforcing gusset along the inner corner, `rib_thickness` wide (defaulting to the bracket thickness) and sized symbolically to the shorter leg — while CadQuery and brepjs still warn it is unimplemented. The brepjs generator (TypeScript only) builds `chamfer`/`fillet` for all ten families using the real OCCT kernel, matching the OpenSCAD generator's per-family target semantics exactly: whole-part / `top` / `bottom` for the box and cylinder families (`round_spacer`, `electronics_standoff`, `spacer_block`, `rounded_rectangular_plate`, `drawer_divider`, `cable_comb`), and the single supported edge for each bespoke family (`project_enclosure_tray` and `cable_clip` bottom, `wall_mount_bracket` and `l_bracket` top). It identifies each target face by a center point and finishes that face's edges — before any cut that would split the face, and, for the plate, stacked on the cornerRadius fillet. As with every generator, the finish must be smaller than the finished face's cross-section (e.g. a fillet radius below half the leg thickness) or the underlying kernel rejects the degenerate operation. The brepjs `l_bracket` `rib` gusset is not yet implemented and still warns. Other targets and these features on the remaining families still warn. BOM helpers format local spec hardware data only; printspec does not scrape suppliers or create carts. The v0.2.0 line is experimental and intended for review before manufacturing.

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

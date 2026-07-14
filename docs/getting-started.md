# Getting started

printspec `v0.2.0` is an experimental toolkit for validating practical parametric 3D-printable part specifications and generating starter CAD source for a small set of supported families.

## Install

```sh
npm install @invisra/printspec
python -m pip install printspec
```

If packages are not published yet, install from a checkout:

```sh
npm install
python -m pip install -e "packages/python[test]"
```

## Validate a spec

```sh
printspec validate examples/part-families/rounded-rectangular-plate.basic.json
python -m printspec.cli validate examples/part-families/rounded-rectangular-plate.basic.json
```

Programmatic TypeScript validation:

```js
import { validatePrintSpec } from "@invisra/printspec";
const result = validatePrintSpec(spec);
```

Programmatic Python validation:

```python
from printspec import validate_printspec
result = validate_printspec(spec)
```

## Generate starter CAD source

Supported starter generator families are `rounded_rectangular_plate`, `spacer_block`, `round_spacer`, `electronics_standoff`, `cable_comb`, `cable_clip`, `wall_mount_bracket`, `l_bracket`, `drawer_divider`, and `project_enclosure_tray` (see [docs/generators.md](generators.md) for the full list and language parity notes).

```sh
printspec to-openscad examples/part-families/round-spacer.basic.json --output round-spacer.scad
printspec to-cadquery examples/part-families/electronics-standoff.m3.json --output standoff.py
```

Generated source is intentionally simple and should be reviewed before printing or downstream CAD export. printspec does not execute OpenSCAD, CadQuery, or FreeCAD.

## Schemas

Schemas are bundled in both packages for offline validation. Hosted copies are available for reference at <https://schemas.invisra.ai/printspec/0.2.0/>.

## Safety

Do not rely on generated designs for safety-critical, regulated, medical, electrical, or load-bearing use without qualified review. See [safety](safety.md).

## Export a bundle

Use `printspec bundle <file> --output <directory>` to create a deterministic source bundle containing the original JSON, README, manifest, supported CAD source, and BOM files when hardware exists. Add `--partcad` for the experimental PartCAD stub. See [bundles](bundles.md).

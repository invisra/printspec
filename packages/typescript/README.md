# @invisra/printspec

TypeScript package for printspec JSON Schemas, offline validation, BOM helpers, browser form metadata helpers, CLI commands, deterministic bundle export, and starter OpenSCAD/CadQuery source generation.

**Status: npm package v0.2.2 / schema v0.1.0 experimental.** Version 0.2.2 adds browser-safe visual preview APIs; schemas and `printspecVersion` remain 0.1.0.

## Installation

```sh
# From a repository checkout
npm install
npm --workspace @invisra/printspec run build

# Once published
npm install @invisra/printspec
```

## ESM-only API usage

This package is ESM-only (`"type": "module"`).

```js
import { validatePrintSpec, generateOpenScad } from "@invisra/printspec";

const spec = {
  printspecVersion: "0.1.0",
  units: "mm",
  part: {
    type: "round_spacer",
    label: "Smoke spacer",
    parameters: { outerDiameter: 12, innerDiameter: 4, height: 8 }
  }
};

const result = validatePrintSpec(spec);
console.log(result.valid, result.errors);

const generated = generateOpenScad(spec);
if (generated.supported) console.log(generated.code);
```

## Browser preview usage

The preview API is renderer-neutral, browser-safe, and intended for approximate visual UI previews only. It does not execute CAD code or generate authoritative manufacturing meshes; exact STL/STEP/3MF output should stay in the external worker/OpenSCAD/CadQuery pipeline.

```js
import { generatePreviewScene } from "@invisra/printspec/preview";
import { createThreePreviewObject } from "@invisra/printspec/three";
import * as THREE from "three";

const preview = generatePreviewScene(spec);
if (preview.supported) {
  const object = createThreePreviewObject(preview.scene, THREE);
  scene.add(object);
}
```

Three.js is an optional peer dependency and is not imported by `@invisra/printspec/browser`.

## CLI usage

```sh
printspec --version
printspec validate examples/part-families/rounded-rectangular-plate.basic.json
printspec bom examples/projects/simple-enclosure-project.json --format markdown
printspec form-metadata rounded_rectangular_plate
printspec list-part-families
printspec to-openscad examples/part-families/round-spacer.basic.json --output round-spacer.scad
printspec to-cadquery examples/part-families/electronics-standoff.m3.json --output standoff.py
printspec bundle examples/part-families/rounded-rectangular-plate.basic.json --output bundle --overwrite
```

## Bundle example

```js
import { createBundle, writeBundleToDirectory } from "@invisra/printspec";

const bundle = createBundle(spec, { includePartCad: true });
writeBundleToDirectory(bundle, "bundle", { overwrite: true });
```

## Package exports and bundled schemas

The package exports the main ESM API from `@invisra/printspec`, browser-safe APIs from `@invisra/printspec/browser` and `@invisra/printspec/preview`, the optional Three.js adapter from `@invisra/printspec/three`, and package schema files through `@invisra/printspec/schemas/*`. Published npm packages must include built TypeScript artifacts under `dist/` (`dist/index.js`, `dist/index.d.ts`, and `dist/cli.js`) and schema files under `schemas/`.

Validation resolves bundled schemas offline. It does not fetch hosted schema URLs during normal validation.

## Hosted schema note

Hosted schemas at `https://schemas.invisra.ai/printspec/0.1.0/` are public references for documentation and external tools. They are not required for package validation.

## Safety note

Browser previews are approximate visual previews: they are dimensionally faithful to major features, but generated OpenSCAD/CadQuery remains the source of manufacturing geometry. Generated OpenSCAD and CadQuery source is a starter artifact for review. This package does not export STL/STEP/3MF files and does not run CAD runtimes, slicers, supplier APIs, or purchasing automation. Do not use generated designs without appropriate engineering review.

## Supported part families

printspec 0.2.2 includes these practical, low-risk alpha part families. Generated OpenSCAD/CadQuery source should be reviewed before manufacturing, and preview geometry is visual/non-authoritative.

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

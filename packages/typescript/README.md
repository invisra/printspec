# @invisra/printspec

TypeScript package for printspec JSON Schemas, offline validation, BOM helpers, browser form metadata helpers, CLI commands, deterministic bundle export, and starter OpenSCAD/CadQuery source generation.

**Status: v0.1.0 experimental.** The package is prepared for npm publication. If it is not yet published, install from the repository workspace instead of assuming registry availability.

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

The package exports the main ESM API from `@invisra/printspec` and package schema files through `@invisra/printspec/schemas/*`. Schema files are bundled in the npm package under `schemas/`.

Validation resolves bundled schemas offline. It does not fetch hosted schema URLs during normal validation.

## Hosted schema note

Hosted schemas at `https://schemas.invisra.ai/printspec/0.1.0/` are public references for documentation and external tools. They are not required for package validation.

## Safety note

Generated OpenSCAD and CadQuery source is a starter artifact for review. This package does not export STL/STEP/3MF files and does not run CAD runtimes, slicers, supplier APIs, or purchasing automation. Do not use generated designs without appropriate engineering review.

# printspec

**Practical JSON Schemas and offline tooling for parametric 3D-printable parts.**

**Status: v0.2.0 experimental**

printspec is an open-source specification and toolkit from Invisra for describing practical, parameterized 3D-printable parts as JSON. The v0.1.0 release focuses on stable schemas, offline TypeScript/Python validation, bundled schema distribution, static hosted schema references, BOM/form helpers, starter source generators, CLI workflows, and deterministic source bundle export—not CAD execution or production manufacturing automation.

## Installation

Packages are being prepared for public release. Until npm/PyPI publication is complete, install from this repository.

```sh
# From the repository
npm install
python -m pip install -e "packages/python[test]"

# Once published
npm install @invisra/printspec
python -m pip install printspec
```

## CLI quickstart

```sh
printspec --version
printspec validate examples/part-families/rounded-rectangular-plate.basic.json
printspec list-part-families
printspec form-metadata rounded_rectangular_plate
printspec bom examples/projects/simple-enclosure-project.json --format markdown
printspec to-openscad examples/part-families/round-spacer.basic.json --output round-spacer.scad
printspec to-cadquery examples/part-families/electronics-standoff.m3.json --output standoff.py
```

## Schema URL quick links

Hosted schemas are public references for documentation and external tooling. Package validators use bundled schemas offline and should not fetch these URLs during normal validation.

- Base index: <https://schemas.invisra.ai/>
- Project index: <https://schemas.invisra.ai/printspec/>
- v0.1.0 index: <https://schemas.invisra.ai/printspec/0.1.0/>
- Root schema: <https://schemas.invisra.ai/printspec/0.1.0/printspec.schema.json>
- Version manifest: <https://schemas.invisra.ai/printspec/0.1.0/manifest.json>
- Online validator: <https://schemas.invisra.ai/printspec/validator/>

The online validator runs locally in your browser; no JSON is uploaded. It is intended for validation and developer debugging only. Manufacturing exports belong in the PartPilot/worker pipeline, not in the static schema-site validator.

## Simple JSON example

```json
{
  "printspecVersion": "0.1.0",
  "units": "mm",
  "part": {
    "type": "round_spacer",
    "label": "Smoke spacer",
    "parameters": {
      "outerDiameter": 12,
      "innerDiameter": 4,
      "height": 8
    }
  }
}
```

## TypeScript API example

printspec for TypeScript is ESM-only.

```js
import { validatePrintSpec, generateOpenScad } from "@invisra/printspec";

const result = validatePrintSpec(spec);
if (!result.valid) console.error(result.errors);

const generated = generateOpenScad(spec);
if (generated.supported) console.log(generated.code);
```

## Browser preview example

The TypeScript package includes a browser-safe, renderer-neutral preview scene generator for immediate UI visualization in tools such as PartPilot. Preview geometry is approximate and visual only: it does not boolean-subtract exact holes, does not execute CAD code, and is not authoritative manufacturing output. Use the OpenSCAD, CadQuery, or external worker pipeline for exact STL/STEP/3MF manufacturing outputs.

```js
import { generatePreviewScene } from "@invisra/printspec/preview";

const preview = generatePreviewScene(spec);
if (preview.supported) {
  console.log(preview.scene.objects);
}
```

An optional Three.js adapter is available without adding Three.js to `@invisra/printspec/browser` or making it a hard runtime dependency. Consumers provide the Three.js namespace themselves.

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

## Python API example

```python
from printspec import validate_printspec
from printspec.generators import generate_openscad

result = validate_printspec(spec)
print(result["valid"], result["errors"])

generated = generate_openscad(spec)
if generated["supported"]:
    print(generated["code"])
```

## Supported part families

v0.1.0 includes practical starter schemas and generator support for:

- `rounded_rectangular_plate`
- `spacer_block`
- `round_spacer`
- `electronics_standoff`

## Supported generators

- Starter OpenSCAD source generation.
- Starter CadQuery source generation.

Generated source is intended as reviewable starting material. printspec does not run OpenSCAD, CadQuery, FreeCAD, slicers, or CAD kernels.

## Bundle export example

Bundles are deterministic source bundles with the original JSON, generated source where supported, BOM files when applicable, a manifest, README, and optional experimental PartCAD stub metadata.

```sh
printspec bundle examples/part-families/rounded-rectangular-plate.basic.json --output bundle --overwrite
```

```js
import { createBundle, writeBundleToDirectory } from "@invisra/printspec";

const bundle = createBundle(spec, { includePartCad: true });
writeBundleToDirectory(bundle, "bundle", { overwrite: true });
```

```python
from printspec import create_bundle, write_bundle_to_directory

bundle = create_bundle(spec, {"includePartCad": True})
write_bundle_to_directory(bundle, "bundle", overwrite=True)
```

## Browser metadata example

Schemas include `x-printspec-*` metadata for browser/editor form builders. This metadata is descriptive; it does not add a web app and does not execute CAD.

```sh
printspec form-metadata rounded_rectangular_plate
printspec list-part-families
```

## What v0.2.0 includes

- JSON Schemas for practical parametric 3D-printable parts.
- Offline TypeScript validation.
- Offline Python validation.
- Bundled schemas in both packages.
- Hosted schemas at `schemas.invisra.ai`.
- Static schema index pages and manifests.
- BOM helpers.
- Browser form metadata helpers.
- Starter OpenSCAD source generators.
- Starter CadQuery source generators.
- CLI commands.
- Deterministic project/part bundle export.
- Optional experimental PartCAD stub metadata.
- Browser-safe renderer-neutral visual preview scene generation for initial alpha part families.
- Optional Three.js adapter at `@invisra/printspec/three` with Three.js as an optional peer dependency.

## What v0.1.0 does not include

- Authoritative preview meshes for manufacturing.
- STL, STEP, or 3MF export.
- CAD runtime execution.
- Slicer integration.
- Supplier API calls.
- McMaster-Carr cart creation.
- PartPilot SaaS app functionality.
- A full CAD language or constraint solver.
- Certified engineering validation.

## Safety and non-goals

printspec is experimental software for describing and generating starter source for 3D-printable parts. Do not use generated designs without appropriate engineering review for safety-critical, load-bearing, medical, electrical, regulated, or production applications. Review dimensions, clearances, materials, printer settings, and mechanical suitability before printing or use.

## Release resources

- Release process: [docs/release-process.md](docs/release-process.md)
- Hosted schema documentation: [docs/hosted-schemas.md](docs/hosted-schemas.md)
- Bundle documentation: [docs/bundles.md](docs/bundles.md)
- Browser/editor metadata: [docs/form-metadata.md](docs/form-metadata.md)
- v0.1.0 checklist: [docs/v0.1.0-release-checklist.md](docs/v0.1.0-release-checklist.md)

## License

Apache-2.0. See package metadata and repository license files for details.

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

# printspec bundles

A printspec bundle is a deterministic source-file export for a single part spec or a project spec. It is intended for review, handoff, source control, and future automation that consumes printspec metadata.

Bundles do **not** run CAD tools and do **not** include STL, STEP, 3MF, or other mesh/solid outputs. They also do not create supplier carts or scrape suppliers.

## Single-part structure

```text
bundle/
├─ printspec.json
├─ README.md
├─ bundle-manifest.json
├─ cad/
│  ├─ model.scad
│  └─ model.py
└─ bom/
   ├─ bom.md
   ├─ bom.csv
   └─ supplier-order-list.txt
```

`printspec.json`, `README.md`, and `bundle-manifest.json` are always generated for valid specs. CAD source files are included only when the OpenSCAD or CadQuery generator supports the part family. BOM files are included only when hardware items exist.

## Project structure

```text
bundle/
├─ printspec.json
├─ README.md
├─ bundle-manifest.json
├─ parts/
│  └─ <part-id>/
│     ├─ printspec.json
│     └─ cad/
│        ├─ model.scad
│        └─ model.py
├─ bom/
│  ├─ bom.md
│  ├─ bom.csv
│  └─ supplier-order-list.txt
└─ partcad.yaml
```

Inline project part specs are bundled under `parts/<part-id>/`. External `specPath` references are reported as warnings because recursive external bundling is not implemented yet.

## Manifest

`bundle-manifest.json` records the bundle version, printspec version, bundle kind, generated files with roles and media types, and warnings. File paths and manifest entries are deterministically sorted.

## CLI

```sh
printspec bundle examples/part-families/rounded-rectangular-plate.basic.json --output bundle --overwrite
printspec bundle examples/projects/simple-enclosure-project.json --output project-bundle --partcad
```

Options:

- `--overwrite`
- `--no-openscad`
- `--no-cadquery`
- `--no-bom`
- `--partcad`
- Python CLI only: `--zip bundle.zip`

## TypeScript API

```ts
import { createBundle, writeBundleToDirectory } from '@invisra/printspec';

const bundle = createBundle(spec, { includePartCad: true });
writeBundleToDirectory(bundle, 'bundle', { overwrite: true });
```

TypeScript supports directory export. Zip export is currently Python-only.

## Python API

```py
from printspec import create_bundle, write_bundle_to_directory, write_bundle_to_zip

bundle = create_bundle(spec, {"includePartCad": True})
write_bundle_to_directory(bundle, "bundle", overwrite=True)
write_bundle_to_zip(bundle, "bundle.zip", overwrite=True)
```

## Experimental PartCAD stub

When `--partcad` / `includePartCad` is enabled for a project, printspec writes a lightweight `partcad.yaml` that references generated CadQuery source files. This is an experimental compatibility stub and is not a claim of full PartCAD support.

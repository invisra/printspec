# printspec for Python

Python package for printspec JSON Schemas, offline validation, BOM helpers, browser form metadata helpers, CLI commands, deterministic bundle export, and starter OpenSCAD/CadQuery source generation.

**Status: v0.2.0 experimental.** Requires Python 3.11+. The package is prepared for PyPI publication. If it is not yet published, install from a repository checkout instead of assuming registry availability.

## Installation

```sh
# From a repository checkout
python -m pip install -e "packages/python[test]"

# Once published
python -m pip install printspec
```

## CLI usage

```sh
python -m printspec.cli --version
python -m printspec.cli validate examples/part-families/rounded-rectangular-plate.basic.json
python -m printspec.cli bom examples/projects/simple-enclosure-project.json --format markdown
python -m printspec.cli form-metadata rounded_rectangular_plate
python -m printspec.cli list-part-families
python -m printspec.cli to-openscad examples/part-families/round-spacer.basic.json --output round-spacer.scad
python -m printspec.cli to-cadquery examples/part-families/electronics-standoff.m3.json --output standoff.py
python -m printspec.cli bundle examples/part-families/rounded-rectangular-plate.basic.json --output bundle --zip bundle.zip --overwrite
```

## API validation example

```python
spec = {
    "printspecVersion": "0.2.0",
    "units": "mm",
    "part": {
        "type": "round_spacer",
        "label": "Smoke spacer",
        "parameters": {"outerDiameter": 12, "innerDiameter": 4, "height": 8},
    },
}

from printspec import validate_printspec

result = validate_printspec(spec)
print(result["valid"], result["errors"])
```

## Generator example

```python
from printspec.generators import generate_openscad, generate_cadquery

generated = generate_openscad(spec)
if generated["supported"]:
    print(generated["code"])

cadquery = generate_cadquery(spec)
if cadquery["supported"]:
    print(cadquery["code"])
```

## Bundle example

```python
from printspec import create_bundle, write_bundle_to_directory, write_bundle_to_zip

bundle = create_bundle(spec, {"includePartCad": True})
write_bundle_to_directory(bundle, "bundle", overwrite=True)
write_bundle_to_zip(bundle, "bundle.zip", overwrite=True)
```

## Bundled schemas and offline behavior

Schema files are included inside the package under `printspec/schemas/`. Validation resolves those package-local schemas offline and does not fetch hosted schema URLs during normal validation.

## Hosted schema note

Hosted schemas at `https://schemas.invisra.ai/printspec/0.2.0/` are public references for documentation and external tools. They are not required for package validation.

## Safety note

Generated OpenSCAD and CadQuery source is a starter artifact for review. This package does not export STL/STEP/3MF files and does not run CAD runtimes, slicers, supplier APIs, or purchasing automation. Do not use generated designs without appropriate engineering review.

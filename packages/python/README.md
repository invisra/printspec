# printspec for Python

Python package for printspec JSON Schemas, offline validation, BOM helpers, CLI commands, and starter OpenSCAD/CadQuery generators.

## Install

```sh
python -m pip install printspec
```

From a checkout:

```sh
python -m pip install -e "packages/python[test]"
```

## CLI usage

```sh
python -m printspec.cli --version
python -m printspec.cli validate examples/part-families/rounded-rectangular-plate.basic.json
python -m printspec.cli bom examples/projects/simple-enclosure-project.json --format markdown
python -m printspec.cli to-cadquery examples/part-families/electronics-standoff.m3.json
```

## Validation example

```python
import json
from pathlib import Path
from printspec import validate_printspec

spec = json.loads(Path("examples/part-families/rounded-rectangular-plate.basic.json").read_text())
result = validate_printspec(spec)
print(result["valid"], result["errors"])
```

## Generator example

```python
from printspec.generators import generate_openscad

generated = generate_openscad(spec)
if generated["supported"]:
    print(generated["code"])
```

Generated CAD source should be reviewed before use. The package does not run CAD runtimes.

## Offline schema behavior

Schema files are bundled under `printspec/schemas/`. Validation resolves those package-local schemas offline and does not fetch hosted schema URLs.

## Browser/editor form metadata

Printspec schemas now include `x-printspec-*` browser-editor metadata for parameter ordering, grouping, units, controls, steps, priorities, examples, and documentation-only warnings. See `docs/form-metadata.md` for the convention plus TypeScript, Python, and CLI usage. This metadata helps tools render forms; it is not a web app and does not execute CAD.


## Bundle export

```py
from printspec import create_bundle, write_bundle_to_directory, write_bundle_to_zip
bundle = create_bundle(spec, {"includePartCad": True})
write_bundle_to_directory(bundle, "bundle", overwrite=True)
write_bundle_to_zip(bundle, "bundle.zip", overwrite=True)
```

CLI: `python -m printspec.cli bundle file.json --output bundle --zip bundle.zip --overwrite`.

# @invisra/printspec

TypeScript package for printspec JSON Schemas, offline validation, BOM helpers, CLI commands, and starter OpenSCAD/CadQuery generators.

## Install

```sh
npm install @invisra/printspec
```

## ESM import

```js
import { validatePrintSpec, generateOpenScad } from "@invisra/printspec";

const result = validatePrintSpec(spec);
if (!result.valid) console.error(result.errors);
```

## CLI usage

```sh
printspec --version
printspec validate examples/part-families/rounded-rectangular-plate.basic.json
printspec bom examples/projects/simple-enclosure-project.json --format markdown
printspec to-openscad examples/part-families/round-spacer.basic.json --output round-spacer.scad
```

## Generator example

```js
import { generateCadQuery } from "@invisra/printspec";

const generated = generateCadQuery(spec);
if (generated.supported) console.log(generated.code);
```

Generated CAD source should be reviewed before use. The package does not run CAD runtimes.

## Offline schema behavior

Schema files are bundled in `schemas/` and exported as `@invisra/printspec/schemas/*` for tools that need to inspect them. Validation uses bundled schemas and does not fetch hosted schema URLs.

## Browser/editor form metadata

Printspec schemas now include `x-printspec-*` browser-editor metadata for parameter ordering, grouping, units, controls, steps, priorities, examples, and documentation-only warnings. See `docs/form-metadata.md` for the convention plus TypeScript, Python, and CLI usage. This metadata helps tools render forms; it is not a web app and does not execute CAD.


## Bundle export

```ts
import { createBundle, writeBundleToDirectory } from "@invisra/printspec";
const bundle = createBundle(spec, { includePartCad: true });
writeBundleToDirectory(bundle, "bundle", { overwrite: true });
```

CLI: `printspec bundle file.json --output bundle --overwrite`. Zip export is currently Python-only.

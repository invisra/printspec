# @invisra/printspec

TypeScript validators, BOM helpers, CLI commands, and starter source generators for printspec.

## Install

```sh
npm install @invisra/printspec
```

## Validate offline

The NPM package includes bundled JSON Schemas in `schemas/`. `validatePrintSpec` registers those package-local schemas with Ajv and resolves `$ref` values offline; it does not fetch hosted schema URLs.

```ts
import { validatePrintSpec } from "@invisra/printspec";

const result = validatePrintSpec(spec);
if (!result.valid) {
  console.error(result.errors);
}
```

## CLI

```sh
npx printspec validate spec.json
npx printspec to-openscad spec.json --output model.scad
npx printspec bom project.json --format markdown
```

The CLI emits source or text artifacts only. It does not execute OpenSCAD, CadQuery, FreeCAD, or any CAD runtime.

## Development

From a repository checkout, run `npm run sync:schemas` before building or packing. The sync command copies root `schemas/*.schema.json` into the public hosted tree, the Python package, and this TypeScript package, then regenerates static schema indexes and manifests.

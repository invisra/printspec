# Validation

printspec v0.2.0 uses JSON Schema as the structural source of truth. The schemas define required fields, known object shapes, numeric ranges, URL formats, allowed enums, and top-level `part` versus `project` exclusivity.

Both toolkits expose matching result shapes:

```ts
validatePrintSpec(spec, { semantic: true }) // { valid: boolean, errors: string[] }
```

```py
validate_printspec(spec, semantic=True) # {"valid": bool, "errors": list[str]}
```

Validation runs in two layers:

1. **JSON Schema validation** checks structural correctness using local schemas synchronized from `schemas/`. TypeScript uses Ajv Draft 2020-12 and Python uses `jsonschema` with `referencing`; both validators register local schemas before validation and do not fetch remote schemas.
2. **Semantic validation** runs only after schema validation succeeds, unless disabled with `semantic: false` / `semantic=False`. It catches cross-reference and geometry sanity issues such as duplicate ids, broken feature targets, broken project relationships, oversized rounded-plate corner radii, inner diameters larger than outer diameters, wall thicknesses that are too large, and obvious hole-fit issues where implemented.

The schemas use stable, public-looking `$id` values such as `https://schemas.invisra.ai/printspec/0.2.0/printspec.schema.json`. These identifiers are schema resource names, not a network dependency. The Python validator registers every local schema with `jsonschema`/`referencing`, and the TypeScript validator registers every local schema with Ajv 2020, so relative `$ref` values resolve offline.

Validation must not fetch schemas from `schemas.invisra.ai` or any other remote host. Schema tests also meta-validate every `schemas/*.schema.json` file against Draft 2020-12 so schema authoring mistakes fail before fixture validation. The schemas are experimental until printspec 1.0, and the `$id` URLs are served publicly for documentation, tooling, and cross-package references.

## Hosted schema references

The repository-level `schemas/` directory is the source of truth. `npm run sync:schemas` creates synchronized artifacts in `public/printspec/0.2.0/` for static hosting and `packages/python/printspec/schemas/` for Python package data, and `packages/typescript/schemas/` for TypeScript package data; do not manually maintain divergent copies in either destination. Vercel serves the synchronized JSON Schema files from `https://schemas.invisra.ai/printspec/0.2.0/` with schema JSON content-type, permissive CORS, and immutable caching headers.

Hosted schema URLs are public references for documentation and external JSON Schema tooling. They are not required by printspec's validators: Python validation uses bundled package schemas and TypeScript validation loads bundled package-local schemas first and registers local schemas before validation, so normal validation works offline and must not fetch schemas from the network.

## Troubleshooting

If validation reports a schema resolution error that tries to fetch `schemas.invisra.ai`, local schema registration is broken. Ensure `npm run sync:schemas` has produced `packages/python/printspec/schemas/` for Python installs and `packages/typescript/schemas/` for TypeScript installs, or that a source checkout can locate the repository-level `schemas/` directory, and that every `*.schema.json` file has the expected unique `$id` value.

Error text is intentionally compact. TypeScript and Python messages are not guaranteed to be byte-for-byte identical, but they should agree on whether shared examples and fixtures are valid.

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

The Python and TypeScript packages validate offline using bundled schemas copied into `packages/python/printspec/schemas/` and `packages/typescript/schemas/`; hosted schema URLs are public references only and validators must not fetch them during normal validation.


Both packages provide a `printspec` CLI. The Python CLI is available after the editable install; the TypeScript CLI can be run from `packages/typescript/dist/cli.js` after `npm run build`:

```sh
printspec validate examples/part-families/rounded-rectangular-plate.basic.json
printspec to-openscad examples/part-families/round-spacer.basic.json --output model.scad
printspec to-cadquery examples/part-families/electronics-standoff.m3.json --output model.py
printspec bom examples/projects/simple-enclosure-project.json --format markdown
node packages/typescript/dist/cli.js validate examples/part-families/rounded-rectangular-plate.basic.json
```

Generators currently emit source code only and do not require or execute OpenSCAD, CadQuery, FreeCAD, or any CAD runtime. See [docs/generators.md](generators.md) for the current supported family list, which is the same for both the TypeScript and Python packages. Validation runs before generation. Optional finishing features are built where a generator supports them and otherwise produce stable warnings rather than being silently ignored: the OpenSCAD generator builds a whole-part `chamfer` for the `round_spacer` and `spacer_block` families, while targeted chamfers, `fillet`, and chamfers on other families still warn. BOM helpers format local spec hardware data only; printspec does not scrape suppliers or create carts. The v0.2.0 line is experimental and intended for review before manufacturing.

## Hosted references and manifests

The public schema site at `https://schemas.invisra.ai` exposes `https://schemas.invisra.ai/printspec/`, `https://schemas.invisra.ai/printspec/0.2.0/`, `https://schemas.invisra.ai/printspec/manifest.json`, and `https://schemas.invisra.ai/printspec/0.2.0/manifest.json`. These files are generated from `schemas/` by `npm run sync:schemas` together with Python and TypeScript package schema data. Validators should continue to resolve schemas offline from bundled/local copies; hosted URLs are public identifiers and references, not a runtime dependency.

## Browser/editor form metadata

Printspec schemas now include `x-printspec-*` browser-editor metadata for parameter ordering, grouping, units, controls, steps, priorities, examples, and documentation-only warnings. See `docs/form-metadata.md` for the convention plus TypeScript, Python, and CLI usage. This metadata helps tools render forms; it is not a web app and does not execute CAD.


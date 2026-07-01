# Validation

printspec v0.1.0 uses JSON Schema as the structural source of truth. The schemas define required fields, known object shapes, numeric ranges, URL formats, allowed enums, and top-level `part` versus `project` exclusivity.

Both toolkits expose matching result shapes:

```ts
validatePrintSpec(spec, { semantic: true }) // { valid: boolean, errors: string[] }
```

```py
validate_printspec(spec, semantic=True) # {"valid": bool, "errors": list[str]}
```

Validation runs in two layers:

1. **JSON Schema validation** checks structural correctness using the local schemas under `schemas/`.
2. **Semantic validation** runs only after schema validation succeeds, unless disabled with `semantic: false` / `semantic=False`. It catches cross-reference and geometry sanity issues such as duplicate ids, broken feature targets, broken project relationships, oversized rounded-plate corner radii, inner diameters larger than outer diameters, wall thicknesses that are too large, and obvious hole-fit issues where implemented.

The schemas use stable, public-looking `$id` values such as `https://schemas.invisra.com/printspec/0.1.0/printspec.schema.json`. These identifiers are schema resource names, not a network dependency. The Python validator registers every local schema with `jsonschema`/`referencing`, and the TypeScript validator registers every local schema with Ajv 2020, so relative `$ref` values resolve offline.

Validation must not fetch schemas from `schemas.invisra.com` or any other remote host. The v0.1.0 schemas are experimental until printspec 1.0, and the `$id` URLs should not be treated as a promise that hosted schemas are available yet.

## Troubleshooting

If validation reports a schema resolution error that tries to fetch `schemas.invisra.com`, local schema registration is broken. Ensure the package can locate the repository-level `schemas/` directory and that every `*.schema.json` file has the expected unique `$id` value.

Error text is intentionally compact. TypeScript and Python messages are not guaranteed to be byte-for-byte identical, but they should agree on whether shared examples and fixtures are valid.

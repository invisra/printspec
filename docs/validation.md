# Validation

printspec v0.1 uses JSON Schema as the source of truth for structural validation: required fields, known object shapes, numeric dimensions, URL formats, allowed enums, and top-level `part` versus `project` exclusivity.

Both toolkits expose matching result shapes:

```ts
validatePrintSpec(spec, { semantic: true }) // { valid: boolean, errors: string[] }
```

```py
validate_printspec(spec, semantic=True) # {"valid": bool, "errors": list[str]}
```

Semantic validation runs by default and covers checks JSON Schema cannot easily express, including duplicate component/feature/project/hardware IDs, broken component feature targets, broken project relationship references, and obvious geometry mistakes such as a rounded-plate corner radius larger than half the plate size.

Error text is intentionally compact. TypeScript and Python messages are not guaranteed to be byte-for-byte identical, but they should agree on whether shared fixtures are valid.

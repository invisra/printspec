## Hard invariants — never violate

- Published packages (@invisra/printspec, printspec) MUST NOT depend on
  cadquery, cadquery-ocp, brepjs, occt-wasm, three, or any CAD kernel —
  not as a dependency, optional dependency, or lazy import.
- Package validation is OFFLINE. Never fetch schemas.invisra.ai at runtime.
- CI MUST NOT execute a CAD kernel. Kernel-touching scripts are opt-in,
  developer-run, and live under scripts/ with a `verify:` prefix.
- Schemas are open; engines are closed. If a feature needs to execute
  geometry, it belongs in a different repo, not here.
- Never break a published schema version. New fields go in a new version
  directory with a manifest entry.

## Style
- TypeScript package is ESM-only.
- Every schema change updates: schemas/, both validators, docs/, CHANGELOG.md.

# Changelog

## 0.1.0 - Experimental release candidate

- Added package-local JSON Schemas for TypeScript and Python offline validation.
- Added hosted static schema output under `public/printspec/0.1.0/`.
- Added validators, BOM helpers, CLI commands, and starter OpenSCAD/CadQuery generators.
- Supported starter generator families: `rounded_rectangular_plate`, `spacer_block`, `round_spacer`, and `electronics_standoff`.
- Added release-readiness checks for version consistency, npm package smoke tests, and Python wheel smoke tests.

This release is experimental. Generated CAD source should be reviewed before printing or use, and publishing to npm/PyPI remains manual until explicitly configured.

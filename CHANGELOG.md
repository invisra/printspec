# Changelog

## 0.2.0

Feature release:
- Add browser-safe renderer-neutral preview scene generator.
- Add optional Three.js preview adapter.
- Add static in-browser PrintSpec validator for schemas.invisra.ai.
- Expand supported practical part families to at least 10.
- Add examples for all supported alpha families.
- Keep Three.js optional and out of the main browser entrypoint.
- Improve browser-safety and package-content checks.
- Keep schema version at `0.1.0`; added alpha family schemas are backward-compatible additions.
- Preview geometry is visual/non-authoritative and generated source should be reviewed before manufacturing.

## 0.1.5

Patch release:
- Make @invisra/printspec/browser fully browser-safe.
- Add browser-safe generator entrypoints.
- Ensure browser bundle creation does not import Node schema loading.
- Add import graph smoke test to prevent node:fs from entering the browser export.
- No schema changes.

## 0.1.4

Patch release:
- Declare `ajv-formats` as a runtime dependency for Node and browser entrypoints.
- Fix downstream bundling in Next/Vercel when importing `@invisra/printspec/browser`.
- No schema changes.

## 0.1.3

Patch release:
- Add browser-safe entrypoint at `@invisra/printspec/browser`.
- Embed bundled schemas for browser validation and form metadata.
- Keep Node entrypoint and CLI unchanged.
- Add package-content and smoke tests for the browser entrypoint.
- No schema changes.

## 0.1.2

Patch release:

- Add browser-safe entrypoint at `@invisra/printspec/browser`.
- Embed bundled schemas for browser validation.
- Keep Node entrypoint and CLI unchanged.
- No schema changes.

## 0.1.1 - npm packaging fix

Patch release:

- Fix npm package contents.
- Include built `dist/` artifacts in the published npm package.
- Add package-content checks to prevent missing build artifacts.
- No schema changes. Schema `$id` values and `printspecVersion` remain `0.1.0`.

## 0.1.0 - Experimental release candidate

- Added package-local JSON Schemas for TypeScript and Python offline validation.
- Added hosted static schema output under `public/printspec/0.1.0/`.
- Added validators, BOM helpers, CLI commands, and starter OpenSCAD/CadQuery generators.
- Supported starter generator families: `rounded_rectangular_plate`, `spacer_block`, `round_spacer`, and `electronics_standoff`.
- Added release-readiness checks for version consistency, npm package smoke tests, and Python wheel smoke tests.

### Version immutability warning

Once `v0.1.0` is released, do not casually mutate `/printspec/0.1.0/` schema contents. Publish `/printspec/0.1.1/` or `/printspec/0.2.0/` for schema changes. Package patches may happen, but schema `$id` paths need careful handling.

This release is experimental. Generated CAD source should be reviewed before printing or use, and publishing to npm/PyPI remains manual until explicitly configured.

## Browser/editor form metadata

Printspec schemas now include `x-printspec-*` browser-editor metadata for parameter ordering, grouping, units, controls, steps, priorities, examples, and documentation-only warnings. See `docs/form-metadata.md` for the convention plus TypeScript, Python, and CLI usage. This metadata helps tools render forms; it is not a web app and does not execute CAD.


## Bundle export

- Added deterministic project and part source bundle export in TypeScript and Python.
- Added directory writers, Python zip writer, CLI `bundle` commands, bundle manifests, README generation, and optional experimental PartCAD stubs.

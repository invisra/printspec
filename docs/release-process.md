# Release process

printspec schema `v0.1.0` is experimental. Publishing is manual for now; this document is a checklist for preparing release candidates without pushing artifacts to npm or PyPI accidentally.

## Pre-release checklist

1. Sync schemas into package-local and hosted locations:
   ```sh
   npm run sync:schemas
   ```
2. Verify version consistency:
   ```sh
   npm run check:versions
   ```
3. Run TypeScript build and tests:
   ```sh
   npm run build
   npm test
   ```
4. Run npm package content and smoke tests. The package-content check must pass before publishing because npm packages must include built `dist/` artifacts as well as bundled schemas:
   ```sh
   npm run check:npm-package
   npm --workspace @invisra/printspec pack --dry-run
   npm run smoke:npm
   ```
5. Run Python source, build, and wheel smoke tests:
   ```sh
   ./scripts/release-smoke-python.sh
   ```
6. Check hosted schema output under `public/printspec/`, including `manifest.json`, the version directory, and schema `$id` values.
7. Review package metadata in `packages/typescript/package.json` and `packages/python/pyproject.toml`.

## Version policy

Before `1.0`, breaking changes are possible. Once a versioned schema directory has been published, treat that directory as immutable. Package patch releases may advance independently from the schema version when schemas do not change. For example, npm package `@invisra/printspec@0.1.1` can remain on schema `$id` paths and `printspecVersion` `0.1.0` when the release only fixes package contents. For schema changes, publish a new versioned schema directory instead of rewriting an existing one.


## v0.1.0 schema immutability warning

Once `v0.1.0` is released, do not casually mutate files under `/printspec/0.1.0/`. Versioned schema URLs are intended to be stable references. For schema changes, publish a new versioned path such as `/printspec/0.1.1/` or `/printspec/0.2.0/`. Package patches may happen, but schema `$id` paths and hosted version directories need careful handling so existing consumers are not surprised.

## npm publishing future path

The npm package name is `@invisra/printspec`. For now, run `npm run check:npm-package` and `npm --workspace @invisra/printspec pack --dry-run` before any manual publish, and confirm `dist/index.js`, `dist/index.d.ts`, `dist/cli.js`, and `schemas/printspec.schema.json` are present. Later releases should prefer npm provenance or trusted publishing through GitHub Actions.

## PyPI publishing future path

The PyPI package name is `printspec`. Build the package and run `python -m twine check packages/python/dist/*` before any manual upload. Later releases should prefer PyPI trusted publishing.

## GitHub release

Use tag format `v0.1.0`. Include a changelog excerpt, links to hosted schemas such as `https://schemas.invisra.ai/printspec/0.1.0/`, and the current npm/PyPI package status. Do not claim packages are published until they are actually available.

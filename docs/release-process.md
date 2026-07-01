# Release process

printspec `v0.1.0` is experimental. Publishing is manual for now; this document is a checklist for preparing release candidates without pushing artifacts to npm or PyPI accidentally.

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
4. Run npm package smoke tests:
   ```sh
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

Before `1.0`, breaking changes are possible. Once a versioned schema directory has been published, treat that directory as immutable. After release, use patch or minor versions for schema changes and publish a new versioned directory instead of rewriting an existing one.

## npm publishing future path

The npm package name is `@invisra/printspec`. For now, run `npm --workspace @invisra/printspec pack --dry-run` before any manual publish. Later releases should prefer npm provenance or trusted publishing through GitHub Actions.

## PyPI publishing future path

The PyPI package name is `printspec`. Build the package and run `python -m twine check packages/python/dist/*` before any manual upload. Later releases should prefer PyPI trusted publishing.

## GitHub release

Use tag format `v0.1.0`. Include a changelog excerpt, links to hosted schemas such as `https://schemas.invisra.ai/printspec/0.1.0/`, and the current npm/PyPI package status. Do not claim packages are published until they are actually available.

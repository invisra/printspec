# Hosted schemas

printspec publishes browsable, static JSON Schema reference files at `https://schemas.invisra.ai`.

Useful entry points:

- Base index: `https://schemas.invisra.ai/`
- Project index: `https://schemas.invisra.ai/printspec/`
- Version index: `https://schemas.invisra.ai/printspec/0.2.0/`
- Project manifest: `https://schemas.invisra.ai/printspec/manifest.json`
- Version manifest: `https://schemas.invisra.ai/printspec/0.2.0/manifest.json`
- Docs site: `https://schemas.invisra.ai/printspec/0.2.0/docs/` -- every `docs/*.md` file (plus `README.md`/`CHANGELOG.md`/`CONTRIBUTING.md`) rendered to HTML.
- `llms.txt` (for AI agents): `https://schemas.invisra.ai/llms.txt` -- a dense, [llms.txt](https://llmstxt.org)-convention summary of the `composable_part` schema, generators, and known hazards, meant to be fetched as plain text rather than parsed as HTML. Also mirrored at the versioned `https://schemas.invisra.ai/printspec/0.2.0/llms.txt`.

The repository `schemas/` directory is the source of truth. Run `npm run sync:schemas` after editing schema files. The command copies schemas into the public hosted tree, copies them into the Python and TypeScript package data directories, and regenerates static HTML indexes plus machine-readable manifests. `npm run build:docs-site` (bundled into `npm run build:schema-site`) renders the docs site and publishes `llms.txt` from those same source files -- it has no separate source of truth of its own.

Validators resolve bundled schemas offline during normal validation. Hosted schema URLs are stable public references for documentation and external tooling; the Python and TypeScript validators use bundled schemas and should not fetch `schemas.invisra.ai` during ordinary validation.

## Version immutability

Before a version is released, regenerating the current version directory is expected. After release, do not casually mutate old versioned schema paths. The `v0.1.0` directory is released and immutable; `v0.2.0` is the current schema version. Once a version is released, do not casually mutate its `/printspec/<version>/` schema contents. For breaking or meaningful schema changes, publish a new version path such as `/printspec/0.2.1/`, `/printspec/0.3.0/`, or `/printspec/1.0.0/` -- older versioned directories stay published alongside it. Package patches may happen, but schema `$id` paths need careful handling.

## Vercel Analytics

Generated HTML pages can include Vercel Web Analytics when `ENABLE_VERCEL_ANALYTICS=1 npm run sync:schemas` is used. Analytics is disabled by default. When enabled, it measures HTML page views only; direct JSON schema or manifest fetches from validators and tools are not counted as Web Analytics page views.

## Browser/editor form metadata

Printspec schemas now include `x-printspec-*` browser-editor metadata for parameter ordering, grouping, units, controls, steps, priorities, examples, and documentation-only warnings. See `docs/form-metadata.md` for the convention plus TypeScript, Python, and CLI usage. This metadata helps tools render forms; it is not a web app and does not execute CAD.


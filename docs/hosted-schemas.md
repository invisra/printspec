# Hosted schemas

printspec publishes browsable, static JSON Schema reference files at `https://schemas.invisra.ai`.

Useful entry points:

- Base index: `https://schemas.invisra.ai/`
- Project index: `https://schemas.invisra.ai/printspec/`
- Version index: `https://schemas.invisra.ai/printspec/0.1.0/`
- Project manifest: `https://schemas.invisra.ai/printspec/manifest.json`
- Version manifest: `https://schemas.invisra.ai/printspec/0.1.0/manifest.json`

The repository `schemas/` directory is the source of truth. Run `npm run sync:schemas` after editing schema files. The command copies schemas into the public hosted tree, copies them into the Python and TypeScript package data directories, and regenerates static HTML indexes plus machine-readable manifests.

Validators resolve bundled schemas offline during normal validation. Hosted schema URLs are stable public references for documentation and external tooling; the Python and TypeScript validators use bundled schemas and should not fetch `schemas.invisra.ai` during ordinary validation.

## Version immutability

Before a version is released, regenerating the current version directory is expected. After release, do not casually mutate old versioned schema paths. For breaking or meaningful schema changes, publish a new version path such as `/printspec/0.1.1/`, `/printspec/0.2.0/`, or `/printspec/1.0.0/`.

## Vercel Analytics

Generated HTML pages can include Vercel Web Analytics when `ENABLE_VERCEL_ANALYTICS=1 npm run sync:schemas` is used. Analytics is disabled by default. When enabled, it measures HTML page views only; direct JSON schema or manifest fetches from validators and tools are not counted as Web Analytics page views.

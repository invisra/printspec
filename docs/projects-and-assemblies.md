# projects and assemblies

## Project bundles

Project specs can be exported as bundles with the root `printspec.json`, per-inline-part specs under `parts/<part-id>/`, generated CAD source where supported, project BOM files, README, manifest, and optional experimental `partcad.yaml`. External `specPath` parts are currently reported as warnings rather than recursively bundled.

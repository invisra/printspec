# Contributing

Use focused pull requests. Keep schemas deterministic, explicit, safe, and browser-editor friendly. Suggested labels: schema, part-family, composable, project, generator, typescript, python, docs, examples, safety, bom, good-first-issue, breaking-change, proposal.

## Local setup

```sh
npm install
python -m venv .venv && source .venv/bin/activate
python -m pip install -e "packages/python[test]" ruff mypy
```

## Running tests

```sh
npm test              # TypeScript package, schema site, and schema validator
npm run test:python   # Python package and shared schema fixtures
```

## Linting and type checking

```sh
npm run lint:ts       # eslint, prettier --check, tsc build
npm run lint:python   # ruff check, ruff format --check, mypy
npm run lint          # both
```

`npm run format` applies Prettier to TypeScript/JavaScript sources; `ruff format .` does the equivalent for Python.

## Before opening a PR

Run `npm run lint`, `npm test`, and `npm run test:python`. If you change any file under `schemas/`, run `npm run sync:schemas` and commit the synced copies in `packages/typescript/schemas`, `packages/python/printspec/schemas`, and `public/printspec/`.

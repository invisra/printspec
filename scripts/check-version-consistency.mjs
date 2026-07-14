#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const readJson = (p) => JSON.parse(readFileSync(path.join(root, p), "utf8"));
const schemaVersion = readJson("package.json").version;
const tsVersion = readJson("packages/typescript/package.json").version;
const pyproject = readFileSync(
  path.join(root, "packages/python/pyproject.toml"),
  "utf8",
);
const pyVersion = pyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

function check(condition, message) {
  if (!condition) errors.push(message);
}
check(
  /^\d+\.\d+\.\d+$/.test(tsVersion),
  `packages/typescript/package.json version ${tsVersion} must be a semver package version`,
);
check(
  pyVersion === schemaVersion,
  `packages/python/pyproject.toml version ${pyVersion} does not match schema version ${schemaVersion}`,
);

const schemaDirs = [
  "schemas",
  "packages/typescript/schemas",
  "packages/python/printspec/schemas",
  `public/printspec/${schemaVersion}`,
];
for (const dir of schemaDirs) {
  const full = path.join(root, dir);
  for (const file of readdirSync(full)
    .filter((f) => f.endsWith(".schema.json"))
    .sort()) {
    const schema = JSON.parse(readFileSync(path.join(full, file), "utf8"));
    const expected = `https://schemas.invisra.ai/printspec/${schemaVersion}/${file}`;
    check(
      schema.$id === expected,
      `${dir}/${file} $id must be ${expected}, got ${schema.$id}`,
    );
    if (file === "printspec.schema.json")
      check(
        schema.properties?.printspecVersion?.const === schemaVersion,
        `${dir}/${file} printspecVersion const must be ${schemaVersion}`,
      );
  }
}

const projectManifest = readJson("public/printspec/manifest.json");
const versions = projectManifest.versions?.map((v) => v.version) ?? [];
check(
  versions.includes(schemaVersion),
  `public/printspec/manifest.json must include version ${schemaVersion}`,
);
check(
  statSync(path.join(root, "public/printspec", schemaVersion)).isDirectory(),
  `public/printspec/${schemaVersion} directory is missing`,
);
const versionManifest = readJson(
  `public/printspec/${schemaVersion}/manifest.json`,
);
check(
  versionManifest.version === schemaVersion,
  `public version manifest must have version ${schemaVersion}`,
);
for (const entry of versionManifest.schemas ?? []) {
  check(
    entry.url === `/printspec/${schemaVersion}/${entry.filename}`,
    `manifest URL mismatch for ${entry.filename}`,
  );
  check(
    entry.id ===
      `https://schemas.invisra.ai/printspec/${schemaVersion}/${entry.filename}`,
    `manifest id mismatch for ${entry.filename}`,
  );
}
for (const html of [
  "public/printspec/index.html",
  `public/printspec/${schemaVersion}/index.html`,
]) {
  const text = readFileSync(path.join(root, html), "utf8");
  check(
    text.includes(schemaVersion),
    `${html} must reference ${schemaVersion}`,
  );
}
function walk(dir) {
  const full = path.join(root, dir);
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (entry.name.endsWith(".json")) {
      const data = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
      if ("printspecVersion" in data)
        check(
          data.printspecVersion === schemaVersion,
          `${rel} printspecVersion must be ${schemaVersion}`,
        );
    }
  }
}
walk("examples");
if (errors.length) {
  console.error(errors.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}
console.log(
  `Version consistency check passed for printspec schema ${schemaVersion} and npm package ${tsVersion}`,
);

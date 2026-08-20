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
// PartFacts is an independently versioned output-artifact schema under
// schemas/partfacts/<version>/ (its own track, not schemaVersion). Verify its
// $id carries its own directory version and that every synced copy matches the
// source, mirroring the flat-schema checks above without conflating the two
// version tracks.
const partFactsSourceDir = path.join(root, "schemas", "partfacts");
if (statSync(partFactsSourceDir, { throwIfNoEntry: false })?.isDirectory()) {
  const partFactsVersions = readdirSync(partFactsSourceDir).filter(
    (entry) =>
      /^\d+\.\d+\.\d+$/.test(entry) &&
      statSync(path.join(partFactsSourceDir, entry)).isDirectory(),
  );
  const partFactsDestRoots = [
    "schemas/partfacts",
    "packages/typescript/schemas/partfacts",
    "packages/python/printspec/schemas/partfacts",
    "public/printspec/partfacts",
  ];
  for (const version of partFactsVersions) {
    const file = "partfacts.schema.json";
    const expectedId = `https://schemas.invisra.ai/printspec/partfacts/${version}/${file}`;
    const sourceRel = `schemas/partfacts/${version}/${file}`;
    const sourceText = readFileSync(path.join(root, sourceRel), "utf8");
    const sourceSchema = JSON.parse(sourceText);
    check(
      sourceSchema.$id === expectedId,
      `${sourceRel} $id must be ${expectedId}, got ${sourceSchema.$id}`,
    );
    check(
      sourceSchema.properties?.partfactsVersion?.const === version,
      `${sourceRel} partfactsVersion const must be ${version}`,
    );
    for (const destRoot of partFactsDestRoots) {
      const destRel = `${destRoot}/${version}/${file}`;
      const destPath = path.join(root, destRel);
      const present = statSync(destPath, { throwIfNoEntry: false })?.isFile();
      check(present, `${destRel} is missing; run \`npm run sync:schemas\``);
      if (present)
        check(
          readFileSync(destPath, "utf8") === sourceText,
          `${destRel} is stale; run \`npm run sync:schemas\``,
        );
    }
  }
  const partFactsManifest = readJson(
    "public/printspec/partfacts/manifest.json",
  );
  check(
    partFactsManifest.artifact === "partfacts",
    "public/printspec/partfacts/manifest.json must name the partfacts artifact",
  );
  const listedVersions = (partFactsManifest.versions ?? []).map(
    (v) => v.version,
  );
  for (const version of partFactsVersions)
    check(
      listedVersions.includes(version),
      `public/printspec/partfacts/manifest.json must include version ${version}`,
    );
  const projectArtifacts = projectManifest.artifacts ?? [];
  check(
    projectArtifacts.some((a) => a.name === "partfacts"),
    "public/printspec/manifest.json must list the partfacts artifact",
  );
}

if (errors.length) {
  console.error(errors.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}
console.log(
  `Version consistency check passed for printspec schema ${schemaVersion} and npm package ${tsVersion}`,
);

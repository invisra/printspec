import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const sourceDir = path.join(root, "schemas");
const publicDir = path.join(root, "public", "printspec", version);
const pythonDir = path.join(root, "packages/python/printspec/schemas");
const typescriptDir = path.join(root, "packages/typescript/schemas");
const schemaFiles = fs
  .readdirSync(sourceDir)
  .filter((f) => f.endsWith(".schema.json"))
  .sort((a, b) =>
    a === "printspec.schema.json"
      ? -1
      : b === "printspec.schema.json"
        ? 1
        : a.localeCompare(b),
  );

test("static schema site files exist", () => {
  for (const file of [
    "public/index.html",
    "public/printspec/index.html",
    `public/printspec/${version}/index.html`,
    "public/printspec/manifest.json",
    `public/printspec/${version}/manifest.json`,
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} should exist`);
  }
});

test("version index links every schema without filesystem paths, with analytics by default", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  for (const file of schemaFiles)
    assert.match(html, new RegExp(file.replaceAll(".", "\\.")));
  assert.doesNotMatch(
    html,
    new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(html, /\/_vercel\/insights\/script\.js/);
});

test("manifests include versions and all schemas", () => {
  const project = JSON.parse(
    fs.readFileSync(path.join(root, "public/printspec/manifest.json"), "utf8"),
  );
  assert.equal(project.project, "printspec");
  // Older versioned schema directories are immutable and stay published
  // alongside the current one (see docs/hosted-schemas.md), so the project
  // manifest can list more than just the current version.
  assert.ok(
    project.versions.map((v) => v.version).includes(version),
    `project manifest versions should include current version ${version}`,
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(publicDir, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.version, version);
  assert.deepEqual(
    manifest.schemas.map((s) => s.filename),
    schemaFiles,
  );
  for (const entry of manifest.schemas) {
    const source = JSON.parse(
      fs.readFileSync(path.join(sourceDir, entry.filename), "utf8"),
    );
    assert.equal(entry.id, source.$id);
    assert.equal(entry.title, source.title);
    assert.equal(entry.description, source.description);
  }
});

function schemaFileNames(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".schema.json"))
    .sort((a, b) =>
      a === "printspec.schema.json"
        ? -1
        : b === "printspec.schema.json"
          ? 1
          : a.localeCompare(b),
    );
}

test("synced schemas match source schemas across all generated destinations", () => {
  for (const [label, dir] of [
    ["public hosted schemas", publicDir],
    ["Python package schemas", pythonDir],
    ["TypeScript package schemas", typescriptDir],
  ]) {
    assert.deepEqual(
      schemaFileNames(dir),
      schemaFiles,
      `${label} should contain exactly the source schema filenames`,
    );
    for (const file of schemaFiles) {
      const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
      assert.equal(
        fs.readFileSync(path.join(dir, file), "utf8"),
        source,
        `${label}/${file} should match schemas/${file}`,
      );
    }
  }
});

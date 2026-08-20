import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validatePartFacts,
  partFactsSchemaVersion,
} from "../../packages/typescript/dist/index.js";
import { validatePartFacts as validatePartFactsBrowser } from "../../packages/typescript/dist/browser.js";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const validDir = path.join(root, "tests/fixtures/partfacts/valid");
const invalidDir = path.join(root, "tests/fixtures/partfacts/invalid");
const listJson = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

test("partFactsSchemaVersion is 0.1.0", () => {
  assert.equal(partFactsSchemaVersion, "0.1.0");
});

test("valid PartFacts fixtures validate", () => {
  for (const file of listJson(validDir)) {
    const result = validatePartFacts(
      read(`tests/fixtures/partfacts/valid/${file}`),
    );
    assert.deepEqual(
      result,
      { valid: true, errors: [] },
      `${file}: ${result.errors}`,
    );
  }
});

test("invalid PartFacts fixtures are rejected", () => {
  for (const file of listJson(invalidDir)) {
    const result = validatePartFacts(
      read(`tests/fixtures/partfacts/invalid/${file}`),
    );
    assert.equal(result.valid, false, `${file} should be invalid`);
    assert.ok(result.errors.length > 0, `${file} should report errors`);
  }
});

test("wrong partfactsVersion is rejected", () => {
  const good = read("tests/fixtures/partfacts/valid/minimal-box.json");
  const result = validatePartFacts({ ...good, partfactsVersion: "9.9.9" });
  assert.equal(result.valid, false);
});

test("additional top-level properties are rejected", () => {
  const good = read("tests/fixtures/partfacts/valid/minimal-box.json");
  const result = validatePartFacts({ ...good, surprise: true });
  assert.equal(result.valid, false);
});

test("the browser entrypoint validates PartFacts identically", () => {
  for (const file of listJson(validDir)) {
    const facts = read(`tests/fixtures/partfacts/valid/${file}`);
    assert.deepEqual(validatePartFactsBrowser(facts), validatePartFacts(facts));
  }
  const bad = read("tests/fixtures/partfacts/invalid/missing-provenance.json");
  assert.deepEqual(
    validatePartFactsBrowser(bad).valid,
    validatePartFacts(bad).valid,
  );
});

test("the bundled PartFacts schema is self-contained (no external $refs)", () => {
  const schema = read("schemas/partfacts/0.1.0/partfacts.schema.json");
  const refs = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, item] of Object.entries(v)) {
        if (k === "$ref" && typeof item === "string") refs.push(item);
        else walk(item);
      }
  };
  walk(schema);
  assert.ok(refs.length > 0, "schema should use internal $refs");
  for (const ref of refs)
    assert.ok(ref.startsWith("#"), `PartFacts $ref must be internal: ${ref}`);
  assert.equal(
    schema.$id,
    "https://schemas.invisra.ai/printspec/partfacts/0.1.0/partfacts.schema.json",
  );
});

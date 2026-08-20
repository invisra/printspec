import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validatePartFacts,
  partFactsSchemaVersion,
  supportedPartFactsVersions,
} from "../../packages/typescript/dist/index.js";
import {
  validatePartFacts as validatePartFactsBrowser,
  supportedPartFactsVersions as supportedPartFactsVersionsBrowser,
} from "../../packages/typescript/dist/browser.js";

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

test("an unsupported partfactsVersion yields a clear dispatch error", () => {
  const good = read("tests/fixtures/partfacts/valid/minimal-box.json");
  const result = validatePartFacts({ ...good, partfactsVersion: "0.2.0" });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /unsupported PartFacts version/);
  // ...and not a pile of confusing structural errors.
  assert.equal(result.errors.length, 1);
});

test("supportedPartFactsVersions includes the current version", () => {
  assert.ok(supportedPartFactsVersions.includes(partFactsSchemaVersion));
  assert.deepEqual(
    [...supportedPartFactsVersionsBrowser],
    [...supportedPartFactsVersions],
  );
});

test("massProperties may be omitted only when topology.valid is false", () => {
  const good = read("tests/fixtures/partfacts/valid/minimal-box.json");
  const noMass = { ...good };
  delete noMass.massProperties;
  assert.equal(validatePartFacts(noMass).valid, false);

  const invalid = structuredClone(good);
  invalid.topology.valid = false;
  invalid.topology.checks = [{ name: "free-edges", status: "fail" }];
  delete invalid.massProperties;
  assert.equal(validatePartFacts(invalid).valid, true);
});

test("a counterbore groups two co-axial faces into one ordered hole", () => {
  const cb = read("tests/fixtures/partfacts/valid/counterbore.json");
  assert.equal(validatePartFacts(cb).valid, true);
  const faces = cb.featureInventory.cylindricalFaces;
  assert.equal(new Set(faces.map((f) => f.featureId)).size, 1);
  const hole = cb.featureInventory.holes[0];
  assert.equal(hole.segments.length, 2);
  assert.deepEqual(
    hole.segments.map((s) => s.radius),
    [2, 5],
  );
});

test("a split hole keeps one featureId across the gap and reads through", () => {
  const sh = read("tests/fixtures/partfacts/valid/split-hole.json");
  assert.equal(validatePartFacts(sh).valid, true);
  assert.equal(
    new Set(sh.featureInventory.cylindricalFaces.map((f) => f.featureId)).size,
    1,
  );
  assert.equal(sh.featureInventory.holes[0].through, true);
});

test("a multi-solid document validates with aggregate + per-solid facts", () => {
  const ms = read("tests/fixtures/partfacts/valid/multi-solid.json");
  assert.equal(validatePartFacts(ms).valid, true);
  assert.equal(ms.topology.solidCount, ms.solids.length);
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

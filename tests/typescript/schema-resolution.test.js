import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validatePrintSpec } from "../../packages/typescript/dist/index.js";

const root = path.resolve("../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const schemaDir = path.join(root, "schemas");
const schemaFiles = fs
  .readdirSync(schemaDir)
  .filter((file) => file.endsWith(".schema.json"))
  .sort();
const schemaBaseUri = "https://schemas.invisra.ai/printspec/0.2.0/";

function createMetaAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const registered = new Set();
  for (const filename of schemaFiles) {
    const schema = read(`schemas/${filename}`);
    const primaryId = schema.$id ?? `${schemaBaseUri}${filename}`;
    ajv.addSchema(schema, primaryId);
    registered.add(primaryId);
  }
  for (const filename of schemaFiles) {
    const schema = read(`schemas/${filename}`);
    const aliasSchema = { ...schema };
    delete aliasSchema.$id;
    for (const alias of [filename, `${schemaBaseUri}${filename}`]) {
      if (!registered.has(alias)) {
        ajv.addSchema(aliasSchema, alias);
        registered.add(alias);
      }
    }
  }
  return ajv;
}

test("all schemas are valid Draft 2020-12 schemas", () => {
  const ajv = createMetaAjv();
  for (const filename of schemaFiles) {
    const schema = read(`schemas/${filename}`);
    assert.equal(ajv.validateSchema(schema), true, `${filename}: ${ajv.errorsText(ajv.errors)}`);
  }
});

test("schema-backed validation resolves nested refs offline from compiled package", () => {
  const plate = read("examples/part-families/rounded-rectangular-plate.basic.json");
  plate.part.parameters.holes = [{ x: 5, y: 5, diameter: 3.2, depth: "through" }];
  plate.hardware = [
    {
      id: "screw",
      kind: "screw",
      quantity: 4,
      supplierReferences: [{ supplier: "example", partNumber: "M3" }],
    },
  ];
  assert.equal(validatePrintSpec(plate).valid, true);

  const project = {
    printspecVersion: "0.2.0",
    units: "mm",
    project: {
      type: "project",
      label: "Offline nested project",
      parts: [{ id: "plate", label: "Plate", spec: plate }],
    },
  };
  const result = validatePrintSpec(project);
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("cable clip requires at least one clip sizing field", () => {
  const valid = validatePrintSpec(read("examples/part-families/cable-clip.basic.json"));
  assert.equal(valid.valid, true, valid.errors.join("; "));

  const invalid = validatePrintSpec(
    read("tests/fixtures/invalid/cable-clip-missing-clip-size.json"),
  );
  assert.equal(invalid.valid, false);
});

test("TypeScript package-local schemas are present for packaging", () => {
  const packageSchemaDir = path.join(root, "packages/typescript/schemas");
  for (const required of ["printspec.schema.json", "common.schema.json"]) {
    assert.ok(
      fs.existsSync(path.join(packageSchemaDir, required)),
      `packages/typescript/schemas/${required} should exist`,
    );
  }
  const packageSchemaFiles = fs
    .readdirSync(packageSchemaDir)
    .filter((file) => file.endsWith(".schema.json"))
    .sort();
  assert.deepEqual(
    packageSchemaFiles,
    schemaFiles,
    "TypeScript package schemas should contain every root schema and no stale schemas",
  );
});

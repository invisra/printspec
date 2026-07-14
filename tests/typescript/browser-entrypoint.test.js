import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validatePrintSpec,
  generateOpenScad,
  createBundle,
  getPartFamilyFormMetadata,
  listPartFamilies,
} from "../../packages/typescript/dist/browser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const distBrowser = path.join(root, "packages/typescript/dist/browser.js");
const spec = {
  printspecVersion: "0.2.0",
  units: "mm",
  part: {
    type: "round_spacer",
    label: "Smoke",
    parameters: { outerDiameter: 12, innerDiameter: 4, height: 8 },
  },
};

test("browser entrypoint validates, generates OpenSCAD, and creates bundles", () => {
  const result = validatePrintSpec(spec);
  assert.equal(result.valid, true, result.errors.join("\n"));
  const generated = generateOpenScad(spec);
  assert.equal(generated.supported, true, generated.message);
  assert.match(generated.code, /cylinder/);
  const bundle = createBundle(spec);
  assert.equal(bundle.supported, true, bundle.message);
  assert.ok(bundle.files.some((file) => file.path === "printspec.json"));
  const metadata = getPartFamilyFormMetadata("round_spacer");
  assert.equal(metadata.partType, "round_spacer");
  assert.ok(metadata.fields.some((field) => field.name === "outerDiameter"));
  const families = listPartFamilies();
  assert.ok(families.some((family) => family.type === "round_spacer"));
});

test("compiled browser entrypoint has no Node builtin imports", () => {
  const source = fs.readFileSync(distBrowser, "utf8");
  for (const forbidden of [
    "node:fs",
    "node:path",
    "node:url",
    'from "fs"',
    'from "path"',
    'from "url"',
    'require("fs")',
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `dist/browser.js must not contain ${forbidden}`,
    );
  }
});

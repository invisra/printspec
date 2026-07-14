#!/usr/bin/env node
// Opt-in real-kernel verification for every brepjs-generated example.
//
// This is NOT part of `npm test` / CI: it requires Node >=24 and a real
// OpenCascade WASM kernel (via the `brepjs` + `occt-wasm` packages
// installed only in this directory's own node_modules -- @invisra/printspec
// itself never depends on either, see docs/generators.md). The committed
// test suite already runs every generated module against a lightweight,
// dependency-free syntax/API-shape stub (tests/fixtures/brepjs-stub/), which
// catches broken or misused brepjs calls; this script goes further and
// checks the *geometry* is actually correct (a valid, non-degenerate solid
// with a sane volume), which the stub can't. Run it by hand after touching
// packages/typescript/src/generators/brepjs.core.ts or brepjs.composable.ts.
//
// It once caught a real bug this way: composable_part's `wedge` kind
// extruded its profile along the wrong axis, producing a silently
// zero-volume solid that every other test (including the stub) missed. See
// CHANGELOG.md "Unreleased" for the fix.
//
// Usage:
//   nvm install 24 && nvm use 24   # or any other way to get Node >=24
//   npm run build                  # builds packages/typescript/dist
//   node scripts/brepjs-verify/verify.mjs
//
// First run installs brepjs + occt-wasm into scripts/brepjs-verify/
// node_modules automatically (a real download, not vendored).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 24) {
  fail(
    `scripts/brepjs-verify needs Node >=24 (brepjs's real OCCT-WASM kernel requires it); ` +
      `currently running Node ${process.versions.node}. With nvm: ` +
      `nvm install 24 && nvm use 24 && node scripts/brepjs-verify/verify.mjs`,
  );
}

const distIndex = path.join(repoRoot, "packages/typescript/dist/index.js");
if (!existsSync(distIndex)) {
  fail(
    `Missing ${path.relative(repoRoot, distIndex)} -- run \`npm run build\` first.`,
  );
}

if (!existsSync(path.join(here, "node_modules", "brepjs"))) {
  console.log(
    "Installing brepjs + occt-wasm into scripts/brepjs-verify/ (first run only)...\n",
  );
  const install = spawnSync("npm", ["install"], {
    cwd: here,
    stdio: "inherit",
  });
  if (install.status !== 0)
    fail("npm install failed in scripts/brepjs-verify/.");
}

const { OcctKernel } = await import("occt-wasm");
const { registerKernel, OcctWasmAdapter, measureVolume, isValid, unwrap } =
  await import("brepjs");
const { generateBrepJs, validatePrintSpec } = await import(
  pathToFileURL(distIndex).href
);

const kernel = await OcctKernel.init();
registerKernel("occt-wasm", OcctWasmAdapter.fromKernel(kernel));

const genDir = path.join(here, ".generated");
rmSync(genDir, { recursive: true, force: true });
mkdirSync(genDir, { recursive: true });

function jsonFilesIn(dir) {
  return readdirSync(path.join(repoRoot, dir))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => [`${dir}/${f}`, path.join(repoRoot, dir, f)]);
}

const examples = [
  ...jsonFilesIn("examples/composable"),
  ...jsonFilesIn("examples/part-families"),
];

let checked = 0;
let failures = 0;
for (const [label, file] of examples) {
  const spec = JSON.parse(readFileSync(file, "utf8"));
  const validation = validatePrintSpec(spec);
  if (!validation.valid) {
    failures++;
    console.error(
      `FAIL ${label}: invalid spec: ${validation.errors.join("; ")}`,
    );
    continue;
  }
  const result = generateBrepJs(spec);
  if (!result.supported) continue; // not every family/example has brepjs support; that's expected

  checked++;
  const modPath = path.join(genDir, `${label.replace(/[\\/]/g, "__")}.mjs`);
  writeFileSync(modPath, result.code);
  try {
    const mod = await import(pathToFileURL(modPath).href);
    const shapeResult = mod.default();
    const valid = isValid(shapeResult);
    const volume = unwrap(measureVolume(shapeResult));
    const ok = valid && volume > 0;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${label}: volume=${volume.toFixed(3)} mm^3, valid=${valid}`,
    );
    if (!ok) failures++;
  } catch (e) {
    failures++;
    console.error(`FAIL ${label}: ${e.stack ?? e}`);
  }
}

rmSync(genDir, { recursive: true, force: true });

console.log(
  `\n${checked} brepjs-supported example(s) checked, ${failures} failure(s).`,
);
process.exit(failures === 0 ? 0 : 1);

#!/usr/bin/env node
// Opt-in real-kernel inspection for a single PrintSpec, built on brepjs-cad's
// verify substrate (https://www.npmjs.com/package/brepjs-cad) -- the same
// tool exposed to MCP-capable agents via its `brep-mcp` server. See
// "Real-kernel inspection for an authoring agent" in docs/generators.md for
// how to register that MCP server.
//
// Generates brepjs source for the given spec with printspec's own
// generateBrepJs(), then runs brepjs-cad's `brep verify` against it: a real
// OCCT-WASM kernel report with volume/bounds/center-of-mass, an actual
// solid-count-based manifold/connectivity check (not the cheap bounding-box
// approximation generateBrepJs() itself uses inline), manufacturability
// checks (minimum radius, bores), and -- if brepjs-cad's optional
// puppeteer/Chrome dependency is installed -- multi-angle rendered PNGs via
// --snapshot.
//
// Requires Node >=24 (brepjs's real kernel needs it) and `npm install` run
// once in this directory (installs brepjs, occt-wasm, and brepjs-cad).
//
// Usage:
//   node scripts/brepjs-verify/inspect.mjs <spec.json> [--snapshot <dir>] [--isolate <id>]
//
// The core JSON report works without any extra setup. --snapshot needs
// brepjs-cad's optional Chrome dependency; if `npm install` here skipped it
// (via allow-scripts), see docs/generators.md for how to opt in.
//
// --isolate <id> inspects one component or feature's own resolved shape
// (via generateBrepJs's { isolate } option -- see docs/generators.md)
// instead of the whole fused part -- for checking a single piece (its own
// volume/bounds/validity) in a composable_part spec without hand-deriving
// combined-shape math or authoring a separate spec that isolates it by hand.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
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
    `scripts/brepjs-verify/inspect.mjs needs Node >=24 (brepjs's real kernel requires it); ` +
      `currently running Node ${process.versions.node}. With nvm: nvm install 24 && nvm use 24`,
  );
}

const args = process.argv.slice(2);
const specPath = args.find((a) => !a.startsWith("--"));
if (!specPath)
  fail(
    "Usage: node scripts/brepjs-verify/inspect.mjs <spec.json> [--snapshot <dir>] [--isolate <id>]",
  );
const snapshotIdx = args.indexOf("--snapshot");
const snapshotDir = snapshotIdx !== -1 ? args[snapshotIdx + 1] : null;
const isolateIdx = args.indexOf("--isolate");
const isolateId = isolateIdx !== -1 ? args[isolateIdx + 1] : null;

const resolvedSpecPath = path.resolve(process.cwd(), specPath);
if (!existsSync(resolvedSpecPath)) fail(`Spec file not found: ${resolvedSpecPath}`);

const distIndex = path.join(repoRoot, "packages/typescript/dist/index.js");
if (!existsSync(distIndex))
  fail(`Missing ${path.relative(repoRoot, distIndex)} -- run \`npm run build\` first.`);

if (!existsSync(path.join(here, "node_modules", "brepjs-cad"))) {
  fail(
    `Missing brepjs-cad in scripts/brepjs-verify/node_modules -- run \`npm install\` in that directory first.`,
  );
}

const { generateBrepJs, validatePrintSpec } = await import(pathToFileURL(distIndex).href);
const spec = JSON.parse(readFileSync(resolvedSpecPath, "utf8"));

const validation = validatePrintSpec(spec);
if (!validation.valid) fail(`Spec is invalid:\n${validation.errors.join("\n")}`);

const result = generateBrepJs(spec, isolateId ? { isolate: isolateId } : undefined);
if (!result.supported) fail(`generateBrepJs() does not support this spec: ${result.message}`);
if (result.warnings.length) {
  console.error("printspec generator warnings:");
  for (const w of result.warnings) console.error(`  - ${w}`);
  console.error("");
}

const tmpDir = mkdtempSync(path.join(os.tmpdir(), "printspec-inspect-"));
try {
  const modPath = path.join(tmpDir, "part.brep.ts");
  writeFileSync(modPath, result.code);

  const brepBin = path.join(here, "node_modules", ".bin", "brep");
  const brepArgs = ["verify", modPath];
  if (snapshotDir) {
    const resolvedSnapshotDir = path.resolve(process.cwd(), snapshotDir);
    mkdirSync(resolvedSnapshotDir, { recursive: true });
    brepArgs.push("--snapshot", resolvedSnapshotDir);
  }
  const run = spawnSync(brepBin, brepArgs, { encoding: "utf8" });
  if (run.stderr) process.stderr.write(run.stderr);
  process.stdout.write(run.stdout);
  process.exit(run.status ?? 1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

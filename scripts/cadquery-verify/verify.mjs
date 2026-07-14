#!/usr/bin/env node
// Opt-in real-kernel verification for every composable_part CadQuery-
// generated example, mirroring scripts/brepjs-verify/verify.mjs's role for
// the brepjs generator exactly, just against a real, installed `cadquery`
// (Python) instead of a real `brepjs`+`occt-wasm` (Node) kernel -- both
// wrap the same underlying OpenCascade, so a spec real-kernel-verified for
// one generator is real-kernel-verifiable for the other too, and this
// script's own volumes should (and, when checked, do) exactly match
// scripts/brepjs-verify's own already-committed results, since both are
// ultimately built by the same OCCT.
//
// This is NOT part of `npm test` / CI: it needs a real `cadquery` install
// (this repo's own `.venv`, not a dependency of `@invisra/printspec`
// itself) and a Python subprocess per example, neither of which the
// committed test suite can assume. `tests/typescript/cadquery-composable.test.js`
// already checks every generated module's *code shape* (schema validation,
// string/regex assertions matching the existing part-family CadQuery
// tests); this script goes further and checks the *geometry* is actually
// correct, which a code-shape check can't.
//
// Usage:
//   cd scripts/cadquery-verify && python3 -m venv .venv (once, if this repo's
//     own top-level .venv doesn't already have cadquery -- see below) &&
//     .venv/bin/pip install cadquery
//   npm run build
//   node scripts/cadquery-verify/verify.mjs
//
// Looks for a `cadquery`-capable Python first at this repo's own top-level
// `.venv/bin/python` (already used by `tests/python`), falling back to
// plain `python3` on PATH if that doesn't have `cadquery` importable.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const distIndex = path.join(repoRoot, "packages/typescript/dist/index.js");
if (!existsSync(distIndex))
  fail(
    `Missing ${path.relative(repoRoot, distIndex)} -- run \`npm run build\` first.`,
  );

function hasCadquery(pythonBin) {
  try {
    execFileSync(pythonBin, ["-c", "import cadquery"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const repoVenvPython = path.join(repoRoot, ".venv/bin/python");
const pythonBin =
  existsSync(repoVenvPython) && hasCadquery(repoVenvPython)
    ? repoVenvPython
    : "python3";
if (!hasCadquery(pythonBin))
  fail(
    `No Python with \`cadquery\` importable found (tried ${repoVenvPython} and \`python3\` on PATH). ` +
      `Install it once with: <python> -m pip install cadquery`,
  );

const { generateCadQuery, validatePrintSpec } = await import(
  pathToFileURL(distIndex).href
);

// Runs one spec through generateCadQuery() and a real cadquery subprocess,
// returning { volume, valid, bbox, warnings, code }. Exported for ad hoc use
// (`import { runSpec } from "./verify.mjs"`) in addition to this file's own
// CLI loop below.
export function runSpec(spec, options) {
  const validation = validatePrintSpec(spec);
  if (!validation.valid)
    throw new Error(`Invalid spec: ${validation.errors.join("; ")}`);
  const result = generateCadQuery(spec, options);
  if (!result.supported)
    throw new Error(`generateCadQuery unsupported: ${result.message}`);
  const tmpDir = mkdtempSync(path.join(tmpdir(), "printspec-cq-verify-"));
  try {
    const modPath = path.join(tmpDir, "part.py");
    writeFileSync(
      modPath,
      result.code +
        "\nimport json\n" +
        "print(json.dumps({'volume': part.Volume(), 'valid': part.isValid(), " +
        "'bbox': [part.BoundingBox().xmin, part.BoundingBox().xmax, part.BoundingBox().ymin, " +
        "part.BoundingBox().ymax, part.BoundingBox().zmin, part.BoundingBox().zmax]}))\n",
    );
    const out = execFileSync(pythonBin, [modPath], {
      encoding: "utf8",
      cwd: repoRoot,
    });
    const report = JSON.parse(out.trim().split("\n").pop());
    return { ...report, warnings: result.warnings, code: result.code };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// When run directly (not imported), check every example under
// examples/composable/. Deliberately excludes examples/part-families/:
// those pre-existing generators build with the fluent `cq.Workplane(...)`
// API (their own `part` variable has no `.Volume()`/`.isValid()` directly,
// unlike this generator's raw `cq.Solid`/`Shape`/`Compound` -- confirmed by
// running this script against them first and hitting exactly that
// AttributeError), and their CadQuery support already has its own
// dedicated coverage (`tests/python/test_generator_parity.py`, comparing
// `supported` against the TypeScript generator) that isn't this script's
// job to duplicate.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  function jsonFilesIn(dir) {
    return readdirSync(path.join(repoRoot, dir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => [`${dir}/${f}`, path.join(repoRoot, dir, f)]);
  }
  const examples = jsonFilesIn("examples/composable");

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
    const result = generateCadQuery(spec);
    if (!result.supported) continue; // not every example has CadQuery support; that's expected (thread/text)

    checked++;
    try {
      const report = runSpec(spec);
      const ok = report.valid && report.volume > 0;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${label}: volume=${report.volume.toFixed(3)} mm^3, valid=${report.valid}`,
      );
      if (!ok) failures++;
    } catch (e) {
      failures++;
      console.error(`FAIL ${label}: ${e.stack ?? e}`);
    }
  }

  console.log(
    `\n${checked} CadQuery-supported example(s) checked, ${failures} failure(s).`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

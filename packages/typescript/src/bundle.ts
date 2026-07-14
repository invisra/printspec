import fs from "node:fs";
import path from "node:path";
import { validatePrintSpec } from "./validate.js";
import { generateOpenScad } from "./generators/openscad.js";
import { generateCadQuery } from "./generators/cadquery.js";
import { generateBrepJs } from "./generators/brepjs.js";
import { createBundleWithDeps } from "./bundle.core.js";
export type {
  BundleFile,
  BundleWarning,
  BundleResult,
  BundleOptions,
  WriteBundleOptions,
} from "./bundle.core.js";
import type { BundleResult, BundleOptions, WriteBundleOptions } from "./bundle.core.js";

export function createBundle(input: unknown, options: BundleOptions = {}): BundleResult {
  return createBundleWithDeps(
    { validatePrintSpec, generateOpenScad, generateCadQuery, generateBrepJs },
    input,
    options,
  );
}

function assertSafe(p: string) {
  if (!p || path.isAbsolute(p) || p.split(/[/]+/).includes(".."))
    throw new Error(`Unsafe bundle path: ${p}`);
}
export function writeBundleToDirectory(
  bundle: BundleResult,
  outputDir: string,
  options: WriteBundleOptions = {},
) {
  if (!bundle.supported) throw new Error(bundle.message ?? "Unsupported bundle");
  if (fs.existsSync(outputDir) && !options.overwrite)
    throw new Error(`Output directory already exists: ${outputDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const f of bundle.files) {
    assertSafe(f.path);
    const dest = path.resolve(outputDir, f.path);
    const root = path.resolve(outputDir);
    if (dest !== root && !dest.startsWith(root + path.sep))
      throw new Error(`Unsafe bundle path: ${f.path}`);
    if (fs.existsSync(dest) && !options.overwrite)
      throw new Error(`Output file already exists: ${dest}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content, "utf8");
  }
}

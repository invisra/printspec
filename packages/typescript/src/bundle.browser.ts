import { validatePrintSpec } from "./validate.browser.js";
import { generateOpenScad } from "./generators/openscad.browser.js";
import { generateCadQuery } from "./generators/cadquery.browser.js";
import { generateBrepJs } from "./generators/brepjs.browser.js";
import { createBundleWithDeps } from "./bundle.core.js";
export type {
  BundleFile,
  BundleWarning,
  BundleResult,
  BundleOptions,
} from "./bundle.core.js";
import type { BundleResult, BundleOptions } from "./bundle.core.js";

export function createBundle(
  input: unknown,
  options: BundleOptions = {},
): BundleResult {
  return createBundleWithDeps(
    { validatePrintSpec, generateOpenScad, generateCadQuery, generateBrepJs },
    input,
    options,
  );
}

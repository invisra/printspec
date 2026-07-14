import type { GeneratorResult, PrintSpec } from "../types.js";
import { validatePrintSpec } from "../validate.js";
import { generateBrepJsWithValidator } from "./brepjs.core.js";
import type { ComposablePartGenerateOptions } from "./brepjs.composable.js";
export type { ComposablePartGenerateOptions } from "./brepjs.composable.js";

export function generateBrepJs(
  spec: PrintSpec,
  options?: ComposablePartGenerateOptions,
): GeneratorResult {
  return generateBrepJsWithValidator(validatePrintSpec, spec, options);
}

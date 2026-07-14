import type { GeneratorResult, PrintSpec } from "../types.js";
import { validatePrintSpec } from "../validate.browser.js";
import { generateCadQueryWithValidator } from "./cadquery.core.js";
import type { ComposablePartGenerateOptions } from "./cadquery.composable.js";

export function generateCadQuery(
  spec: PrintSpec,
  options?: ComposablePartGenerateOptions,
): GeneratorResult {
  return generateCadQueryWithValidator(validatePrintSpec, spec, options);
}

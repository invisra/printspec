import type { GeneratorResult, PrintSpec } from "../types.js";
import { validatePrintSpec } from "../validate.js";
import { generateOpenScadWithValidator } from "./openscad.core.js";

export function generateOpenScad(spec: PrintSpec): GeneratorResult {
  return generateOpenScadWithValidator(validatePrintSpec, spec);
}

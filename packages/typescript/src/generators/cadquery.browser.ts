import type {GeneratorResult, PrintSpec} from '../types.js';
import {validatePrintSpec} from '../validate.browser.js';
import {generateCadQueryWithValidator} from './cadquery.core.js';

export function generateCadQuery(spec: PrintSpec): GeneratorResult {
  return generateCadQueryWithValidator(validatePrintSpec, spec);
}

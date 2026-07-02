import {validatePrintSpec} from './validate.browser.js';
import {createBundleWithValidator} from './bundle.core.js';
export type {BundleFile, BundleWarning, BundleResult, BundleOptions} from './bundle.core.js';
import type {BundleResult, BundleOptions} from './bundle.core.js';

export function createBundle(input: unknown, options: BundleOptions = {}): BundleResult {
  return createBundleWithValidator(validatePrintSpec, input, options);
}

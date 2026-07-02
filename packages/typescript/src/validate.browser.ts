import type {ValidationResult} from './types.js';
import {validateSemantic} from './semantic.js';
import {createAjv, schemas} from './schemas.browser.js';
import {formatAjvErrors} from './schemas.shared.js';

type ValidationOptions = {semantic?: boolean};

type ValidatorName = 'printspec.schema.json' | 'part-family.schema.json' | 'composable-part.schema.json' | 'project.schema.json';

const ajv = createAjv();
const validators = new Map<ValidatorName, any>();

function validatorFor(schemaName: ValidatorName): any {
  const existing = validators.get(schemaName);
  if (existing) return existing;
  const schema = schemas[schemaName];
  if (!schema) throw new Error(`Missing local schema: ${schemaName}`);
  const compiled = ajv.compile(schema);
  validators.set(schemaName, compiled);
  return compiled;
}

function validateWithSchema(schemaName: ValidatorName, value: unknown, semantic = false): ValidationResult {
  const validate = validatorFor(schemaName);
  const ok = validate(value);
  const errors = ok ? [] : formatAjvErrors(validate);
  if (errors.length === 0 && semantic) errors.push(...validateSemantic(value));
  return {valid: errors.length === 0, errors};
}

export function validatePartFamilySpec(part: unknown, _options: ValidationOptions = {}): ValidationResult {
  return validateWithSchema('part-family.schema.json', part, false);
}

export function validateComposablePartSpec(part: unknown, _options: ValidationOptions = {}): ValidationResult {
  return validateWithSchema('composable-part.schema.json', part, false);
}

export function validateProjectSpec(project: unknown, _options: ValidationOptions = {}): ValidationResult {
  return validateWithSchema('project.schema.json', project, false);
}

export function validatePrintSpec(spec: unknown, options: ValidationOptions = {}): ValidationResult {
  return validateWithSchema('printspec.schema.json', spec, options.semantic !== false);
}

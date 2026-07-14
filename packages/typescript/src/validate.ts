import type { ValidationResult } from "./types.js";
import { validateSemantic } from "./semantic.js";
import { createAjv, schemas } from "./schemas.js";
import {
  formatAjvErrors,
  typeToSchemaFile,
  compileRefOnly,
  compilePrintspecNarrowedToPartType,
} from "./schemas.shared.js";

type ValidationOptions = { semantic?: boolean };

type ValidatorName =
  | "printspec.schema.json"
  | "part-family.schema.json"
  | "composable-part.schema.json"
  | "project.schema.json";

const ajv = createAjv();
const validators = new Map<ValidatorName, any>();
const TYPE_TO_SCHEMA_FILE = typeToSchemaFile(schemas);
const narrowedFamilyValidators = new Map<string, any>();
const narrowedPrintspecValidators = new Map<string, any>();

function validatorFor(schemaName: ValidatorName): any {
  const existing = validators.get(schemaName);
  if (existing) return existing;
  const schema = schemas[schemaName];
  if (!schema) throw new Error(`Missing local schema: ${schemaName}`);
  const compiled = ajv.compile(schema);
  validators.set(schemaName, compiled);
  return compiled;
}

function validateWithSchema(
  schemaName: ValidatorName,
  value: unknown,
  semantic = false,
): ValidationResult {
  const validate = validatorFor(schemaName);
  const ok = validate(value);
  const errors = ok ? [] : formatAjvErrors(validate);
  if (errors.length === 0 && semantic) errors.push(...validateSemantic(value));
  return { valid: errors.length === 0, errors };
}

// See typeToSchemaFile()/compileRefOnly() in schemas.shared.ts: narrows
// part-family.schema.json's oneOf-over-13-types down to just the one
// schema file `partType` names, when recognized, instead of the noisy
// every-branch-failed error output the plain oneOf gives for an
// otherwise-recognizable part with some other mistake in it.
function narrowedFamilyValidator(partType: string): any | undefined {
  const cached = narrowedFamilyValidators.get(partType);
  if (cached) return cached;
  const schemaFile = TYPE_TO_SCHEMA_FILE.get(partType);
  if (!schemaFile || schemaFile === "composable-part.schema.json")
    return undefined;
  const compiled = compileRefOnly(ajv, schemaFile);
  narrowedFamilyValidators.set(partType, compiled);
  return compiled;
}

// Same idea as narrowedFamilyValidator() above, but for printspec.schema.json
// as a whole (its `part` property is the oneOf, over both part-family types
// and composable_part).
function narrowedPrintspecValidator(partType: string): any | undefined {
  const cached = narrowedPrintspecValidators.get(partType);
  if (cached) return cached;
  const schemaFile = TYPE_TO_SCHEMA_FILE.get(partType);
  if (!schemaFile) return undefined;
  const compiled = compilePrintspecNarrowedToPartType(
    ajv,
    schemas["printspec.schema.json"],
    schemaFile,
  );
  narrowedPrintspecValidators.set(partType, compiled);
  return compiled;
}

export function validatePartFamilySpec(
  part: unknown,
  _options: ValidationOptions = {},
): ValidationResult {
  const partType = (part as any)?.type;
  if (typeof partType === "string") {
    const narrowed = narrowedFamilyValidator(partType);
    if (narrowed) {
      const ok = narrowed(part);
      return { valid: ok, errors: ok ? [] : formatAjvErrors(narrowed) };
    }
  }
  return validateWithSchema("part-family.schema.json", part, false);
}

export function validateComposablePartSpec(
  part: unknown,
  _options: ValidationOptions = {},
): ValidationResult {
  return validateWithSchema("composable-part.schema.json", part, false);
}

export function validateProjectSpec(
  project: unknown,
  _options: ValidationOptions = {},
): ValidationResult {
  return validateWithSchema("project.schema.json", project, false);
}

export function validatePrintSpec(
  spec: unknown,
  options: ValidationOptions = {},
): ValidationResult {
  const semantic = options.semantic !== false;
  const partType = (spec as any)?.part?.type;
  if (typeof partType === "string") {
    const narrowed = narrowedPrintspecValidator(partType);
    if (narrowed) {
      const ok = narrowed(spec);
      const errors = ok ? [] : formatAjvErrors(narrowed);
      if (errors.length === 0 && semantic)
        errors.push(...validateSemantic(spec));
      return { valid: errors.length === 0, errors };
    }
  }
  return validateWithSchema("printspec.schema.json", spec, semantic);
}

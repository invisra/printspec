import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ValidationResult } from "./types.js";
import { formatAjvErrors } from "./schemas.shared.js";
import {
  partFactsSchema,
  latestPartFactsVersion,
} from "./generated/partfacts.generated.js";

// PartFacts validation is intentionally self-contained: the schema has no
// external `$ref`s to the printspec-document schemas, so it validates against
// its own bundled copy with a dedicated Ajv instance and never touches the
// filesystem or the network. This keeps it isomorphic -- the same code path
// works in Node and in the browser bundle -- and keeps the independently
// versioned PartFacts artifact decoupled from the document schema registry.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(partFactsSchema);

export const partFactsSchemaVersion: string = latestPartFactsVersion;

/**
 * Validate a PartFacts document (the canonical output of executing a printspec
 * on a real CAD kernel) against the bundled PartFacts JSON Schema, offline.
 *
 * Mirrors {@link validatePrintSpec}: returns `{ valid, errors }`, where
 * `errors` is an empty array when the document is structurally valid. There is
 * no semantic layer for PartFacts in 0.1.0.
 */
export function validatePartFacts(facts: unknown): ValidationResult {
  const ok = validate(facts);
  return { valid: !!ok, errors: ok ? [] : formatAjvErrors(validate) };
}

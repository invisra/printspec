import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ValidationResult } from "./types.js";
import { formatAjvErrors } from "./schemas.shared.js";
import {
  partFactsSchemasByVersion,
  partFactsVersions,
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

const validatorsByVersion = new Map<string, ReturnType<typeof ajv.compile>>();
for (const version of partFactsVersions)
  validatorsByVersion.set(
    version,
    ajv.compile(
      partFactsSchemasByVersion[
        version as keyof typeof partFactsSchemasByVersion
      ],
    ),
  );

/** The PartFacts schema versions this package can validate. */
export const supportedPartFactsVersions: readonly string[] = [
  ...partFactsVersions,
];

/** The latest (default) PartFacts schema version bundled in this package. */
export const partFactsSchemaVersion: string = latestPartFactsVersion;

/**
 * Validate a PartFacts document (the canonical output of executing a printspec
 * on a real CAD kernel) against the bundled PartFacts JSON Schema, offline.
 *
 * Mirrors {@link validatePrintSpec}: returns `{ valid, errors }`, where
 * `errors` is an empty array when the document is structurally valid. There is
 * no semantic layer for PartFacts in 0.1.0.
 *
 * The document's `partfactsVersion` is read from the raw object and dispatched
 * to the matching bundled schema BEFORE validation, so an unsupported version
 * yields a clear "unsupported PartFacts version" error instead of a confusing
 * `const` mismatch buried in the structural errors. A document with no
 * `partfactsVersion` is validated against the latest schema, which reports the
 * missing required field.
 */
export function validatePartFacts(facts: unknown): ValidationResult {
  const declared =
    facts && typeof facts === "object"
      ? (facts as { partfactsVersion?: unknown }).partfactsVersion
      : undefined;
  if (typeof declared === "string" && !validatorsByVersion.has(declared)) {
    return {
      valid: false,
      errors: [
        `/partfactsVersion: unsupported PartFacts version "${declared}" (supported: ${supportedPartFactsVersions.join(", ")})`,
      ],
    };
  }
  const validate =
    typeof declared === "string" && validatorsByVersion.has(declared)
      ? validatorsByVersion.get(declared)!
      : validatorsByVersion.get(latestPartFactsVersion)!;
  const ok = validate(facts);
  return { valid: !!ok, errors: ok ? [] : formatAjvErrors(validate) };
}

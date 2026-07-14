import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaBaseUri = "https://schemas.invisra.ai/printspec/0.2.0/";

export function createAjvFromSchemas(schemas: Record<string, any>): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false, loadSchema: undefined });
  addFormats(ajv);
  const registered = new Set<string>();
  for (const [filename, schema] of Object.entries(schemas)) {
    const primaryId = schema.$id ?? `${schemaBaseUri}${filename}`;
    ajv.addSchema(schema, primaryId);
    registered.add(primaryId);
  }
  for (const [filename, schema] of Object.entries(schemas)) {
    const aliasSchema = { ...schema };
    delete aliasSchema.$id;
    for (const alias of [filename, `${schemaBaseUri}${filename}`]) {
      if (!registered.has(alias)) {
        ajv.addSchema(aliasSchema, alias);
        registered.add(alias);
      }
    }
  }
  return ajv;
}

function formatPath(instancePath: string | undefined): string {
  return instancePath && instancePath.length > 0 ? instancePath : "/";
}

export function formatAjvErrors(validate: any): string[] {
  return (validate.errors ?? []).map((error: any) => {
    const keyword = error.keyword ? ` [${error.keyword}]` : "";
    const message = error.message ?? "failed schema validation";
    return `${formatPath(error.instancePath)}: ${message}${keyword}`;
  });
}

// Maps a discriminated part `type` value (for example "composable_part" or
// "rounded_rectangular_plate") to the schema file that defines it. Every
// part-family schema and composable-part.schema.json each declare a literal
// `properties.type.const`, so this is built once from the same schema set
// createAjvFromSchemas() already registers -- excluding project.schema.json,
// whose own `type: "project"` const belongs to a different field (the
// top-level `project`, not `part`) and would otherwise misleadingly match a
// `part.type` of "project".
export function typeToSchemaFile(schemas: Record<string, any>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [filename, schema] of Object.entries(schemas)) {
    if (filename === "project.schema.json") continue;
    const typeConst = schema?.properties?.type?.const;
    if (typeof typeConst === "string") map.set(typeConst, filename);
  }
  return map;
}

// Compiles a pass-through `{ $ref: schemaFile }` schema, so validating
// against it is equivalent to validating directly against schemaFile's own
// rules. Used to narrow part-family.schema.json's oneOf-over-13-types (and,
// via compilePrintspecNarrowedToPartType below, printspec.schema.json's
// oneOf over those same 13 plus composable_part) down to the one branch an
// input's own `type` field actually names: ajv's oneOf reports errors for
// *every* failed branch when none match, which for an input with a
// recognizable `type` but some other mistake elsewhere means dozens of
// irrelevant "doesn't match spacer_block"/"doesn't match cable_clip"/etc.
// errors burying the one relevant one. schemaFile must already be
// registered in `ajv` (createAjvFromSchemas() registers every schema under
// both its bare filename and full $id).
export function compileRefOnly(ajv: any, schemaFile: string): any {
  return ajv.compile({ $ref: schemaFile });
}

// Compiles a variant of printspec.schema.json with its `properties.part`
// (normally `oneOf` over every part-family type plus composable_part)
// replaced by a direct `$ref` to just the one schema file matching a known
// `part.type` -- see compileRefOnly() above for why. Every other check in
// printspecSchema (printspecVersion/units consts, the project/part
// top-level oneOf, additionalProperties, and so on) still applies
// unchanged, since only the `part` property's own schema is swapped.
export function compilePrintspecNarrowedToPartType(
  ajv: any,
  printspecSchema: any,
  schemaFile: string,
): any {
  const variant: any = {
    ...printspecSchema,
    properties: { ...printspecSchema.properties, part: { $ref: schemaFile } },
  };
  delete variant.$id;
  return ajv.compile(variant);
}

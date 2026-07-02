import {Ajv2020} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schemaBaseUri = 'https://schemas.invisra.ai/printspec/0.1.0/';

export function createAjvFromSchemas(schemas: Record<string, any>): Ajv2020 {
  const ajv = new Ajv2020({allErrors: true, strict: false, loadSchema: undefined});
  addFormats(ajv);
  const registered = new Set<string>();
  for (const [filename, schema] of Object.entries(schemas)) {
    const primaryId = schema.$id ?? `${schemaBaseUri}${filename}`;
    ajv.addSchema(schema, primaryId);
    registered.add(primaryId);
  }
  for (const [filename, schema] of Object.entries(schemas)) {
    const aliasSchema = {...schema};
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
  return instancePath && instancePath.length > 0 ? instancePath : '/';
}

export function formatAjvErrors(validate: any): string[] {
  return (validate.errors ?? []).map((error: any) => {
    const keyword = error.keyword ? ` [${error.keyword}]` : '';
    const message = error.message ?? 'failed schema validation';
    return `${formatPath(error.instancePath)}: ${message}${keyword}`;
  });
}

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const schemaBaseUri = 'https://schemas.invisra.com/printspec/0.1.0/';

function findSchemaDir(): string {
  // Source checkouts compile to packages/typescript/dist; walk upward to the
  // repository-level schemas directory so validation stays fully offline.
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'schemas');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
  }
  throw new Error('Unable to locate local printspec schemas directory');
}

export const schemaDir = findSchemaDir();
export const schemaFiles = fs.readdirSync(schemaDir).filter((f: string) => f.endsWith('.schema.json')).sort();

export function loadSchemas(): Record<string, any> {
  return Object.fromEntries(schemaFiles.map((file: string) => [file, JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'))]));
}

export const schemas = loadSchemas();

export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({allErrors: true, strict: false, loadSchema: undefined});
  addFormats(ajv);
  for (const [filename, schema] of Object.entries(schemas)) {
    ajv.addSchema(schema, filename);
    ajv.addSchema(schema, `${schemaBaseUri}${filename}`);
    if (schema.$id) ajv.addSchema(schema, schema.$id);
  }
  return ajv;
}

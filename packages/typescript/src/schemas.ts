import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Ajv2020} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schemaBaseUri = 'https://schemas.invisra.ai/printspec/0.1.0/';

function isDirectory(candidate: string): boolean {
  return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
}

function findSchemaDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageLocalCandidate = path.resolve(moduleDir, '..', 'schemas');
  if (isDirectory(packageLocalCandidate)) return packageLocalCandidate;

  // Source checkout fallback: walk upward to the repository-level schemas
  // directory so development builds can still validate fully offline.
  for (let dir = moduleDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'schemas');
    if (isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
  }
  throw new Error('Unable to locate bundled printspec schemas. Run npm run sync:schemas before building, or reinstall the package.');
}

export const schemaDir = findSchemaDir();
export const schemaFiles = fs.readdirSync(schemaDir).filter((f: string) => f.endsWith('.schema.json')).sort();

export function loadSchemas(): Record<string, any> {
  const files = fs.readdirSync(schemaDir).filter((f: string) => f.endsWith('.schema.json')).sort();
  return Object.fromEntries(files.map((file: string) => [file, JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'))]));
}

export const schemas = loadSchemas();

export function createAjv(): Ajv2020 {
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

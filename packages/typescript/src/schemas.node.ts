import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAjvFromSchemas} from './schemas.shared.js';

function isDirectory(candidate: string): boolean {
  return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
}

function findSchemaDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageLocalCandidate = path.resolve(moduleDir, '..', 'schemas');
  if (isDirectory(packageLocalCandidate)) return packageLocalCandidate;

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
  return Object.fromEntries(schemaFiles.map((file: string) => [file, JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'))]));
}

export const schemas = loadSchemas();
export function createAjv() { return createAjvFromSchemas(schemas); }

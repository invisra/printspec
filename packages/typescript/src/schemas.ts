import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const schemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../schemas');
export const schemaFiles = (fs.readdirSync(schemaDir) as string[]).filter((f: string) => f.endsWith('.schema.json')).sort();
export function loadSchemas(): any[] { return schemaFiles.map((f: string) => JSON.parse(fs.readFileSync(path.join(schemaDir, f), 'utf8'))); }
export const schemas = Object.fromEntries(schemaFiles.map((f: string, i: number) => [f, loadSchemas()[i]]));
export async function createAjvAsync(): Promise<any> { const Ajv=(await import('ajv')).default; const addFormats=(await import('ajv-formats')).default; const ajv=new Ajv({allErrors:true,strict:false}); addFormats(ajv); for(const schema of loadSchemas()) ajv.addSchema(schema, path.basename(schema.$id ?? '')); return ajv; }
export function createAjv(): any { throw new Error('Ajv is loaded lazily by validatePrintSpec when installed.'); }

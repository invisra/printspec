import {copyFileSync, mkdirSync, readdirSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_SCHEMA_DIR = 'schemas';
const PUBLIC_SCHEMA_DIR = 'public/printspec/0.1.0';
const PYTHON_SCHEMA_DIR = 'packages/python/printspec/schemas';

const sourceDir = path.join(root, SOURCE_SCHEMA_DIR);
const destinations = [PUBLIC_SCHEMA_DIR, PYTHON_SCHEMA_DIR];

const files = readdirSync(sourceDir)
  .filter((file) => file.endsWith('.schema.json'))
  .sort((a, b) => a.localeCompare(b));

for (const destination of destinations) {
  const destinationDir = path.join(root, destination);
  mkdirSync(destinationDir, {recursive: true});

  for (const existing of readdirSync(destinationDir)) {
    const targetPath = path.join(destinationDir, existing);
    if (existing.endsWith('.schema.json') && statSync(targetPath).isFile()) {
      rmSync(targetPath);
    }
  }

  for (const file of files) {
    copyFileSync(path.join(sourceDir, file), path.join(destinationDir, file));
  }
}

console.log(`Synced ${files.length} schema files`);
console.log(`Public destination: ${PUBLIC_SCHEMA_DIR}`);
console.log(`Python package destination: ${PYTHON_SCHEMA_DIR}`);

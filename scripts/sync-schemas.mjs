import {copyFileSync, mkdirSync, readdirSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'schemas');
const targetDir = path.join(root, 'public', 'printspec', '0.1.0');

const files = readdirSync(sourceDir)
  .filter((file) => file.endsWith('.schema.json'))
  .sort();

mkdirSync(targetDir, {recursive: true});

for (const existing of readdirSync(targetDir)) {
  const targetPath = path.join(targetDir, existing);
  if (existing.endsWith('.schema.json') && statSync(targetPath).isFile()) {
    rmSync(targetPath);
  }
}

for (const file of files) {
  copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
}

console.log(`Synced ${files.length} schema files to ${path.relative(root, targetDir)}`);

#!/usr/bin/env node
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'packages/typescript/dist');
const start = path.join(dist, 'browser.js');
const bannedText = ['node:fs', 'node:path', 'node:url'];
const bannedRelativeSpecifiers = new Set(['./schemas.js', './schemas.node.js', './validate.js', './bundle.js']);
const importExportRe = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

if (!existsSync(start)) {
  console.error(`Browser import graph smoke test requires built file: ${path.relative(root, start)}`);
  process.exit(1);
}

const seen = new Set();
const failures = [];

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function visit(file) {
  const resolved = path.resolve(file);
  if (seen.has(resolved)) return;
  seen.add(resolved);
  const source = readFileSync(resolved, 'utf8');
  for (const text of bannedText) {
    if (source.includes(text)) failures.push(`${rel(resolved)} contains banned text ${text}`);
  }
  for (const match of source.matchAll(importExportRe)) {
    const spec = match[1] ?? match[2];
    if (!spec?.startsWith('.')) continue;
    if (bannedRelativeSpecifiers.has(spec)) {
      failures.push(`${rel(resolved)} imports banned browser specifier ${spec}`);
    }
    const target = path.resolve(path.dirname(resolved), spec);
    const candidates = path.extname(target) ? [target] : [`${target}.js`, path.join(target, 'index.js')];
    const next = candidates.find((candidate) => existsSync(candidate));
    if (!next) failures.push(`${rel(resolved)} imports missing relative specifier ${spec}`);
    else visit(next);
  }
}

visit(start);

if (failures.length > 0) {
  console.error('Browser import graph smoke test failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('\nBrowser-reachable files:');
  for (const file of [...seen].sort()) console.error(`- ${rel(file)}`);
  process.exit(1);
}

console.log(`Browser import graph smoke test passed (${seen.size} files checked).`);

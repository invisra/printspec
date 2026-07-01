#!/usr/bin/env node
import {spawnSync} from 'node:child_process';

const steps = [
  ['npm', ['run', 'sync:schemas']],
  ['npm', ['run', 'check:versions']],
  ['npm', ['run', 'build']],
  ['npm', ['test']],
  ['npm', ['--workspace', '@invisra/printspec', 'pack', '--dry-run']],
  ['npm', ['run', 'smoke:npm']],
];
for (const [cmd, args] of steps) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {stdio: 'inherit', shell: process.platform === 'win32'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}

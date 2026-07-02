import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeDir = mkdtempSync(path.join(tmpdir(), 'printspec-npm-smoke-'));

function run(command, args, options = {}) {
  execFileSync(command, args, {stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], ...options});
}

try {
  const packOutput = execFileSync('npm', ['--workspace', '@invisra/printspec', 'pack', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  const [{filename}] = JSON.parse(packOutput);
  const tarball = path.join(root, filename);

  writeFileSync(
    path.join(smokeDir, 'package.json'),
    JSON.stringify({type: 'module', private: true}, null, 2),
  );
  run('npm', ['install', '--no-save', tarball], {cwd: smokeDir});
  rmSync(tarball, {force: true});

  for (const dependency of ['ajv', 'ajv-formats']) {
    if (!existsSync(path.join(smokeDir, 'node_modules', dependency, 'package.json'))) {
      throw new Error(`Installed package is missing runtime dependency ${dependency}`);
    }
  }

  const specSource = `const spec = {\n  printspecVersion: "0.1.0",\n  units: "mm",\n  part: {\n    type: "round_spacer",\n    label: "Smoke test spacer",\n    parameters: {\n      outerDiameter: 12,\n      innerDiameter: 4,\n      height: 8\n    }\n  }\n};`;

  run('node', ['--input-type=module', '-'], {
    cwd: smokeDir,
    input: `import { validatePrintSpec } from "@invisra/printspec";\n\n${specSource}\n\nconst result = validatePrintSpec(spec);\nif (!result.valid) {\n  console.error(result);\n  process.exit(1);\n}\nconsole.log("NPM package root import validation smoke test passed");\n`,
  });

  run('node', ['--input-type=module', '-'], {
    cwd: smokeDir,
    input: `import { validatePrintSpec, createBundle } from "@invisra/printspec/browser";\n\n${specSource}\n\nconst result = validatePrintSpec(spec);\nif (!result.valid) {\n  console.error(result);\n  process.exit(1);\n}\nconst bundle = createBundle(spec);\nif (!bundle.supported) {\n  console.error(bundle);\n  process.exit(1);\n}\nconsole.log("NPM package browser import validation and bundle smoke test passed");\n`,
  });

  run('npx', ['printspec', '--version'], {cwd: smokeDir});
} finally {
  rmSync(smokeDir, {recursive: true, force: true});
}

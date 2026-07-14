#!/usr/bin/env node
import { rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "package/dist/index.js",
  "package/dist/index.d.ts",
  "package/dist/browser.js",
  "package/dist/browser.d.ts",
  "package/dist/preview/index.js",
  "package/dist/preview/index.d.ts",
  "package/dist/three.js",
  "package/dist/three.d.ts",
  "package/dist/bundle.browser.js",
  "package/dist/generators/openscad.browser.js",
  "package/dist/generators/cadquery.browser.js",
  "package/dist/cli.js",
  "package/package.json",
  "package/README.md",
  "package/schemas/printspec.schema.json",
  "package/schemas/common.schema.json",
  "package/schemas/wall-mount-bracket.schema.json",
  "package/schemas/drawer-divider.schema.json",
  "package/schemas/project-enclosure-tray.schema.json",
];

const result = spawnSync(
  "npm",
  ["--workspace", "@invisra/printspec", "pack", "--json"],
  {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  },
);

if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

let metadata;
try {
  metadata = JSON.parse(result.stdout);
} catch (error) {
  console.error("Failed to parse npm pack --json output.");
  console.error(error);
  process.exit(1);
}

const [pack] = metadata;
const tarball = pack?.filename ? path.join(root, pack.filename) : undefined;
try {
  const paths = new Set(
    (pack?.files ?? []).map((file) => {
      const filePath = file.path ?? file;
      return filePath.startsWith("package/") ? filePath : `package/${filePath}`;
    }),
  );

  const missing = requiredFiles.filter((file) => !paths.has(file));
  if (missing.length > 0) {
    console.error("npm package contents check failed. Missing required files:");
    for (const file of missing) console.error(`- ${file}`);
    console.error("\nFiles included in the generated package:");
    for (const file of [...paths].sort()) console.error(`- ${file}`);
    process.exitCode = 1;
  } else {
    console.log(
      "npm package contents check passed. Required files are present:",
    );
    for (const file of requiredFiles) console.log(`- ${file}`);
  }
} finally {
  if (tarball) rmSync(tarball, { force: true });
}

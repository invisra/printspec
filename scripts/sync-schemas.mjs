import {copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_NAME = 'printspec';
const PROJECT_DESCRIPTION = 'JSON Schemas for practical parametric 3D-printable parts.';
const PROJECT_REPO_URL = 'https://github.com/invisra/printspec';
const SOURCE_SCHEMA_DIR = 'schemas';
const PYTHON_SCHEMA_DIR = 'packages/python/printspec/schemas';
const TYPESCRIPT_SCHEMA_DIR = 'packages/typescript/schemas';
const ENABLE_VERCEL_ANALYTICS = process.env.ENABLE_VERCEL_ANALYTICS === '1';

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const SCHEMA_VERSION = packageJson.version;
const PUBLIC_PROJECT_DIR = `public/${PROJECT_NAME}`;
const PUBLIC_SCHEMA_DIR = `${PUBLIC_PROJECT_DIR}/${SCHEMA_VERSION}`;
const sourceDir = path.join(root, SOURCE_SCHEMA_DIR);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function schemaSort(a, b) {
  if (a === 'printspec.schema.json') return -1;
  if (b === 'printspec.schema.json') return 1;
  return a.localeCompare(b);
}

function analyticsSnippet() {
  if (!ENABLE_VERCEL_ANALYTICS) return '';
  return `\n<script>\n  window.va =\n    window.va ||\n    function () {\n      (window.vaq = window.vaq || []).push(arguments);\n    };\n</script>\n<script defer src="/_vercel/insights/script.js"></script>`;
}

function page(title, body) {
  return `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${escapeHtml(title)}</title>\n  <style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;max-width:960px;margin:0 auto;padding:2rem;color:#172033}a{color:#2454d6}code{background:#f2f4f8;padding:.1rem .25rem;border-radius:.25rem}.muted{color:#5f6b7a}.schema{border-top:1px solid #d9dee7;padding:1rem 0}footer{margin-top:3rem;font-size:.9rem;color:#5f6b7a}</style>${analyticsSnippet()}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

function validateSchemaIdVersion(file, schema) {
  if (!schema.$id) return;
  const match = schema.$id.match(new RegExp(`/${PROJECT_NAME}/([^/]+)/`));
  if (match && match[1] !== SCHEMA_VERSION) {
    throw new Error(`${file} has $id version ${match[1]}, but package.json version is ${SCHEMA_VERSION}`);
  }
}

const files = readdirSync(sourceDir)
  .filter((file) => file.endsWith('.schema.json'))
  .sort(schemaSort);
const schemas = files.map((file) => {
  const schema = readJson(path.join(sourceDir, file));
  validateSchemaIdVersion(file, schema);
  return {file, schema};
});

for (const destination of [PUBLIC_SCHEMA_DIR, PYTHON_SCHEMA_DIR, TYPESCRIPT_SCHEMA_DIR]) {
  const destinationDir = path.join(root, destination);
  mkdirSync(destinationDir, {recursive: true});

  for (const existing of readdirSync(destinationDir)) {
    const targetPath = path.join(destinationDir, existing);
    if (existing.endsWith('.schema.json') && statSync(targetPath).isFile()) rmSync(targetPath);
  }

  for (const {file} of schemas) copyFileSync(path.join(sourceDir, file), path.join(destinationDir, file));
}

const publicProjectPath = path.join(root, PUBLIC_PROJECT_DIR);
const publicVersionPath = path.join(root, PUBLIC_SCHEMA_DIR);
mkdirSync(publicProjectPath, {recursive: true});
mkdirSync(publicVersionPath, {recursive: true});

const versions = readdirSync(publicProjectPath)
  .filter((entry) => statSync(path.join(publicProjectPath, entry)).isDirectory())
  .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

writeJson(path.join(publicProjectPath, 'manifest.json'), {
  project: PROJECT_NAME,
  description: PROJECT_DESCRIPTION,
  versions: versions.map((version) => ({
    version,
    url: `/${PROJECT_NAME}/${version}/`,
    manifest: `/${PROJECT_NAME}/${version}/manifest.json`,
  })),
});

const schemaManifest = {
  project: PROJECT_NAME,
  version: SCHEMA_VERSION,
  schemas: schemas.map(({file, schema}) => ({
    filename: file,
    url: `/${PROJECT_NAME}/${SCHEMA_VERSION}/${file}`,
    id: schema.$id,
    title: schema.title,
    description: schema.description,
  })),
};
writeJson(path.join(publicVersionPath, 'manifest.json'), schemaManifest);

writeFileSync(path.join(root, 'public/index.html'), page('Invisra Schemas', `<main>\n  <h1>Invisra Schemas</h1>\n  <p>Public JSON Schemas for Invisra open-source projects.</p>\n  <ul>\n    <li><a href="/${PROJECT_NAME}/">${PROJECT_NAME} schemas</a></li>\n    <li><a href="https://invisra.ai">Invisra website</a></li>\n  </ul>\n</main>\n<footer>Schemas are provided for public reference. Validators should resolve bundled schemas offline where possible.</footer>`));

writeFileSync(path.join(publicProjectPath, 'index.html'), page(`${PROJECT_NAME} Schemas`, `<main>\n  <h1>${PROJECT_NAME} Schemas</h1>\n  <p>${PROJECT_DESCRIPTION}</p>\n  <p>Schemas include browser-editor metadata where available so tools can build parameter forms from bundled schemas.</p>\n  <h2>Versions</h2>\n  <ul>\n${versions.map((version) => `    <li><a href="/${PROJECT_NAME}/${version}/">${version}</a></li>`).join('\n')}\n  </ul>\n  <p><a href="/${PROJECT_NAME}/manifest.json">Project manifest</a></p>\n  <p><a href="${PROJECT_REPO_URL}">GitHub repository</a></p>\n</main>`));

writeFileSync(path.join(publicVersionPath, 'index.html'), page(`${PROJECT_NAME} ${SCHEMA_VERSION} Schemas`, `<main>\n  <h1>${PROJECT_NAME} ${SCHEMA_VERSION} Schemas</h1>\n  <p>Versioned JSON Schemas for ${PROJECT_NAME} ${SCHEMA_VERSION}.</p>\n  <p><a href="/${PROJECT_NAME}/">Back to ${PROJECT_NAME}</a> · <a href="/${PROJECT_NAME}/${SCHEMA_VERSION}/manifest.json">Version manifest</a></p>\n  <h2>Schema files</h2>\n${schemaManifest.schemas.map((schema) => `  <section class="schema">\n    <h3><a href="${escapeHtml(schema.filename)}">${escapeHtml(schema.filename)}</a></h3>\n    ${schema.title ? `<p><strong>${escapeHtml(schema.title)}</strong></p>` : ''}\n    ${schema.description ? `<p>${escapeHtml(schema.description)}</p>` : ''}\n    ${schema.id ? `<p class="muted"><code>${escapeHtml(schema.id)}</code></p>` : ''}\n  </section>`).join('\n')}\n</main>`));

console.log(`Synced ${files.length} schema files`);
console.log(`Public destination: ${PUBLIC_SCHEMA_DIR}`);
console.log(`Python package destination: ${PYTHON_SCHEMA_DIR}`);
console.log(`TypeScript package destination: ${TYPESCRIPT_SCHEMA_DIR}`);
console.log(`Generated static schema indexes and manifests for ${PROJECT_NAME} ${SCHEMA_VERSION}`);

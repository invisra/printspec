// Shared project constants used by scripts/sync-schemas.mjs and
// scripts/build-docs-site.mjs so both build the same site under the same
// paths/version without duplicating (and risking drift on) these values.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PROJECT_NAME = "printspec";
export const PROJECT_DESCRIPTION = "JSON Schemas for practical parametric 3D-printable parts.";
export const PROJECT_REPO_URL = "https://github.com/invisra/printspec";

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
export const SCHEMA_VERSION = packageJson.version;

export const PUBLIC_PROJECT_DIR = `public/${PROJECT_NAME}`;
export const PUBLIC_SCHEMA_DIR = `${PUBLIC_PROJECT_DIR}/${SCHEMA_VERSION}`;
export const PUBLIC_DOCS_DIR = `${PUBLIC_SCHEMA_DIR}/docs`;

#!/usr/bin/env node
// Renders the repository's own docs/*.md (plus README/CHANGELOG/CONTRIBUTING/
// CODE_OF_CONDUCT/SECURITY and the release notes under docs/releases/) into a
// static HTML docs site under public/printspec/<version>/docs/, using the
// same page chrome as the schema site (scripts/lib/site-template.mjs) so the
// two feel like one site. Also publishes llms.txt (verbatim, NOT rendered to
// HTML -- it's meant to be fetched as plain text by AI agents per the
// llmstxt.org convention) at both the site root and the versioned docs dir.
//
// Run via `npm run build:docs-site` (bundled into `npm run build:schema-site`
// alongside scripts/sync-schemas.mjs and scripts/build-schema-validator.mjs).

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { marked } from "marked";
import {
  root,
  SCHEMA_VERSION,
  PUBLIC_SCHEMA_DIR,
  PUBLIC_DOCS_DIR,
} from "./lib/project-info.mjs";
import { escapeHtml, page } from "./lib/site-template.mjs";

// Each entry: source path (relative to repo root), output slug (becomes
// <slug>.html), and a category used to group the docs index page.
const DOC_SOURCES = [
  {
    src: "docs/getting-started.md",
    slug: "getting-started",
    category: "Start here",
  },
  {
    src: "docs/composable-parts.md",
    slug: "composable-parts",
    category: "Start here",
  },
  { src: "docs/generators.md", slug: "generators", category: "Start here" },
  {
    src: "docs/part-families.md",
    slug: "part-families",
    category: "Start here",
  },

  { src: "docs/validation.md", slug: "validation", category: "Reference" },
  {
    src: "docs/form-metadata.md",
    slug: "form-metadata",
    category: "Reference",
  },
  {
    src: "docs/units-and-coordinates.md",
    slug: "units-and-coordinates",
    category: "Reference",
  },
  { src: "docs/bundles.md", slug: "bundles", category: "Reference" },
  {
    src: "docs/projects-and-assemblies.md",
    slug: "projects-and-assemblies",
    category: "Reference",
  },
  {
    src: "docs/supplier-hardware.md",
    slug: "supplier-hardware",
    category: "Reference",
  },
  {
    src: "docs/browser-editors.md",
    slug: "browser-editors",
    category: "Reference",
  },
  {
    src: "docs/hosted-schemas.md",
    slug: "hosted-schemas",
    category: "Reference",
  },
  {
    src: "docs/partcad-compatibility.md",
    slug: "partcad-compatibility",
    category: "Reference",
  },
  { src: "docs/safety.md", slug: "safety", category: "Reference" },

  {
    src: "docs/design-principles.md",
    slug: "design-principles",
    category: "Project",
  },
  { src: "docs/roadmap.md", slug: "roadmap", category: "Project" },
  {
    src: "docs/release-process.md",
    slug: "release-process",
    category: "Project",
  },
  {
    src: "docs/v0.1.0-release-checklist.md",
    slug: "v0.1.0-release-checklist",
    category: "Project",
  },
  {
    src: "docs/releases/v0.1.0.md",
    slug: "release-notes-v0.1.0",
    category: "Project",
  },

  { src: "README.md", slug: "readme", category: "Repository" },
  { src: "CHANGELOG.md", slug: "changelog", category: "Repository" },
  { src: "CONTRIBUTING.md", slug: "contributing", category: "Repository" },
  {
    src: "CODE_OF_CONDUCT.md",
    slug: "code-of-conduct",
    category: "Repository",
  },
  { src: "SECURITY.md", slug: "security", category: "Repository" },
];

const slugByBasename = new Map(
  DOC_SOURCES.map(({ src, slug }) => [path.basename(src), slug]),
);

// Rewrites relative `*.md` links (however prefixed: `foo.md`, `./foo.md`,
// `docs/foo.md`) that point at another file in DOC_SOURCES into the flat
// `<slug>.html` layout every rendered doc page actually lives in. External
// links (http(s)/mailto) and `.md` links with no matching DOC_SOURCES entry
// are left untouched.
function rewriteMarkdownLinks(markdown) {
  return markdown.replace(/\]\(([^)\s]+)\)/g, (whole, href) => {
    if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(href)) return whole; // scheme-prefixed (http:, mailto:, etc.)
    const hashIndex = href.indexOf("#");
    const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
    const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
    if (!pathPart.endsWith(".md")) return whole;
    const slug = slugByBasename.get(path.basename(pathPart));
    return slug ? `](${slug}.html${hash})` : whole;
  });
}

function cleanInline(text) {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function extractTitle(markdown, fallback) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function extractDescription(markdown) {
  const lines = markdown.replace(/^#[^\n]*\n/, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i].trim();
    i++;
    if (!raw || raw.startsWith("#") || /^\|/.test(raw) || /^-{3,}$/.test(raw))
      continue;
    if (raw.startsWith("```")) {
      while (i < lines.length && !lines[i].trim().startsWith("```")) i++;
      i++;
      continue;
    }
    const isListItem = /^(?:[-*]|\d+\.)\s+/.test(raw);
    let text = cleanInline(
      raw.replace(/^>\s*/, "").replace(/^(?:[-*]|\d+\.)\s+/, ""),
    );
    if (/^\w+:?$/.test(text)) continue; // bare section label, e.g. "Feature:"
    if (!isListItem) {
      while (i < lines.length) {
        const next = lines[i].trim();
        if (
          !next ||
          next.startsWith("#") ||
          /^(?:[-*]|\d+\.)\s+/.test(next) ||
          next.startsWith("```")
        )
          break;
        text += ` ${cleanInline(next)}`;
        i++;
      }
    }
    return text.length > 220 ? `${text.slice(0, 217)}...` : text;
  }
  return "";
}

// Assigns a stable `id` to every rendered heading (slugified from its text)
// so doc pages support deep links, even though no current cross-doc link
// relies on one yet.
function addHeadingIds(html) {
  const seen = new Set();
  return html.replace(/<(h[1-6])>([\s\S]*?)<\/\1>/g, (whole, tag, inner) => {
    const plain = inner.replace(/<[^>]+>/g, "").toLowerCase();
    const base =
      plain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
    let id = base;
    let n = 2;
    while (seen.has(id)) id = `${base}-${n++}`;
    seen.add(id);
    return `<${tag} id="${id}">${inner}</${tag}>`;
  });
}

const publicDocsPath = path.join(root, PUBLIC_DOCS_DIR);
mkdirSync(publicDocsPath, { recursive: true });
for (const existing of readdirSync(publicDocsPath)) {
  const targetPath = path.join(publicDocsPath, existing);
  if (existing.endsWith(".html") && statSync(targetPath).isFile())
    rmSync(targetPath);
}

const rendered = DOC_SOURCES.map(({ src, slug, category }) => {
  const markdown = readFileSync(path.join(root, src), "utf8");
  const title = extractTitle(markdown, slug);
  const description = extractDescription(markdown);
  const bodyHtml = addHeadingIds(marked.parse(rewriteMarkdownLinks(markdown)));
  return { src, slug, category, title, description, bodyHtml };
});

for (const doc of rendered) {
  writeFileSync(
    path.join(publicDocsPath, `${doc.slug}.html`),
    page(
      `${doc.title} | printspec docs`,
      `<main class="invisra-shell">
  <section class="invisra-container">
    <p class="link-row"><a href="./">&larr; All docs</a><a href="https://github.com/invisra/printspec/blob/main/${doc.src}">View source on GitHub</a></p>
    <article class="invisra-card doc-body">
${doc.bodyHtml}
    </article>
  </section>
</main>`,
    ),
  );
}

const categories = ["Start here", "Reference", "Project", "Repository"];
writeFileSync(
  path.join(publicDocsPath, "index.html"),
  page(
    `printspec ${SCHEMA_VERSION} docs | Invisra`,
    `<main class="invisra-shell">
  <section class="invisra-container invisra-card hero-card">
    <span class="invisra-badge">Documentation</span>
    <h1>printspec docs</h1>
    <p class="invisra-text-muted lede">Guides, generator notes, and the full API reference, rendered from the repository's own docs.</p>
    <div class="hero-actions"><a class="invisra-button invisra-button-secondary" href="../">Back to printspec</a></div>
  </section>
  <section class="invisra-container invisra-card hero-card">
    <span class="invisra-badge">For AI agents</span>
    <h2>llms.txt</h2>
    <p class="invisra-text-muted">A dense, agent-oriented summary of the <code class="invisra-code">composable_part</code> schema, generators, and known hazards -- follows the <a href="https://llmstxt.org">llms.txt</a> convention so coding agents can fetch it directly as plain text instead of parsing HTML.</p>
    <div class="hero-actions"><a class="invisra-button invisra-button-primary" href="/llms.txt">Open /llms.txt</a></div>
  </section>
${categories
  .map((category) => {
    const docs = rendered.filter((doc) => doc.category === category);
    return `  <section class="invisra-container">
    <h2>${escapeHtml(category)}</h2>
    <ul class="doc-index-list">
${docs
  .map(
    (doc) =>
      `      <li><a href="${doc.slug}.html">${escapeHtml(doc.title)}</a>${doc.description ? ` &mdash; <span class="invisra-text-muted">${escapeHtml(doc.description)}</span>` : ""}</li>`,
  )
  .join("\n")}
    </ul>
  </section>`;
  })
  .join("\n")}
</main>`,
  ),
);

const llmsTxtSource = readFileSync(path.join(root, "llms.txt"), "utf8");
writeFileSync(path.join(root, "public/llms.txt"), llmsTxtSource);
writeFileSync(path.join(root, PUBLIC_SCHEMA_DIR, "llms.txt"), llmsTxtSource);

console.log(`Rendered ${rendered.length} doc page(s) to ${PUBLIC_DOCS_DIR}`);
console.log(
  `Published llms.txt at public/llms.txt and ${PUBLIC_SCHEMA_DIR}/llms.txt`,
);

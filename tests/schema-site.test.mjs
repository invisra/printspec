import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const docsDir = "public/printspec/0.2.0/docs";
const docPages = readdirSync(docsDir)
  .filter((f) => f.endsWith(".html"))
  .map((f) => path.join(docsDir, f));

const pages = [
  "public/index.html",
  "public/printspec/index.html",
  "public/printspec/0.2.0/index.html",
  "public/404.html",
  ...docPages,
];

test("schema site pages include pinned Invisra brand assets and dark theme", () => {
  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    assert.match(html, /https:\/\/assets\.invisra\.ai\/brand\/v1\/brand\.min\.css/, page);
    assert.match(html, /https:\/\/assets\.invisra\.ai\/brand\/v1\/favicon\.svg/, page);
    assert.match(html, /data-theme="dark"/, page);
    assert.match(html, /Invisra/, page);
    assert.match(html, /printspec/, page);
    assert.match(html, /html\[data-theme=light\] body\.invisra-theme/, page);
    assert.match(
      html,
      /html\[data-theme=light\] \.invisra-shell,html\[data-theme=light\] footer/,
      page,
    );
  }
});

test("docs site has a non-trivial set of rendered doc pages", () => {
  // 18 docs/*.md + docs/releases/v0.1.0.md + README/CHANGELOG/CONTRIBUTING/
  // CODE_OF_CONDUCT/SECURITY + index.html itself.
  assert.ok(docPages.length >= 20, `expected at least 20 doc pages, found ${docPages.length}`);
  assert.ok(docPages.includes(path.join(docsDir, "index.html")));
  assert.ok(docPages.includes(path.join(docsDir, "generators.html")));
  assert.ok(docPages.includes(path.join(docsDir, "composable-parts.html")));
});

test("docs pages have no leftover relative .md links and no broken same-directory .html links", () => {
  for (const page of docPages) {
    const html = readFileSync(page, "utf8");
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("#"))
        continue;
      assert.ok(!href.endsWith(".md"), `${page} has an unrewritten .md link: ${href}`);
      if (href.endsWith(".html") && !href.startsWith("..")) {
        const target = path.join(docsDir, href.split("#")[0]);
        assert.ok(existsFor(target), `${page} links to missing doc page ${href}`);
      }
    }
  }
});

function existsFor(filePath) {
  try {
    readFileSync(filePath);
    return true;
  } catch {
    return false;
  }
}

test("llms.txt is published verbatim as plain text at site root and under the versioned docs dir", () => {
  const source = readFileSync("llms.txt", "utf8");
  const rootCopy = readFileSync("public/llms.txt", "utf8");
  const versionedCopy = readFileSync("public/printspec/0.2.0/llms.txt", "utf8");
  assert.equal(rootCopy, source);
  assert.equal(versionedCopy, source);
  assert.ok(!rootCopy.trim().startsWith("<!doctype"), "llms.txt must not be HTML-wrapped");
});

test("docs site is linked from site navigation and the printspec project page", () => {
  const nav = readFileSync("public/printspec/0.2.0/index.html", "utf8");
  assert.match(nav, /\/printspec\/0\.2\.0\/docs\//);
  assert.match(nav, /href="\/llms\.txt"/);
});

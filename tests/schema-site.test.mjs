import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const pages = [
  'public/index.html',
  'public/printspec/index.html',
  'public/printspec/0.1.0/index.html',
  'public/404.html',
];

test('schema site pages include pinned Invisra brand assets and dark theme', () => {
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    assert.match(html, /https:\/\/assets\.invisra\.ai\/brand\/v1\/brand\.min\.css/, page);
    assert.match(html, /https:\/\/assets\.invisra\.ai\/brand\/v1\/favicon\.svg/, page);
    assert.match(html, /data-theme="dark"/, page);
    assert.match(html, /Invisra/, page);
    assert.match(html, /printspec/, page);
  }
});

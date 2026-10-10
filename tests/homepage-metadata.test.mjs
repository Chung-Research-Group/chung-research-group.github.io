import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { renderPublishedPage } from '../scripts/render-static-site.mjs';
import { requiredPages } from '../scripts/site-files.mjs';

const dataRoot = fileURLToPath(new URL('..', import.meta.url));
const siteUrl = 'https://chung-research-group.github.io';
const parseHead = html => parseHTML(html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)[0]).document;
const staticFallback = html => html.match(/<noscript data-static-fallback>([\s\S]*?)<\/noscript>/)[1];

test('published homepage exposes its title, search and sharing metadata before JavaScript', async () => {
  const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const result = await renderPublishedPage(source, { filename: 'index.html', dataRoot });
  const head = parseHead(result);
  const sourceHelmet = parseHTML(source).document.querySelector('helmet');
  assert.equal(head.querySelectorAll('title').length, 1);
  assert.equal(head.querySelector('title').textContent, 'Chung Research Group @ PNU');
  assert.equal(head.querySelectorAll('link[rel="canonical"]').length, 1);
  assert.equal(head.querySelector('link[rel="canonical"]').getAttribute('href'), `${siteUrl}/index.html`);
  for (const selector of [
    'meta[name="description"]', 'meta[property="og:type"]',
    'meta[property="og:title"]', 'meta[property="og:description"]',
    'meta[property="og:url"]', 'meta[property="og:image"]',
    'meta[property="og:image:width"]', 'meta[property="og:image:height"]',
    'meta[property="og:image:alt"]', 'meta[name="twitter:card"]',
    'meta[name="twitter:image"]', 'meta[name="twitter:image:alt"]'
  ]) {
    assert.equal(head.querySelectorAll(selector).length, 1, selector);
    assert.equal(head.querySelector(selector).getAttribute('content'), sourceHelmet.querySelector(selector).getAttribute('content'), selector);
  }
  assert.equal(head.querySelector('meta[property="og:image"]').getAttribute('content'), `${siteUrl}/images/homepage-social.png`);
  assert.equal(head.querySelector('meta[property="og:image:width"]').getAttribute('content'), '1200');
  assert.equal(head.querySelector('meta[property="og:image:height"]').getAttribute('content'), '630');
  assert.equal(head.querySelector('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');
  const runtimeTemplate = result.match(/<template data-site-template>([\s\S]*?)<\/template>/)[1];
  const helmet = parseHTML(runtimeTemplate).document.querySelector('helmet');
  assert.equal(helmet.querySelectorAll('title, meta, link[rel="canonical"]').length, 0, 'runtime must not duplicate promoted metadata');
  assert.ok(helmet.querySelector('style'), 'runtime styling was removed');
  assert.ok(helmet.querySelector('script[src^="feed.js"]'), 'runtime data script was removed');
  assert.deepEqual(
    [...helmet.querySelectorAll('style, script, link[rel="stylesheet"]')].map(node => node.outerHTML),
    [...sourceHelmet.querySelectorAll('style, script, link[rel="stylesheet"]')].map(node => node.outerHTML),
    'metadata promotion changed runtime style, script or stylesheet content'
  );
  const fallback = staticFallback(result);
  assert.doesNotMatch(fallback, /{{|<sc-(?:for|if)\b|<script\b|\sonclick=/i);
  const fallbackDocument = parseHTML(fallback).document;
  assert.equal(fallbackDocument.querySelectorAll('main').length, 1);
  assert.ok(fallbackDocument.querySelector('img[src^="images/mofs/cu-btc.svg"]'), 'no-JavaScript structure poster was lost');
  assert.ok(fallbackDocument.querySelector('a[href="CoRE%20MOF%20Database.dc.html"]'), 'no-JavaScript tool navigation was lost');
  assert.equal(await renderPublishedPage(source, { filename: 'index.html', dataRoot }), result, 'published HTML is not deterministic');
});

test('other published pages preserve their existing head metadata without duplicate titles or canonicals', async () => {
  // Publications and Statistics read build-generated snapshots. The build
  // validator checks their initial heads; these pages render from source data.
  for (const filename of requiredPages.filter(file => !['index.html', 'Publications.dc.html', 'Statistics.dc.html'].includes(file))) {
    const source = await readFile(new URL('../' + filename, import.meta.url), 'utf8');
    const result = await renderPublishedPage(source, { filename, dataRoot });
    const originalHead = parseHead(source);
    const publishedHead = parseHead(result);
    assert.equal(publishedHead.querySelectorAll('title').length, 1, filename);
    assert.equal(publishedHead.querySelectorAll('link[rel="canonical"]').length, 1, filename);
    for (const selector of ['title', 'meta[name="description"]', 'link[rel="canonical"]', 'meta[property="og:title"]', 'meta[property="og:url"]']) {
      assert.equal(publishedHead.querySelector(selector).outerHTML, originalHead.querySelector(selector).outerHTML, `${filename}: ${selector}`);
      assert.equal(publishedHead.querySelectorAll(selector).length, 1, `${filename}: ${selector}`);
    }
    const fallbackDocument = parseHTML(staticFallback(result)).document;
    assert.equal(fallbackDocument.querySelectorAll('main').length, 1, filename);
  }
});

test('existing head values win over template metadata and sharing fields can be promoted generically', async () => {
  const source = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="utf-8"><title>Existing title</title>
    <meta name="description" content="Existing description">
    <link rel="canonical" href="${siteUrl}/existing.html">
    <script src="./vendor/react.production.min.js"></script>
    </head><body><x-dc><helmet>
    <meta charset="utf-8"><title>Template title</title>
    <meta name="description" content="Template description">
    <link rel="canonical" href="${siteUrl}/template.html">
    <meta property="og:image" content="${siteUrl}/images/social.png">
    <meta property="og:image:width" content="1200">
    <meta name="twitter:image" content="${siteUrl}/images/social.png">
    <style>.hero { color: blue; }</style><link rel="stylesheet" href="assets/site-common.css">
    </helmet><main><a href="index.html">Home</a><p>Static content</p></main></x-dc></body></html>`;
  const result = await renderPublishedPage(source, { filename: 'index.html', dataRoot });
  const head = parseHead(result);
  assert.equal(head.querySelectorAll('meta[charset]').length, 1);
  assert.equal(head.querySelectorAll('title').length, 1);
  assert.equal(head.querySelector('title').textContent, 'Existing title');
  assert.equal(head.querySelectorAll('meta[name="description"]').length, 1);
  assert.equal(head.querySelector('meta[name="description"]').getAttribute('content'), 'Existing description');
  assert.equal(head.querySelectorAll('link[rel="canonical"]').length, 1);
  assert.equal(head.querySelector('link[rel="canonical"]').getAttribute('href'), `${siteUrl}/existing.html`);
  assert.equal(head.querySelector('meta[property="og:image:width"]').getAttribute('content'), '1200');
  assert.equal(head.querySelector('meta[name="twitter:image"]').getAttribute('content'), `${siteUrl}/images/social.png`);
  const fallback = staticFallback(result);
  assert.match(fallback, /\.hero \{ color: blue; \}/);
  assert.match(fallback, /<a href="index.html">Home<\/a>/);
  assert.doesNotMatch(fallback, /Template title|Template description|template\.html/);
});

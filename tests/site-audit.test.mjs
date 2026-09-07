import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { requiredPages } from '../scripts/site-files.mjs';
import { sharedChrome } from '../scripts/site-chrome.mjs';
import { renderPublishedPage } from '../scripts/render-static-site.mjs';
import '../assets/mof-renderer.js';

test('MOF display bonds use short periodic images and remain inside the viewport', async () => {
  const model = JSON.parse(await readFile(new URL('../data/irmof-1.json', import.meta.url), 'utf8'));
  assert.equal(model.units, 'angstrom');
  assert.deepEqual(model.atom_counts, { Zn: 32, O: 104, C: 192, H: 96 });
  const limits = { 'C-C': [1.3, 1.6], 'C-O': [1.2, 1.4], 'O-Zn': [1.8, 2.1] };
  for (const [i, j] of model.bonds) {
    const a = model.atoms[i], b = model.atoms[j];
    const distance = Math.hypot(...a.slice(1).map((v, axis) => v - b[axis + 1]));
    const [min, max] = limits[[a[0], b[0]].sort().join('-')];
    assert.ok(distance > min && distance < max, `invalid display bond ${i}-${j}: ${distance}`);
  }
  for (const angle of [0, .38, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    for (const atom of MofRenderer.project(model, 350, 206, angle).filter(p => p.kind === 'atom')) {
      assert.ok(atom.x - atom.r >= 0 && atom.x + atom.r <= 350);
      assert.ok(atom.y - atom.r >= 0 && atom.y + atom.r <= 206);
    }
  }
});

test('all page templates have landmarks, consistent contact links, and no stale footer dates', async () => {
  for (const file of requiredPages) {
    const html = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    const { document } = parseHTML(html);
    assert.equal(document.querySelectorAll('main').length, 1, file);
    assert.equal(document.querySelectorAll('head link[href="assets/site-common.css"]').length, 1, file);
    for (const style of document.querySelectorAll('style')) assert.doesNotMatch(style.textContent, /<(?:link|section|dl|dt|dd|h[1-6])\b/);
    if (/^(AIM|CoRE MOF Database|GWP-estimator|MOFClassifier|PACMAN|SESAMI-APP)\./.test(file)) {
      assert.equal(document.querySelectorAll('main > .tool-start').length, 1, file);
    }
    const skip = document.querySelector('a[href="#main-content"], a[href="#statistics-main"]');
    assert.ok(skip && document.querySelector(skip.getAttribute('href')), file);
    assert.doesNotMatch(html, /Last updated July 2026/);
  }
  const people = await readFile(new URL('../People.dc.html', import.meta.url), 'utf8');
  assert.doesNotMatch(people, /<image-slot\b/);
  assert.match(people, /alt="{{ m.name }}"/);
  const publications = await readFile(new URL('../Publications.dc.html', import.meta.url), 'utf8');
  assert.doesNotMatch(publications, /dimensions|altmetric|discoveryTerms|<span onClick/);
  assert.match(publications, /aria-pressed="{{ it.active }}"/);
  const sesami = await readFile(new URL('../SESAMI-APP.dc.html', import.meta.url), 'utf8');
  assert.doesNotMatch(sesami, /sesami-web\.org|164\.125\.248\.102/);
  assert.match(sesami, /https:\/\/github.com\/hjkgrp\/SESAMI_web/);
});

test('shared chrome is deterministic and preserves the statistics navigation policy', async () => {
  for (const file of requiredPages) {
    const html = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    const result = sharedChrome(html, file);
    assert.equal(sharedChrome(result, file), result);
    const { document } = parseHTML(result);
    assert.equal(document.querySelectorAll('nav.nav a').length, 6);
    assert.equal(document.querySelectorAll('nav.nav a[href="Statistics.dc.html"]').length, 0);
    for (const link of document.querySelectorAll('[data-prof-email], [data-prof-pnu-email]')) {
      assert.equal(link.getAttribute('href'), 'mailto:drygchung@pusan.ac.kr');
    }
  }
});

test('the no-JavaScript renderer uses the same records without active scripts or template placeholders', async () => {
  for (const filename of ['People.dc.html', 'News.dc.html', 'Software & Data.dc.html', 'AIM.dc.html', 'CoRE MOF Database.dc.html', 'GWP-estimator.dc.html', 'MOFClassifier.dc.html', 'PACMAN.dc.html', 'SESAMI-APP.dc.html']) {
    const source = await readFile(new URL('../' + filename, import.meta.url), 'utf8');
    const result = await renderPublishedPage(source, { filename, dataRoot: new URL('..', import.meta.url).pathname });
    const fallback = result.match(/<noscript data-static-fallback>([\s\S]*?)<\/noscript>/)[1];
    assert.doesNotMatch(fallback, /{{|<sc-(?:for|if)|<script\b|\sonclick=/i);
    const { document } = parseHTML(fallback);
    assert.equal(document.querySelectorAll('main').length, 1);
    for (const style of document.querySelectorAll('style')) {
      assert.doesNotMatch(style.textContent, /&#64;|<(?:section|dl|link)\b/);
    }
    assert.match(fallback, /@media/);
    if (/^(AIM|CoRE MOF Database|GWP-estimator|MOFClassifier|PACMAN|SESAMI-APP)\./.test(filename)) {
      assert.equal(document.querySelectorAll('main > .tool-start').length, 1, filename);
    }
    if (filename === 'People.dc.html') {
      assert.equal(document.querySelectorAll('main img[loading="lazy"]').length, 8);
      assert.match(document.textContent || fallback, /Baek, Mingyu/);
    }
    if (filename === 'News.dc.html') {
      assert.ok(document.querySelectorAll('main a[href]').length > 20);
      assert.match(fallback, /Research Briefing/);
      assert.match(fallback, /Nature Computational Science/);
      assert.match(fallback, /chemistryworld\.com\/news\//);
    }
    assert.match(result, /<template data-site-template><x-dc>/);
    assert.ok(result.indexOf('assets/site-template.js') < result.indexOf('./support.js'));
    if (filename === 'People.dc.html') assert.ok(result.indexOf('src="people-data.js"') < result.indexOf('./support.js'));
  }
});

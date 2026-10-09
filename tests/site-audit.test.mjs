import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { requiredPages } from '../scripts/site-files.mjs';
import { sharedChrome } from '../scripts/site-chrome.mjs';
import { renderPublishedPage } from '../scripts/render-static-site.mjs';
import '../assets/mof-renderer.js';

test('the four MOFs retain their source cells, periodic bonds and a shared physical scale throughout rotation', async () => {
  const models = JSON.parse(await readFile(new URL('../data/mof-catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(models.map(model => model.name), ['Cu-BTC', 'CALF-20', 'MOF-74 (Mg)', 'NU-1000']);
  const previousCatalog = globalThis.MOF_MODELS;
  globalThis.MOF_MODELS = models;
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  try {
    for (const model of models) {
      assert.equal(model.units, 'angstrom');
      assert.ok(model.atoms.length > 0 && model.bond_segments.length > 0, model.name);
      assert.ok(model.atoms.every(([element, ...position]) => element !== 'H' && position.every(Number.isFinite)), model.name);
      const source = await readFile(new URL(`../data/mof-source/${model.slug}.cif`, import.meta.url));
      assert.equal(createHash('sha256').update(source).digest('hex'), model.source_sha256, model.name);
      const vectors = model.cell_vectors, volume = dot(vectors[0], cross(vectors[1], vectors[2]));
      assert.ok(volume > 0, model.name);
      const reciprocal = [cross(vectors[1], vectors[2]), cross(vectors[2], vectors[0]), cross(vectors[0], vectors[1])]
        .map(vector => vector.map(x => x / volume));
      for (const [element, ...coordinates] of model.bond_segments) {
        assert.ok(model.atoms.some(atom => atom[0] === element), model.name);
        const start = coordinates.slice(0, 3), end = coordinates.slice(3);
        assert.ok(Math.hypot(...start.map((x, axis) => x - end[axis])) <= 1.5,
          `${model.name}: display segment spans more than a local half-bond`);
        for (const point of [start, end]) for (const axis of reciprocal) {
          assert.ok(Math.abs(dot(point, axis)) <= .500001, `${model.name}: periodic bond left its unit cell`);
        }
      }
    }
    for (const [width, height] of [[180, 120], [335, 335], [506, 506]]) {
      const scales = models.map(model => MofRenderer.viewScale(model, width, height));
      assert.ok(scales[0] > 0 && scales.every(scale => scale === scales[0]), 'MOFs use different pixels per angstrom');
      const radiiByColor = new Map();
      for (const model of models) for (let degrees = 0; degrees <= 360; degrees += 5) {
        const shapes = MofRenderer.project(model, width, height, degrees * Math.PI / 180);
        assert.equal(shapes.filter(shape => shape.kind === 'atom').length, model.atoms.length, model.name);
        assert.deepEqual(shapes.filter(shape => shape.kind === 'label').map(shape => shape.text), ['a', 'b', 'c']);
        for (const shape of shapes) {
          const radius = shape.kind === 'atom' ? shape.r : shape.kind === 'label' ? 13 : shape.width / 2;
          const endpoints = shape.x2 === undefined ? [[shape.x, shape.y]] : [[shape.x, shape.y], [shape.x2, shape.y2]];
          for (const [x, y] of endpoints) {
            assert.ok(x - radius >= 0 && x + radius <= width, `${model.name}: clipped ${shape.kind} at ${degrees} degrees`);
            assert.ok(y - radius >= 0 && y + radius <= height, `${model.name}: clipped ${shape.kind} at ${degrees} degrees`);
          }
          if (shape.kind === 'atom') {
            const previousRadius = radiiByColor.get(shape.color);
            if (previousRadius !== undefined) assert.equal(shape.r, previousRadius, 'atom size changed between models or angles');
            radiiByColor.set(shape.color, shape.r);
          }
        }
      }
    }
  } finally {
    if (previousCatalog === undefined) delete globalThis.MOF_MODELS;
    else globalThis.MOF_MODELS = previousCatalog;
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
  assert.doesNotMatch(publications, /discoveryTerms|<span onClick/);
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
    const result = await renderPublishedPage(source, { filename, dataRoot: fileURLToPath(new URL('..', import.meta.url)) });
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
      const sandbox = { window: {} };
      vm.runInNewContext(await readFile(new URL('../people-data.js', import.meta.url), 'utf8'), sandbox);
      const expectedNames = Array.from(sandbox.window.MTAP_PEOPLE().groups)
        .flatMap(group => Array.from(group.people, person => person.name));
      assert.deepEqual(
        Array.from(document.querySelectorAll('main img[loading="lazy"]'), image => image.getAttribute('alt')),
        expectedNames
      );
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

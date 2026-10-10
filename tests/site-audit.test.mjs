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

test('the eight manual MOF views preserve their source cells, periodic repeats and shared physical scale without axis labels', async () => {
  const models = JSON.parse(await readFile(new URL('../data/mof-catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(models.map(model => model.name), ['Cu-BTC', 'CALF-20', 'MOF-74 (Mg)', 'NU-1000', 'ZIF-8', 'MOF-5', 'NU-100', 'MOF-177']);
  const previousCatalog = globalThis.MOF_MODELS;
  globalThis.MOF_MODELS = models;
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sourceCounts = [552, 36, 144, 420, 168, 328, 2448, 568];
  const repeats = [[2, 2, 1], [1, 3, 3], [2, 2, 1], [1, 1, 1], [3, 3, 1], [2, 2, 1], [1, 1, 1], [1, 1, 1]];
  const identity = [1, 0, 0, 0];
  const orientations = [identity, [Math.cos(.4), Math.sin(.4), 0, 0], [Math.cos(.7), 0, Math.sin(.7), 0], [.5, .5, .5, .5]];
  try {
    for (const [index, model] of models.entries()) {
      assert.equal(model.units, 'angstrom');
      assert.equal(model.atoms.length, sourceCounts[index], `${model.name}: the original cell was changed`);
      assert.ok(model.bond_segments.length > 0, model.name);
      assert.ok(model.atoms.every(([element, ...position]) => element !== 'H' && position.every(Number.isFinite)), model.name);
      const source = await readFile(new URL(`../data/mof-source/${model.slug}.cif`, import.meta.url));
      assert.equal(createHash('sha256').update(source).digest('hex'), model.source_sha256, model.name);
      const vectors = model.cell_vectors, volume = dot(vectors[0], cross(vectors[1], vectors[2]));
      assert.ok(volume > 0, model.name);
      const reciprocal = [cross(vectors[1], vectors[2]), cross(vectors[2], vectors[0]), cross(vectors[0], vectors[1])]
        .map(vector => vector.map(x => x / volume));
      for (const atom of model.atoms) for (const axis of reciprocal) {
        assert.ok(Math.abs(dot(atom.slice(1), axis)) <= .500001, `${model.name}: source atom left its unit cell`);
      }
      for (const [element, ...coordinates] of model.bond_segments) {
        assert.ok(model.atoms.some(atom => atom[0] === element), model.name);
        const start = coordinates.slice(0, 3), end = coordinates.slice(3);
        assert.ok(Math.hypot(...start.map((x, axis) => x - end[axis])) <= 1.5,
          `${model.name}: display segment spans more than a local half-bond`);
        for (const point of [start, end]) for (const axis of reciprocal) {
          assert.ok(Math.abs(dot(point, axis)) <= .500001, `${model.name}: periodic bond left its unit cell`);
        }
      }
      const geometry = MofRenderer.geometry(model);
      assert.deepEqual(geometry.repetitions, repeats[index]);
      const copies = repeats[index].reduce((count, n) => count * n, 1);
      assert.ok(geometry.displayAtoms.length <= model.atoms.length * copies, `${model.name}: unexpected extra atoms`);
      assert.ok(geometry.displayAtoms.length >= model.atoms.length, `${model.name}: original cell atoms were lost`);
      if (copies > 1) assert.ok(geometry.displayAtoms.length > model.atoms.length, `${model.name}: periodic neighbors were not displayed`);
      // Shared boundary atoms can be deduplicated, but every displayed atom must
      // still be a lattice translation of a source atom of the same element.
      const periodicKey = (element, fractional) => element + ':' + fractional
        .map(x => ((Math.round(x * 1e5) % 100000) + 100000) % 100000).join(',');
      const sourceSites = new Set(model.atoms.map(([element, ...position]) => periodicKey(element, reciprocal.map(axis => dot(position, axis)))));
      for (const [element, ...position] of geometry.displayAtoms) {
        const fractional = reciprocal.map(axis => dot(position, axis));
        fractional.forEach((x, axis) => assert.ok(Math.abs(x) <= repeats[index][axis] / 2 + 1e-6, `${model.name}: atom left the repeated cell region`));
        assert.ok(sourceSites.has(periodicKey(element, fractional.map((x, axis) => x + (repeats[index][axis] - 1) / 2))), `${model.name}: displayed atom is not a source lattice translation`);
      }
      assert.equal(geometry.viewDirection, index === 1 ? '[100]' : '[001]');
      const normal = vectors[index === 1 ? 0 : 2], length = Math.hypot(...normal);
      assert.ok(Math.abs(Math.abs(dot(geometry.basis[2], normal)) / length - 1) < 1e-12, `${model.name}: initial view is diagonal to the pore axis`);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        assert.ok(Math.abs(dot(geometry.basis[i], geometry.basis[j]) - (i === j ? 1 : 0)) < 1e-12, 'camera basis distorts physical lengths');
      }
    }
    for (const quaternion of orientations) {
      const matrix = MofRenderer.quaternionMatrix(quaternion);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        assert.ok(Math.abs(dot(matrix[i], matrix[j]) - (i === j ? 1 : 0)) < 1e-12, 'manual rotation changes physical lengths');
      }
    }
    for (const [width, height] of [[180, 120], [335, 335], [900, 520]]) {
      for (const model of models) {
        const shapes = MofRenderer.project(model, width, height, { quaternion: identity, zoom: 1 });
        assert.equal(shapes.filter(shape => shape.kind === 'label').length, 0, 'crystallographic axis labels remain');
        assert.doesNotMatch(MofRenderer.toSvg(model, width, height), /<text\b/);
        for (const shape of shapes) {
          const radius = shape.kind === 'atom' ? shape.r : shape.kind === 'label' ? 13 : shape.width / 2;
          const endpoints = shape.x2 === undefined ? [[shape.x, shape.y]] : [[shape.x, shape.y], [shape.x2, shape.y2]];
          for (const [x, y] of endpoints) {
            assert.ok(x - radius >= 0 && x + radius <= width, `${model.name}: clipped ${shape.kind} in its initial front view`);
            assert.ok(y - radius >= 0 && y + radius <= height, `${model.name}: clipped ${shape.kind} in its initial front view`);
          }
        }
      }
      for (const zoom of [.75, 1, 2]) {
        const scales = models.map(model => MofRenderer.viewScale(model, width, height, zoom));
        assert.ok(scales[0] > 0 && scales.every(scale => scale === scales[0]), 'MOFs use different pixels per angstrom');
        assert.ok(Math.abs(scales[0] - zoom * MofRenderer.viewScale(models[0], width, height, 1)) < 1e-12, 'zoom is not uniform in physical units');
        const radiiByColor = new Map();
        for (const model of models) for (const quaternion of orientations) {
          const atoms = MofRenderer.project(model, width, height, { quaternion, zoom }).filter(shape => shape.kind === 'atom');
          assert.equal(atoms.length, MofRenderer.geometry(model).displayAtoms.length, model.name);
          for (const atom of atoms) {
            assert.ok([atom.x, atom.y, atom.z, atom.r].every(Number.isFinite), model.name);
            const previousRadius = radiiByColor.get(atom.color);
            if (previousRadius !== undefined) assert.equal(atom.r, previousRadius, 'atom size changed between models or manual orientations');
            radiiByColor.set(atom.color, atom.r);
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

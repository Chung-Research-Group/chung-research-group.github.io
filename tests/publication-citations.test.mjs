import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateBibtex,
  generateCff,
  generatePublicationCitationFiles,
  normalizeCanonicalRecord,
  parseFeedDois,
  refreshBibliographySnapshot,
  validateBibliography
} from '../scripts/publication-citations.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');
const FEED_PATH = path.join(REPOSITORY_ROOT, 'feed.js');
const BIBLIOGRAPHY_PATH = path.join(REPOSITORY_ROOT, 'data', 'publication-bibliography.json');

async function fixture() {
  const [feedSource, snapshotSource] = await Promise.all([
    readFile(FEED_PATH, 'utf8'),
    readFile(BIBLIOGRAPHY_PATH, 'utf8')
  ]);
  return {
    feedDois: parseFeedDois(feedSource),
    snapshot: JSON.parse(snapshotSource)
  };
}

test('committed bibliography has the exact 72-DOI feed set and complete structured records', async () => {
  const { feedDois, snapshot } = await fixture();
  assert.equal(feedDois.length, 72);
  assert.equal(new Set(feedDois).size, 72);
  assert.deepEqual(Object.keys(snapshot.publications), feedDois);

  const result = validateBibliography(snapshot, feedDois);
  assert.deepEqual(result, { ok: true, errors: [] });
  for (const doi of feedDois) {
    const record = snapshot.publications[doi];
    assert.equal(record.doi, doi);
    assert.equal(record.type, 'article');
    assert.ok(record.title);
    assert.ok(record.journal);
    assert.match(String(record.year), /^\d{4}$/);
    assert.ok(record.authors.length > 0);
    for (const author of record.authors) {
      assert.ok(author.literal || author.family);
      assert.doesNotMatch(
        [author.given, author.family, author.literal].filter(Boolean).join(' '),
        /(?:\bet\s+al\.?(?:\s|$)|[*#])/i
      );
    }
  }
});

test('site validation reports duplicate feed DOIs even when the bibliography snapshot is missing', async () => {
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), 'publication-validator-'));
  const temporaryRoot = path.join(temporaryParent, 'site');
  try {
    const excludedRoots = ['.git', 'dist', 'node_modules', 'test-results']
      .map(name => path.join(REPOSITORY_ROOT, name));
    await cp(REPOSITORY_ROOT, temporaryRoot, {
      recursive: true,
      filter: source => !excludedRoots.some(excluded =>
        source === excluded || source.startsWith(`${excluded}${path.sep}`)
      )
    });

    const feedPath = path.join(temporaryRoot, 'feed.js');
    const feedSource = await readFile(feedPath, 'utf8');
    const publicationStart = feedSource.indexOf('const PUBS = [');
    const publicationEnd = feedSource.indexOf('\n];', publicationStart);
    assert.ok(publicationStart >= 0 && publicationEnd > publicationStart);
    const publicationSource = feedSource.slice(publicationStart, publicationEnd);
    const doiMatches = [...publicationSource.matchAll(/'(10\.[^']+)'\)/gi)];
    assert.ok(doiMatches.length > 1);
    const secondMatch = doiMatches[1];
    const duplicatedPublications = `${publicationSource.slice(0, secondMatch.index)}'${doiMatches[0][1]}')${publicationSource.slice(secondMatch.index + secondMatch[0].length)}`;
    const duplicatedFeed = `${feedSource.slice(0, publicationStart)}${duplicatedPublications}${feedSource.slice(publicationEnd)}`;
    await writeFile(feedPath, duplicatedFeed, 'utf8');
    await rm(path.join(temporaryRoot, 'data', 'publication-bibliography.json'));

    const result = spawnSync(process.execPath, [
      path.join(REPOSITORY_ROOT, 'scripts', 'validate-site.mjs'),
      '--root',
      temporaryRoot
    ], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8'
    });
    const diagnostics = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(diagnostics, /Missing required file: data\/publication-bibliography\.json/);
    assert.match(diagnostics, /feed\.js contains duplicate publication DOIs\./);
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
});

test('BibTeX and CFF exports are deterministic, complete, ordered, and LF terminated', async () => {
  const { feedDois, snapshot } = await fixture();
  const firstBibtex = generateBibtex(snapshot, feedDois);
  const secondBibtex = generateBibtex(snapshot, feedDois);
  const firstCff = generateCff(snapshot, feedDois);
  const secondCff = generateCff(snapshot, feedDois);

  assert.equal(firstBibtex, secondBibtex);
  assert.equal(firstCff, secondCff);
  assert.equal((firstBibtex.match(/^@article\{/gm) ?? []).length, 72);
  assert.equal((firstCff.match(/^  - type: "article"$/gm) ?? []).length, 72);
  assert.equal((firstCff.match(/^    doi: /gm) ?? []).length, 72);
  assert.ok(firstBibtex.endsWith('\n'));
  assert.ok(firstCff.endsWith('\n'));
  assert.doesNotMatch(firstBibtex, /\r/);
  assert.doesNotMatch(firstCff, /\r/);
  assert.doesNotMatch(firstBibtex, /\bet\s+al\.?/i);

  const firstDoiPosition = firstBibtex.indexOf(`doi = {${feedDois[0]}}`);
  const lastDoiPosition = firstBibtex.indexOf(`doi = {${feedDois.at(-1)}}`);
  assert.ok(firstDoiPosition >= 0);
  assert.ok(lastDoiPosition > firstDoiPosition);
  for (const doi of feedDois) {
    assert.equal((firstBibtex.match(new RegExp(`doi = \\{${doi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g')) ?? []).length, 1);
    assert.equal((firstCff.match(new RegExp(`^    doi: ${JSON.stringify(doi).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'gm')) ?? []).length, 1);
  }

  assert.match(firstCff, /^cff-version: "1\.2\.0"$/m);
  assert.match(firstCff, /^type: "dataset"$/m);
  assert.match(firstCff, /^title: "Chung Research Group Publication Catalogue"$/m);
  assert.match(firstCff, /^references:$/m);
});

test('normalization strips JATS/MathML, decodes entities, preserves Unicode mononyms, and escapes output', () => {
  const record = normalizeCanonicalRecord({
    DOI: 'https://doi.org/10.5555/EXAMPLE_1',
    title: ['A <jats:italic>café</jats:italic> &amp; CO<sub>2</sub>_test &lt;110&gt; {100%}'],
    author: [
      { family: 'Prerna' },
      { given: 'Zoë', family: 'O’Neil', ORCID: '0000-0002-1825-0097' }
    ],
    'container-title': ['Journal &amp; Tests'],
    issued: { 'date-parts': [[2024, 5, 1]] },
    volume: '3',
    issue: '2',
    'article-number': 'e17'
  }, {
    provider: 'crossref',
    retrievedAt: '2024-06-01T00:00:00.000Z'
  });
  assert.equal(record.doi, '10.5555/example_1');
  assert.equal(record.title, 'A café & CO2_test <110> {100%}');
  assert.deepEqual(record.authors[0], { literal: 'Prerna' });
  assert.deepEqual(record.authors[1], {
    given: 'Zoë',
    family: 'O’Neil',
    orcid: 'https://orcid.org/0000-0002-1825-0097'
  });

  const snapshot = {
    schemaVersion: 1,
    snapshotUpdatedAt: '2024-06-01T00:00:00.000Z',
    publications: { [record.doi]: record }
  };
  const bibtex = generateBibtex(snapshot, [record.doi]);
  const cff = generateCff(snapshot, [record.doi]);
  assert.match(bibtex, /title = \{\{A café \\& CO2\\_test <110> \\{100\\%\\}\}\}/);
  assert.match(bibtex, /author = \{\{Prerna\} and O’Neil, Zoë\}/);
  assert.doesNotMatch(bibtex, /\\\{Prerna\\\}/);
  assert.match(cff, /- name: "Prerna"/);
  assert.match(cff, /^    title: ".*<110>.*"$/m);
  assert.match(cff, /start: "e17"/);
  assert.match(cff, /orcid: "https:\/\/orcid\.org\/0000-0002-1825-0097"/);
});

test('refresh uses at most two requests concurrently, retries transient failures, and falls back for non-Crossref DOIs', async () => {
  const dois = ['10.5555/one', '10.5555/two', '10.5555/three'];
  const attempts = new Map();
  let active = 0;
  let maximumActive = 0;
  const crossrefWork = doi => ({
    message: {
      DOI: doi,
      title: [`Title ${doi}`],
      author: [{ given: 'Ada', family: 'Lovelace' }],
      'container-title': ['Test Journal'],
      issued: { 'date-parts': [[2024]] },
      volume: '1',
      page: '1-2',
      publisher: 'Test Publisher'
    }
  });
  const fetchImpl = async (input, init) => {
    const url = String(input);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setImmediate(resolve));
    active -= 1;
    attempts.set(url, (attempts.get(url) ?? 0) + 1);

    assert.match(init.headers['User-Agent'], /mailto:test@example\.com/);
    if (url.includes(encodeURIComponent('10.5555/one'))) {
      if (attempts.get(url) === 1) {
        return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
      }
      return Response.json(crossrefWork('10.5555/one'));
    }
    if (url.includes(encodeURIComponent('10.5555/two'))) {
      return Response.json(crossrefWork('10.5555/two'));
    }
    if (url.includes(encodeURIComponent('10.5555/three')) && url.includes('/agency')) {
      return Response.json({ message: { agency: { id: 'datacite' } } });
    }
    if (url.startsWith('https://api.crossref.org/') && url.includes(encodeURIComponent('10.5555/three'))) {
      return new Response('{}', { status: 404 });
    }
    if (url === 'https://doi.org/10.5555/three') {
      assert.equal(init.headers.Accept, 'application/vnd.citationstyles.csl+json');
      return Response.json({
        DOI: '10.5555/three',
        title: 'Fallback title',
        author: [{ literal: 'Testing Consortium' }],
        'container-title': 'Fallback Journal',
        issued: { 'date-parts': [[2023]] },
        volume: '4',
        page: 'e9'
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const snapshot = await refreshBibliographySnapshot({
    dois,
    fetchImpl,
    mailto: 'test@example.com',
    concurrency: 2,
    now: () => new Date('2024-06-01T00:00:00.000Z'),
    sleep: async () => {}
  });
  assert.ok(maximumActive <= 2);
  assert.equal(snapshot.publications['10.5555/one'].source.provider, 'crossref');
  assert.equal(snapshot.publications['10.5555/three'].source.provider, 'doi-csl');
  const retriedUrl = [...attempts.keys()].find(url => url.includes(encodeURIComponent('10.5555/one')));
  assert.equal(attempts.get(retriedUrl), 2);
  assert.deepEqual(validateBibliography(snapshot, dois), { ok: true, errors: [] });
});

test('validator rejects DOI drift and abbreviated/UI-only authors', async () => {
  const { feedDois, snapshot } = await fixture();
  const altered = structuredClone(snapshot);
  delete altered.publications[feedDois[0]];
  altered.publications[feedDois[1]].authors[0] = { literal: 'et al.*' };
  const result = validateBibliography(altered, feedDois);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('snapshot is missing DOI')));
  assert.ok(result.errors.some(error => error.includes('abbreviated/UI-only marker')));
  assert.ok(result.errors.some(error => error.includes('does not match feed DOI count')));
});

test('file generator writes the two network-free catalogue artifacts', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'publication-citations-'));
  try {
    const result = await generatePublicationCitationFiles({
      feedPath: FEED_PATH,
      bibliographyPath: BIBLIOGRAPHY_PATH,
      outputRoot: temporaryRoot
    });
    assert.equal(result.publicationCount, 72);
    const [bibtex, cff] = await Promise.all([
      readFile(result.bibtexPath, 'utf8'),
      readFile(result.cffPath, 'utf8')
    ]);
    assert.equal((bibtex.match(/^@article\{/gm) ?? []).length, 72);
    assert.equal((cff.match(/^  - type: "article"$/gm) ?? []).length, 72);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

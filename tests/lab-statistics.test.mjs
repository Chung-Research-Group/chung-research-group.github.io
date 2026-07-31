import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
  deriveJcrInputRequirements,
  deriveLabStatistics,
  derivePublicationJcrBands,
  generateJcrInputRequirementsFile,
  generateLabStatisticsFile,
  generatePublicationJcrBandsFile,
  prepareLicensedJcrInput,
  validateLicensedJcrInputFile
} from '../scripts/lab-statistics.mjs';
import { TOPIC_GROUPS } from '../scripts/publication-bot.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FEED_PATH = path.join(ROOT, 'feed.js');
const METADATA_PATH = path.join(ROOT, 'data', 'publication-metadata.json');
const BIBLIOGRAPHY_PATH = path.join(ROOT, 'data', 'publication-bibliography.json');
const PEOPLE_PATH = path.join(ROOT, 'people-data.js');
const CURRENT_YEAR = new Date().getUTCFullYear();
const METRIC_SOURCE_STATUSES = new Set(['ok', 'stale', 'partial']);

async function loadBrowserData(pathname, expression) {
  const source = await fs.readFile(pathname, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: pathname });
  return JSON.parse(JSON.stringify(vm.runInNewContext(expression, sandbox)));
}

async function loadIntegrationSources() {
  const [publications, metadata, bibliography, people] = await Promise.all([
    loadBrowserData(FEED_PATH, 'window.MTAP_FEED.PUBS'),
    fs.readFile(METADATA_PATH, 'utf8').then(JSON.parse),
    fs.readFile(BIBLIOGRAPHY_PATH, 'utf8').then(JSON.parse),
    loadBrowserData(PEOPLE_PATH, 'window.MTAP_PEOPLE()')
  ]);
  return { publications, metadata, bibliography, people };
}

function normalizedOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function testDoi(value) {
  return String(value || '')
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .trim()
    .normalize('NFC')
    .toLowerCase();
}

function scopedMetadataRecords(metadata, publications) {
  const feedDois = new Set(publications.map(publication => testDoi(publication.doi)));
  return Object.entries(metadata.publications || {})
    .filter(([key, record]) => feedDois.has(testDoi(record?.doi || key)))
    .map(([, record]) => record);
}

function expectedCitationTotal(metadata, publications, sourceId) {
  const sourceStatus = metadata.sources?.[sourceId]?.status;
  let rawTotal;
  if (sourceId === 'googleScholar') {
    rawTotal = metadata.googleScholar?.citations?.all
      ?? metadata.totals?.googleScholarCitations;
  } else {
    const counts = scopedMetadataRecords(metadata, publications)
      .map(publication => publication?.[sourceId]?.citationCount)
      .filter(value => value !== undefined && value !== null && value !== '')
      .map(Number)
      .filter(value => Number.isInteger(value) && value >= 0);
    rawTotal = counts.length ? counts.reduce((sum, count) => sum + count, 0) : null;
  }
  const total = normalizedOptionalInteger(rawTotal);
  return METRIC_SOURCE_STATUSES.has(sourceStatus) && total !== null ? total : null;
}

function expectedCitationMatched(metadata, publications, sourceId) {
  if (sourceId === 'googleScholar') return null;
  const observed = scopedMetadataRecords(metadata, publications)
    .map(publication => publication?.[sourceId]?.citationCount)
    .filter(value => value !== undefined && value !== null && value !== '')
    .map(Number)
    .filter(value => Number.isInteger(value) && value >= 0)
    .length;
  const reported = normalizedOptionalInteger(metadata.sources?.[sourceId]?.matched);
  return Math.min(reported ?? observed, observed);
}

function expectedCumulativeCounts(points) {
  if (!points.length) return [];
  const counts = new Map(points.map(point => [point.year, point.count]));
  let runningTotal = 0;
  const result = [];
  for (let year = points[0].year; year <= points.at(-1).year; year += 1) {
    runningTotal += counts.get(year) || 0;
    result.push({ year, count: runningTotal });
  }
  return result;
}

function assertCitationHistory(source) {
  const annualTotal = source.countsByYear.reduce((sum, point) => sum + point.count, 0);
  assert.deepEqual(
    source.cumulativeCountsByYear,
    expectedCumulativeCounts(source.countsByYear)
  );
  if (!source.countsByYear.length) {
    assert.deepEqual(source.history, {
      status: 'unavailable',
      annualTotal: null,
      reportedTotal: source.total,
      reconciliationDelta: null,
      unassignedCount: null,
      excessAnnualCount: null,
      reason: 'provider-year-history-unavailable'
    });
    return;
  }

  const delta = source.total - annualTotal;
  const expectedStatus = delta !== 0 || source.status === 'partial'
    ? 'partial'
    : source.status === 'stale'
      ? 'stale'
      : 'ok';
  assert.deepEqual(source.history, {
    status: expectedStatus,
    annualTotal,
    reportedTotal: source.total,
    reconciliationDelta: delta,
    unassignedCount: delta > 0 ? delta : 0,
    excessAnnualCount: delta < 0 ? Math.abs(delta) : 0,
    reason: delta > 0
      ? 'provider-total-includes-citations-without-assigned-year'
      : delta < 0
        ? 'provider-year-history-exceeds-current-total'
        : source.status === 'partial'
          ? 'source-partial'
          : source.status === 'stale'
            ? 'source-stale'
            : null
  });
}

function calculateExpectedHIndex(counts) {
  const descending = [...counts].sort((left, right) => right - left);
  let value = 0;
  descending.forEach((count, index) => {
    if (count >= index + 1) value = index + 1;
  });
  return value;
}

const EXPECTED_PI_ORCID = '0000-0002-7756-0589';

function expectedWhitespace(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function expectedAuthorNamePart(value) {
  return expectedWhitespace(value)
    .replace(/\b([A-Za-z][A-Za-z'-]+)\.([A-Z])\./g, '$1 $2.')
    .replace(/\s+([,.;:])/g, '$1');
}

function expectedAuthorLabel(author) {
  const given = expectedAuthorNamePart(author.given);
  const family = expectedAuthorNamePart(author.family);
  return expectedWhitespace([given, family].filter(Boolean).join(' '))
    || expectedAuthorNamePart(author.literal);
}

function expectedAuthorNameKey(author) {
  return expectedAuthorLabel(author)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function expectedOrcid(value) {
  const normalized = expectedWhitespace(value)
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(normalized) ? normalized : null;
}

function expectedTextOrder(left, right) {
  const leftKey = String(left).normalize('NFKD').toLowerCase();
  const rightKey = String(right).normalize('NFKD').toLowerCase();
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function expectedLabel(labelCounts) {
  return [...labelCounts.entries()]
    .sort((left, right) =>
      right[1] - left[1] || expectedTextOrder(left[0], right[0])
    )[0][0];
}

function expectedPrincipalInvestigator(author) {
  const orcid = expectedOrcid(author.orcid);
  if (orcid) return orcid === EXPECTED_PI_ORCID;
  return expectedAuthorNamePart(author.family).toLowerCase() === 'chung'
    && /^yongchul(?:\s|$)/.test(expectedAuthorNamePart(author.given).toLowerCase());
}

function expectedAuthorId(identity) {
  return `author-${createHash('sha256').update(identity).digest('hex').slice(0, 12)}`;
}

function recomputeExpectedCoauthors(bibliography) {
  const records = Object.values(bibliography.publications);
  const nameOrcids = new Map();
  records.forEach(record => {
    record.authors.forEach(author => {
      const orcid = expectedOrcid(author.orcid);
      if (!orcid) return;
      const nameKey = expectedAuthorNameKey(author);
      const values = nameOrcids.get(nameKey) || new Set();
      values.add(orcid);
      nameOrcids.set(nameKey, values);
    });
  });

  const piIdentity = `orcid:${EXPECTED_PI_ORCID}`;
  const authors = new Map();
  const publicationIdentitySets = records.map(record => {
    const identities = new Set();
    record.authors.forEach(author => {
      const label = expectedAuthorLabel(author);
      const nameKey = expectedAuthorNameKey(author);
      const explicitOrcid = expectedOrcid(author.orcid);
      const knownOrcids = nameOrcids.get(nameKey);
      const knownOrcid = knownOrcids?.size === 1 ? [...knownOrcids][0] : null;
      const identity = explicitOrcid
        ? `orcid:${explicitOrcid}`
        : expectedPrincipalInvestigator(author)
          ? piIdentity
          : knownOrcid ? `orcid:${knownOrcid}` : `name:${nameKey}`;
      identities.add(identity);
      const aggregate = authors.get(identity) || {
        labelCounts: new Map(),
        publicationCount: 0,
        isPrincipalInvestigator: identity === piIdentity
      };
      aggregate.labelCounts.set(label, (aggregate.labelCounts.get(label) || 0) + 1);
      authors.set(identity, aggregate);
    });
    identities.forEach(identity => {
      authors.get(identity).publicationCount += 1;
    });
    return identities;
  });

  const jointCounts = new Map();
  publicationIdentitySets.forEach(identities => {
    if (!identities.has(piIdentity)) return;
    identities.forEach(identity => {
      if (identity !== piIdentity) {
        jointCounts.set(identity, (jointCounts.get(identity) || 0) + 1);
      }
    });
  });
  const collaborators = [...jointCounts.entries()]
    .map(([identity, jointPublicationCount]) => ({
      identity,
      jointPublicationCount,
      publicationCount: authors.get(identity).publicationCount,
      label: expectedLabel(authors.get(identity).labelCounts)
    }))
    .sort((left, right) =>
      right.jointPublicationCount - left.jointPublicationCount
      || right.publicationCount - left.publicationCount
      || expectedTextOrder(left.label, right.label)
      || expectedTextOrder(left.identity, right.identity)
    )
    .slice(0, 24);
  const selectedIdentities = [piIdentity, ...collaborators.map(author => author.identity)];
  const selectedIdentitySet = new Set(selectedIdentities);
  const authorIds = new Map(
    selectedIdentities.map(identity => [identity, expectedAuthorId(identity)])
  );
  const nodes = selectedIdentities.map(identity => ({
    id: authorIds.get(identity),
    label: expectedLabel(authors.get(identity).labelCounts),
    publicationCount: authors.get(identity).publicationCount,
    isPrincipalInvestigator: authors.get(identity).isPrincipalInvestigator
  }));

  const edgeCounts = new Map();
  publicationIdentitySets.forEach(identities => {
    const displayed = [...identities]
      .filter(identity => selectedIdentitySet.has(identity))
      .sort(expectedTextOrder);
    for (let left = 0; left < displayed.length; left += 1) {
      for (let right = left + 1; right < displayed.length; right += 1) {
        const source = authorIds.get(displayed[left]);
        const target = authorIds.get(displayed[right]);
        const key = `${source}\u0000${target}`;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
    }
  });
  const allEdges = [...edgeCounts.entries()]
    .map(([key, publicationCount]) => {
      const [source, target] = key.split('\u0000');
      return { source, target, publicationCount };
    })
    .sort((left, right) =>
      right.publicationCount - left.publicationCount
      || expectedTextOrder(left.source, right.source)
      || expectedTextOrder(left.target, right.target)
    );
  const piId = authorIds.get(piIdentity);
  const piEdges = allEdges.filter(edge => edge.source === piId || edge.target === piId);
  const otherEdges = allEdges.filter(edge => edge.source !== piId && edge.target !== piId);
  const edges = [
    ...piEdges,
    ...otherEdges.slice(0, Math.max(0, 80 - piEdges.length))
  ].slice(0, 80);

  return {
    totalAuthors: authors.size,
    totalCollaborators: Math.max(0, authors.size - 1),
    displayedAuthors: nodes.length,
    nodes,
    edges
  };
}

function minimalMetadata({
  sources = {},
  totals = {},
  googleScholar = {},
  publications = {}
} = {}) {
  return {
    snapshotUpdatedAt: '2026-01-01T00:00:00.000Z',
    sources,
    totals,
    googleScholar,
    publications
  };
}

function minimalPeople() {
  return {
    groups: [
      { title: 'Postdoctoral Researchers', people: [] },
      { title: 'Graduate Students', people: [] },
      { title: 'Undergraduates', people: [] }
    ]
  };
}

async function generateFixture(directory, name = 'lab-statistics.json') {
  const outputPath = path.join(directory, name);
  const statistics = await generateLabStatisticsFile({
    feedPath: FEED_PATH,
    metadataPath: METADATA_PATH,
    bibliographyPath: BIBLIOGRAPHY_PATH,
    peoplePath: PEOPLE_PATH,
    outputPath,
    currentYear: CURRENT_YEAR
  });
  return { outputPath, statistics };
}

test('derives the current publication, research, citation, and team facts', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-statistics-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = await loadIntegrationSources();
  const { statistics } = await generateFixture(directory);

  assert.equal(statistics.schemaVersion, 4);
  assert.equal(statistics.dataAsOf, source.metadata.snapshotUpdatedAt);
  const publicationYears = source.publications.map(publication => Number(publication.year));
  const reviewCount = source.publications.filter(
    publication => publication.topics.includes('Review')
  ).length;
  const firstPublicationYear = Math.min(...publicationYears);
  const lastPublicationYear = Math.max(...publicationYears);
  assert.deepEqual(
    {
      total: statistics.publications.total,
      articles: statistics.publications.articles,
      reviews: statistics.publications.reviews,
      firstYear: statistics.publications.firstYear,
      lastPublicationYear: statistics.publications.lastPublicationYear,
      lastYear: statistics.publications.lastYear,
      currentYearPartial: statistics.publications.currentYearPartial
    },
    {
      total: source.publications.length,
      articles: source.publications.length - reviewCount,
      reviews: reviewCount,
      firstYear: Math.min(firstPublicationYear, CURRENT_YEAR),
      lastPublicationYear,
      lastYear: Math.max(lastPublicationYear, CURRENT_YEAR),
      currentYearPartial: true
    }
  );
  const expectedYearCounts = new Map();
  publicationYears.forEach(year => {
    expectedYearCounts.set(year, (expectedYearCounts.get(year) || 0) + 1);
  });
  assert.equal(
    statistics.publications.byYear.length,
    statistics.publications.lastYear - statistics.publications.firstYear + 1
  );
  statistics.publications.byYear.forEach((point, index, rows) => {
    assert.equal(point.year, statistics.publications.firstYear + index);
    assert.equal(point.count, expectedYearCounts.get(point.year) || 0);
    assert.equal(point.partial, point.year === CURRENT_YEAR);
    if (index > 0) assert.equal(point.year, rows[index - 1].year + 1);
  });
  assert.deepEqual(
    statistics.publications.byYear.find(point => point.year === CURRENT_YEAR),
    {
      year: CURRENT_YEAR,
      count: expectedYearCounts.get(CURRENT_YEAR) || 0,
      partial: true
    }
  );

  const expectedJournalKeys = new Set(
    source.publications.map(publication =>
      publication.journal.trim().toLocaleLowerCase('en-US').replace(/^the\s+/, '')
    )
  );
  assert.equal(statistics.journals.publicationTotal, source.publications.length);
  assert.equal(statistics.journals.distinctCount, expectedJournalKeys.size);
  assert.equal(statistics.journals.groups.length, statistics.journals.distinctCount);
  assert.equal(
    statistics.journals.groups.reduce((sum, journal) => sum + journal.count, 0),
    source.publications.length
  );
  assert.ok(
    statistics.journals.groups.every((journal, index, groups) =>
      index === 0
      || groups[index - 1].count > journal.count
      || (
        groups[index - 1].count === journal.count
        && groups[index - 1].name.localeCompare(journal.name, 'en', { sensitivity: 'base' }) <= 0
      )
    )
  );

  assert.equal(statistics.coauthors.bounded, true);
  assert.equal(statistics.coauthors.maxNodes, 25);
  assert.equal(statistics.coauthors.maxEdges, 80);
  const expectedCoauthors = recomputeExpectedCoauthors(source.bibliography);
  assert.deepEqual(
    {
      totalAuthors: statistics.coauthors.totalAuthors,
      totalCollaborators: statistics.coauthors.totalCollaborators,
      displayedAuthors: statistics.coauthors.displayedAuthors,
      nodes: statistics.coauthors.nodes,
      edges: statistics.coauthors.edges
    },
    expectedCoauthors
  );
  assert.equal(statistics.coauthors.displayedAuthors, statistics.coauthors.nodes.length);
  assert.ok(statistics.coauthors.totalAuthors > statistics.coauthors.displayedAuthors);
  assert.equal(statistics.coauthors.totalCollaborators, statistics.coauthors.totalAuthors - 1);
  assert.ok(statistics.coauthors.nodes.length <= statistics.coauthors.maxNodes);
  assert.ok(statistics.coauthors.edges.length <= statistics.coauthors.maxEdges);
  const principalInvestigators = statistics.coauthors.nodes.filter(
    node => node.isPrincipalInvestigator
  );
  assert.equal(principalInvestigators.length, 1);
  assert.match(principalInvestigators[0].label, /Yongchul.*Chung/i);
  assert.ok(
    statistics.coauthors.edges.some(edge =>
      edge.source === principalInvestigators[0].id || edge.target === principalInvestigators[0].id
    )
  );
  const displayedAuthorIds = new Set(statistics.coauthors.nodes.map(node => node.id));
  assert.equal(displayedAuthorIds.size, statistics.coauthors.nodes.length);
  assert.ok(
    statistics.coauthors.edges.every(edge =>
      displayedAuthorIds.has(edge.source) && displayedAuthorIds.has(edge.target)
    )
  );

  const research = Object.fromEntries(statistics.researchAreas.groups.map(group => [group.name, group]));
  for (const [name, labels] of Object.entries(TOPIC_GROUPS)) {
    const articleCount = source.publications.filter(publication =>
      !publication.topics.includes('Review')
      && publication.topics.some(topic => labels.includes(topic))
    ).length;
    const areaReviewCount = source.publications.filter(publication =>
      publication.topics.includes('Review') && publication.reviewTopic === name
    ).length;
    assert.deepEqual(research[name], {
      id: name.toLowerCase(),
      name,
      count: articleCount + areaReviewCount,
      articleCount,
      reviewCount: areaReviewCount
    });
  }
  assert.equal(statistics.researchAreas.overlap, true);
  assert.match(statistics.researchAreas.countingMethod, /multiple areas/i);

  const citations = Object.fromEntries(
    statistics.citations.sources.map(source => [source.id, source])
  );
  for (const [sourceId, citation] of Object.entries(citations)) {
    const rawSource = source.metadata.sources?.[sourceId] || {};
    const expectedTotal = expectedCitationTotal(
      source.metadata,
      source.publications,
      sourceId
    );
    const expectedMatched = expectedCitationMatched(
      source.metadata,
      source.publications,
      sourceId
    );
    const incompleteCoverage = expectedTotal !== null
      && expectedMatched !== null
      && expectedMatched < source.publications.length;
    assert.equal(citation.total, expectedTotal);
    assert.equal(citation.publicationTotal, source.publications.length);
    assert.equal(citation.status, incompleteCoverage ? 'partial' : rawSource.status);
    const defaultProvider = sourceId === 'googleScholar'
      ? 'Google Scholar author profile'
      : sourceId === 'openAlex'
        ? 'OpenAlex API'
        : 'Semantic Scholar API';
    assert.equal(citation.provider, rawSource.provider
      ?? (sourceId === 'googleScholar' ? source.metadata.googleScholar?.provider : null)
      ?? defaultProvider);
    assert.equal(
      citation.reason,
      rawSource.reason
        ?? (incompleteCoverage
          ? `Partial coverage: ${expectedMatched} of ${source.publications.length} catalogue publications matched.`
          : null)
    );
    assert.equal(citation.matched, expectedMatched);
    assert.equal(citation.updatedAt, rawSource.contentUpdatedAt ?? null);
    assertCitationHistory(citation);
  }
  assert.match(citations.googleScholar.profileUrl, /scholar\.google\.com/);
  if (citations.semanticScholar.status === 'unavailable') {
    assert.deepEqual(citations.semanticScholar.countsByYear, []);
  }
  assert.deepEqual(
    [...new Set(citations.openAlex.countsByYear.map(point => point.year))],
    citations.openAlex.countsByYear.map(point => point.year)
  );
  const rawGoogleHIndex = normalizedOptionalInteger(source.metadata.googleScholar?.hIndex?.all);
  if (rawGoogleHIndex !== null
      && METRIC_SOURCE_STATUSES.has(source.metadata.sources?.googleScholar?.status)) {
    assert.equal(statistics.metrics.hIndex.value, rawGoogleHIndex);
    assert.equal(statistics.metrics.hIndex.source, 'Google Scholar');
    assert.equal(statistics.metrics.hIndex.matched, null);
  } else {
    const openAlexCounts = scopedMetadataRecords(source.metadata, source.publications)
      .map(publication => publication?.openAlex?.citationCount)
      .filter(value => Number.isInteger(value) && value >= 0);
    assert.equal(statistics.metrics.hIndex.value, calculateExpectedHIndex(openAlexCounts));
    assert.equal(statistics.metrics.hIndex.source, 'OpenAlex');
    assert.equal(statistics.metrics.hIndex.matched, openAlexCounts.length);
    assert.equal(statistics.metrics.hIndex.publicationTotal, source.publications.length);
    assert.match(statistics.metrics.hIndex.method, /curated DOI catalogue/i);
  }
  assert.deepEqual(
    statistics.impactFactors,
    {
      status: 'unavailable',
      metric: 'Journal Impact Factor',
      total: null,
      coveredPublications: 0,
      publicationTotal: source.publications.length,
      source: null,
      edition: null,
      licenseConfirmed: false,
      aggregatePublicationAuthorized: false,
      updatedAt: null,
      reason: 'No authoritative, licensed, locally curated Journal Impact Factor dataset is configured; no proxy metric is inferred.'
    }
  );
  assert.deepEqual(
    statistics.journalStanding,
    {
      status: 'unavailable',
      publicationTotal: source.publications.length,
      coveredPublications: 0,
      unavailablePublications: source.publications.length,
      bands: [],
      source: null,
      edition: null,
      licenseConfirmed: false,
      aggregatePublicationAuthorized: false,
      aggregateRankingDisplayAuthorized: false,
      updatedAt: null,
      yearBasis: 'Previous-year JCR: publication year Y uses JCR year Y-1.',
      reason: 'No licensed JCR input is configured. Previous-year JCR ranking aggregates are unavailable, and publication-year or current JCR data are not substituted.'
    }
  );

  const includedTeamTitles = new Set([
    'Postdoctoral Researchers',
    'Graduate Students',
    'Undergraduates'
  ]);
  const expectedTeamGroups = source.people.groups
    .filter(group => includedTeamTitles.has(group.title) && group.people.length > 0);
  assert.equal(
    statistics.team.total,
    expectedTeamGroups.reduce((sum, group) => sum + group.people.length, 0)
  );
  assert.deepEqual(
    Object.fromEntries(statistics.team.groups.map(group => [group.label, group.count])),
    Object.fromEntries(expectedTeamGroups.map(group => [group.title, group.people.length]))
  );
  const serialized = JSON.stringify(statistics);
  assert.equal(serialized.includes('@pusan.ac.kr'), false);
  assert.equal(serialized.includes('linkedin.com'), false);
});

test('writes deterministic bytes without leaking a browser global', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-statistics-deterministic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const originalWindow = globalThis.window;
  const first = await generateFixture(directory, 'first.json');
  const second = await generateFixture(directory, 'second.json');
  const [firstBytes, secondBytes] = await Promise.all([
    fs.readFile(first.outputPath),
    fs.readFile(second.outputPath)
  ]);

  assert.deepEqual(firstBytes, secondBytes);
  assert.equal(firstBytes.at(-1), 10);
  assert.equal(firstBytes.toString('utf8').includes('generatedAt'), false);
  assert.strictEqual(globalThis.window, originalWindow);
  assert.deepEqual(first.statistics, second.statistics);
});

test('normalizes duplicate citation years and keeps sources separate', () => {
  const publications = [
    {
      no: '01',
      doi: '10.1000/source-first',
      year: '2024',
      journal: 'Journal A',
      topics: ['Adsorption', 'Carbon Capture'],
      reviewTopic: false
    },
    {
      no: '02',
      doi: '10.1000/source-second',
      year: '2025',
      journal: 'The Journal A',
      topics: ['Review'],
      reviewTopic: 'Applications'
    }
  ];
  const metadata = {
    snapshotUpdatedAt: '2026-01-01T00:00:00.000Z',
    sources: {
      googleScholar: {
        status: 'stale',
        provider: 'Test Google Scholar Provider',
        reason: 'request-failed',
        contentUpdatedAt: '2026-01-01T00:00:00.000Z'
      },
      openAlex: {
        status: 'ok',
        provider: 'OpenAlex API',
        reason: null,
        matched: 1,
        contentUpdatedAt: '2026-01-01T00:00:00.000Z'
      },
      semanticScholar: {
        status: 'unavailable',
        provider: 'Semantic Scholar API',
        reason: 'not-configured',
        matched: 2,
        contentUpdatedAt: null
      }
    },
    totals: {
      googleScholarCitations: 20,
      openAlexCitations: 15,
      semanticScholarCitations: 12
    },
    googleScholar: {
      profileUrl: 'https://scholar.google.com/citations?user=test',
      citations: { all: 20 },
      hIndex: { all: 8, since: 5, sinceYear: 2021 },
      countsByYear: [
        { year: 2024, citationCount: 2 },
        { year: 2024, citationCount: 3 },
        { year: 2025, citationCount: 4 }
      ]
    },
    publications: {
      first: {
        doi: '10.1000/source-first',
        openAlex: {
          citationCount: 10,
          countsByYear: [
            { year: 2024, citationCount: 2 },
            { year: 2025, citationCount: 1 }
          ]
        },
        semanticScholar: { citationCount: 7 }
      },
      second: {
        doi: '10.1000/source-second',
        openAlex: {
          citationCount: 5,
          countsByYear: [
            { year: 2024, citationCount: 3 },
            { year: 'invalid', citationCount: 9 }
          ]
        },
        semanticScholar: { citationCount: 5 }
      }
    }
  };
  const bibliography = {
    publications: {
      first: {
        authors: [
          {
            given: 'Yongchul G.',
            family: 'Chung',
            orcid: 'https://orcid.org/0000-0002-7756-0589'
          },
          { given: 'Alpha', family: 'Researcher' }
        ]
      },
      second: {
        authors: [
          { given: 'Yongchul Greg', family: 'Chung' },
          { given: 'Beta', family: 'Researcher' }
        ]
      }
    }
  };
  const people = {
    groups: [
      { title: 'Postdoctoral Researchers', people: [{}] },
      { title: 'Graduate Students', people: [{}, {}] },
      { title: 'Undergraduates', people: [] },
      { title: 'Visitors', people: [{ name: 'Not included' }] }
    ],
    alumni: [{ title: 'Graduate Students', people: [{ name: 'Not included' }] }]
  };

  const result = deriveLabStatistics({
    publications,
    metadata,
    bibliography,
    people,
    currentYear: 2026
  });
  const sources = Object.fromEntries(result.citations.sources.map(source => [source.id, source]));
  assert.deepEqual(sources.googleScholar.countsByYear, [
    { year: 2024, count: 5 },
    { year: 2025, count: 4 }
  ]);
  assert.deepEqual(sources.openAlex.countsByYear, [
    { year: 2024, count: 5 },
    { year: 2025, count: 1 }
  ]);
  assert.deepEqual(sources.openAlex.cumulativeCountsByYear, [
    { year: 2024, count: 5 },
    { year: 2025, count: 6 }
  ]);
  assert.deepEqual(sources.openAlex.history, {
    status: 'partial',
    annualTotal: 6,
    reportedTotal: 15,
    reconciliationDelta: 9,
    unassignedCount: 9,
    excessAnnualCount: 0,
    reason: 'provider-total-includes-citations-without-assigned-year'
  });
  assert.equal(sources.openAlex.status, 'partial');
  assert.equal(sources.openAlex.reason, 'Partial coverage: 1 of 2 catalogue publications matched.');
  assert.equal(sources.openAlex.matched, 1);
  assert.deepEqual(sources.semanticScholar.countsByYear, []);
  assertCitationHistory(sources.googleScholar);
  assertCitationHistory(sources.openAlex);
  assertCitationHistory(sources.semanticScholar);
  assert.deepEqual(
    {
      status: sources.googleScholar.status,
      total: sources.googleScholar.total,
      provider: sources.googleScholar.provider,
      reason: sources.googleScholar.reason,
      matched: sources.googleScholar.matched,
      publicationTotal: sources.googleScholar.publicationTotal,
      updatedAt: sources.googleScholar.updatedAt
    },
    {
      status: 'stale',
      total: 20,
      provider: 'Test Google Scholar Provider',
      reason: 'request-failed',
      matched: null,
      publicationTotal: 2,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  );
  assert.deepEqual(
    {
      status: sources.semanticScholar.status,
      total: sources.semanticScholar.total,
      provider: sources.semanticScholar.provider,
      reason: sources.semanticScholar.reason,
      matched: sources.semanticScholar.matched,
      publicationTotal: sources.semanticScholar.publicationTotal,
      updatedAt: sources.semanticScholar.updatedAt
    },
    {
      status: 'unavailable',
      total: null,
      provider: 'Semantic Scholar API',
      reason: 'not-configured',
      matched: 2,
      publicationTotal: 2,
      updatedAt: null
    }
  );
  assert.equal(Object.hasOwn(result.citations, 'total'), false);
  assert.deepEqual(result.metrics.hIndex, {
    status: 'stale',
    value: 8,
    since: 5,
    sinceYear: 2021,
    source: 'Google Scholar',
    provider: 'Test Google Scholar Provider',
    reason: 'request-failed',
    updatedAt: '2026-01-01T00:00:00.000Z',
    matched: null,
    publicationTotal: 2,
    method: 'Reported by the Google Scholar author profile.',
    profileUrl: 'https://scholar.google.com/citations?user=test'
  });
  assert.deepEqual(result.publications, {
    total: 2,
    articles: 1,
    reviews: 1,
    firstYear: 2024,
    lastPublicationYear: 2025,
    lastYear: 2026,
    currentYearPartial: true,
    byYear: [
      { year: 2024, count: 1, partial: false },
      { year: 2025, count: 1, partial: false },
      { year: 2026, count: 0, partial: true }
    ]
  });
  assert.equal(result.journals.publicationTotal, 2);
  assert.equal(result.journals.distinctCount, 1);
  assert.deepEqual(result.journals.groups, [{ name: 'Journal A', count: 2 }]);
  assert.equal(result.coauthors.totalAuthors, 3);
  assert.equal(result.coauthors.totalCollaborators, 2);
  assert.equal(result.coauthors.displayedAuthors, 3);
  assert.equal(result.team.total, 3);
});

test('keeps provider-unassigned citation delta out of annual and cumulative years', () => {
  const publications = [{
    no: '01',
    doi: '10.1000/unassigned-citation-year',
    year: 2026,
    journal: 'Journal A',
    topics: ['Adsorption']
  }];
  const result = deriveLabStatistics({
    publications,
    metadata: minimalMetadata({
      sources: {
        googleScholar: { status: 'unavailable', reason: 'not-configured' },
        openAlex: {
          status: 'ok',
          matched: 1,
          contentUpdatedAt: '2026-01-01T00:00:00.000Z'
        },
        semanticScholar: { status: 'unavailable', reason: 'not-configured' }
      },
      publications: {
        only: {
          doi: publications[0].doi,
          openAlex: {
            citationCount: 5700,
            countsByYear: [
              { year: 2024, citationCount: 2800 },
              { year: 2025, citationCount: 2899 }
            ]
          }
        }
      }
    }),
    bibliography: {
      publications: {
        only: {
          authors: [{
            given: 'Yongchul G.',
            family: 'Chung',
            orcid: '0000-0002-7756-0589'
          }]
        }
      }
    },
    people: minimalPeople(),
    currentYear: 2026
  });

  const openAlex = result.citations.sources.find(source => source.id === 'openAlex');
  assert.equal(openAlex.status, 'ok');
  assert.equal(openAlex.total, 5700);
  assert.deepEqual(openAlex.countsByYear, [
    { year: 2024, count: 2800 },
    { year: 2025, count: 2899 }
  ]);
  assert.deepEqual(openAlex.cumulativeCountsByYear, [
    { year: 2024, count: 2800 },
    { year: 2025, count: 5699 }
  ]);
  assert.deepEqual(openAlex.history, {
    status: 'partial',
    annualTotal: 5699,
    reportedTotal: 5700,
    reconciliationDelta: 1,
    unassignedCount: 1,
    excessAnnualCount: 0,
    reason: 'provider-total-includes-citations-without-assigned-year'
  });
  assert.equal(openAlex.countsByYear.reduce((sum, point) => sum + point.count, 0), 5699);
  assert.equal(openAlex.cumulativeCountsByYear.at(-1).count, 5699);
});

test('keeps the actual reporting year partial when the catalogue contains a future publication', () => {
  const result = deriveLabStatistics({
    publications: [{
      no: '01',
      doi: '10.1000/future-publication',
      year: 2028,
      journal: 'Future Journal',
      topics: ['Adsorption']
    }],
    metadata: minimalMetadata(),
    bibliography: {
      publications: {
        future: {
          authors: [{
            given: 'Yongchul G.',
            family: 'Chung',
            orcid: 'https://orcid.org/0000-0002-7756-0589'
          }]
        }
      }
    },
    people: minimalPeople(),
    currentYear: 2026
  });

  assert.deepEqual(result.publications, {
    total: 1,
    articles: 1,
    reviews: 0,
    firstYear: 2026,
    lastPublicationYear: 2028,
    lastYear: 2028,
    currentYearPartial: true,
    byYear: [
      { year: 2026, count: 0, partial: true },
      { year: 2027, count: 0, partial: false },
      { year: 2028, count: 1, partial: false }
    ]
  });
});

test('accepts Unicode and reserved punctuation through the canonical DOI parser', () => {
  const result = deriveLabStatistics({
    publications: [{
      no: '01',
      doi: '10.1000/Über?x=1&y=2#part',
      year: 2026,
      journal: 'Journal A',
      topics: ['Adsorption']
    }],
    metadata: minimalMetadata(),
    bibliography: {
      publications: {
        unicode: {
          authors: [{
            given: 'Yongchul G.',
            family: 'Chung',
            orcid: 'https://orcid.org/0000-0002-7756-0589'
          }]
        }
      }
    },
    people: minimalPeople(),
    currentYear: 2026,
    impactFactorJson: {
      metric: 'Journal Impact Factor',
      provider: 'Clarivate Journal Citation Reports',
      edition: '2025 JCR edition',
      updatedAt: '2026-07-30T00:00:00.000Z',
      licenseConfirmed: true,
      aggregatePublicationAuthorized: true,
      factorsByDoi: {
        'https://doi.org/10.1000/Über?x=1&y=2#part': {
          jcrYear: 2025,
          jif: 4.25
        }
      }
    }
  });

  assert.equal(result.impactFactors.status, 'ok');
  assert.equal(result.impactFactors.coveredPublications, 1);
  assert.equal(result.impactFactors.total, 4.25);
});

test('represents missing and unavailable citation totals as null without invented zeroes', () => {
  const publications = [{
    no: '01',
    doi: '10.1000/missing-total',
    year: 2025,
    journal: 'Journal A',
    topics: ['Adsorption']
  }];
  const metadata = minimalMetadata({
    sources: {
      googleScholar: {
        status: 'ok',
        contentUpdatedAt: '2026-01-01T00:00:00.000Z'
      },
      openAlex: { status: 'unavailable', reason: 'request-failed' },
      semanticScholar: { status: 'unavailable', reason: 'not-configured' }
    },
    googleScholar: {
      countsByYear: [{ year: 2025, citationCount: 9 }]
    }
  });
  const bibliography = {
    publications: {
      only: {
        authors: [{
          given: 'Yongchul G.',
          family: 'Chung',
          orcid: '0000-0002-7756-0589'
        }]
      }
    }
  };

  const result = deriveLabStatistics({
    publications,
    metadata,
    bibliography,
    people: minimalPeople(),
    currentYear: 2026
  });
  const sources = Object.fromEntries(result.citations.sources.map(source => [source.id, source]));

  assert.deepEqual(sources.googleScholar, {
    id: 'googleScholar',
    label: 'Google Scholar',
    status: 'unavailable',
    total: null,
    provider: 'Google Scholar author profile',
    reason: 'citation-total-unavailable',
    matched: null,
    publicationTotal: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    countsByYear: [],
    cumulativeCountsByYear: [],
    history: {
      status: 'unavailable',
      annualTotal: null,
      reportedTotal: null,
      reconciliationDelta: null,
      unassignedCount: null,
      excessAnnualCount: null,
      reason: 'provider-year-history-unavailable'
    }
  });
  assert.equal(sources.openAlex.total, null);
  assert.equal(sources.openAlex.provider, 'OpenAlex API');
  assert.deepEqual(sources.openAlex.countsByYear, []);
  assert.equal(sources.semanticScholar.total, null);
  assert.equal(sources.semanticScholar.provider, 'Semantic Scholar API');
  assert.deepEqual(sources.semanticScholar.countsByYear, []);
  assertCitationHistory(sources.googleScholar);
  assertCitationHistory(sources.openAlex);
  assertCitationHistory(sources.semanticScholar);

  const zeroMetadata = JSON.parse(JSON.stringify(metadata));
  zeroMetadata.sources.googleScholar.status = 'stale';
  zeroMetadata.googleScholar = { citations: { all: 0 }, countsByYear: [] };
  const zeroResult = deriveLabStatistics({
    publications,
    metadata: zeroMetadata,
    bibliography,
    people: minimalPeople(),
    currentYear: 2026
  });
  const zeroScholar = zeroResult.citations.sources.find(source => source.id === 'googleScholar');
  assert.equal(zeroScholar.status, 'stale');
  assert.equal(zeroScholar.total, 0);
  assert.equal(zeroScholar.reason, 'source-stale');
  assertCitationHistory(zeroScholar);
});

test('scopes citation aggregation and fallback metrics to feed DOI identities', () => {
  const publications = [
    {
      no: '01',
      doi: '10.1000/scoped-a',
      year: 2025,
      journal: 'Journal A',
      topics: ['Adsorption']
    },
    {
      no: '02',
      doi: '10.1000/scoped-b',
      year: 2025,
      journal: 'Journal B',
      topics: ['Carbon Capture']
    }
  ];
  const bibliography = {
    publications: {
      first: {
        authors: [{
          given: 'Yongchul G.',
          family: 'Chung',
          orcid: '0000-0002-7756-0589'
        }]
      },
      second: {
        authors: [{ given: 'Yongchul Greg', family: 'Chung' }]
      }
    }
  };
  const metadata = minimalMetadata({
    sources: {
      googleScholar: { status: 'unavailable', reason: 'not-configured' },
      openAlex: {
        status: 'ok',
        matched: 3,
        contentUpdatedAt: '2026-01-04T00:00:00.000Z'
      },
      semanticScholar: {
        status: 'ok',
        matched: 3,
        contentUpdatedAt: '2026-01-04T00:00:00.000Z'
      }
    },
    totals: {
      openAlexCitations: 1_010,
      semanticScholarCitations: 1_006
    },
    publications: {
      'https://doi.org/10.1000/SCOPED-A': {
        doi: '10.1000/scoped-a',
        openAlex: {
          citationCount: 10,
          countsByYear: [{ year: 2025, citationCount: 2 }]
        },
        semanticScholar: { citationCount: 4 }
      },
      '10.1000/scoped-b': {
        openAlex: {
          citationCount: 0,
          countsByYear: [{ year: 2026, citationCount: 1 }]
        },
        semanticScholar: { citationCount: 2 }
      },
      '10.1000/not-in-feed': {
        doi: '10.1000/not-in-feed',
        openAlex: {
          citationCount: 1_000,
          countsByYear: [{ year: 1999, citationCount: 999 }]
        },
        semanticScholar: { citationCount: 1_000 }
      },
      'legacy-extra-key': {
        openAlex: {
          citationCount: 500,
          countsByYear: [{ year: 2000, citationCount: 500 }]
        }
      }
    }
  });

  const result = deriveLabStatistics({
    publications,
    metadata,
    bibliography,
    people: minimalPeople(),
    currentYear: 2026
  });
  const sources = Object.fromEntries(result.citations.sources.map(source => [source.id, source]));

  assert.equal(sources.openAlex.status, 'ok');
  assert.equal(sources.openAlex.total, 10);
  assert.equal(sources.openAlex.matched, 2);
  assert.deepEqual(sources.openAlex.countsByYear, [
    { year: 2025, count: 2 },
    { year: 2026, count: 1 }
  ]);
  assert.equal(sources.semanticScholar.status, 'ok');
  assert.equal(sources.semanticScholar.total, 6);
  assert.equal(sources.semanticScholar.matched, 2);
  assert.deepEqual(result.metrics.hIndex, {
    status: 'ok',
    value: 1,
    since: null,
    sinceYear: null,
    source: 'OpenAlex',
    provider: 'OpenAlex API',
    reason: null,
    updatedAt: '2026-01-04T00:00:00.000Z',
    matched: 2,
    publicationTotal: 2,
    method: 'Derived from per-publication OpenAlex citation counts for the curated DOI catalogue.'
  });

  const mismatchedIdentity = JSON.parse(JSON.stringify(metadata));
  mismatchedIdentity.publications['10.1000/scoped-b'].doi = '10.1000/scoped-a';
  assert.throws(
    () => deriveLabStatistics({
      publications,
      metadata: mismatchedIdentity,
      bibliography,
      people: minimalPeople(),
      currentYear: 2026
    }),
    /key .* conflicts with record DOI/
  );

  const duplicateIdentity = JSON.parse(JSON.stringify(metadata));
  duplicateIdentity.publications['doi: 10.1000/scoped-a'] = {
    doi: '10.1000/scoped-a',
    openAlex: { citationCount: 10 }
  };
  assert.throws(
    () => deriveLabStatistics({
      publications,
      metadata: duplicateIdentity,
      bibliography,
      people: minimalPeople(),
      currentYear: 2026
    }),
    /duplicate records for feed DOI/
  );
});

test('falls back to a catalogue OpenAlex h-index with explicit coverage provenance', () => {
  const publications = [1, 2, 3].map(index => ({
    no: String(index).padStart(2, '0'),
    doi: `10.1000/openalex-${index}`,
    year: 2025,
    journal: 'Journal A',
    topics: ['Adsorption']
  }));
  const bibliography = {
    publications: Object.fromEntries(publications.map((publication, index) => [
      publication.no,
      {
        authors: [
          {
            given: 'Yongchul G.',
            family: 'Chung',
            orcid: '0000-0002-7756-0589'
          },
          { given: `Researcher ${index + 1}`, family: 'Example' }
        ]
      }
    ]))
  };
  const metadata = minimalMetadata({
    sources: {
      googleScholar: {
        status: 'unavailable',
        reason: 'profile-private',
        contentUpdatedAt: null
      },
      openAlex: {
        status: 'ok',
        matched: 3,
        contentUpdatedAt: '2026-01-02T00:00:00.000Z'
      },
      semanticScholar: { status: 'unavailable', reason: 'not-configured' }
    },
    totals: { openAlexCitations: 14 },
    googleScholar: {
      hIndex: { all: 99, since: 50, sinceYear: 2021 }
    },
    publications: {
      first: {
        doi: '10.1000/openalex-1',
        openAlex: { citationCount: 10 }
      },
      second: {
        doi: '10.1000/openalex-2',
        openAlex: { citationCount: 3 }
      },
      third: {
        doi: '10.1000/openalex-3',
        openAlex: { citationCount: 1 }
      }
    }
  });

  const complete = deriveLabStatistics({
    publications,
    metadata,
    bibliography,
    people: minimalPeople(),
    currentYear: 2026
  });
  assert.deepEqual(complete.metrics.hIndex, {
    status: 'ok',
    value: 2,
    since: null,
    sinceYear: null,
    source: 'OpenAlex',
    provider: 'OpenAlex API',
    reason: null,
    updatedAt: '2026-01-02T00:00:00.000Z',
    matched: 3,
    publicationTotal: 3,
    method: 'Derived from per-publication OpenAlex citation counts for the curated DOI catalogue.'
  });

  const partialMetadata = JSON.parse(JSON.stringify(metadata));
  delete partialMetadata.publications.third.openAlex;
  partialMetadata.sources.openAlex.matched = 2;
  const partial = deriveLabStatistics({
    publications,
    metadata: partialMetadata,
    bibliography,
    people: minimalPeople(),
    currentYear: 2026
  });
  assert.deepEqual(partial.metrics.hIndex, {
    status: 'partial',
    value: 2,
    since: null,
    sinceYear: null,
    source: 'OpenAlex',
    provider: 'OpenAlex API',
    reason: 'incomplete-catalogue-coverage',
    updatedAt: '2026-01-02T00:00:00.000Z',
    matched: 2,
    publicationTotal: 3,
    method: 'Derived from per-publication OpenAlex citation counts for the curated DOI catalogue.'
  });
});

test('uses explicit ORCIDs before name matching in the coauthor network', () => {
  const publications = [1, 2, 3].map(index => ({
    no: String(index).padStart(2, '0'),
    doi: `10.1000/orcid-${index}`,
    year: 2025,
    journal: 'Journal A',
    topics: ['Adsorption']
  }));
  const bibliography = {
    publications: {
      first: {
        authors: [
          {
            given: 'Yongchul G.',
            family: 'Chung',
            orcid: '0000-0002-7756-0589'
          },
          { given: 'Alex', family: 'Kim', orcid: '0000-0001-0000-0001' }
        ]
      },
      second: {
        authors: [
          { given: 'Yongchul Greg', family: 'Chung' },
          { given: 'Alex', family: 'Kim', orcid: '0000-0001-0000-0002' }
        ]
      },
      third: {
        authors: [
          {
            given: 'Yongchul G.',
            family: 'Chung',
            orcid: '0000-0002-7756-0589'
          },
          {
            given: 'Yongchul',
            family: 'Chung',
            orcid: '0000-0001-9999-9999'
          }
        ]
      }
    }
  };

  const result = deriveLabStatistics({
    publications,
    metadata: minimalMetadata(),
    bibliography,
    people: minimalPeople(),
    currentYear: 2026
  });
  const alexNodes = result.coauthors.nodes.filter(node => node.label === 'Alex Kim');
  const chungNodes = result.coauthors.nodes.filter(node => /Yongchul.*Chung/i.test(node.label));

  assert.equal(alexNodes.length, 2);
  assert.equal(new Set(alexNodes.map(node => node.id)).size, 2);
  assert.equal(chungNodes.length, 2);
  assert.equal(chungNodes.filter(node => node.isPrincipalInvestigator).length, 1);
  assert.equal(
    chungNodes.find(node => !node.isPrincipalInvestigator).publicationCount,
    1
  );
  assert.equal(result.coauthors.totalAuthors, 4);

  const conflictingBibliography = {
    publications: {
      first: {
        authors: [
          {
            given: 'Yongchul G.',
            family: 'Chung',
            orcid: '0000-0002-7756-0589'
          },
          { given: 'Wei', family: 'Li', orcid: '0000-0001-2345-6789' }
        ]
      },
      second: {
        authors: [
          { given: 'Yongchul Greg', family: 'Chung' },
          { given: 'Song', family: 'Li', orcid: '0000-0001-2345-6789' }
        ]
      },
      third: {
        authors: [{
          given: 'Yongchul G',
          family: 'Chung',
          orcid: '0000-0002-7756-0589'
        }]
      }
    }
  };
  assert.throws(
    () => deriveLabStatistics({
      publications,
      metadata: minimalMetadata(),
      bibliography: conflictingBibliography,
      people: minimalPeople(),
      currentYear: 2026
    }),
    /ORCID 0000-0001-2345-6789.*conflicting given\/family names.*Wei Li.*Song Li/
  );

  const conflictingFamily = JSON.parse(JSON.stringify(conflictingBibliography));
  conflictingFamily.publications.second.authors[1] = {
    given: 'Wei',
    family: 'Kim',
    orcid: '0000-0001-2345-6789'
  };
  assert.throws(
    () => deriveLabStatistics({
      publications,
      metadata: minimalMetadata(),
      bibliography: conflictingFamily,
      people: minimalPeople(),
      currentYear: 2026
    }),
    /ORCID 0000-0001-2345-6789.*conflicting given\/family names.*Wei Li.*Wei Kim/
  );
});

test('derives only licensed DOI-keyed Journal Impact Factor aggregates', () => {
  const publications = [
    {
      no: '01',
      doi: '10.1000/alpha',
      year: 2025,
      journal: 'Journal A',
      topics: ['Adsorption']
    },
    {
      no: '02',
      doi: '10.1000/beta',
      year: 2025,
      journal: 'Journal B',
      topics: ['Carbon Capture']
    }
  ];
  const bibliography = {
    publications: {
      first: {
        authors: [{
          given: 'Yongchul G.',
          family: 'Chung',
          orcid: '0000-0002-7756-0589'
        }]
      },
      second: {
        authors: [{
          given: 'Yongchul Greg',
          family: 'Chung'
        }]
      }
    }
  };
  const baseDataset = {
    metric: 'Journal Impact Factor',
    provider: 'Clarivate Journal Citation Reports',
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    updatedAt: '2026-01-03T00:00:00.000Z',
    edition: '2025 edition',
    factorsByDoi: {
      'https://doi.org/10.1000/ALPHA': { jcrYear: 2024, jif: 2.5 },
      'doi: 10.1000/beta': { jcrYear: 2024, jif: 3.75 }
    }
  };
  const common = {
    publications,
    metadata: minimalMetadata(),
    bibliography,
    people: minimalPeople(),
    currentYear: 2026
  };

  const complete = deriveLabStatistics({
    ...common,
    impactFactorJson: JSON.stringify(baseDataset)
  });
  assert.deepEqual(complete.impactFactors, {
    status: 'ok',
    metric: 'Journal Impact Factor',
    total: 6.25,
    coveredPublications: 2,
    publicationTotal: 2,
    source: 'Clarivate Journal Citation Reports',
    edition: '2025 edition',
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    updatedAt: '2026-01-03T00:00:00.000Z',
    reason: null
  });
  assert.equal(Object.hasOwn(complete.impactFactors, 'factorsByDoi'), false);

  const partial = deriveLabStatistics({
    ...common,
    impactFactorJson: {
      ...baseDataset,
      factorsByDoi: { '10.1000/alpha': { jcrYear: 2024, jif: 2.5 } }
    }
  });
  assert.deepEqual(partial.impactFactors, {
    status: 'partial',
    metric: 'Journal Impact Factor',
    total: 2.5,
    coveredPublications: 1,
    publicationTotal: 2,
    source: 'Clarivate Journal Citation Reports',
    edition: '2025 edition',
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    updatedAt: '2026-01-03T00:00:00.000Z',
    reason: 'Partial coverage: 1 of 2 catalogue publications have an authorized Journal Impact Factor value.'
  });

  const invalidCases = [
    [{ ...baseDataset, metric: 'CiteScore' }, /metric/],
    [{ ...baseDataset, provider: 'OpenAlex CiteScore' }, /provider/],
    [{ ...baseDataset, licenseConfirmed: false }, /licenseConfirmed/],
    [{ ...baseDataset, aggregatePublicationAuthorized: false }, /aggregatePublicationAuthorized/],
    [{ ...baseDataset, updatedAt: 'not-a-date' }, /updatedAt/],
    [{ ...baseDataset, edition: '  ' }, /edition/],
    [{ ...baseDataset, factorsByDoi: { '10.1000/alpha': -1 } }, /must be an object/],
    [{ ...baseDataset, factorsByDoi: { '10.1000/alpha': { jcrYear: 2024, jif: -1 } } }, /jif must be a non-negative finite/],
    [{ ...baseDataset, factorsByDoi: { '10.1000/alpha': { jcrYear: 2024, jif: '2.5' } } }, /jif must be a non-negative finite/],
    [{ ...baseDataset, factorsByDoi: { '10.1000/alpha': { jcrYear: 2025, jif: 2.5 } } }, /must equal previous-year JCR year 2024/],
    [{ ...baseDataset, factorsByDoi: { '10.1000/alpha': { jif: 2.5 } } }, /jcrYear must be a valid year/],
    [{ ...baseDataset, factorsByDoi: { '10.1000/alpha': { jcrYear: 2024, jif: 2.5, proxy: 'CiteScore' } } }, /unexpected fields/],
    [{ ...baseDataset, factorsByDoi: { '10.1000/other': { jcrYear: 2024, jif: 2.5 } } }, /not present/],
    ['{not valid json', /valid JSON/]
  ];
  invalidCases.forEach(([impactFactorJson, expectedError]) => {
    assert.throws(
      () => deriveLabStatistics({ ...common, impactFactorJson }),
      expectedError
    );
  });

  const noFactors = deriveLabStatistics({
    ...common,
    impactFactorJson: { ...baseDataset, factorsByDoi: {} }
  });
  assert.deepEqual(noFactors.impactFactors, {
    status: 'unavailable',
    metric: 'Journal Impact Factor',
    total: null,
    coveredPublications: 0,
    publicationTotal: 2,
    source: 'Clarivate Journal Citation Reports',
    edition: '2025 edition',
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    updatedAt: '2026-01-03T00:00:00.000Z',
    reason: 'No licensed DOI-keyed Journal Impact Factor values are configured; no proxy metric is inferred.'
  });
});

test('derives a deterministic public-only JCR input requirements manifest', () => {
  const requirements = deriveJcrInputRequirements([
    {
      no: '02',
      doi: 'https://doi.org/10.1000/ALPHA',
      title: 'Alpha paper',
      journal: 'Journal Alpha',
      year: 2026
    },
    {
      no: '01',
      doi: 'doi: 10.1000/beta',
      title: 'Beta paper',
      journal: 'Journal Beta',
      year: 2025
    }
  ]);
  assert.deepEqual(requirements, {
    schemaVersion: 1,
    publicationTotal: 2,
    yearBasis: 'Previous-year JCR: publication year Y uses JCR year Y-1.',
    records: [
      {
        no: '02',
        doi: '10.1000/alpha',
        title: 'Alpha paper',
        journal: 'Journal Alpha',
        publicationYear: 2026,
        requiredJcrYear: 2025
      },
      {
        no: '01',
        doi: '10.1000/beta',
        title: 'Beta paper',
        journal: 'Journal Beta',
        publicationYear: 2025,
        requiredJcrYear: 2024
      }
    ]
  });
  assert.doesNotMatch(
    JSON.stringify(requirements),
    /"jif"|"rank"|"quartile"|"categories"|"jifPercentile"/
  );
});

test('rejects malformed JCR input requirements instead of guessing years', () => {
  const valid = {
    no: '01',
    doi: '10.1000/alpha',
    title: 'Alpha paper',
    journal: 'Journal Alpha',
    year: 2025
  };
  assert.throws(
    () => deriveJcrInputRequirements([{ ...valid }, { ...valid }]),
    /duplicate DOI/
  );
  assert.throws(
    () => deriveJcrInputRequirements([{ ...valid, year: 'unknown' }]),
    /must be a valid year/
  );
  assert.throws(
    () => deriveJcrInputRequirements([{ ...valid, journal: ' ' }]),
    /nonempty no, title, and journal/
  );
});

test('writes all catalogue DOI and previous-year JCR lookup requirements', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jcr-requirements-'));
  const outputPath = path.join(directory, 'requirements.json');
  const repeatedOutputPath = path.join(directory, 'requirements-repeated.json');
  try {
    const requirements = await generateJcrInputRequirementsFile({
      feedPath: FEED_PATH,
      outputPath
    });
    await generateJcrInputRequirementsFile({
      feedPath: FEED_PATH,
      outputPath: repeatedOutputPath
    });
    const publications = await loadBrowserData(FEED_PATH, 'window.MTAP_FEED.PUBS');
    assert.equal(requirements.publicationTotal, publications.length);
    assert.equal(requirements.records.length, publications.length);
    assert.equal(
      new Set(requirements.records.map(record => record.doi)).size,
      publications.length
    );
    requirements.records.forEach(record => {
      assert.equal(record.requiredJcrYear, record.publicationYear - 1);
    });
    assert.deepEqual(
      JSON.parse(await fs.readFile(outputPath, 'utf8')),
      requirements
    );
    assert.deepEqual(
      await fs.readFile(repeatedOutputPath),
      await fs.readFile(outputPath)
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('validates and deterministically compacts private licensed JCR input', () => {
  const publications = [{
    no: '01',
    doi: '10.1000/jcr-private',
    title: 'Private input validation',
    journal: 'Journal A',
    year: 2026,
    topics: ['Adsorption']
  }];
  const dataset = {
    rankingsByDoi: {
      '10.1000/jcr-private': {
        categories: [{
          quartile: 'Q1',
          jifPercentile: 99.5,
          categoryTotal: 100,
          rank: 1,
          category: 'Chemical Engineering'
        }],
        jcrYear: 2025
      }
    },
    factorsByDoi: {
      '10.1000/jcr-private': { jif: 12.3, jcrYear: 2025 }
    },
    edition: 'Historical JCR through 2025',
    updatedAt: '2026-07-31T00:00:00.000Z',
    aggregatePublicationAuthorized: true,
    licenseConfirmed: true,
    provider: 'Clarivate Journal Citation Reports',
    metric: 'Journal Impact Factor',
    aggregateRankingDisplayAuthorized: true,
    rankingAuthorizationReference: 'Public aggregate permission 2026-001',
    rankingAuthorizationDate: '2026-07-31'
  };
  const first = prepareLicensedJcrInput({
    publications,
    impactFactorJson: JSON.stringify(dataset, null, 2)
  });
  const second = prepareLicensedJcrInput({
    publications,
    impactFactorJson: structuredClone(dataset)
  });

  assert.equal(first.compactJson, second.compactJson);
  assert.equal(Buffer.byteLength(first.compactJson, 'utf8'), first.summary.compactBytes);
  assert.deepEqual(first.summary, {
    publicationTotal: 1,
    factorRecords: 1,
    rankingRecords: 1,
    compactBytes: first.summary.compactBytes,
    maxSecretBytes: 49_152,
    impactFactorStatus: 'ok',
    journalStandingStatus: 'ok',
    publicationBandStatus: 'unavailable',
    publicationBandRecords: 0
  });
  assert.equal(JSON.stringify(JSON.parse(first.compactJson)), first.compactJson);
  assert.throws(
    () => prepareLicensedJcrInput({
      publications,
      impactFactorJson: dataset,
      maxSecretBytes: first.summary.compactBytes - 1
    }),
    /exceeding the GitHub Actions secret limit/
  );
  assert.throws(
    () => prepareLicensedJcrInput({
      publications,
      impactFactorJson: { ...dataset, helperMetadata: true }
    }),
    /unexpected fields: helperMetadata/
  );

  const unauthorizedMalformed = structuredClone(dataset);
  unauthorizedMalformed.aggregateRankingDisplayAuthorized = false;
  delete unauthorizedMalformed.rankingAuthorizationReference;
  delete unauthorizedMalformed.rankingAuthorizationDate;
  unauthorizedMalformed.rankingsByDoi['10.1000/jcr-private'].jcrYear = 2024;
  assert.throws(
    () => prepareLicensedJcrInput({
      publications,
      impactFactorJson: unauthorizedMalformed
    }),
    /must equal previous-year JCR year 2025/
  );
});

test('validates a private JCR file and writes a new compact file without overwriting', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jcr-private-'));
  const inputPath = path.join(directory, 'working.json');
  const outputPath = path.join(directory, 'secret.json');
  const dataset = {
    metric: 'Journal Impact Factor',
    provider: 'Clarivate JCR licensed extract',
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    updatedAt: '2026-07-31T00:00:00.000Z',
    edition: 'Historical JCR',
    factorsByDoi: {
      '10.1002/ijch.70028': { jcrYear: 2025, jif: 1.2 }
    }
  };
  try {
    await fs.writeFile(inputPath, JSON.stringify(dataset, null, 2), 'utf8');
    const summary = await validateLicensedJcrInputFile({
      feedPath: FEED_PATH,
      inputPath,
      compactOutputPath: outputPath
    });
    const compactSource = await fs.readFile(outputPath, 'utf8');
    assert.equal(summary.factorRecords, 1);
    assert.equal(summary.rankingRecords, 0);
    assert.equal(summary.compactBytes, Buffer.byteLength(compactSource, 'utf8'));
    assert.equal(JSON.stringify(JSON.parse(compactSource)), compactSource);
    await assert.rejects(
      validateLicensedJcrInputFile({
        feedPath: FEED_PATH,
        inputPath,
        compactOutputPath: outputPath
      }),
      /EEXIST/
    );
    await assert.rejects(
      validateLicensedJcrInputFile({
        feedPath: FEED_PATH,
        inputPath,
        compactOutputPath: inputPath
      }),
      /must not overwrite inputPath/
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('derives only authorized previous-year JCR standing bands from the best category percentile', () => {
  const publications = Array.from({ length: 8 }, (_, index) => ({
    no: String(index + 1).padStart(2, '0'),
    doi: `10.1000/standing-${index + 1}`,
    year: index === 0 ? 2026 : 2025,
    journal: `Journal ${index + 1}`,
    topics: ['Adsorption']
  }));
  const bibliography = {
    publications: Object.fromEntries(publications.map((publication, index) => [
      publication.doi,
      {
        authors: [{
          given: index % 2 === 0 ? 'Yongchul G.' : 'Yongchul Greg',
          family: 'Chung',
          ...(index === 0 ? { orcid: '0000-0002-7756-0589' } : {})
        }]
      }
    ]))
  };
  const category = (rank, quartile, jifPercentile, name = `Category ${rank}`) => ({
    category: name,
    rank,
    categoryTotal: 100,
    quartile,
    jifPercentile
  });
  const rankingsByDoi = {
    '10.1000/standing-1': {
      jcrYear: 2025,
      categories: [category(1, 'Q1', 99.5)]
    },
    '10.1000/standing-2': {
      jcrYear: 2024,
      categories: [
        category(40, 'Q2', 60.5, 'Lower category'),
        category(4, 'Q1', 96.5, 'Best category')
      ]
    },
    '10.1000/standing-3': {
      jcrYear: 2024,
      categories: [category(8, 'Q1', 92.5)]
    },
    '10.1000/standing-4': {
      jcrYear: 2024,
      categories: [category(15, 'Q1', 85.5)]
    },
    '10.1000/standing-5': {
      jcrYear: 2024,
      categories: [category(35, 'Q2', 65.5)]
    },
    '10.1000/standing-6': {
      jcrYear: 2024,
      categories: [category(65, 'Q3', 35.5)]
    },
    '10.1000/standing-7': {
      jcrYear: 2024,
      categories: [category(90, 'Q4', 10.5)]
    }
  };
  const baseDataset = {
    metric: 'Journal Impact Factor',
    provider: 'Clarivate Journal Citation Reports',
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    aggregateRankingDisplayAuthorized: true,
    rankingAuthorizationReference: 'Public aggregate permission 2026-001',
    rankingAuthorizationDate: '2026-01-04',
    updatedAt: '2026-01-03T00:00:00.000Z',
    edition: 'Historical JCR data through 2025',
    rankingsByDoi
  };
  const common = {
    publications,
    metadata: minimalMetadata(),
    bibliography,
    people: minimalPeople(),
    currentYear: 2026
  };

  const result = deriveLabStatistics({
    ...common,
    impactFactorJson: baseDataset
  });
  assert.equal(result.impactFactors.status, 'unavailable');
  assert.deepEqual(result.journalStanding, {
    status: 'partial',
    publicationTotal: 8,
    coveredPublications: 7,
    unavailablePublications: 1,
    bands: [
      { id: 'top1', label: 'Top 1%', count: 1 },
      { id: 'top5', label: 'Top 5%', count: 1 },
      { id: 'top10', label: 'Top 10%', count: 1 },
      { id: 'otherQ1', label: 'Other Q1', count: 1 },
      { id: 'q2', label: 'Q2', count: 1 },
      { id: 'q3', label: 'Q3', count: 1 },
      { id: 'q4', label: 'Q4', count: 1 },
      { id: 'unavailable', label: 'Unavailable', count: 1 }
    ],
    source: 'Clarivate Journal Citation Reports',
    edition: 'Historical JCR data through 2025',
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    aggregateRankingDisplayAuthorized: true,
    updatedAt: '2026-01-03T00:00:00.000Z',
    authorizationReference: 'Public aggregate permission 2026-001',
    authorizationDate: '2026-01-04',
    yearBasis: 'Previous-year JCR: publication year Y uses JCR year Y-1.',
    reason: 'Partial coverage: 7 of 8 catalogue publications have an authorized previous-year JCR ranking; 1 is unavailable and no publication-year or current JCR data are substituted.'
  });
  assert.doesNotMatch(
    JSON.stringify(result.journalStanding),
    /10\.1000\/|rankingsByDoi|jcrYear|categoryTotal|jifPercentile|"rank"|"quartile"/i
  );
  assert.equal(
    result.journalStanding.bands.reduce((sum, band) => sum + band.count, 0),
    result.journalStanding.publicationTotal
  );

  const unauthorized = deriveLabStatistics({
    ...common,
    impactFactorJson: {
      ...baseDataset,
      aggregateRankingDisplayAuthorized: false,
      rankingsByDoi: {
        '10.1000/standing-1': {
          jcrYear: 9999,
          categories: [{ privateLicensedRecord: true }]
        }
      }
    }
  }).journalStanding;
  assert.equal(unauthorized.status, 'unavailable');
  assert.deepEqual(unauthorized.bands, []);
  assert.equal(unauthorized.aggregateRankingDisplayAuthorized, false);
  assert.equal(Object.hasOwn(unauthorized, 'authorizationReference'), false);
  assert.equal(Object.hasOwn(unauthorized, 'authorizationDate'), false);
  assert.match(unauthorized.reason, /not explicitly authorized/i);

  const noRankings = deriveLabStatistics({
    ...common,
    impactFactorJson: {
      ...baseDataset,
      rankingsByDoi: {}
    }
  }).journalStanding;
  assert.equal(noRankings.status, 'unavailable');
  assert.deepEqual(noRankings.bands, []);
  assert.equal(noRankings.aggregateRankingDisplayAuthorized, true);
  assert.match(noRankings.reason, /No previous-year JCR ranking records/i);

  const invalidCases = [
    [
      dataset => {
        dataset.rankingsByDoi['10.1000/standing-1'].jcrYear = 2026;
      },
      /must equal previous-year JCR year 2025 for feed publication year 2026/
    ],
    [
      dataset => {
        dataset.rankingsByDoi['10.1000/standing-1'].jcrYear = '2025';
      },
      /must be an integer year/
    ],
    [
      dataset => {
        dataset.rankingsByDoi['10.1000/standing-1'].categories = [];
      },
      /categories must be a non-empty array/
    ],
    [
      dataset => {
        dataset.rankingsByDoi['10.1000/standing-1'].categories[0].rank = 101;
      },
      /rank must not exceed categoryTotal/
    ],
    [
      dataset => {
        dataset.rankingsByDoi['10.1000/standing-1'].categories[0].quartile = 'Q4';
      },
      /quartile Q4 is inconsistent/
    ],
    [
      dataset => {
        dataset.rankingsByDoi['10.1000/standing-1'].categories[0].jifPercentile = 80;
      },
      /official rank\/total formula/
    ],
    [
      dataset => {
        dataset.rankingsByDoi['10.1000/standing-1'].categories.push({
          ...dataset.rankingsByDoi['10.1000/standing-1'].categories[0]
        });
      },
      /category must be unique/
    ],
    [
      dataset => {
        delete dataset.rankingAuthorizationReference;
      },
      /rankingAuthorizationReference/
    ],
    [
      dataset => {
        dataset.rankingAuthorizationDate = 'not-a-date';
      },
      /rankingAuthorizationDate/
    ],
    [
      dataset => {
        dataset.rankingsByDoi['10.1000/not-in-catalogue'] =
          dataset.rankingsByDoi['10.1000/standing-1'];
      },
      /not present in the publication catalogue/
    ]
  ];
  invalidCases.forEach(([mutate, expectedError]) => {
    const dataset = structuredClone(baseDataset);
    mutate(dataset);
    assert.throws(
      () => deriveLabStatistics({ ...common, impactFactorJson: dataset }),
      expectedError
    );
  });
});

test('publishes per-paper JCR bands only with separate authorization and exact previous-year data', () => {
  const publications = [
    {
      no: '02',
      doi: '10.1000/card-2026',
      year: 2026,
      journal: 'Journal A',
      topics: ['Adsorption']
    },
    {
      no: '01',
      doi: '10.1000/card-2025',
      year: 2025,
      journal: 'Journal B',
      topics: ['Diffusion']
    }
  ];
  const baseDataset = {
    metric: 'Journal Impact Factor',
    provider: 'Clarivate Journal Citation Reports',
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    aggregateRankingDisplayAuthorized: true,
    rankingAuthorizationReference: 'Aggregate permission 2026-001',
    rankingAuthorizationDate: '2026-01-04',
    updatedAt: '2026-01-03T00:00:00.000Z',
    edition: 'Historical JCR data through 2025',
    rankingsByDoi: {
      '10.1000/card-2026': {
        jcrYear: 2025,
        categories: [{
          category: 'Example category',
          rank: 1,
          categoryTotal: 100,
          quartile: 'Q1',
          jifPercentile: 99.5
        }]
      }
    }
  };

  const unauthorized = derivePublicationJcrBands({
    publications,
    impactFactorJson: baseDataset
  });
  assert.deepEqual(unauthorized, {
    schemaVersion: 1,
    status: 'unavailable',
    displayAuthorized: false,
    publicationTotal: 2,
    coveredPublications: 0,
    yearBasis: 'Previous-year JCR: publication year Y uses JCR year Y-1.',
    bandsByDoi: {},
    reason: 'Public per-publication JCR band display is not explicitly authorized.'
  });

  const authorizedDataset = {
    ...baseDataset,
    perPublicationRankingDisplayAuthorized: true,
    perPublicationRankingAuthorizationReference: 'Per-publication display permission 2026-002',
    perPublicationRankingAuthorizationDate: '2026-01-05'
  };
  const authorized = derivePublicationJcrBands({
    publications,
    impactFactorJson: authorizedDataset
  });
  assert.deepEqual(authorized, {
    schemaVersion: 1,
    status: 'partial',
    displayAuthorized: true,
    publicationTotal: 2,
    coveredPublications: 1,
    yearBasis: 'Previous-year JCR: publication year Y uses JCR year Y-1.',
    bandsByDoi: {
      '10.1000/card-2026': 'top1'
    },
    reason: 'Partial coverage: 1 of 2 catalogue publications have an exact previous-year JCR band authorized for public per-publication display.'
  });
  assert.doesNotMatch(
    JSON.stringify(authorized),
    /jcrYear|categor(?:y|ies)|categoryTotal|jifPercentile|impactFactor|"(?:rank|quartile|jif)"\s*:/i
  );

  assert.throws(
    () => derivePublicationJcrBands({
      publications,
      impactFactorJson: {
        ...authorizedDataset,
        rankingsByDoi: {
          ...authorizedDataset.rankingsByDoi,
          '10.1000/card-2026': {
            ...authorizedDataset.rankingsByDoi['10.1000/card-2026'],
            jcrYear: 2026
          }
        }
      }
    }),
    /must equal previous-year JCR year 2025 for feed publication year 2026/
  );
  assert.throws(
    () => derivePublicationJcrBands({
      publications,
      impactFactorJson: {
        ...authorizedDataset,
        perPublicationRankingAuthorizationReference: ''
      }
    }),
    /perPublicationRankingAuthorizationReference/
  );
});

test('writes a fail-closed unavailable per-publication JCR snapshot without licensed input', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-jcr-bands-'));
  const outputPath = path.join(directory, 'publication-jcr-bands.json');
  try {
    const snapshot = await generatePublicationJcrBandsFile({
      feedPath: FEED_PATH,
      outputPath
    });
    const written = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.deepEqual(written, snapshot);
    assert.equal(written.status, 'unavailable');
    assert.equal(written.displayAuthorized, false);
    assert.equal(written.coveredPublications, 0);
    assert.deepEqual(written.bandsByDoi, {});
    assert.doesNotMatch(
      JSON.stringify(written),
      /rankingsByDoi|jcrYear|categor(?:y|ies)|categoryTotal|jifPercentile|impactFactor|"(?:rank|quartile|jif)"\s*:/i
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('rejects malformed inputs with actionable errors', () => {
  const metadata = {
    snapshotUpdatedAt: '2026-01-01T00:00:00.000Z',
    googleScholar: {},
    publications: {}
  };
  const people = {
    groups: [
      { title: 'Graduate Students', people: [] }
    ]
  };
  const bibliography = {
    publications: {
      only: {
        authors: [
          {
            given: 'Yongchul G.',
            family: 'Chung',
            orcid: 'https://orcid.org/0000-0002-7756-0589'
          }
        ]
      }
    }
  };

  assert.throws(
    () => deriveLabStatistics({
      publications: [],
      metadata,
      bibliography: { publications: {} },
      people,
      currentYear: 2026
    }),
    /non-empty array/
  );
  assert.throws(
    () => deriveLabStatistics({
      publications: [{ no: '01', year: 'not-a-year', journal: 'Journal', topics: [] }],
      metadata,
      bibliography,
      people,
      currentYear: 2026
    }),
    /valid year/
  );
  assert.throws(
    () => deriveLabStatistics({
      publications: [{
        no: '01',
        doi: '10.1000/malformed-review',
        year: 2026,
        journal: 'Journal',
        topics: ['Review'],
        reviewTopic: 'Unknown'
      }],
      metadata,
      bibliography,
      people,
      currentYear: 2026
    }),
    /invalid reviewTopic/
  );
  assert.throws(
    () => deriveLabStatistics({
      publications: [{
        no: '01',
        doi: '10.1000/malformed-fixture',
        year: 2026,
        journal: 'Journal',
        topics: []
      }],
      metadata: {},
      bibliography,
      people,
      currentYear: 2026
    }),
    /snapshotUpdatedAt/
  );
  assert.throws(
    () => deriveLabStatistics({
      publications: [{
        no: '01',
        doi: '10.1000/malformed-fixture',
        year: 2026,
        journal: 'Journal',
        topics: []
      }],
      metadata,
      bibliography,
      people: { groups: 'not-an-array' },
      currentYear: 2026
    }),
    /people\.groups/
  );
  assert.throws(
    () => deriveLabStatistics({
      publications: [{
        no: '01',
        doi: '10.1000/malformed-fixture',
        year: 2026,
        journal: 'Journal',
        topics: []
      }],
      metadata,
      bibliography: { publications: {} },
      people,
      currentYear: 2026
    }),
    /must contain 1 records/
  );
});

test('keeps the licensed JIF input out of pull-request checks', async () => {
  const workflow = await fs.readFile(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  const secretLine = workflow.split(/\r?\n/).find(line =>
    line.includes('JOURNAL_IMPACT_FACTORS_JSON:')
  );

  assert.ok(secretLine, 'Pages workflow must declare the licensed JIF input.');
  assert.match(secretLine, /github\.event_name == 'push'/);
  assert.match(secretLine, /github\.ref == 'refs\/heads\/main'/);
  assert.match(secretLine, /github\.event_name == 'workflow_dispatch'/);
  assert.match(secretLine, /&& secrets\.JOURNAL_IMPACT_FACTORS_JSON \|\| ''/);
  assert.doesNotMatch(secretLine, /:\s*\$\{\{\s*secrets\.JOURNAL_IMPACT_FACTORS_JSON\s*\}\}/);
});

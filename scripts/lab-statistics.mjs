import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

import { TOPIC_GROUPS } from './publication-bot.mjs';
import { normalizeDoi as normalizeCanonicalDoi } from './publication-citations.mjs';

const SCHEMA_VERSION = 4;
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const SCRIPT_TIMEOUT_MS = 1_000;
const COAUTHOR_MAX_NODES = 25;
const COAUTHOR_MAX_EDGES = 80;
const PRINCIPAL_INVESTIGATOR_ORCID = '0000-0002-7756-0589';
const METRIC_SOURCE_STATUSES = Object.freeze(new Set(['ok', 'stale', 'partial']));
const RESEARCH_AREA_NAMES = Object.freeze(Object.keys(TOPIC_GROUPS));
const CURRENT_TEAM_GROUPS = Object.freeze([
  Object.freeze({ id: 'postdoctoralResearchers', label: 'Postdoctoral Researchers' }),
  Object.freeze({ id: 'graduateStudents', label: 'Graduate Students' }),
  Object.freeze({ id: 'undergraduates', label: 'Undergraduates' })
]);
const JOURNAL_STANDING_YEAR_BASIS =
  'Previous-year JCR: publication year Y uses JCR year Y-1.';
const PUBLICATION_JCR_BANDS_SCHEMA_VERSION = 1;
const JCR_INPUT_REQUIREMENTS_SCHEMA_VERSION = 1;
const JOURNAL_STANDING_BANDS = Object.freeze([
  Object.freeze({ id: 'top1', label: 'Top 1%' }),
  Object.freeze({ id: 'top5', label: 'Top 5%' }),
  Object.freeze({ id: 'top10', label: 'Top 10%' }),
  Object.freeze({ id: 'otherQ1', label: 'Other Q1' }),
  Object.freeze({ id: 'q2', label: 'Q2' }),
  Object.freeze({ id: 'q3', label: 'Q3' }),
  Object.freeze({ id: 'q4', label: 'Q4' }),
  Object.freeze({ id: 'unavailable', label: 'Unavailable' })
]);
const JCR_PERCENTILE_TOLERANCE = 1;
const GITHUB_ACTIONS_SECRET_MAX_BYTES = 48 * 1024;
const LICENSED_JCR_INPUT_KEYS = Object.freeze([
  'metric',
  'provider',
  'licenseConfirmed',
  'aggregatePublicationAuthorized',
  'updatedAt',
  'edition',
  'factorsByDoi',
  'aggregateRankingDisplayAuthorized',
  'rankingAuthorizationReference',
  'rankingAuthorizationDate',
  'rankingsByDoi',
  'perPublicationRankingDisplayAuthorized',
  'perPublicationRankingAuthorizationReference',
  'perPublicationRankingAuthorizationDate'
]);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function positiveYear(value, label) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new TypeError(`${label} must be a valid year.`);
  }
  return year;
}

function normalizeStatus(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'unavailable';
}

function nullableText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isIsoCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeWhitespace(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function compareText(left, right) {
  const leftKey = String(left).normalize('NFKD').toLowerCase();
  const rightKey = String(right).normalize('NFKD').toLowerCase();
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function nullableNonNegativeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function normalizeDoi(value, label = 'DOI') {
  try {
    return normalizeCanonicalDoi(value);
  } catch {
    throw new TypeError(`${label} must be a valid DOI.`);
  }
}

function metadataKeyDoi(value, label) {
  const candidate = normalizeWhitespace(value);
  if (!candidate) return null;
  try {
    return normalizeDoi(candidate, label);
  } catch (error) {
    if (/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/|10\.)/i.test(candidate)) {
      throw error;
    }
    return null;
  }
}

function scopeMetadataPublications(publications, metadataPublications) {
  const catalogueDois = new Set();
  for (const [index, publication] of publications.entries()) {
    const doi = normalizeDoi(publication.doi, `publications[${index}].doi`);
    if (catalogueDois.has(doi)) {
      throw new TypeError(`publications contains duplicate DOI ${doi}.`);
    }
    catalogueDois.add(doi);
  }

  const source = assertObject(metadataPublications || {}, 'metadata.publications');
  const scoped = Object.create(null);
  for (const [rawKey, rawRecord] of Object.entries(source)) {
    const keyDoi = metadataKeyDoi(rawKey, `metadata.publications key ${rawKey}`);
    const recordIsObject = rawRecord && typeof rawRecord === 'object' && !Array.isArray(rawRecord);
    let recordDoi = null;
    if (recordIsObject && rawRecord.doi !== undefined && rawRecord.doi !== null) {
      recordDoi = normalizeDoi(rawRecord.doi, `metadata.publications.${rawKey}.doi`);
    }
    if (keyDoi && recordDoi && keyDoi !== recordDoi) {
      throw new TypeError(
        `metadata publication key ${keyDoi} conflicts with record DOI ${recordDoi}.`
      );
    }

    const doi = recordDoi || keyDoi;
    if (!doi || !catalogueDois.has(doi)) continue;
    const record = assertObject(rawRecord, `metadata publication ${rawKey}`);
    if (Object.hasOwn(scoped, doi)) {
      throw new TypeError(`metadata.publications contains duplicate records for feed DOI ${doi}.`);
    }
    scoped[doi] = record;
  }
  return scoped;
}

function normalizeCountsByYear(entries) {
  if (!Array.isArray(entries)) return [];
  const totals = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const year = Number(entry.year);
    const rawCount = entry.count ?? entry.citationCount ?? entry.citations;
    const count = Number(rawCount);
    if (!Number.isInteger(year) || year < 1 || year > 9999) continue;
    if (!Number.isInteger(count) || count < 0) continue;
    totals.set(year, (totals.get(year) || 0) + count);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, count]) => ({ year, count }));
}

function cumulativeCountsByYear(annualCounts) {
  if (!annualCounts.length) return [];
  const counts = new Map(annualCounts.map(point => [point.year, point.count]));
  const firstYear = annualCounts[0].year;
  const lastYear = annualCounts.at(-1).year;
  const cumulative = [];
  let runningTotal = 0;
  for (let year = firstYear; year <= lastYear; year += 1) {
    runningTotal += counts.get(year) || 0;
    cumulative.push({ year, count: runningTotal });
  }
  return cumulative;
}

function citationHistory(total, annualCounts, sourceStatus) {
  const annualTotal = annualCounts.reduce((sum, point) => sum + point.count, 0);
  if (!annualCounts.length) {
    return {
      status: 'unavailable',
      annualTotal: null,
      reportedTotal: total,
      reconciliationDelta: null,
      unassignedCount: null,
      excessAnnualCount: null,
      reason: 'provider-year-history-unavailable'
    };
  }

  const reconciliationDelta = total - annualTotal;
  const unassignedCount = reconciliationDelta > 0 ? reconciliationDelta : 0;
  const excessAnnualCount = reconciliationDelta < 0 ? Math.abs(reconciliationDelta) : 0;
  const status = reconciliationDelta !== 0 || sourceStatus === 'partial'
    ? 'partial'
    : sourceStatus === 'stale'
      ? 'stale'
      : 'ok';
  const reason = reconciliationDelta > 0
    ? 'provider-total-includes-citations-without-assigned-year'
    : reconciliationDelta < 0
      ? 'provider-year-history-exceeds-current-total'
      : sourceStatus === 'partial'
        ? 'source-partial'
        : sourceStatus === 'stale'
          ? 'source-stale'
          : null;

  return {
    status,
    annualTotal,
    reportedTotal: total,
    reconciliationDelta,
    unassignedCount,
    excessAnnualCount,
    reason
  };
}

function aggregatePublicationCitationYears(metadataPublications, sourceKey) {
  if (!metadataPublications || typeof metadataPublications !== 'object') return [];
  const entries = [];
  for (const publication of Object.values(metadataPublications)) {
    const source = publication?.[sourceKey];
    if (!source || typeof source !== 'object') continue;
    for (const point of Array.isArray(source.countsByYear) ? source.countsByYear : []) {
      entries.push(point);
    }
  }
  return normalizeCountsByYear(entries);
}

function summarizeSourceCitations(metadataPublications, sourceKey) {
  let total = 0;
  let matched = 0;
  for (const publication of Object.values(metadataPublications)) {
    const rawCount = publication?.[sourceKey]?.citationCount;
    if (rawCount === undefined || rawCount === null || rawCount === '') continue;
    const count = Number(rawCount);
    if (Number.isInteger(count) && count >= 0) {
      total += count;
      matched += 1;
    }
  }
  return {
    total: matched > 0 ? total : null,
    matched
  };
}

function sourceUpdatedAt(metadata, sourceKey) {
  const value = metadata.sources?.[sourceKey]?.contentUpdatedAt;
  return typeof value === 'string' && value.trim() ? value : null;
}

function makeCitationSource({
  metadata,
  id,
  label,
  total,
  publicationTotal,
  countsByYear,
  provider = null,
  matched = null
}) {
  const source = metadata.sources?.[id] || {};
  const sourceStatus = normalizeStatus(source.status);
  const normalizedTotal = nullableNonNegativeInteger(total);
  const available = METRIC_SOURCE_STATUSES.has(sourceStatus) && normalizedTotal !== null;
  const normalizedMatched = nullableNonNegativeInteger(matched);
  const normalizedPublicationTotal = nullableNonNegativeInteger(publicationTotal);
  const incompleteCoverage = available
    && normalizedMatched !== null
    && normalizedPublicationTotal !== null
    && normalizedMatched < normalizedPublicationTotal;
  const status = available
    ? (incompleteCoverage ? 'partial' : sourceStatus)
    : 'unavailable';
  const reason = nullableText(source.reason)
    || (status === 'partial'
      ? (incompleteCoverage
        ? `Partial coverage: ${normalizedMatched} of ${normalizedPublicationTotal} catalogue publications matched.`
        : 'source-partial')
      : status === 'stale'
      ? 'source-stale'
      : available ? null : normalizedTotal === null ? 'citation-total-unavailable' : 'source-unavailable');
  const annualCounts = available ? normalizeCountsByYear(countsByYear) : [];
  const history = available
    ? citationHistory(normalizedTotal, annualCounts, status)
    : citationHistory(null, [], 'unavailable');
  return {
    id,
    label,
    status,
    total: available ? normalizedTotal : null,
    provider: nullableText(source.provider) || nullableText(provider),
    reason,
    matched: normalizedMatched,
    publicationTotal: normalizedPublicationTotal,
    updatedAt: sourceUpdatedAt(metadata, id),
    countsByYear: annualCounts,
    cumulativeCountsByYear: cumulativeCountsByYear(annualCounts),
    history
  };
}

function makeCitationSources(metadata, publicationTotal) {
  const publications = metadata.publications;
  const googleScholar = assertObject(metadata.googleScholar || {}, 'metadata.googleScholar');
  const openAlex = summarizeSourceCitations(publications, 'openAlex');
  const semanticScholar = summarizeSourceCitations(publications, 'semanticScholar');
  const openAlexReportedMatched = nullableNonNegativeInteger(metadata.sources?.openAlex?.matched);
  const semanticScholarReportedMatched = nullableNonNegativeInteger(
    metadata.sources?.semanticScholar?.matched
  );
  const scholar = makeCitationSource({
    metadata,
    id: 'googleScholar',
    label: 'Google Scholar',
    total: googleScholar.citations?.all ?? metadata.totals?.googleScholarCitations,
    publicationTotal,
    countsByYear: googleScholar.countsByYear ?? googleScholar.citations?.countsByYear,
    provider: nullableText(googleScholar.provider) || 'Google Scholar author profile',
    matched: null
  });
  if (typeof googleScholar.profileUrl === 'string' && googleScholar.profileUrl.trim()) {
    scholar.profileUrl = googleScholar.profileUrl.trim();
  }

  return [
    scholar,
    makeCitationSource({
      metadata,
      id: 'openAlex',
      label: 'OpenAlex',
      total: openAlex.total,
      publicationTotal,
      countsByYear: aggregatePublicationCitationYears(publications, 'openAlex'),
      provider: 'OpenAlex API',
      matched: Math.min(openAlexReportedMatched ?? openAlex.matched, openAlex.matched)
    }),
    makeCitationSource({
      metadata,
      id: 'semanticScholar',
      label: 'Semantic Scholar',
      total: semanticScholar.total,
      publicationTotal,
      countsByYear: aggregatePublicationCitationYears(publications, 'semanticScholar'),
      provider: 'Semantic Scholar API',
      matched: Math.min(
        semanticScholarReportedMatched ?? semanticScholar.matched,
        semanticScholar.matched
      )
    })
  ];
}

function calculateHIndex(citationCounts) {
  const descending = [...citationCounts].sort((left, right) => right - left);
  let value = 0;
  for (let index = 0; index < descending.length; index += 1) {
    if (descending[index] < index + 1) break;
    value = index + 1;
  }
  return value;
}

function openAlexCatalogueCitationCounts(metadataPublications) {
  if (!metadataPublications || typeof metadataPublications !== 'object') return [];
  const counts = [];
  for (const publication of Object.values(metadataPublications)) {
    const rawCount = publication?.openAlex?.citationCount;
    if (rawCount === undefined || rawCount === null || rawCount === '') continue;
    const count = Number(rawCount);
    if (Number.isInteger(count) && count >= 0) counts.push(count);
  }
  return counts;
}

function makeHIndexMetric(metadata, publicationTotal) {
  const googleScholar = assertObject(metadata.googleScholar || {}, 'metadata.googleScholar');
  const value = nullableNonNegativeInteger(googleScholar.hIndex?.all);
  const since = nullableNonNegativeInteger(googleScholar.hIndex?.since);
  const sinceYear = nullableNonNegativeInteger(googleScholar.hIndex?.sinceYear);
  const googleScholarSource = metadata.sources?.googleScholar || {};
  const sourceStatus = normalizeStatus(googleScholarSource.status);
  if (value !== null && METRIC_SOURCE_STATUSES.has(sourceStatus)) {
    const metric = {
      status: sourceStatus,
      value,
      since,
      sinceYear,
      source: 'Google Scholar',
      provider: nullableText(googleScholarSource.provider)
        || nullableText(googleScholar.provider)
        || 'Google Scholar author profile',
      reason: nullableText(googleScholarSource.reason),
      updatedAt: sourceUpdatedAt(metadata, 'googleScholar'),
      matched: null,
      publicationTotal,
      method: 'Reported by the Google Scholar author profile.'
    };
    if (typeof googleScholar.profileUrl === 'string' && googleScholar.profileUrl.trim()) {
      metric.profileUrl = googleScholar.profileUrl.trim();
    }
    return metric;
  }

  const openAlexCounts = openAlexCatalogueCitationCounts(metadata.publications);
  if (openAlexCounts.length > publicationTotal) {
    throw new TypeError(
      `metadata.publications contains ${openAlexCounts.length} OpenAlex citation counts for ${publicationTotal} catalogue publications.`
    );
  }
  if (openAlexCounts.length > 0) {
    const openAlexSource = metadata.sources?.openAlex || {};
    const openAlexStatus = normalizeStatus(openAlexSource.status);
    const complete = openAlexCounts.length === publicationTotal;
    return {
      status: complete && openAlexStatus === 'ok' ? 'ok' : 'partial',
      value: calculateHIndex(openAlexCounts),
      since: null,
      sinceYear: null,
      source: 'OpenAlex',
      provider: nullableText(openAlexSource.provider) || 'OpenAlex API',
      reason: nullableText(openAlexSource.reason)
        || (!complete
          ? 'incomplete-catalogue-coverage'
          : openAlexStatus === 'ok' ? null : `source-status-${openAlexStatus}`),
      updatedAt: sourceUpdatedAt(metadata, 'openAlex'),
      matched: openAlexCounts.length,
      publicationTotal,
      method: 'Derived from per-publication OpenAlex citation counts for the curated DOI catalogue.'
    };
  }

  return {
    status: 'unavailable',
    value: null,
    since: null,
    sinceYear: null,
    source: null,
    provider: null,
    reason: nullableText(googleScholarSource.reason)
      || nullableText(metadata.sources?.openAlex?.reason)
      || 'h-index-unavailable',
    updatedAt: null,
    matched: 0,
    publicationTotal,
    method: 'No valid Google Scholar profile h-index or OpenAlex catalogue citation counts were available.'
  };
}

function derivePublicationStatistics(publications, currentYear) {
  if (!Array.isArray(publications) || publications.length === 0) {
    throw new TypeError('publications must be a non-empty array.');
  }

  const yearCounts = new Map();
  let reviews = 0;
  for (const [index, publication] of publications.entries()) {
    assertObject(publication, `publications[${index}]`);
    const year = positiveYear(publication.year, `publications[${index}].year`);
    if (!Array.isArray(publication.topics)) {
      throw new TypeError(`publications[${index}].topics must be an array.`);
    }
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    if (publication.topics.includes('Review')) reviews += 1;
  }

  const years = [...yearCounts.keys()].sort((left, right) => left - right);
  const firstPublicationYear = years[0];
  const lastPublicationYear = years.at(-1);
  const firstYear = Math.min(firstPublicationYear, currentYear);
  const lastYear = Math.max(lastPublicationYear, currentYear);
  const currentYearPartial = true;
  const byYear = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    byYear.push({
      year,
      count: yearCounts.get(year) || 0,
      partial: year === currentYear
    });
  }

  return {
    total: publications.length,
    articles: publications.length - reviews,
    reviews,
    firstYear,
    lastPublicationYear,
    lastYear,
    currentYearPartial,
    byYear
  };
}

function deriveJournalDistribution(publications) {
  const journalMap = new Map();
  for (const [index, publication] of publications.entries()) {
    const journal = normalizeWhitespace(publication.journal);
    if (!journal) {
      throw new TypeError(`publications[${index}].journal must be a non-empty string.`);
    }
    const key = journal.toLocaleLowerCase('en-US').replace(/^the\s+/, '');
    const current = journalMap.get(key) || { labels: new Map(), count: 0 };
    current.labels.set(journal, (current.labels.get(journal) || 0) + 1);
    current.count += 1;
    journalMap.set(key, current);
  }

  const groups = [...journalMap.values()]
    .map(entry => {
      const name = [...entry.labels.entries()]
        .sort((left, right) => right[1] - left[1] || compareText(left[0], right[0]))[0][0];
      return { name, count: entry.count };
    })
    .sort((left, right) => right.count - left.count || compareText(left.name, right.name));

  return {
    publicationTotal: publications.length,
    distinctCount: groups.length,
    groups,
    countingMethod: 'Each catalogue publication is counted once using the journal name recorded in feed.js; names are grouped case-insensitively with an optional leading “The” ignored, then sorted by publication count.'
  };
}

function deriveResearchAreas(publications) {
  const labelSets = new Map(
    Object.entries(TOPIC_GROUPS).map(([name, labels]) => [name, new Set(labels)])
  );

  const groups = RESEARCH_AREA_NAMES.map(name => {
    let articleCount = 0;
    let reviewCount = 0;
    const labels = labelSets.get(name);
    for (const publication of publications) {
      const isReview = publication.topics.includes('Review');
      if (isReview) {
        if (!RESEARCH_AREA_NAMES.includes(publication.reviewTopic)) {
          throw new TypeError(
            `Review publication ${publication.no || publication.doi || publication.title || ''} has an invalid reviewTopic.`
          );
        }
        if (publication.reviewTopic === name) reviewCount += 1;
      } else if (publication.topics.some(topic => labels.has(topic))) {
        articleCount += 1;
      }
    }
    return {
      id: name.toLowerCase(),
      name,
      count: articleCount + reviewCount,
      articleCount,
      reviewCount
    };
  });

  return {
    overlap: true,
    countingMethod: 'Distinct publications within each research area; one publication may count in multiple areas. Reviews are assigned by reviewTopic.',
    groups
  };
}

function normalizeOrcid(value) {
  const normalized = normalizeWhitespace(value)
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(normalized) ? normalized : null;
}

function normalizeAuthorNamePart(value) {
  return normalizeWhitespace(value)
    .replace(/\b([A-Za-z][A-Za-z'-]+)\.([A-Z])\./g, '$1 $2.')
    .replace(/\s+([,.;:])/g, '$1');
}

function publicAuthorLabel(author) {
  const given = normalizeAuthorNamePart(author.given);
  const family = normalizeAuthorNamePart(author.family);
  const structuredName = normalizeWhitespace([given, family].filter(Boolean).join(' '));
  return structuredName || normalizeAuthorNamePart(author.literal);
}

function authorNameKey(author) {
  return publicAuthorLabel(author)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizedAuthorPartTokens(value) {
  return normalizeAuthorNamePart(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function authorOrcidName(author) {
  return {
    label: publicAuthorLabel(author),
    nameKey: authorNameKey(author),
    given: normalizedAuthorPartTokens(author.given),
    family: normalizedAuthorPartTokens(author.family)
  };
}

function authorTokenSequencesCompatible(left, right, { initials = false } = {}) {
  if (left.length === 0 || right.length === 0) return false;
  if (!initials && left.length !== right.length) return false;
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] === right[index]) continue;
    if (initials
        && (left[index].length === 1 || right[index].length === 1)
        && left[index][0] === right[index][0]) {
      continue;
    }
    return false;
  }
  return initials || left.length === right.length;
}

function authorOrcidNamesCompatible(left, right) {
  if (left.given.length === 0 || left.family.length === 0
      || right.given.length === 0 || right.family.length === 0) {
    return left.nameKey === right.nameKey;
  }
  return authorTokenSequencesCompatible(left.family, right.family)
    && authorTokenSequencesCompatible(left.given, right.given, { initials: true });
}

function isPrincipalInvestigator(author) {
  const orcid = normalizeOrcid(author.orcid);
  if (orcid) return orcid === PRINCIPAL_INVESTIGATOR_ORCID;
  const family = normalizeAuthorNamePart(author.family).toLowerCase();
  const given = normalizeAuthorNamePart(author.given).toLowerCase();
  return family === 'chung' && /^yongchul(?:\s|$)/.test(given);
}

function stableAuthorId(identity) {
  return `author-${createHash('sha256').update(identity).digest('hex').slice(0, 12)}`;
}

function chooseAuthorLabel(labelCounts) {
  return [...labelCounts.entries()]
    .sort((left, right) => right[1] - left[1] || compareText(left[0], right[0]))[0][0];
}

function deriveCoauthorNetwork(bibliography, expectedPublicationCount) {
  const source = assertObject(bibliography, 'bibliography');
  const publicationMap = assertObject(source.publications, 'bibliography.publications');
  const records = Object.values(publicationMap);
  if (records.length !== expectedPublicationCount) {
    throw new TypeError(
      `bibliography.publications must contain ${expectedPublicationCount} records; found ${records.length}.`
    );
  }

  const nameOrcids = new Map();
  const orcidNames = new Map();
  for (const [recordIndex, record] of records.entries()) {
    assertObject(record, `bibliography publication ${recordIndex + 1}`);
    if (!Array.isArray(record.authors) || record.authors.length === 0) {
      throw new TypeError(`bibliography publication ${recordIndex + 1}.authors must be a non-empty array.`);
    }
    for (const [authorIndex, rawAuthor] of record.authors.entries()) {
      const author = assertObject(
        rawAuthor,
        `bibliography publication ${recordIndex + 1} author ${authorIndex + 1}`
      );
      const nameKey = authorNameKey(author);
      const label = publicAuthorLabel(author);
      if (!nameKey || !label) {
        throw new TypeError(
          `bibliography publication ${recordIndex + 1} author ${authorIndex + 1} must have a public name.`
        );
      }
      const orcid = normalizeOrcid(author.orcid);
      if (orcid) {
        const observedName = authorOrcidName(author);
        const priorNames = orcidNames.get(orcid) || [];
        const conflict = priorNames.find(
          priorName => !authorOrcidNamesCompatible(priorName, observedName)
        );
        if (conflict) {
          throw new TypeError(
            `ORCID ${orcid} is assigned to conflicting given/family names "${conflict.label}" and "${observedName.label}".`
          );
        }
        priorNames.push(observedName);
        orcidNames.set(orcid, priorNames);
        const values = nameOrcids.get(nameKey) || new Set();
        values.add(orcid);
        nameOrcids.set(nameKey, values);
      }
    }
  }

  const authors = new Map();
  const publicationAuthorSets = [];
  const principalInvestigatorIdentity = `orcid:${PRINCIPAL_INVESTIGATOR_ORCID}`;
  for (const [recordIndex, record] of records.entries()) {
    const identities = new Set();
    for (const author of record.authors) {
      const label = publicAuthorLabel(author);
      const nameKey = authorNameKey(author);
      const explicitOrcid = normalizeOrcid(author.orcid);
      const knownOrcids = nameOrcids.get(nameKey);
      const uniqueKnownOrcid = knownOrcids?.size === 1 ? [...knownOrcids][0] : null;
      const identity = explicitOrcid
        ? `orcid:${explicitOrcid}`
        : isPrincipalInvestigator(author)
          ? principalInvestigatorIdentity
          : uniqueKnownOrcid
            ? `orcid:${uniqueKnownOrcid}`
            : `name:${nameKey}`;
      identities.add(identity);
      const aggregate = authors.get(identity) || {
        labelCounts: new Map(),
        publicationCount: 0,
        isPrincipalInvestigator: identity === principalInvestigatorIdentity
      };
      aggregate.labelCounts.set(label, (aggregate.labelCounts.get(label) || 0) + 1);
      authors.set(identity, aggregate);
    }
    for (const identity of identities) {
      authors.get(identity).publicationCount += 1;
    }
    publicationAuthorSets.push(identities);
  }

  if (!authors.has(principalInvestigatorIdentity)) {
    throw new TypeError('bibliography.publications must include the principal investigator.');
  }

  const jointPublicationCounts = new Map();
  for (const identities of publicationAuthorSets) {
    if (!identities.has(principalInvestigatorIdentity)) continue;
    for (const identity of identities) {
      if (identity === principalInvestigatorIdentity) continue;
      jointPublicationCounts.set(identity, (jointPublicationCounts.get(identity) || 0) + 1);
    }
  }

  const selectedCollaborators = [...jointPublicationCounts.entries()]
    .map(([identity, jointPublicationCount]) => ({
      identity,
      jointPublicationCount,
      publicationCount: authors.get(identity).publicationCount,
      label: chooseAuthorLabel(authors.get(identity).labelCounts)
    }))
    .sort((left, right) =>
      right.jointPublicationCount - left.jointPublicationCount
      || right.publicationCount - left.publicationCount
      || compareText(left.label, right.label)
      || compareText(left.identity, right.identity)
    )
    .slice(0, COAUTHOR_MAX_NODES - 1);
  const selectedIdentities = [
    principalInvestigatorIdentity,
    ...selectedCollaborators.map(author => author.identity)
  ];
  const selectedIdentitySet = new Set(selectedIdentities);
  const authorIds = new Map(
    selectedIdentities.map(identity => [identity, stableAuthorId(identity)])
  );
  const nodes = selectedIdentities.map(identity => {
    const author = authors.get(identity);
    return {
      id: authorIds.get(identity),
      label: chooseAuthorLabel(author.labelCounts),
      publicationCount: author.publicationCount,
      isPrincipalInvestigator: author.isPrincipalInvestigator
    };
  });

  const edgeCounts = new Map();
  for (const identities of publicationAuthorSets) {
    const displayed = [...identities]
      .filter(identity => selectedIdentitySet.has(identity))
      .sort(compareText);
    for (let left = 0; left < displayed.length; left += 1) {
      for (let right = left + 1; right < displayed.length; right += 1) {
        const source = authorIds.get(displayed[left]);
        const target = authorIds.get(displayed[right]);
        const key = `${source}\u0000${target}`;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
    }
  }
  const allEdges = [...edgeCounts.entries()]
    .map(([key, publicationCount]) => {
      const [source, target] = key.split('\u0000');
      return { source, target, publicationCount };
    })
    .sort((left, right) =>
      right.publicationCount - left.publicationCount
      || compareText(left.source, right.source)
      || compareText(left.target, right.target)
    );
  const principalInvestigatorId = authorIds.get(principalInvestigatorIdentity);
  const principalInvestigatorEdges = allEdges.filter(
    edge => edge.source === principalInvestigatorId || edge.target === principalInvestigatorId
  );
  const collaboratorEdges = allEdges.filter(
    edge => edge.source !== principalInvestigatorId && edge.target !== principalInvestigatorId
  );
  const edges = [
    ...principalInvestigatorEdges,
    ...collaboratorEdges.slice(0, Math.max(0, COAUTHOR_MAX_EDGES - principalInvestigatorEdges.length))
  ].slice(0, COAUTHOR_MAX_EDGES);

  return {
    countingMethod: 'Public author metadata from the publication bibliography. The graph shows the principal investigator plus up to 24 collaborators ranked by joint catalogue publications, retains every displayed PI connection, and then keeps the strongest remaining coauthor links. Each paper contributes at most once to a node or edge.',
    bounded: true,
    maxNodes: COAUTHOR_MAX_NODES,
    maxEdges: COAUTHOR_MAX_EDGES,
    totalAuthors: authors.size,
    totalCollaborators: Math.max(0, authors.size - 1),
    displayedAuthors: nodes.length,
    nodes,
    edges
  };
}

function deriveTeamStatistics(people) {
  const data = assertObject(people, 'people');
  if (!Array.isArray(data.groups)) {
    throw new TypeError('people.groups must be an array.');
  }
  const sourceGroups = new Map();
  for (const [index, group] of data.groups.entries()) {
    assertObject(group, `people.groups[${index}]`);
    if (typeof group.title !== 'string' || !Array.isArray(group.people)) {
      throw new TypeError(`people.groups[${index}] must have a title and people array.`);
    }
    if (sourceGroups.has(group.title)) {
      throw new TypeError(`Duplicate current people group: ${group.title}`);
    }
    sourceGroups.set(group.title, group.people);
  }

  const groups = CURRENT_TEAM_GROUPS
    .map(group => ({
      id: group.id,
      label: group.label,
      count: sourceGroups.get(group.label)?.length || 0
    }))
    .filter(group => group.count > 0);

  return {
    total: groups.reduce((sum, group) => sum + group.count, 0),
    groups
  };
}

function unavailableImpactFactors(publicationTotal, dataset = null, reason = null) {
  return {
    status: 'unavailable',
    metric: 'Journal Impact Factor',
    total: null,
    coveredPublications: 0,
    publicationTotal,
    source: dataset?.provider || null,
    edition: dataset?.edition || null,
    licenseConfirmed: dataset?.licenseConfirmed === true,
    aggregatePublicationAuthorized: dataset?.aggregatePublicationAuthorized === true,
    updatedAt: dataset?.updatedAt || null,
    reason: reason || 'No authoritative, licensed, locally curated Journal Impact Factor dataset is configured; no proxy metric is inferred.'
  };
}

function journalStandingProvenance(dataset) {
  if (!dataset) {
    return {
      source: null,
      edition: null,
      licenseConfirmed: false,
      aggregatePublicationAuthorized: false,
      aggregateRankingDisplayAuthorized: false,
      updatedAt: null
    };
  }
  return {
    source: dataset.provider,
    edition: dataset.edition,
    licenseConfirmed: dataset.licenseConfirmed === true,
    aggregatePublicationAuthorized: dataset.aggregatePublicationAuthorized === true,
    aggregateRankingDisplayAuthorized: dataset.aggregateRankingDisplayAuthorized === true,
    updatedAt: dataset.updatedAt
  };
}

function rankingAuthorizationProvenance(dataset) {
  if (!dataset || dataset.aggregateRankingDisplayAuthorized !== true) return {};
  const reference = nullableText(dataset.rankingAuthorizationReference);
  if (!reference) {
    throw new TypeError(
      'impactFactorJson.rankingAuthorizationReference must be non-empty text when aggregateRankingDisplayAuthorized is true.'
    );
  }
  const authorizationDate = nullableText(dataset.rankingAuthorizationDate);
  if (!isIsoCalendarDate(authorizationDate)) {
    throw new TypeError(
      'impactFactorJson.rankingAuthorizationDate must be a valid YYYY-MM-DD date when aggregateRankingDisplayAuthorized is true.'
    );
  }
  return {
    authorizationReference: reference,
    authorizationDate
  };
}

function unavailableJournalStanding(publicationTotal, dataset = null, reason = null) {
  return {
    status: 'unavailable',
    publicationTotal,
    coveredPublications: 0,
    unavailablePublications: publicationTotal,
    bands: [],
    ...journalStandingProvenance(dataset),
    ...rankingAuthorizationProvenance(dataset),
    yearBasis: JOURNAL_STANDING_YEAR_BASIS,
    reason: reason || (
      dataset
        ? 'Previous-year JCR ranking aggregates are unavailable. Publication-year or current JCR data are not substituted.'
        : 'No licensed JCR input is configured. Previous-year JCR ranking aggregates are unavailable, and publication-year or current JCR data are not substituted.'
    )
  };
}

function parseImpactFactorJson(impactFactorJson) {
  if (impactFactorJson === undefined || impactFactorJson === null || impactFactorJson === '') {
    return null;
  }
  if (typeof impactFactorJson === 'string') {
    try {
      return assertObject(JSON.parse(impactFactorJson), 'impactFactorJson');
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError(`impactFactorJson must be valid JSON: ${error.message}`);
    }
  }
  return assertObject(impactFactorJson, 'impactFactorJson');
}

function validateImpactFactorDataset(dataset) {
  if (!dataset) return null;
  assertOnlyInputKeys(dataset, LICENSED_JCR_INPUT_KEYS, 'impactFactorJson');
  if (dataset.metric !== 'Journal Impact Factor') {
    throw new TypeError('impactFactorJson.metric must equal "Journal Impact Factor".');
  }
  const provider = nullableText(dataset.provider);
  if (!provider
      || !/\b(?:Clarivate|Journal Citation Reports?|JCR)\b/i.test(provider)
      || /\b(?:OpenAlex|Semantic Scholar|Crossref|CiteScore|SJR)\b/i.test(provider)) {
    throw new TypeError(
      'impactFactorJson.provider must identify Clarivate Journal Citation Reports and must not be a proxy metric provider.'
    );
  }
  if (dataset.licenseConfirmed !== true) {
    throw new TypeError('impactFactorJson.licenseConfirmed must be true.');
  }
  if (dataset.aggregatePublicationAuthorized !== true) {
    throw new TypeError('impactFactorJson.aggregatePublicationAuthorized must be true.');
  }
  const updatedAt = nullableText(dataset.updatedAt);
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
    throw new TypeError('impactFactorJson.updatedAt must be an ISO date-time.');
  }
  const edition = nullableText(dataset.edition);
  if (!edition) {
    throw new TypeError('impactFactorJson.edition must be a non-empty string.');
  }
  return {
    ...dataset,
    provider,
    updatedAt,
    edition
  };
}

function deriveImpactFactors(publications, dataset) {
  if (!dataset) return unavailableImpactFactors(publications.length);
  if (dataset.factorsByDoi === undefined || dataset.factorsByDoi === null) {
    return unavailableImpactFactors(
      publications.length,
      dataset,
      'No licensed DOI-keyed Journal Impact Factor values are configured; no proxy metric is inferred.'
    );
  }
  const factorsByDoi = assertObject(dataset.factorsByDoi, 'impactFactorJson.factorsByDoi');
  const factorEntries = Object.entries(factorsByDoi);
  if (factorEntries.length === 0) {
    return unavailableImpactFactors(
      publications.length,
      dataset,
      'No licensed DOI-keyed Journal Impact Factor values are configured; no proxy metric is inferred.'
    );
  }

  const publicationsByDoi = new Map();
  for (const [index, publication] of publications.entries()) {
    const doi = normalizeDoi(publication.doi, `publications[${index}].doi`);
    if (publicationsByDoi.has(doi)) {
      throw new TypeError('publications must contain unique DOI values when impactFactorJson is configured.');
    }
    publicationsByDoi.set(doi, publication);
  }

  const normalizedFactors = new Map();
  for (const [rawDoi, rawRecord] of factorEntries) {
    const doi = normalizeDoi(rawDoi, `impactFactorJson.factorsByDoi key ${rawDoi}`);
    if (normalizedFactors.has(doi)) {
      throw new TypeError(`impactFactorJson.factorsByDoi contains duplicate normalized DOI ${doi}.`);
    }
    const publication = publicationsByDoi.get(doi);
    if (!publication) {
      throw new TypeError(`impactFactorJson.factorsByDoi contains DOI not present in the publication catalogue: ${doi}.`);
    }
    const label = `impactFactorJson.factorsByDoi.${rawDoi}`;
    const record = assertObject(rawRecord, label);
    assertOnlyInputKeys(record, ['jcrYear', 'jif'], label);
    const publicationYear = positiveYear(publication.year, `publication ${doi}.year`);
    const jcrYear = positiveYear(record.jcrYear, `${label}.jcrYear`);
    const expectedJcrYear = publicationYear - 1;
    if (expectedJcrYear < 1) {
      throw new TypeError(`publication ${doi}.year must permit a positive previous-year JCR value.`);
    }
    if (jcrYear !== expectedJcrYear) {
      throw new TypeError(
        `${label}.jcrYear must equal previous-year JCR year ${expectedJcrYear} for feed publication year ${publicationYear}; publication-year or current JCR data cannot be substituted.`
      );
    }
    if (typeof record.jif !== 'number' || !Number.isFinite(record.jif) || record.jif < 0) {
      throw new TypeError(`${label}.jif must be a non-negative finite number.`);
    }
    normalizedFactors.set(doi, record.jif);
  }

  const total = [...normalizedFactors.values()].reduce((sum, factor) => sum + factor, 0);
  const coveredPublications = normalizedFactors.size;
  const complete = coveredPublications === publications.length;
  return {
    status: complete ? 'ok' : 'partial',
    metric: 'Journal Impact Factor',
    total,
    coveredPublications,
    publicationTotal: publications.length,
    source: dataset.provider,
    edition: dataset.edition,
    licenseConfirmed: true,
    aggregatePublicationAuthorized: true,
    updatedAt: dataset.updatedAt,
    reason: complete
      ? null
      : `Partial coverage: ${coveredPublications} of ${publications.length} catalogue publications have an authorized Journal Impact Factor value.`
  };
}

function expectedJcrQuartile(rank, categoryTotal) {
  const normalizedRank = rank / categoryTotal;
  if (normalizedRank <= 0.25) return 'Q1';
  if (normalizedRank <= 0.5) return 'Q2';
  if (normalizedRank <= 0.75) return 'Q3';
  return 'Q4';
}

function journalStandingBand(jifPercentile) {
  if (jifPercentile >= 99) return 'top1';
  if (jifPercentile >= 95) return 'top5';
  if (jifPercentile >= 90) return 'top10';
  if (jifPercentile >= 75) return 'otherQ1';
  if (jifPercentile >= 50) return 'q2';
  if (jifPercentile >= 25) return 'q3';
  return 'q4';
}

function assertOnlyInputKeys(value, expectedKeys, label) {
  const unexpected = Object.keys(value).filter(key => !expectedKeys.includes(key));
  if (unexpected.length) {
    throw new TypeError(`${label} contains unexpected fields: ${unexpected.join(', ')}.`);
  }
}

function validatePreviousYearRankingBands(publications, dataset) {
  const rankingsByDoi = assertObject(
    dataset.rankingsByDoi,
    'impactFactorJson.rankingsByDoi'
  );
  const rankingEntries = Object.entries(rankingsByDoi);
  const publicationsByDoi = new Map();
  for (const [index, publication] of publications.entries()) {
    const doi = normalizeDoi(publication.doi, `publications[${index}].doi`);
    if (publicationsByDoi.has(doi)) {
      throw new TypeError(
        'publications must contain unique DOI values when impactFactorJson is configured.'
      );
    }
    publicationsByDoi.set(doi, publication);
  }

  const normalizedRankingDois = new Set();
  const bandsByDoi = new Map();
  for (const [rawDoi, rawRanking] of rankingEntries) {
    const doi = normalizeDoi(rawDoi, `impactFactorJson.rankingsByDoi key ${rawDoi}`);
    if (normalizedRankingDois.has(doi)) {
      throw new TypeError(
        `impactFactorJson.rankingsByDoi contains duplicate normalized DOI ${doi}.`
      );
    }
    normalizedRankingDois.add(doi);
    const publication = publicationsByDoi.get(doi);
    if (!publication) {
      throw new TypeError(
        `impactFactorJson.rankingsByDoi contains DOI not present in the publication catalogue: ${doi}.`
      );
    }

    const ranking = assertObject(
      rawRanking,
      `impactFactorJson.rankingsByDoi.${rawDoi}`
    );
    assertOnlyInputKeys(
      ranking,
      ['jcrYear', 'categories'],
      `impactFactorJson.rankingsByDoi.${rawDoi}`
    );
    if (!Number.isInteger(ranking.jcrYear)) {
      throw new TypeError(
        `impactFactorJson.rankingsByDoi.${rawDoi}.jcrYear must be an integer year.`
      );
    }
    const jcrYear = positiveYear(
      ranking.jcrYear,
      `impactFactorJson.rankingsByDoi.${rawDoi}.jcrYear`
    );
    const publicationYear = positiveYear(
      publication.year,
      `publication ${doi}.year`
    );
    const expectedJcrYear = publicationYear - 1;
    if (expectedJcrYear < 1) {
      throw new TypeError(
        `publication ${doi}.year must allow a positive previous JCR year.`
      );
    }
    if (jcrYear !== expectedJcrYear) {
      throw new TypeError(
        `impactFactorJson.rankingsByDoi.${rawDoi}.jcrYear must equal previous-year JCR year ${expectedJcrYear} for feed publication year ${publicationYear}; publication-year or current JCR data cannot be substituted.`
      );
    }
    if (!Array.isArray(ranking.categories) || ranking.categories.length === 0) {
      throw new TypeError(
        `impactFactorJson.rankingsByDoi.${rawDoi}.categories must be a non-empty array.`
      );
    }

    const categoryNames = new Set();
    let bestPercentile = -1;
    for (const [categoryIndex, rawCategory] of ranking.categories.entries()) {
      const label =
        `impactFactorJson.rankingsByDoi.${rawDoi}.categories[${categoryIndex}]`;
      const category = assertObject(rawCategory, label);
      assertOnlyInputKeys(
        category,
        ['category', 'rank', 'categoryTotal', 'quartile', 'jifPercentile'],
        label
      );
      const categoryName = nullableText(category.category);
      if (!categoryName) {
        throw new TypeError(`${label}.category must be non-empty text.`);
      }
      const categoryKey = categoryName.normalize('NFKC').toLocaleLowerCase('en-US');
      if (categoryNames.has(categoryKey)) {
        throw new TypeError(`${label}.category must be unique within the DOI record.`);
      }
      categoryNames.add(categoryKey);
      if (!Number.isInteger(category.rank) || category.rank < 1) {
        throw new TypeError(`${label}.rank must be a positive integer.`);
      }
      if (!Number.isInteger(category.categoryTotal) || category.categoryTotal < 1) {
        throw new TypeError(`${label}.categoryTotal must be a positive integer.`);
      }
      if (category.rank > category.categoryTotal) {
        throw new TypeError(`${label}.rank must not exceed categoryTotal.`);
      }
      if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(category.quartile)) {
        throw new TypeError(`${label}.quartile must be Q1, Q2, Q3, or Q4.`);
      }
      const expectedQuartile = expectedJcrQuartile(
        category.rank,
        category.categoryTotal
      );
      if (category.quartile !== expectedQuartile) {
        throw new TypeError(
          `${label}.quartile ${category.quartile} is inconsistent with rank ${category.rank} of ${category.categoryTotal}; expected ${expectedQuartile}.`
        );
      }
      if (typeof category.jifPercentile !== 'number'
          || !Number.isFinite(category.jifPercentile)
          || category.jifPercentile < 0
          || category.jifPercentile > 100) {
        throw new TypeError(`${label}.jifPercentile must be a finite number from 0 to 100.`);
      }
      const rankDerivedPercentile =
        (category.categoryTotal - category.rank + 0.5)
        / category.categoryTotal
        * 100;
      if (Math.abs(category.jifPercentile - rankDerivedPercentile)
          > JCR_PERCENTILE_TOLERANCE) {
        throw new TypeError(
          `${label}.jifPercentile is inconsistent with the official rank/total formula by more than ${JCR_PERCENTILE_TOLERANCE} percentage point.`
        );
      }
      bestPercentile = Math.max(bestPercentile, category.jifPercentile);
    }
    const bandId = journalStandingBand(bestPercentile);
    bandsByDoi.set(doi, bandId);
  }
  return bandsByDoi;
}

function deriveJournalStanding(publications, dataset) {
  if (!dataset) return unavailableJournalStanding(publications.length);
  if (dataset.aggregateRankingDisplayAuthorized !== true) {
    return unavailableJournalStanding(
      publications.length,
      dataset,
      'Public display of previous-year JCR ranking aggregates is not explicitly authorized. No ranking bands are published, and publication-year or current JCR data are not substituted.'
    );
  }

  const authorizationProvenance = rankingAuthorizationProvenance(dataset);
  if (dataset.rankingsByDoi === undefined || dataset.rankingsByDoi === null
      || Object.keys(assertObject(
        dataset.rankingsByDoi,
        'impactFactorJson.rankingsByDoi'
      )).length === 0) {
    return unavailableJournalStanding(
      publications.length,
      dataset,
      'No previous-year JCR ranking records are configured. Publication-year or current JCR data are not substituted.'
    );
  }

  const bandsByDoi = validatePreviousYearRankingBands(publications, dataset);
  const bandCounts = new Map(
    JOURNAL_STANDING_BANDS.map(band => [band.id, 0])
  );
  for (const bandId of bandsByDoi.values()) {
    bandCounts.set(bandId, bandCounts.get(bandId) + 1);
  }

  const coveredPublications = bandsByDoi.size;
  const unavailablePublications = publications.length - coveredPublications;
  bandCounts.set('unavailable', unavailablePublications);
  const complete = unavailablePublications === 0;
  return {
    status: complete ? 'ok' : 'partial',
    publicationTotal: publications.length,
    coveredPublications,
    unavailablePublications,
    bands: JOURNAL_STANDING_BANDS.map(band => ({
      id: band.id,
      label: band.label,
      count: bandCounts.get(band.id)
    })),
    ...journalStandingProvenance(dataset),
    ...authorizationProvenance,
    yearBasis: JOURNAL_STANDING_YEAR_BASIS,
    reason: complete
      ? null
      : `Partial coverage: ${coveredPublications} of ${publications.length} catalogue publications have an authorized previous-year JCR ranking; ${unavailablePublications} ${unavailablePublications === 1 ? 'is' : 'are'} unavailable and no publication-year or current JCR data are substituted.`
  };
}

function perPublicationRankingAuthorization(dataset) {
  if (!dataset || dataset.perPublicationRankingDisplayAuthorized !== true) return;
  const reference = nullableText(dataset.perPublicationRankingAuthorizationReference);
  if (!reference) {
    throw new TypeError(
      'impactFactorJson.perPublicationRankingAuthorizationReference must be non-empty text when perPublicationRankingDisplayAuthorized is true.'
    );
  }
  const authorizationDate = nullableText(dataset.perPublicationRankingAuthorizationDate);
  if (!isIsoCalendarDate(authorizationDate)) {
    throw new TypeError(
      'impactFactorJson.perPublicationRankingAuthorizationDate must be a valid YYYY-MM-DD date when perPublicationRankingDisplayAuthorized is true.'
    );
  }
}

function unavailablePublicationJcrBands(
  publicationTotal,
  displayAuthorized = false,
  reason = null
) {
  return {
    schemaVersion: PUBLICATION_JCR_BANDS_SCHEMA_VERSION,
    status: 'unavailable',
    displayAuthorized,
    publicationTotal,
    coveredPublications: 0,
    yearBasis: JOURNAL_STANDING_YEAR_BASIS,
    bandsByDoi: {},
    reason: reason || (
      displayAuthorized
        ? 'No exact previous-year JCR ranking records are available for public per-publication display.'
        : 'Public per-publication JCR band display is not explicitly authorized.'
    )
  };
}

/**
 * Derive the smallest public per-publication JCR snapshot needed by publication
 * cards. The private source categories, ranks, totals, percentiles, quartiles,
 * JIF values, edition, and authorization evidence are intentionally omitted.
 */
export function derivePublicationJcrBands({
  publications,
  impactFactorJson = null
}) {
  if (!Array.isArray(publications)) {
    throw new TypeError('publications must be an array.');
  }
  const dataset = validateImpactFactorDataset(
    parseImpactFactorJson(impactFactorJson)
  );
  if (!dataset) {
    return unavailablePublicationJcrBands(
      publications.length,
      false,
      'No licensed JCR input is configured; publication cards do not show a JCR band.'
    );
  }
  if (dataset.perPublicationRankingDisplayAuthorized !== true) {
    return unavailablePublicationJcrBands(publications.length);
  }

  perPublicationRankingAuthorization(dataset);
  if (dataset.rankingsByDoi === undefined || dataset.rankingsByDoi === null
      || Object.keys(assertObject(
        dataset.rankingsByDoi,
        'impactFactorJson.rankingsByDoi'
      )).length === 0) {
    return unavailablePublicationJcrBands(
      publications.length,
      true,
      'No exact previous-year JCR ranking records are configured for public per-publication display.'
    );
  }

  const validatedBands = validatePreviousYearRankingBands(publications, dataset);
  const bandsByDoi = {};
  for (const [index, publication] of publications.entries()) {
    const doi = normalizeDoi(publication.doi, `publications[${index}].doi`);
    const band = validatedBands.get(doi);
    if (band) bandsByDoi[doi] = band;
  }
  const coveredPublications = Object.keys(bandsByDoi).length;
  return {
    schemaVersion: PUBLICATION_JCR_BANDS_SCHEMA_VERSION,
    status: coveredPublications === publications.length ? 'ok' : 'partial',
    displayAuthorized: true,
    publicationTotal: publications.length,
    coveredPublications,
    yearBasis: JOURNAL_STANDING_YEAR_BASIS,
    bandsByDoi,
    reason: coveredPublications === publications.length
      ? null
      : `Partial coverage: ${coveredPublications} of ${publications.length} catalogue publications have an exact previous-year JCR band authorized for public per-publication display.`
  };
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareText)
      .map(key => [key, canonicalizeJson(value[key])])
  );
}

/**
 * Validate a private licensed JCR/JIF input against the publication catalogue
 * and prepare deterministic compact bytes suitable for a GitHub Actions secret.
 * The returned summary never contains licensed values.
 */
export function prepareLicensedJcrInput({
  publications,
  impactFactorJson,
  maxSecretBytes = GITHUB_ACTIONS_SECRET_MAX_BYTES
}) {
  if (!Array.isArray(publications)) {
    throw new TypeError('publications must be an array.');
  }
  if (!Number.isInteger(maxSecretBytes) || maxSecretBytes < 1) {
    throw new TypeError('maxSecretBytes must be a positive integer.');
  }
  const dataset = validateImpactFactorDataset(
    parseImpactFactorJson(impactFactorJson)
  );
  if (!dataset) {
    throw new TypeError('A nonempty licensed JCR/JIF input is required.');
  }

  const factorRecords = dataset.factorsByDoi === undefined
    ? 0
    : Object.keys(assertObject(
      dataset.factorsByDoi,
      'impactFactorJson.factorsByDoi'
    )).length;
  const rankingRecords = dataset.rankingsByDoi === undefined
    ? 0
    : Object.keys(assertObject(
      dataset.rankingsByDoi,
      'impactFactorJson.rankingsByDoi'
    )).length;
  if (factorRecords === 0 && rankingRecords === 0) {
    throw new TypeError(
      'The licensed JCR/JIF input must contain at least one factorsByDoi or rankingsByDoi record.'
    );
  }

  const impactFactors = deriveImpactFactors(publications, dataset);
  if (rankingRecords > 0) {
    validatePreviousYearRankingBands(publications, dataset);
  }
  const journalStanding = deriveJournalStanding(publications, dataset);
  const publicationBands = derivePublicationJcrBands({
    publications,
    impactFactorJson: dataset
  });

  const compactJson = JSON.stringify(canonicalizeJson(dataset));
  const compactBytes = Buffer.byteLength(compactJson, 'utf8');
  if (compactBytes > maxSecretBytes) {
    throw new RangeError(
      `The compact licensed JCR/JIF input is ${compactBytes} bytes, exceeding the GitHub Actions secret limit of ${maxSecretBytes} bytes.`
    );
  }

  return {
    compactJson,
    summary: {
      publicationTotal: publications.length,
      factorRecords,
      rankingRecords,
      compactBytes,
      maxSecretBytes,
      impactFactorStatus: impactFactors.status,
      journalStandingStatus: journalStanding.status,
      publicationBandStatus: publicationBands.status,
      publicationBandRecords: publicationBands.coveredPublications
    }
  };
}

/**
 * Derive a privacy-preserving, build-time-only statistics snapshot.
 * Citation sources remain separate because their coverage and counting methods differ.
 */
export function deriveLabStatistics({
  publications,
  metadata,
  bibliography,
  people,
  currentYear,
  impactFactorJson = null
}) {
  const year = positiveYear(currentYear, 'currentYear');
  const sourceMetadata = assertObject(metadata, 'metadata');
  if (typeof sourceMetadata.snapshotUpdatedAt !== 'string' || !sourceMetadata.snapshotUpdatedAt.trim()) {
    throw new TypeError('metadata.snapshotUpdatedAt must be a non-empty string.');
  }

  const publicationStatistics = derivePublicationStatistics(publications, year);
  const impactFactorDataset = validateImpactFactorDataset(
    parseImpactFactorJson(impactFactorJson)
  );
  const scopedMetadata = {
    ...sourceMetadata,
    publications: scopeMetadataPublications(publications, sourceMetadata.publications)
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    dataAsOf: sourceMetadata.snapshotUpdatedAt,
    publications: publicationStatistics,
    journals: deriveJournalDistribution(publications),
    coauthors: deriveCoauthorNetwork(bibliography, publications.length),
    researchAreas: deriveResearchAreas(publications),
    citations: {
      sources: makeCitationSources(scopedMetadata, publications.length)
    },
    metrics: {
      hIndex: makeHIndexMetric(scopedMetadata, publications.length)
    },
    impactFactors: deriveImpactFactors(publications, impactFactorDataset),
    journalStanding: deriveJournalStanding(publications, impactFactorDataset),
    team: deriveTeamStatistics(people)
  };
}

/**
 * Produce a deterministic, non-licensed lookup manifest for preparing the
 * private JCR/JIF input. It contains only public catalogue metadata and the
 * required previous-year mapping; no JIF, rank, percentile, or category values.
 */
export function deriveJcrInputRequirements(publications) {
  if (!Array.isArray(publications)) {
    throw new TypeError('publications must be an array.');
  }
  const seenDois = new Set();
  const records = publications.map((publication, index) => {
    if (!publication || typeof publication !== 'object' || Array.isArray(publication)) {
      throw new TypeError(`publications[${index}] must be an object.`);
    }
    const doi = normalizeDoi(publication.doi, `publications[${index}].doi`);
    if (seenDois.has(doi)) {
      throw new TypeError(`publications contains duplicate DOI ${doi}.`);
    }
    seenDois.add(doi);
    const publicationYear = positiveYear(
      publication.year,
      `publications[${index}].year`
    );
    const requiredJcrYear = positiveYear(
      publicationYear - 1,
      `publications[${index}].requiredJcrYear`
    );
    const no = normalizeWhitespace(publication.no);
    const title = normalizeWhitespace(publication.title);
    const journal = normalizeWhitespace(publication.journal);
    if (!no || !title || !journal) {
      throw new TypeError(
        `publications[${index}] must include nonempty no, title, and journal fields.`
      );
    }
    return {
      no,
      doi,
      title,
      journal,
      publicationYear,
      requiredJcrYear
    };
  });
  return {
    schemaVersion: JCR_INPUT_REQUIREMENTS_SCHEMA_VERSION,
    publicationTotal: records.length,
    yearBasis: JOURNAL_STANDING_YEAR_BASIS,
    records
  };
}

async function readBoundedFile(path, maxBytes, label) {
  const stat = await fs.stat(path);
  if (!stat.isFile() || stat.size > maxBytes) {
    throw new Error(`${label} must be a file no larger than ${maxBytes} bytes.`);
  }
  return fs.readFile(path, 'utf8');
}

async function loadBrowserDataScript(path, expression, label) {
  const source = await readBoundedFile(path, MAX_SCRIPT_BYTES, label);
  const sandbox = Object.create(null);
  sandbox.window = Object.create(null);
  const context = vm.createContext(sandbox, {
    name: `lab-statistics:${label}`,
    codeGeneration: { strings: false, wasm: false }
  });
  const script = new vm.Script(source, { filename: path });
  script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });
  const value = new vm.Script(expression, { filename: `${path}:extract` })
    .runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });
  return JSON.parse(JSON.stringify(value));
}

async function readJson(path, label) {
  const source = await readBoundedFile(path, MAX_JSON_BYTES, label);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

export async function generateJcrInputRequirementsFile({
  feedPath,
  outputPath
}) {
  for (const [label, value] of Object.entries({ feedPath, outputPath })) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`${label} must be a non-empty path.`);
    }
  }
  const publications = await loadBrowserDataScript(
    feedPath,
    'window.MTAP_FEED && window.MTAP_FEED.PUBS',
    'feed.js'
  );
  const requirements = deriveJcrInputRequirements(publications);
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(requirements, null, 2)}\n`,
    'utf8'
  );
  return requirements;
}

export async function validateLicensedJcrInputFile({
  feedPath,
  inputPath,
  compactOutputPath = null,
  maxSecretBytes = GITHUB_ACTIONS_SECRET_MAX_BYTES
}) {
  for (const [label, value] of Object.entries({ feedPath, inputPath })) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`${label} must be a non-empty path.`);
    }
  }
  if (compactOutputPath !== null
      && (typeof compactOutputPath !== 'string' || !compactOutputPath.trim())) {
    throw new TypeError('compactOutputPath must be null or a non-empty path.');
  }
  if (compactOutputPath && resolve(compactOutputPath) === resolve(inputPath)) {
    throw new TypeError('compactOutputPath must not overwrite inputPath.');
  }

  const [publications, inputSource] = await Promise.all([
    loadBrowserDataScript(
      feedPath,
      'window.MTAP_FEED && window.MTAP_FEED.PUBS',
      'feed.js'
    ),
    readBoundedFile(inputPath, MAX_JSON_BYTES, 'licensed JCR/JIF input')
  ]);
  const prepared = prepareLicensedJcrInput({
    publications,
    impactFactorJson: inputSource,
    maxSecretBytes
  });
  if (compactOutputPath) {
    await fs.mkdir(dirname(compactOutputPath), { recursive: true });
    await fs.writeFile(compactOutputPath, prepared.compactJson, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
  }
  return prepared.summary;
}

export async function generateLabStatisticsFile({
  feedPath,
  metadataPath,
  bibliographyPath,
  peoplePath,
  outputPath,
  currentYear = new Date().getUTCFullYear(),
  impactFactorJson = null
}) {
  for (const [label, value] of Object.entries({
    feedPath,
    metadataPath,
    bibliographyPath,
    peoplePath,
    outputPath
  })) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`${label} must be a non-empty path.`);
    }
  }

  const [publications, metadata, bibliography, people] = await Promise.all([
    loadBrowserDataScript(feedPath, 'window.MTAP_FEED && window.MTAP_FEED.PUBS', 'feed.js'),
    readJson(metadataPath, 'publication metadata'),
    readJson(bibliographyPath, 'publication bibliography'),
    loadBrowserDataScript(peoplePath, 'window.MTAP_PEOPLE && window.MTAP_PEOPLE()', 'people-data.js')
  ]);
  const statistics = deriveLabStatistics({
    publications,
    metadata,
    bibliography,
    people,
    currentYear,
    impactFactorJson
  });
  const serialized = `${JSON.stringify(statistics, null, 2)}\n`;
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, serialized, 'utf8');
  return statistics;
}

export async function generatePublicationJcrBandsFile({
  feedPath,
  outputPath,
  impactFactorJson = null
}) {
  for (const [label, value] of Object.entries({ feedPath, outputPath })) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`${label} must be a non-empty path.`);
    }
  }
  const publications = await loadBrowserDataScript(
    feedPath,
    'window.MTAP_FEED && window.MTAP_FEED.PUBS',
    'feed.js'
  );
  const snapshot = derivePublicationJcrBands({
    publications,
    impactFactorJson
  });
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8'
  );
  return snapshot;
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_FEED_PATH = path.join(REPOSITORY_ROOT, 'feed.js');
const DEFAULT_BIBLIOGRAPHY_PATH = path.join(REPOSITORY_ROOT, 'data', 'publication-bibliography.json');
const DEFAULT_OUTPUT_ROOT = path.join(REPOSITORY_ROOT, 'dist');
const USER_AGENT_BASE = 'Chung-Research-Group-publication-catalogue/1.0';
// DOI suffixes may contain Unicode graphic characters, including legacy
// punctuation such as angle brackets. Literal whitespace is required to be
// percent-encoded so a DOI remains one unambiguous catalogue token.
const DOI_PATTERN = /^10\.\d{4,9}\/[\p{L}\p{M}\p{N}\p{P}\p{S}]+$/iu;
const DISALLOWED_AUTHOR_TEXT = /(?:\bet\s+al\.?(?:\s|$)|[*#])/i;
const CURATED_AUTHOR_ORCID_OVERRIDES = new Map([
  [
    '10.1002/slct.201701934\u0000wei\u0000li',
    'https://orcid.org/0000-0002-3920-3863'
  ]
]);

const ENTITY_MAP = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['lt', '<'],
  ['nbsp', ' '],
  ['quot', '"'],
  ['ndash', '–'],
  ['mdash', '—'],
  ['minus', '−'],
  ['middot', '·'],
  ['hellip', '…'],
  ['times', '×'],
  ['alpha', 'α'],
  ['beta', 'β'],
  ['gamma', 'γ'],
  ['delta', 'δ'],
  ['mu', 'μ']
]);

function decodeEntities(value) {
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (entity, body) => {
    if (body[0] === '#') {
      const hexadecimal = body[1]?.toLowerCase() === 'x';
      const numberText = body.slice(hexadecimal ? 2 : 1);
      const codePoint = Number.parseInt(numberText, hexadecimal ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return entity;
      }
    }
    return ENTITY_MAP.get(body.toLowerCase()) ?? entity;
  });
}

function normalizePlainText(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
}

function cleanText(value) {
  if (value === undefined || value === null) return '';
  return normalizePlainText(
    decodeEntities(String(value).replace(/<[^>]*>/g, ''))
  );
}

function optionalText(value) {
  const cleaned = cleanText(value);
  return cleaned || undefined;
}

function normalizeDoi(value) {
  const cleaned = decodeEntities(String(value ?? ''))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .trim()
    .normalize('NFC')
    .toLowerCase();
  const match = cleaned.match(DOI_PATTERN);
  if (!match || match[0] !== cleaned) throw new Error(`Invalid DOI: ${value}`);
  return cleaned;
}

export function doiResolverUrl(value) {
  const doi = normalizeDoi(value);
  const separator = doi.indexOf('/');
  const prefix = doi.slice(0, separator);
  const suffix = doi.slice(separator + 1);
  return `https://doi.org/${prefix}/${encodeURIComponent(suffix)}`;
}

function normalizeOrcid(value) {
  const text = optionalText(value);
  if (!text) return undefined;
  const identifier = text.replace(/^https?:\/\/orcid\.org\//i, '').toUpperCase();
  if (!/^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(identifier)) return undefined;
  return `https://orcid.org/${identifier}`;
}

function firstValue(value) {
  if (Array.isArray(value)) return value.find(item => optionalText(item)) ?? '';
  return value ?? '';
}

function dateYear(raw) {
  const candidates = [
    raw?.['published-print'],
    raw?.['published-online'],
    raw?.published,
    raw?.issued
  ];
  for (const candidate of candidates) {
    const value = candidate?.['date-parts']?.[0]?.[0];
    const year = Number.parseInt(value, 10);
    if (Number.isInteger(year) && year >= 1000 && year <= 9999) return year;
  }
  const direct = Number.parseInt(raw?.year, 10);
  return Number.isInteger(direct) && direct >= 1000 && direct <= 9999 ? direct : undefined;
}

function normalizeAuthor(author) {
  if (typeof author === 'string') {
    const literal = optionalText(author);
    return literal ? { literal } : null;
  }
  if (!author || typeof author !== 'object') return null;

  const given = optionalText(author.given ?? author['given-names']);
  const family = optionalText(author.family ?? author['family-names']);
  const explicitLiteral = optionalText(author.literal ?? author.name);
  const orcid = normalizeOrcid(author.ORCID ?? author.orcid);
  const normalized = {};

  if (explicitLiteral) {
    normalized.literal = explicitLiteral;
  } else if (given && family) {
    normalized.given = given;
    normalized.family = family;
  } else if (family) {
    // A name with no separable given name is retained as a mononym/entity.
    normalized.literal = family;
  } else if (given) {
    normalized.literal = given;
  } else {
    return null;
  }
  if (orcid) normalized.orcid = orcid;
  return normalized;
}

function normalizePages(value) {
  const text = optionalText(value);
  return text ? text.replace(/\s*[-‐‑‒–—]\s*/g, '–') : undefined;
}

function decodeJavascriptStringLiteral(literal) {
  const quote = literal[0];
  if (!["'", '"'].includes(quote) || literal.at(-1) !== quote) {
    throw new Error('feed.js DOI string is not terminated');
  }
  let value = '';
  for (let index = 1; index < literal.length - 1; index += 1) {
    const character = literal[index];
    if (character !== '\\') {
      value += character;
      continue;
    }
    index += 1;
    if (index >= literal.length - 1) throw new Error('feed.js DOI string has an incomplete escape');
    const escaped = literal[index];
    const simpleEscapes = {
      '\\': '\\',
      "'": "'",
      '"': '"',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      0: '\0'
    };
    if (Object.hasOwn(simpleEscapes, escaped)) {
      if (escaped === '0' && /\d/.test(literal[index + 1] || '')) {
        throw new Error('feed.js DOI string must not use a legacy octal escape');
      }
      value += simpleEscapes[escaped];
      continue;
    }
    if (escaped === 'x') {
      const digits = literal.slice(index + 1, index + 3);
      if (!/^[\da-f]{2}$/i.test(digits)) throw new Error('feed.js DOI string has an invalid hexadecimal escape');
      value += String.fromCodePoint(Number.parseInt(digits, 16));
      index += 2;
      continue;
    }
    if (escaped === 'u') {
      if (literal[index + 1] === '{') {
        const close = literal.indexOf('}', index + 2);
        const digits = close < 0 ? '' : literal.slice(index + 2, close);
        const codePoint = /^[\da-f]{1,6}$/i.test(digits) ? Number.parseInt(digits, 16) : -1;
        if (close < 0 || codePoint < 0 || codePoint > 0x10ffff) {
          throw new Error('feed.js DOI string has an invalid Unicode code-point escape');
        }
        value += String.fromCodePoint(codePoint);
        index = close;
        continue;
      }
      const digits = literal.slice(index + 1, index + 5);
      if (!/^[\da-f]{4}$/i.test(digits)) throw new Error('feed.js DOI string has an invalid Unicode escape');
      value += String.fromCharCode(Number.parseInt(digits, 16));
      index += 4;
      continue;
    }
    if (escaped === '\n' || escaped === '\u2028' || escaped === '\u2029') continue;
    if (escaped === '\r') {
      if (literal[index + 1] === '\n') index += 1;
      continue;
    }
    if (/[1-9]/.test(escaped)) {
      throw new Error('feed.js DOI string must not use a legacy octal escape');
    }
    // JavaScript non-escape characters such as \q evaluate to q.
    value += escaped;
  }
  return value;
}

/**
 * Extract the publication DOI sequence from feed.js without executing browser code.
 * The order of the returned array is the editorial order used by the website.
 */
export function parseFeedDois(feedSource) {
  const source = String(feedSource);
  const start = source.indexOf('const PUBS = [');
  if (start < 0) throw new Error('feed.js does not contain `const PUBS = [`');
  const end = source.indexOf('\n];', start);
  if (end < 0) throw new Error('feed.js publication list is not terminated');
  const publicationSection = source.slice(start, end);
  const dois = [];
  const lastArgumentPattern = /,\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*\)\s*,?/g;
  for (const match of publicationSection.matchAll(lastArgumentPattern)) {
    const value = decodeJavascriptStringLiteral(match[1]);
    if (/^10\./i.test(value)) dois.push(normalizeDoi(value));
  }
  if (dois.length === 0) throw new Error('feed.js publication list does not contain any DOI');
  return dois;
}

/**
 * Convert either a Crossref work or a CSL-JSON record into the canonical snapshot shape.
 */
export function normalizeCanonicalRecord(rawRecord, {
  doi,
  provider = 'crossref',
  retrievedAt
} = {}) {
  if (!rawRecord || typeof rawRecord !== 'object') throw new Error('Bibliographic record must be an object');
  const normalizedDoi = normalizeDoi(doi ?? rawRecord.DOI ?? rawRecord.doi);
  const authors = (rawRecord.author ?? rawRecord.authors ?? [])
    .map(normalizeAuthor)
    .filter(Boolean)
    .map(author => {
      const authorKey = [
        normalizedDoi,
        optionalText(author.given)?.toLowerCase() || '',
        optionalText(author.family)?.toLowerCase() || ''
      ].join('\u0000');
      const correctedOrcid = CURATED_AUTHOR_ORCID_OVERRIDES.get(authorKey);
      return correctedOrcid ? { ...author, orcid: correctedOrcid } : author;
    });
  const record = {
    doi: normalizedDoi,
    type: 'article',
    title: cleanText(firstValue(rawRecord.title)),
    authors,
    journal: cleanText(firstValue(rawRecord['container-title'] ?? rawRecord['container_title'] ?? rawRecord.journal)),
    year: dateYear(rawRecord)
  };

  const volume = optionalText(rawRecord.volume);
  const issue = optionalText(rawRecord.issue ?? rawRecord.number);
  const pages = normalizePages(rawRecord.page ?? rawRecord.pages);
  const articleNumber = optionalText(
    rawRecord['article-number']
      ?? rawRecord.articleNumber
      ?? rawRecord['article_number']
  );
  const publisher = optionalText(rawRecord.publisher);
  if (volume) record.volume = volume;
  if (issue) record.issue = issue;
  // Several registration agencies repeat an electronic article number in
  // both `page` and `article-number`; keep it as an article number only.
  if (pages && pages !== articleNumber) record.pages = pages;
  if (articleNumber) record.articleNumber = articleNumber;
  if (publisher) record.publisher = publisher;
  record.source = { provider: provider === 'doi-csl' ? 'doi-csl' : 'crossref' };
  if (retrievedAt) record.source.retrievedAt = new Date(retrievedAt).toISOString();
  return record;
}

function userAgent(mailto) {
  const contact = optionalText(mailto);
  return contact ? `${USER_AGENT_BASE} (mailto:${contact})` : USER_AGENT_BASE;
}

function crossrefUrl(pathname, mailto) {
  const url = new URL(`https://api.crossref.org${pathname}`);
  const contact = optionalText(mailto);
  if (contact) url.searchParams.set('mailto', contact);
  return url;
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 30_000);
  }
  return Math.min(500 * (2 ** attempt), 8_000);
}

async function requestJson(url, {
  fetchImpl,
  headers,
  retries = 3,
  sleep
}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, { headers });
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
      await sleep(500 * (2 ** attempt));
      continue;
    }

    if (response.status === 404) return { status: 404, data: null };
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`Metadata request failed with HTTP ${response.status}: ${url}`);
      if (attempt === retries) throw lastError;
      await sleep(retryDelay(response, attempt));
      continue;
    }
    if (!response.ok) throw new Error(`Metadata request failed with HTTP ${response.status}: ${url}`);
    try {
      return { status: response.status, data: await response.json() };
    } catch (error) {
      throw new Error(`Metadata response was not valid JSON: ${url}`, { cause: error });
    }
  }
  throw lastError;
}

async function fetchCanonicalRecord(doi, options) {
  const {
    fetchImpl,
    mailto,
    retrievedAt,
    sleep
  } = options;
  const headers = {
    Accept: 'application/json',
    'User-Agent': userAgent(mailto)
  };
  const encodedDoi = encodeURIComponent(doi);
  const crossref = await requestJson(crossrefUrl(`/works/${encodedDoi}`, mailto), {
    fetchImpl,
    headers,
    sleep
  });
  if (crossref.status !== 404) {
    return normalizeCanonicalRecord(crossref.data?.message, {
      doi,
      provider: 'crossref',
      retrievedAt
    });
  }

  const agency = await requestJson(crossrefUrl(`/works/${encodedDoi}/agency`, mailto), {
    fetchImpl,
    headers,
    sleep
  });
  const agencyId = optionalText(agency.data?.message?.agency?.id)?.toLowerCase();
  if (agency.status === 404 || !agencyId) {
    throw new Error(`No DOI registration agency was found for ${doi}`);
  }
  if (agencyId === 'crossref') {
    throw new Error(`Crossref identifies ${doi} as a Crossref DOI but returned no work metadata`);
  }

  const csl = await requestJson(new URL(doiResolverUrl(doi)), {
    fetchImpl,
    headers: {
      Accept: 'application/vnd.citationstyles.csl+json',
      'User-Agent': userAgent(mailto)
    },
    sleep
  });
  if (csl.status === 404) throw new Error(`doi.org returned no CSL metadata for ${doi}`);
  return normalizeCanonicalRecord(csl.data, {
    doi,
    provider: 'doi-csl',
    retrievedAt
  });
}

async function mapWithConcurrency(values, concurrency, task) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

/**
 * Refresh a canonical snapshot. This is the only exported operation that uses the network.
 * Build and validation callers should consume the committed snapshot instead.
 */
export async function refreshBibliographySnapshot({
  dois,
  fetchImpl = globalThis.fetch,
  mailto = process.env.CROSSREF_MAILTO,
  concurrency = 2,
  now = () => new Date(),
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
}) {
  if (!Array.isArray(dois) || dois.length === 0) throw new Error('A non-empty DOI array is required');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
    throw new Error('Citation refresh concurrency must be an integer from 1 to 2');
  }
  const normalizedDois = dois.map(normalizeDoi);
  if (new Set(normalizedDois).size !== normalizedDois.length) throw new Error('The DOI list contains duplicates');
  const snapshotTime = now();
  const retrievedAt = snapshotTime.toISOString();
  const records = await mapWithConcurrency(normalizedDois, concurrency, doi => fetchCanonicalRecord(doi, {
    fetchImpl,
    mailto,
    retrievedAt,
    sleep
  }));
  const publications = {};
  normalizedDois.forEach((doi, index) => {
    publications[doi] = records[index];
  });
  const snapshot = {
    schemaVersion: 1,
    snapshotUpdatedAt: retrievedAt,
    publications
  };
  const validation = validateBibliography(snapshot, normalizedDois);
  if (!validation.ok) throw new Error(`Refreshed bibliography is invalid:\n- ${validation.errors.join('\n- ')}`);
  return snapshot;
}

function authorDisplay(author) {
  if (author.literal) return author.literal;
  return [author.given, author.family].filter(Boolean).join(' ');
}

function orderedRecords(snapshot, feedDois) {
  const order = feedDois?.map(normalizeDoi) ?? Object.keys(snapshot.publications ?? {});
  return order.map(doi => snapshot.publications[doi]);
}

/**
 * Validate a committed snapshot against the DOI sequence from feed.js.
 */
export function validateBibliography(snapshot, feedDois) {
  const errors = [];
  const structuredNamesByOrcid = new Map();
  const expected = Array.isArray(feedDois) ? feedDois.map(doi => {
    try {
      return normalizeDoi(doi);
    } catch (error) {
      errors.push(error.message);
      return String(doi);
    }
  }) : [];
  if (snapshot?.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (!snapshot?.snapshotUpdatedAt || !Number.isFinite(Date.parse(snapshot.snapshotUpdatedAt))) {
    errors.push('snapshotUpdatedAt must be an ISO date-time');
  }
  const publications = snapshot?.publications;
  if (!publications || typeof publications !== 'object' || Array.isArray(publications)) {
    errors.push('publications must be an object keyed by normalized DOI');
    return { ok: false, errors };
  }

  const duplicateExpected = expected.filter((doi, index) => expected.indexOf(doi) !== index);
  if (duplicateExpected.length) errors.push(`feed DOI list contains duplicates: ${[...new Set(duplicateExpected)].join(', ')}`);
  const actual = Object.keys(publications);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter(doi => !actualSet.has(doi));
  const unexpected = actual.filter(doi => !expectedSet.has(doi));
  if (missing.length) errors.push(`snapshot is missing DOI(s): ${missing.join(', ')}`);
  if (unexpected.length) errors.push(`snapshot contains unexpected DOI(s): ${unexpected.join(', ')}`);
  if (expected.length !== actual.length) {
    errors.push(`snapshot DOI count ${actual.length} does not match feed DOI count ${expected.length}`);
  }

  for (const [key, record] of Object.entries(publications)) {
    let normalizedKey;
    try {
      normalizedKey = normalizeDoi(key);
      if (normalizedKey !== key) errors.push(`${key}: snapshot key is not a normalized DOI`);
    } catch {
      errors.push(`${key}: snapshot key is not a valid DOI`);
      continue;
    }
    if (!record || typeof record !== 'object') {
      errors.push(`${key}: record must be an object`);
      continue;
    }
    if (record.doi !== normalizedKey) errors.push(`${key}: record DOI must match its key`);
    if (record.type !== 'article') errors.push(`${key}: type must be article`);
    for (const field of ['title', 'journal']) {
      if (!optionalText(record[field])) errors.push(`${key}: ${field} is required`);
    }
    if (!Number.isInteger(record.year) || record.year < 1000 || record.year > 9999) {
      errors.push(`${key}: year must be a four-digit integer`);
    }
    if (!Array.isArray(record.authors) || record.authors.length === 0) {
      errors.push(`${key}: at least one structured author is required`);
    } else {
      record.authors.forEach((author, index) => {
        const label = `${key}: author ${index + 1}`;
        if (!author || typeof author !== 'object') {
          errors.push(`${label} must be an object`);
          return;
        }
        const hasLiteral = Boolean(optionalText(author.literal));
        const hasFamily = Boolean(optionalText(author.family));
        if (!hasLiteral && !hasFamily) errors.push(`${label} must have literal or family`);
        const display = authorDisplay(author);
        if (DISALLOWED_AUTHOR_TEXT.test(display)) errors.push(`${label} contains an abbreviated/UI-only marker`);
        const orcid = normalizeOrcid(author.orcid);
        const given = optionalText(author.given);
        const family = optionalText(author.family);
        if (orcid && given && family) {
          const normalizeNamePart = value => normalizePlainText(value)
            .normalize('NFKD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim();
          const identity = {
            given: normalizeNamePart(given).split(' ')[0],
            family: normalizeNamePart(family),
            display,
            key
          };
          const identities = structuredNamesByOrcid.get(orcid) || [];
          identities.push(identity);
          structuredNamesByOrcid.set(orcid, identities);
        }
      });
    }
    if (!['crossref', 'doi-csl'].includes(record.source?.provider)) {
      errors.push(`${key}: source.provider must be crossref or doi-csl`);
    }
  }
  const compatibleGivenNames = (left, right) =>
    left === right
    || (left.length === 1 && right.startsWith(left))
    || (right.length === 1 && left.startsWith(right));
  for (const [orcid, identities] of structuredNamesByOrcid) {
    for (let left = 0; left < identities.length; left += 1) {
      for (let right = left + 1; right < identities.length; right += 1) {
        const first = identities[left];
        const second = identities[right];
        if (first.family !== second.family
            || !compatibleGivenNames(first.given, second.given)) {
          errors.push(
            `${orcid}: conflicting structured author names ${first.display} (${first.key}) and ${second.display} (${second.key})`
          );
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function bibtexEscape(value) {
  const replacements = {
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    '#': '\\#',
    '$': '\\$',
    '%': '\\%',
    '&': '\\&',
    '_': '\\_',
    '^': '\\^{}',
    '~': '\\~{}'
  };
  return normalizePlainText(value).split('').map(character => replacements[character] ?? character).join('');
}

/**
 * Recover DOI field values from the deterministic BibTeX shape generated by
 * this module. This reverses only our explicit escaping and is not intended to
 * be a general-purpose BibTeX parser.
 */
export function parseGeneratedBibtexDois(bibtex) {
  const dois = [];
  for (const line of String(bibtex).split(/\r?\n/)) {
    const match = line.match(/^\s*doi\s*=\s*(\{.*\}|".*")\s*,?\s*$/i);
    if (!match) continue;
    const escaped = match[1].slice(1, -1);
    dois.push(
      escaped
        .replaceAll('\\textbackslash{}', '\\')
        .replaceAll('\\^{}', '^')
        .replaceAll('\\~{}', '~')
        .replace(/\\([{}&%$#_])/g, '$1')
    );
  }
  return dois;
}

function bibtexAuthor(author) {
  if (author.literal) return `{${bibtexEscape(author.literal)}}`;
  const family = bibtexEscape(author.family);
  const given = bibtexEscape(author.given ?? '');
  return given ? `${family}, ${given}` : family;
}

function citationKey(doi) {
  const slug = doi.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const digest = createHash('sha256').update(doi).digest('hex').slice(0, 8);
  return `doi_${slug}_${digest}`;
}

/**
 * Generate a deterministic BibTeX catalogue in feed order.
 */
export function generateBibtex(snapshot, feedDois) {
  const records = orderedRecords(snapshot, feedDois);
  const entries = records.map(record => {
    const fields = [
      ['title', record.title],
      ['author', record.authors.map(bibtexAuthor).join(' and '), true],
      ['journal', record.journal],
      ['year', String(record.year)],
      ['volume', record.volume],
      ['number', record.issue],
      ['pages', record.pages],
      ['eid', record.articleNumber],
      ['doi', record.doi],
      ['url', doiResolverUrl(record.doi)]
    ].filter(([, value]) => optionalText(value));
    const body = fields.map(([name, value, alreadyEscaped], index) => {
      const suffix = index === fields.length - 1 ? '' : ',';
      const escapedValue = alreadyEscaped ? value : bibtexEscape(value);
      const wrappedValue = name === 'title' ? `{{${escapedValue}}}` : `{${escapedValue}}`;
      return `  ${name} = ${wrappedValue}${suffix}`;
    }).join('\n');
    return `@article{${citationKey(record.doi)},\n${body}\n}`;
  });
  return `${entries.join('\n\n')}\n`;
}

function yamlString(value) {
  return JSON.stringify(normalizePlainText(value));
}

function yamlLine(lines, indent, key, value) {
  if (value === undefined || value === null || value === '') return;
  const scalar = typeof value === 'number' ? String(value) : yamlString(value);
  lines.push(`${' '.repeat(indent)}${key}: ${scalar}`);
}

function cffAuthorLines(lines, author, indent) {
  lines.push(`${' '.repeat(indent)}- ${author.literal ? `name: ${yamlString(author.literal)}` : `family-names: ${yamlString(author.family)}`}`);
  if (!author.literal && author.given) yamlLine(lines, indent + 2, 'given-names', author.given);
  if (!author.literal && author.orcid) yamlLine(lines, indent + 2, 'orcid', author.orcid);
}

function pageRange(record) {
  const value = optionalText(record.pages);
  if (!value) return record.articleNumber ? { start: record.articleNumber } : {};
  const pieces = value.split(/\s*[–—]\s*/, 2);
  return pieces.length === 2
    ? { start: pieces[0], end: pieces[1] }
    : { start: value };
}

/**
 * Generate a deterministic CFF 1.2.0 dataset whose references are the articles.
 */
export function generateCff(snapshot, feedDois) {
  const lines = [
    'cff-version: "1.2.0"',
    'message: "Please cite the individual DOI article(s) used from this publication catalogue; do not cite this catalogue in place of the articles."',
    'title: "Chung Research Group Publication Catalogue"',
    'type: "dataset"',
    'authors:',
    '  - name: "Chung Research Group"',
    'url: "https://chung-research-group.github.io/Publications.dc.html"',
    'references:'
  ];
  for (const record of orderedRecords(snapshot, feedDois)) {
    lines.push('  - type: "article"');
    yamlLine(lines, 4, 'title', record.title);
    lines.push('    authors:');
    record.authors.forEach(author => cffAuthorLines(lines, author, 6));
    yamlLine(lines, 4, 'journal', record.journal);
    yamlLine(lines, 4, 'year', record.year);
    yamlLine(lines, 4, 'volume', record.volume);
    yamlLine(lines, 4, 'issue', record.issue);
    const pages = pageRange(record);
    yamlLine(lines, 4, 'start', pages.start);
    yamlLine(lines, 4, 'end', pages.end);
    yamlLine(lines, 4, 'doi', record.doi);
    yamlLine(lines, 4, 'url', doiResolverUrl(record.doi));
  }
  return `${lines.join('\n')}\n`;
}

async function writeUtf8(target, contents) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

/**
 * Generate both downloadable files from committed source data without network access.
 */
export async function generatePublicationCitationFiles({
  feedPath = DEFAULT_FEED_PATH,
  bibliographyPath = DEFAULT_BIBLIOGRAPHY_PATH,
  outputRoot = DEFAULT_OUTPUT_ROOT,
  bibtexPath,
  cffPath
} = {}) {
  const [feedSource, snapshotSource] = await Promise.all([
    readFile(feedPath, 'utf8'),
    readFile(bibliographyPath, 'utf8')
  ]);
  const feedDois = parseFeedDois(feedSource);
  const snapshot = JSON.parse(snapshotSource);
  const validation = validateBibliography(snapshot, feedDois);
  if (!validation.ok) throw new Error(`Publication bibliography is invalid:\n- ${validation.errors.join('\n- ')}`);
  const resolvedBibtexPath = bibtexPath ?? path.join(outputRoot, 'exports', 'publications', 'publications.bib');
  const resolvedCffPath = cffPath ?? path.join(outputRoot, 'exports', 'publications', 'CITATION.cff');
  await Promise.all([
    writeUtf8(resolvedBibtexPath, generateBibtex(snapshot, feedDois)),
    writeUtf8(resolvedCffPath, generateCff(snapshot, feedDois))
  ]);
  return {
    bibtexPath: resolvedBibtexPath,
    cffPath: resolvedCffPath,
    publicationCount: feedDois.length
  };
}

function parseArguments(argv) {
  const options = {
    refresh: false,
    generate: false,
    feedPath: DEFAULT_FEED_PATH,
    bibliographyPath: DEFAULT_BIBLIOGRAPHY_PATH,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    bibtexPath: undefined,
    cffPath: undefined,
    concurrency: 2
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      return path.resolve(value);
    };
    if (argument === '--refresh') options.refresh = true;
    else if (argument === '--generate') options.generate = true;
    else if (argument === '--feed') options.feedPath = readValue();
    else if (argument === '--snapshot') options.bibliographyPath = readValue();
    else if (argument === '--output-root') options.outputRoot = readValue();
    else if (argument === '--bibtex') options.bibtexPath = readValue();
    else if (argument === '--cff') options.cffPath = readValue();
    else if (argument === '--concurrency') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value)) throw new Error('--concurrency requires an integer');
      options.concurrency = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.refresh && !options.generate) options.generate = true;
  return options;
}

async function runCli(argv) {
  const options = parseArguments(argv);
  if (options.refresh) {
    const feedSource = await readFile(options.feedPath, 'utf8');
    const feedDois = parseFeedDois(feedSource);
    const snapshot = await refreshBibliographySnapshot({
      dois: feedDois,
      concurrency: options.concurrency
    });
    await writeUtf8(options.bibliographyPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    process.stdout.write(`Refreshed ${feedDois.length} publication records in ${options.bibliographyPath}\n`);
  }
  if (options.generate) {
    const result = await generatePublicationCitationFiles(options);
    process.stdout.write(`Generated ${result.publicationCount} citation records:\n- ${result.bibtexPath}\n- ${result.cffPath}\n`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  runCli(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

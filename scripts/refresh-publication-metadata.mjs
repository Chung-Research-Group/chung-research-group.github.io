import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const defaultOutput = path.join(repositoryRoot, "data", "publication-metadata.json");
const nonRetryableRequestError = Symbol("nonRetryableRequestError");
const googleScholarAuthorId = String(
  process.env.GOOGLE_SCHOLAR_AUTHOR_ID || "q-UUrywAAAAJ"
).trim();
const googleScholarArticleLimit = 100;
const googleScholarMaximumPages = 5;

export const googleScholarCitationOverrides = Object.freeze({
  "10.1021/acs.jpcc.9b02116": "q-UUrywAAAAJ:3fE2CSJIrl8C"
});

export function normalizeDoi(value = "") {
  return String(value)
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

function decodeTitleEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => {
      const codePoint = Number.parseInt(digits, 16);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    })
    .replace(/&#([0-9]+);/g, (_, digits) => {
      const codePoint = Number.parseInt(digits, 10);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => ({
      amp: "&",
      lt: "<",
      gt: ">",
      quot: "\"",
      apos: "'",
      nbsp: " "
    })[name.toLowerCase()] || entity);
}

export function normalizePublicationTitle(value = "") {
  return decodeTitleEntities(value)
    .replace(/<[^>]*>/g, " ")
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function unique(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => value && !seen.has(value.toLowerCase()) && seen.add(value.toLowerCase()));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function redactedRequestUrl(value) {
  try {
    const url = new URL(value);
    for (const name of ["api_key", "apikey", "key", "token", "access_token"]) {
      if (url.searchParams.has(name)) url.searchParams.set(name, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return String(value).replace(
      /([?&](?:api_?key|key|token|access_token)=)[^&\s]+/gi,
      "$1[REDACTED]"
    );
  }
}

async function requestJson(url, options = {}, fetchImpl = fetch, { maxAttempts = 5 } = {}) {
  let lastError;
  const safeUrl = redactedRequestUrl(url);
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  for (let attempt = 0; attempt < attempts; attempt++) {
    let wait = Math.min(8000, 750 * (2 ** attempt));
    try {
      const response = await fetchImpl(url, options);
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          const error = new Error(`${options.method || "GET"} ${safeUrl}: invalid JSON response`);
          error[nonRetryableRequestError] = true;
          throw error;
        }
      }
      if (response.status !== 429 && response.status < 500) {
        const error = new Error(`${options.method || "GET"} ${safeUrl}: HTTP ${response.status}`);
        error[nonRetryableRequestError] = true;
        throw error;
      }
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : wait;
      lastError = new Error(`${options.method || "GET"} ${safeUrl}: HTTP ${response.status}`);
    } catch (error) {
      if (error?.[nonRetryableRequestError]) throw error;
      lastError = new Error(`${options.method || "GET"} ${safeUrl}: network request failed`);
    }
    if (attempt < attempts - 1) await delay(wait);
  }
  throw lastError || new Error(`Request failed: ${safeUrl}`);
}

export async function loadFeedPublications(feedPath = path.join(repositoryRoot, "feed.js")) {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    await import(`${pathToFileURL(feedPath).href}?metadata=${Date.now()}`);
    return (globalThis.window.MTAP_FEED?.PUBS || []).map((publication) => ({
      no: String(publication.no),
      doi: normalizeDoi(publication.doi),
      title: publication.title,
      year: Number((publication.meta?.match(/\((\d{4})\)/) || [])[1] || 0)
    }));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

export async function fetchSemanticScholar(dois, {
  apiKey = "",
  fetchImpl = fetch
} = {}) {
  if (!dois.length) return {};
  const fields = [
    "title", "url", "externalIds", "citationCount", "influentialCitationCount",
    "referenceCount", "fieldsOfStudy", "s2FieldsOfStudy", "publicationTypes",
    "publicationDate", "year"
  ].join(",");
  const headers = { "content-type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const records = await requestJson(
    `https://api.semanticscholar.org/graph/v1/paper/batch?fields=${encodeURIComponent(fields)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ ids: dois.map((doi) => `DOI:${doi}`) })
    },
    fetchImpl
  );

  const result = {};
  records.forEach((record, index) => {
    if (!record) return;
    const doi = normalizeDoi(record.externalIds?.DOI || dois[index]);
    if (!doi) return;
    result[doi] = {
      paperId: record.paperId || null,
      url: record.url || null,
      title: record.title || null,
      citationCount: Number(record.citationCount || 0),
      influentialCitationCount: Number(record.influentialCitationCount || 0),
      referenceCount: Number(record.referenceCount || 0),
      fields: unique([
        ...(record.fieldsOfStudy || []),
        ...(record.s2FieldsOfStudy || []).map((field) => field.category)
      ]),
      publicationTypes: unique(record.publicationTypes || []),
      publicationDate: record.publicationDate || null,
      year: Number(record.year || 0) || null
    };
  });
  return result;
}

export async function fetchOpenAlex(dois, {
  apiKey = "",
  fetchImpl = fetch,
  chunkSize = 25
} = {}) {
  const result = {};
  const select = [
    "id", "doi", "display_name", "cited_by_count", "primary_topic", "topics",
    "keywords", "fwci", "citation_normalized_percentile", "counts_by_year",
    "type", "is_retracted", "publication_year", "updated_date"
  ].join(",");

  for (let offset = 0; offset < dois.length; offset += chunkSize) {
    const chunk = dois.slice(offset, offset + chunkSize);
    const params = new URLSearchParams({
      filter: `doi:${chunk.join("|")}`,
      per_page: "100",
      select
    });
    if (apiKey) params.set("api_key", apiKey);
    const payload = await requestJson(`https://api.openalex.org/works?${params}`, {}, fetchImpl);

    for (const work of payload.results || []) {
      const doi = normalizeDoi(work.doi);
      if (!doi) continue;
      const primaryTopic = work.primary_topic || null;
      result[doi] = {
        workId: work.id || null,
        title: work.display_name || null,
        citationCount: Number(work.cited_by_count || 0),
        year: validPublicationYear(work.publication_year),
        type: work.type || null,
        isRetracted: Boolean(work.is_retracted),
        fwci: Number.isFinite(work.fwci) ? work.fwci : null,
        citationPercentile: Number.isFinite(work.citation_normalized_percentile?.value)
          ? work.citation_normalized_percentile.value
          : null,
        primaryTopic: primaryTopic ? {
          id: primaryTopic.id || null,
          name: primaryTopic.display_name || null,
          score: Number(primaryTopic.score || 0),
          subfield: primaryTopic.subfield?.display_name || null,
          field: primaryTopic.field?.display_name || null,
          domain: primaryTopic.domain?.display_name || null
        } : null,
        topics: (work.topics || []).slice(0, 3).map((topic) => ({
          id: topic.id || null,
          name: topic.display_name || null,
          score: Number(topic.score || 0)
        })),
        keywords: (work.keywords || [])
          .filter((keyword) => Number(keyword.score || 0) >= 0.2)
          .slice(0, 10)
          .map((keyword) => ({
            id: keyword.id || null,
            name: keyword.display_name || null,
            score: Number(keyword.score || 0)
          })),
        countsByYear: (work.counts_by_year || []).map((item) => ({
          year: Number(item.year),
          citationCount: Number(item.cited_by_count || 0)
        })),
        updatedAt: work.updated_date || null
      };
    }
  }
  return result;
}

function scholarMetric(table, key) {
  const row = (table || []).find((entry) => entry && typeof entry === "object" && entry[key]);
  const metric = row?.[key] || {};
  const all = Number(metric.all);
  const sinceEntry = Object.entries(metric)
    .find(([name]) => name !== "all" && /^since_|^depuis_/i.test(name));
  const sinceYear = Number((sinceEntry?.[0].match(/(\d{4})/) || [])[1]);
  return {
    all: Number.isFinite(all) && all >= 0 ? all : null,
    since: Number.isFinite(Number(sinceEntry?.[1])) && Number(sinceEntry?.[1]) >= 0
      ? Number(sinceEntry[1])
      : null,
    sinceYear: Number.isInteger(sinceYear) ? sinceYear : null
  };
}

function validateGoogleScholarPayload(payload, authorId) {
  if (payload?.error) throw new Error("SerpApi Google Scholar request returned an error.");
  if (payload?.search_parameters?.author_id !== authorId) {
    throw new Error("SerpApi Google Scholar response did not match the configured author profile.");
  }
}

function googleScholarProfileFromPayload(payload, authorId) {
  validateGoogleScholarPayload(payload, authorId);
  const table = payload?.cited_by?.table || [];
  const citations = scholarMetric(table, "citations");
  const hIndex = scholarMetric(table, "h_index");
  const i10Index = scholarMetric(table, "i10_index");
  if (!Number.isFinite(citations.all)) {
    throw new Error("SerpApi Google Scholar response did not include a total citation count.");
  }

  return {
    profileId: authorId,
    profileUrl: `https://scholar.google.com/citations?user=${encodeURIComponent(authorId)}&hl=en`,
    name: payload?.author?.name || null,
    affiliations: payload?.author?.affiliations || null,
    citations,
    hIndex,
    i10Index,
    countsByYear: (payload?.cited_by?.graph || [])
      .map((item) => ({
        year: Number(item?.year),
        citationCount: Number(item?.citations)
      }))
      .filter((item) => Number.isInteger(item.year)
        && item.year >= 1900
        && Number.isFinite(item.citationCount)
        && item.citationCount >= 0)
      .sort((left, right) => left.year - right.year),
    provider: "SerpApi Google Scholar Author API"
  };
}

function safeGoogleScholarUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== "scholar.google.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function googleScholarArticleFromPayload(article, authorId) {
  const title = String(article?.title || "").trim();
  const citationId = String(article?.citation_id || "").trim();
  if (!title || !citationId.startsWith(`${authorId}:`)) return null;
  const rawCitationCount = article?.cited_by?.value;
  const citationCount = rawCitationCount == null ? 0 : Number(rawCitationCount);
  if (!Number.isInteger(citationCount) || citationCount < 0) return null;
  const year = Number(article?.year);
  const url = safeGoogleScholarUrl(article?.link)
    || `https://scholar.google.com/citations?view_op=view_citation&hl=en`
      + `&user=${encodeURIComponent(authorId)}`
      + `&citation_for_view=${encodeURIComponent(citationId)}`;
  return {
    title,
    citationId,
    citationCount,
    url,
    citedByUrl: safeGoogleScholarUrl(article?.cited_by?.link),
    year: Number.isInteger(year) && year >= 1900 ? year : null
  };
}

export async function fetchGoogleScholarAuthor({
  authorId,
  apiKey,
  fetchImpl = fetch,
  maxAttempts = 5,
  maxPages = googleScholarMaximumPages
} = {}) {
  const normalizedAuthorId = String(authorId || "").trim();
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedAuthorId) throw new Error("Google Scholar author ID is required.");
  if (!normalizedApiKey) throw new Error("SerpApi API key is required.");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > googleScholarMaximumPages) {
    throw new Error(
      `Google Scholar maxPages must be an integer from 1 to ${googleScholarMaximumPages}.`
    );
  }

  const articlesById = new Map();
  let discardedArticles = 0;
  let profile = null;
  let pageCount = 0;
  let responseTruncated = false;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const params = new URLSearchParams({
      engine: "google_scholar_author",
      author_id: normalizedAuthorId,
      hl: "en",
      sort: "pubdate",
      start: String(pageIndex * googleScholarArticleLimit),
      num: String(googleScholarArticleLimit),
      api_key: normalizedApiKey
    });
    const payload = await requestJson(
      `https://serpapi.com/search.json?${params}`,
      {},
      fetchImpl,
      { maxAttempts }
    );
    validateGoogleScholarPayload(payload, normalizedAuthorId);
    if (!profile) profile = googleScholarProfileFromPayload(payload, normalizedAuthorId);

    const rawArticles = Array.isArray(payload?.articles) ? payload.articles : [];
    const sizeBeforePage = articlesById.size;
    for (const rawArticle of rawArticles) {
      const article = googleScholarArticleFromPayload(rawArticle, normalizedAuthorId);
      if (!article) {
        discardedArticles += 1;
        continue;
      }
      const prior = articlesById.get(article.citationId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(article)) {
        throw new Error("SerpApi Google Scholar response reused a citation ID inconsistently.");
      }
      articlesById.set(article.citationId, article);
    }
    pageCount += 1;

    const hasNextPage = Boolean(payload?.serpapi_pagination?.next)
      || rawArticles.length >= googleScholarArticleLimit;
    const pageMadeProgress = articlesById.size > sizeBeforePage;
    if (pageIndex > 0 && rawArticles.length > 0 && !pageMadeProgress) {
      responseTruncated = true;
      break;
    }
    if (!hasNextPage) break;
    if (rawArticles.length === 0 || !pageMadeProgress) {
      responseTruncated = true;
      break;
    }
    if (pageIndex === maxPages - 1) responseTruncated = true;
  }

  return {
    profile,
    articles: [...articlesById.values()],
    responseTruncated,
    discardedArticles,
    pageCount
  };
}

export async function fetchGoogleScholarProfile(options = {}) {
  return (await fetchGoogleScholarAuthor(options)).profile;
}

function validPublicationYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 ? year : null;
}

function yearsCompatible(left, right) {
  const leftYear = validPublicationYear(left);
  const rightYear = validPublicationYear(right);
  return leftYear !== null && rightYear !== null && Math.abs(leftYear - rightYear) <= 1;
}

function publicGoogleScholarRecord(article, matchedBy) {
  return {
    title: article.title,
    citationId: article.citationId,
    citationCount: article.citationCount,
    url: article.url || null,
    citedByUrl: article.citedByUrl || null,
    year: validPublicationYear(article.year),
    matchedBy
  };
}

function isSafeTruncatedPrefix(left, right) {
  if (!left || !right || left === right) return false;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  if (shorter.length < 48 || shorter.split(" ").length < 8) return false;
  if (shorter.length / longer.length < 0.55) return false;
  return longer.startsWith(`${shorter} `);
}

export function matchGoogleScholarArticles({
  publications = [],
  articles = [],
  previous = {},
  semanticScholar = {},
  openAlex = {},
  overrides = googleScholarCitationOverrides
} = {}) {
  const publicationByDoi = new Map();
  for (const publication of publications) {
    const doi = normalizeDoi(publication?.doi);
    if (doi) publicationByDoi.set(doi, { ...publication, doi });
  }
  const articleById = new Map();
  for (const article of articles) {
    const citationId = String(article?.citationId || "").trim();
    const title = normalizePublicationTitle(article?.title);
    if (!citationId || !title || articleById.has(citationId)) continue;
    articleById.set(citationId, { ...article, normalizedTitle: title });
  }

  const assignments = {};
  const claimedArticles = new Set();
  const unmatchedDois = new Set(publicationByDoi.keys());
  const ambiguousDois = new Set();

  const assignByDirectId = (method, citationIdForDoi) => {
    const claims = new Map();
    for (const doi of unmatchedDois) {
      const citationId = String(citationIdForDoi(doi) || "").trim();
      if (!citationId || claimedArticles.has(citationId) || !articleById.has(citationId)) continue;
      const claimants = claims.get(citationId) || [];
      claimants.push(doi);
      claims.set(citationId, claimants);
    }
    for (const [citationId, dois] of claims) {
      if (dois.length !== 1) {
        dois.forEach((doi) => ambiguousDois.add(doi));
        continue;
      }
      const [doi] = dois;
      assignments[doi] = publicGoogleScholarRecord(articleById.get(citationId), method);
      claimedArticles.add(citationId);
      unmatchedDois.delete(doi);
      ambiguousDois.delete(doi);
    }
  };

  const assignByCandidates = (method, candidatesForPublication) => {
    const candidatesByDoi = new Map();
    const claimantsByCitationId = new Map();
    for (const doi of unmatchedDois) {
      const publication = publicationByDoi.get(doi);
      const candidates = [...new Set(
        candidatesForPublication(publication)
          .map((article) => article?.citationId)
          .filter((citationId) => citationId && !claimedArticles.has(citationId))
      )];
      if (!candidates.length) continue;
      candidatesByDoi.set(doi, candidates);
      for (const citationId of candidates) {
        const claimants = claimantsByCitationId.get(citationId) || [];
        claimants.push(doi);
        claimantsByCitationId.set(citationId, claimants);
      }
    }
    for (const [doi, candidates] of candidatesByDoi) {
      if (candidates.length !== 1
          || claimantsByCitationId.get(candidates[0])?.length !== 1) {
        ambiguousDois.add(doi);
        continue;
      }
      const [citationId] = candidates;
      assignments[doi] = publicGoogleScholarRecord(articleById.get(citationId), method);
      claimedArticles.add(citationId);
      unmatchedDois.delete(doi);
      ambiguousDois.delete(doi);
    }
  };

  assignByDirectId("override", (doi) => overrides?.[doi]);
  assignByDirectId(
    "prior-citation-id",
    (doi) => previous?.publications?.[doi]?.googleScholar?.citationId
  );

  assignByCandidates("feed-title", (publication) => {
    const title = normalizePublicationTitle(publication?.title);
    return [...articleById.values()].filter((article) => article.normalizedTitle === title
      && yearsCompatible(article.year, publication?.year));
  });

  assignByCandidates("provider-title", (publication) => {
    const doi = publication.doi;
    const providers = [semanticScholar?.[doi], openAlex?.[doi]].filter(Boolean);
    return [...articleById.values()].filter((article) => providers.some((provider) => {
      const titleMatches = article.normalizedTitle === normalizePublicationTitle(provider?.title);
      const providerYear = validPublicationYear(provider?.year) ?? validPublicationYear(publication.year);
      return titleMatches && yearsCompatible(article.year, providerYear);
    }));
  });

  assignByCandidates("truncated-prefix", (publication) => {
    const doi = publication.doi;
    const sourceTitles = unique([
      publication?.title,
      semanticScholar?.[doi]?.title,
      openAlex?.[doi]?.title
    ]).map(normalizePublicationTitle);
    const sourceYears = unique([
      publication?.year,
      semanticScholar?.[doi]?.year,
      openAlex?.[doi]?.year
    ]).map(validPublicationYear).filter((year) => year !== null);
    return [...articleById.values()].filter((article) => {
      if (!sourceYears.some((year) => yearsCompatible(article.year, year))) return false;
      return sourceTitles.some((title) => isSafeTruncatedPrefix(title, article.normalizedTitle));
    });
  });

  return {
    records: assignments,
    matched: Object.keys(assignments).length,
    unmatchedDois: [...unmatchedDois].sort(),
    ambiguousDois: [...ambiguousDois].filter((doi) => unmatchedDois.has(doi)).sort(),
    unusedArticleCount: [...articleById.keys()]
      .filter((citationId) => !claimedArticles.has(citationId))
      .length
  };
}

export function guardGoogleScholarProfile({
  profile,
  previous = {},
  minimumCitationRatio = 0.8
}) {
  const current = Number(profile?.citations?.all);
  const prior = Number(previous?.googleScholar?.citations?.all);
  if (!Number.isFinite(current) || current < 0) {
    return { profile: null, status: "stale", reason: "invalid-response" };
  }
  if (Number.isFinite(prior)
      && prior > 0
      && current < Math.floor(prior * minimumCitationRatio)) {
    return {
      profile: null,
      status: "stale",
      reason: "citation-collapse",
      observedCitations: current,
      minimumCitations: Math.floor(prior * minimumCitationRatio)
    };
  }
  return { profile, status: "ok", reason: null };
}

export function guardGoogleScholarCoverage({
  profile,
  matchResult = {},
  previous = {},
  expectedCount,
  responseTruncated = false,
  minimumCitationRatio = 0.8,
  minimumCoverageRatio = 0.8
}) {
  const profileCoverage = guardGoogleScholarProfile({
    profile,
    previous,
    minimumCitationRatio
  });
  if (profileCoverage.status !== "ok") {
    return { ...profileCoverage, records: {}, freshMatched: 0 };
  }
  if (responseTruncated) {
    return {
      profile: profileCoverage.profile,
      records: {},
      status: "partial",
      reason: "response-truncated",
      freshMatched: 0
    };
  }

  const records = matchResult.records || {};
  const freshMatched = Object.keys(records).length;
  const priorMatched = Math.max(
    Number(previous.sources?.googleScholar?.matched || 0),
    Object.values(previous.publications || {})
      .filter((publication) => publication?.googleScholar)
      .length
  );
  const baseline = priorMatched || Number(expectedCount || 0);
  const minimumMatched = baseline >= 10
    ? Math.ceil(Math.min(baseline, Number(expectedCount || baseline)) * minimumCoverageRatio)
    : 0;
  if (minimumMatched && freshMatched < minimumMatched) {
    return {
      profile: profileCoverage.profile,
      records: {},
      status: "partial",
      reason: "per-paper-coverage-collapse",
      freshMatched: 0,
      observedMatched: freshMatched,
      minimumMatched
    };
  }

  const expected = Number(expectedCount || 0);
  const partial = freshMatched < expected
    || Number(matchResult.ambiguousDois?.length || 0) > 0;
  return {
    profile: profileCoverage.profile,
    records,
    status: partial ? "partial" : "ok",
    reason: partial ? "partial-match" : null,
    freshMatched,
    observedMatched: freshMatched,
    minimumMatched
  };
}

function sourceProperty(sourceName) {
  if (sourceName === "semanticScholar") return "semanticScholar";
  if (sourceName === "openAlex") return "openAlex";
  if (sourceName === "googleScholar") return "googleScholar";
  throw new Error(`Unknown publication metadata source: ${sourceName}`);
}

function previousSourceMatches(previous, sourceName) {
  const property = sourceProperty(sourceName);
  return Object.values(previous.publications || {})
    .filter((publication) => publication?.[property])
    .length;
}

export function guardSourceCoverage({
  sourceName,
  records,
  previous = {},
  expectedCount,
  minimumCoverageRatio = 0.8
}) {
  const observedMatched = Object.keys(records || {}).length;
  const priorMatched = Math.max(
    Number(previous.sources?.[sourceName]?.matched || 0),
    previousSourceMatches(previous, sourceName)
  );
  const baseline = priorMatched || Number(expectedCount || 0);
  const minimumMatched = baseline >= 10
    ? Math.ceil(Math.min(baseline, Number(expectedCount || baseline)) * minimumCoverageRatio)
    : 0;

  if (minimumMatched && observedMatched < minimumMatched) {
    return {
      records: {},
      status: "stale",
      reason: "coverage-collapse",
      observedMatched,
      minimumMatched
    };
  }
  return {
    records: records || {},
    status: "ok",
    reason: null,
    observedMatched,
    minimumMatched
  };
}

function sourceProjection(publications, sourceName) {
  const property = sourceProperty(sourceName);
  return Object.fromEntries(
    Object.entries(publications || {})
      .filter(([, publication]) => publication?.[property])
      .map(([doi, publication]) => [doi, publication[property]])
  );
}

function sourceRecordState({
  freshRecord,
  priorRecord,
  priorFreshness,
  priorSource,
  now
}) {
  if (freshRecord) {
    const contentChanged = JSON.stringify(freshRecord) !== JSON.stringify(priorRecord || null);
    return {
      record: freshRecord,
      freshness: {
        status: "observed",
        contentUpdatedAt: contentChanged
          ? now
          : (priorFreshness?.contentUpdatedAt || priorSource?.contentUpdatedAt || now)
      }
    };
  }
  if (priorRecord) {
    return {
      record: priorRecord,
      freshness: {
        status: "retained",
        contentUpdatedAt: priorFreshness?.contentUpdatedAt
          || priorSource?.contentUpdatedAt
          || null
      }
    };
  }
  return {
    record: null,
    freshness: {
      status: "unavailable",
      contentUpdatedAt: null
    }
  };
}

function sourceState(previous, {
  status,
  reason,
  matched,
  observedMatched,
  retainedMatched,
  now,
  contentChanged
}) {
  const effectiveStatus = status === "ok" && retainedMatched > 0 ? "stale" : status;
  const effectiveReason = effectiveStatus === "ok"
    ? null
    : (
        status === "ok" && retainedMatched > 0
          ? "partial-refresh-retained-prior-records"
          : (reason || "request-failed")
      );
  return {
    status: effectiveStatus,
    reason: effectiveReason,
    matched,
    observedMatched,
    retainedMatched,
    contentUpdatedAt: contentChanged
      ? now
      : (previous?.contentUpdatedAt || previous?.lastSuccessfulAt || null)
  };
}

export function buildMetadata({
  publications,
  semanticScholar = {},
  openAlex = {},
  googleScholar = null,
  googleScholarArticles = {},
  semanticScholarStatus = "ok",
  openAlexStatus = "ok",
  googleScholarStatus = "stale",
  semanticScholarReason = null,
  openAlexReason = null,
  googleScholarReason = "unconfigured",
  semanticScholarObservedMatched = null,
  openAlexObservedMatched = null,
  previous = {},
  now = new Date().toISOString()
}) {
  const previousPublications = previous.publications || {};
  const priorGoogleScholar = previous.googleScholar || null;
  const retainedGoogleScholar = googleScholar || priorGoogleScholar || {
    profileId: googleScholarAuthorId,
    profileUrl: `https://scholar.google.com/citations?user=${encodeURIComponent(googleScholarAuthorId)}&hl=en`,
    name: null,
    affiliations: null,
    citations: { all: 0, since: null, sinceYear: null },
    hIndex: { all: null, since: null, sinceYear: null },
    i10Index: { all: null, since: null, sinceYear: null },
    countsByYear: [],
    provider: "Unconfigured"
  };
  const entries = {};
  const sourceRefreshCounts = {
    semanticScholar: { observed: 0, retained: 0 },
    openAlex: { observed: 0, retained: 0 }
  };

  for (const publication of publications) {
    const doi = normalizeDoi(publication.doi);
    if (!doi) continue;
    const prior = previousPublications[doi] || {};
    const semanticState = sourceRecordState({
      freshRecord: semanticScholar[doi] || null,
      priorRecord: prior.semanticScholar || null,
      priorFreshness: prior.sourceFreshness?.semanticScholar,
      priorSource: previous.sources?.semanticScholar,
      now
    });
    const openAlexState = sourceRecordState({
      freshRecord: openAlex[doi] || null,
      priorRecord: prior.openAlex || null,
      priorFreshness: prior.sourceFreshness?.openAlex,
      priorSource: previous.sources?.openAlex,
      now
    });
    const semantic = semanticState.record;
    const alex = openAlexState.record;
    if (semanticState.freshness.status === "observed") {
      sourceRefreshCounts.semanticScholar.observed += 1;
    } else if (semanticState.freshness.status === "retained") {
      sourceRefreshCounts.semanticScholar.retained += 1;
    }
    if (openAlexState.freshness.status === "observed") {
      sourceRefreshCounts.openAlex.observed += 1;
    } else if (openAlexState.freshness.status === "retained") {
      sourceRefreshCounts.openAlex.retained += 1;
    }
    const freshScholar = googleScholarArticles[doi] || null;
    const priorScholar = prior.googleScholar || null;
    const scholar = freshScholar || priorScholar || null;
    const fields = unique([
      ...(semantic?.fields || []),
      alex?.primaryTopic?.field,
      alex?.primaryTopic?.subfield
    ]).slice(0, 8);
    const keywords = unique([
      ...(alex?.topics || []).map((topic) => topic.name),
      ...(alex?.keywords || []).map((keyword) => keyword.name)
    ]).filter((keyword) => !fields.some((field) => field.toLowerCase() === keyword.toLowerCase()))
      .slice(0, 10);

    const entry = {
      no: publication.no,
      doi,
      title: publication.title,
      year: publication.year || null,
      semanticScholar: semantic,
      openAlex: alex,
      sourceFreshness: {
        semanticScholar: semanticState.freshness,
        openAlex: openAlexState.freshness
      },
      fields,
      keywords
    };
    if (scholar) entry.googleScholar = scholar;
    const priorFreshness = prior.sourceFreshness?.googleScholar || null;
    const scholarChanged = freshScholar
      && JSON.stringify(freshScholar) !== JSON.stringify(priorScholar);
    const freshnessStatus = freshScholar
      ? "fresh"
      : (priorScholar ? "stale" : "unavailable");
    entry.sourceFreshness.googleScholar = {
      status: freshnessStatus,
      reason: freshScholar
        ? null
        : (googleScholarStatus === "ok"
          ? "no-confident-match"
          : (googleScholarReason || "request-failed")),
      contentUpdatedAt: freshScholar
        ? (scholarChanged || !priorFreshness
          ? now
          : (priorFreshness.contentUpdatedAt || now))
        : (priorFreshness?.contentUpdatedAt || null)
    };
    entries[doi] = entry;
  }

  const values = Object.values(entries);
  const semanticProjection = sourceProjection(entries, "semanticScholar");
  const openAlexProjection = sourceProjection(entries, "openAlex");
  const googleScholarProjection = sourceProjection(entries, "googleScholar");
  const previousSemanticProjection = sourceProjection(previousPublications, "semanticScholar");
  const previousOpenAlexProjection = sourceProjection(previousPublications, "openAlex");
  const previousGoogleScholarProjection = sourceProjection(previousPublications, "googleScholar");
  const googleScholarChanged = JSON.stringify(retainedGoogleScholar) !== JSON.stringify(priorGoogleScholar)
    || JSON.stringify(googleScholarProjection) !== JSON.stringify(previousGoogleScholarProjection);
  const googleScholarMatched = Object.keys(googleScholarProjection).length;
  const googleScholarFreshMatched = values
    .filter((publication) => publication.sourceFreshness?.googleScholar?.status === "fresh")
    .length;
  const normalizedSemanticObservedMatched = Number.isInteger(semanticScholarObservedMatched)
    && semanticScholarObservedMatched >= 0
    ? semanticScholarObservedMatched
    : sourceRefreshCounts.semanticScholar.observed;
  const normalizedOpenAlexObservedMatched = Number.isInteger(openAlexObservedMatched)
    && openAlexObservedMatched >= 0
    ? openAlexObservedMatched
    : sourceRefreshCounts.openAlex.observed;
  const metadata = {
    schemaVersion: 3,
    snapshotUpdatedAt: now,
    sources: {
      semanticScholar: sourceState(
        previous.sources?.semanticScholar,
        {
          status: semanticScholarStatus,
          reason: semanticScholarReason,
          matched: Object.keys(semanticProjection).length,
          observedMatched: normalizedSemanticObservedMatched,
          retainedMatched: sourceRefreshCounts.semanticScholar.retained,
          now,
          contentChanged: JSON.stringify(semanticProjection) !== JSON.stringify(previousSemanticProjection)
        }
      ),
      openAlex: sourceState(
        previous.sources?.openAlex,
        {
          status: openAlexStatus,
          reason: openAlexReason,
          matched: Object.keys(openAlexProjection).length,
          observedMatched: normalizedOpenAlexObservedMatched,
          retainedMatched: sourceRefreshCounts.openAlex.retained,
          now,
          contentChanged: JSON.stringify(openAlexProjection) !== JSON.stringify(previousOpenAlexProjection)
        }
      ),
      googleScholar: {
        status: googleScholarStatus,
        reason: googleScholarStatus === "ok" ? null : (googleScholarReason || "request-failed"),
        matched: googleScholarMatched,
        freshMatched: googleScholarFreshMatched,
        profileId: retainedGoogleScholar?.profileId || previous.sources?.googleScholar?.profileId || null,
        provider: retainedGoogleScholar?.provider
          || previous.sources?.googleScholar?.provider
          || "SerpApi Google Scholar Author API",
        contentUpdatedAt: googleScholarChanged
          ? now
          : (previous.sources?.googleScholar?.contentUpdatedAt || null)
      }
    },
    totals: {
      publications: values.length,
      semanticScholarCitations: values.reduce(
        (sum, item) => sum + Number(item.semanticScholar?.citationCount || 0),
        0
      ),
      openAlexCitations: values.reduce(
        (sum, item) => sum + Number(item.openAlex?.citationCount || 0),
        0
      ),
      googleScholarCitations: Number(retainedGoogleScholar?.citations?.all || 0)
    },
    googleScholar: retainedGoogleScholar,
    publications: entries
  };
  if (Number(previous.schemaVersion) === metadata.schemaVersion
      && JSON.stringify(comparableMetadata(metadata)) === JSON.stringify(comparableMetadata(previous))) {
    metadata.snapshotUpdatedAt = previous.snapshotUpdatedAt || now;
  }
  return metadata;
}

export function comparableMetadata(metadata) {
  return {
    schemaVersion: metadata.schemaVersion,
    sources: Object.fromEntries(
      Object.entries(metadata.sources || {}).map(([name, source]) => [
        name,
        {
          status: source.status,
          reason: source.reason || null,
          matched: source.matched,
          freshMatched: source.freshMatched,
          observedMatched: source.observedMatched,
          retainedMatched: source.retainedMatched
        }
      ])
    ),
    totals: metadata.totals,
    googleScholar: metadata.googleScholar,
    publications: metadata.publications
  };
}

export function metadataContentEquals(left, right) {
  return JSON.stringify(comparableMetadata(left)) === JSON.stringify(comparableMetadata(right));
}

export function summarizePublicationMetadataHealth(metadata) {
  const sourceRows = [
    ["semanticScholar", "Semantic Scholar"],
    ["openAlex", "OpenAlex"],
    ["googleScholar", "Google Scholar"]
  ].map(([id, label]) => {
    const source = metadata?.sources?.[id] || {};
    return {
      id,
      label,
      status: String(source.status || "unavailable"),
      reason: source.reason == null ? null : String(source.reason),
      matched: Number.isInteger(source.matched) ? source.matched : 0,
      freshMatched: id === "googleScholar" && Number.isInteger(source.freshMatched)
        ? source.freshMatched
        : null,
      contentUpdatedAt: source.contentUpdatedAt || null,
      provider: id === "googleScholar"
        ? String(source.provider || metadata?.googleScholar?.provider || "")
        : null
    };
  });
  const scholarSource = sourceRows.find(source => source.id === "googleScholar");
  const scholarProfile = metadata?.googleScholar || {};
  const scholarProvider = scholarSource.provider;
  const scholarProfileCurrent = ["ok", "partial"].includes(scholarSource.status)
    && scholarProvider === "SerpApi Google Scholar Author API"
    && scholarProfile.provider === scholarProvider
    && Number.isFinite(scholarProfile?.citations?.all)
    && Number.isInteger(scholarProfile?.hIndex?.all)
    && Array.isArray(scholarProfile.countsByYear)
    && scholarProfile.countsByYear.length > 0
    && Number.isFinite(Date.parse(scholarSource.contentUpdatedAt || ""));
  const scholarPapersCurrent = scholarProfileCurrent
    && scholarSource.freshMatched > 0;
  const warnings = [];
  if (!scholarProfileCurrent) {
    warnings.push(
      `Google Scholar profile refresh is not current (${scholarSource.reason || scholarSource.status}).`
    );
  } else if (!scholarPapersCurrent) {
    warnings.push(
      `Google Scholar profile metrics are current, but no per-paper matches are fresh (${scholarSource.reason || scholarSource.status}).`
    );
  }
  for (const source of sourceRows.filter(source => source.id !== "googleScholar")) {
    if (source.status !== "ok") {
      warnings.push(
        `${source.label} metadata is ${source.status} (${source.reason || "unspecified"}).`
      );
    }
  }
  return {
    sourceRows,
    scholarProfileCurrent,
    scholarPapersCurrent,
    warnings
  };
}

export function validateMetadataSnapshot(metadata, expectedDois = []) {
  const errors = [];
  if (metadata?.schemaVersion !== 3) errors.push("schemaVersion must be 3");
  if (!Number.isFinite(Date.parse(metadata?.snapshotUpdatedAt || ""))) {
    errors.push("snapshotUpdatedAt must be an ISO timestamp");
  }
  const entries = metadata?.publications || {};
  const normalizedExpected = unique(expectedDois.map(normalizeDoi));
  if (normalizedExpected.length && Object.keys(entries).length !== normalizedExpected.length) {
    errors.push(`expected ${normalizedExpected.length} DOI records, found ${Object.keys(entries).length}`);
  }
  for (const doi of normalizedExpected) {
    if (!entries[doi]) errors.push(`missing DOI record: ${doi}`);
  }
  for (const sourceName of ["semanticScholar", "openAlex"]) {
    const source = metadata?.sources?.[sourceName];
    if (!source || !["ok", "partial", "stale"].includes(source.status)) {
      errors.push(`${sourceName} status must be ok, partial, or stale`);
    }
    if (!Number.isInteger(source?.matched) || source.matched < 0) {
      errors.push(`${sourceName} matched must be a non-negative integer`);
    }
    for (const field of ["observedMatched", "retainedMatched"]) {
      if (source?.[field] !== undefined
          && (!Number.isInteger(source[field]) || source[field] < 0)) {
        errors.push(`${sourceName} ${field} must be a non-negative integer when present`);
      }
    }
    if (Number.isInteger(source?.retainedMatched)
        && source.retainedMatched > source.matched) {
      errors.push(`${sourceName} retainedMatched cannot exceed matched`);
    }
    if (source?.status === "ok" && Number(source?.retainedMatched || 0) > 0) {
      errors.push(`${sourceName} cannot be ok while prior records are retained`);
    }
    if (source?.status !== "ok" && !source.reason) {
      errors.push(`${sourceName} non-ok status must include a reason`);
    }
    if (source?.contentUpdatedAt !== null
        && !Number.isFinite(Date.parse(source?.contentUpdatedAt || ""))) {
      errors.push(`${sourceName} contentUpdatedAt must be null or an ISO timestamp`);
    }
  }
  const googleScholarSource = metadata?.sources?.googleScholar;
  if (!googleScholarSource || !["ok", "partial", "stale"].includes(googleScholarSource.status)) {
    errors.push("googleScholar status must be ok, partial, or stale");
  }
  if (googleScholarSource?.status !== "ok" && !googleScholarSource?.reason) {
    errors.push("googleScholar non-ok status must include a reason");
  }
  for (const countName of ["matched", "freshMatched"]) {
    if (!Number.isInteger(googleScholarSource?.[countName])
        || googleScholarSource[countName] < 0) {
      errors.push(`googleScholar ${countName} must be a non-negative integer`);
    }
  }
  if (googleScholarSource?.contentUpdatedAt !== null
      && !Number.isFinite(Date.parse(googleScholarSource?.contentUpdatedAt || ""))) {
    errors.push("googleScholar contentUpdatedAt must be null or an ISO timestamp");
  }
  const googleScholar = metadata?.googleScholar;
  if (!googleScholar || typeof googleScholar !== "object") {
    errors.push("googleScholar profile metrics must be present");
  } else {
    if (!googleScholar.profileId) errors.push("googleScholar profileId must be present");
    for (const metricName of ["citations", "hIndex", "i10Index"]) {
      for (const period of ["all", "since"]) {
        const value = googleScholar?.[metricName]?.[period];
        if (value !== null && (!Number.isFinite(value) || value < 0)) {
          errors.push(`googleScholar ${metricName}.${period} must be null or a nonnegative number`);
        }
      }
      const sinceYear = googleScholar?.[metricName]?.sinceYear;
      if (sinceYear !== null && (!Number.isInteger(sinceYear) || sinceYear < 1900)) {
        errors.push(`googleScholar ${metricName}.sinceYear must be null or a valid year`);
      }
    }
    if (googleScholar.countsByYear != null && !Array.isArray(googleScholar.countsByYear)) {
      errors.push("googleScholar countsByYear must be an array");
    }
    for (const annual of Array.isArray(googleScholar.countsByYear) ? googleScholar.countsByYear : []) {
      if (!Number.isInteger(annual?.year)
          || !Number.isFinite(annual?.citationCount)
          || annual.citationCount < 0) {
        errors.push("googleScholar annual citation counts must contain a year and nonnegative count");
      }
    }
  }
  if (googleScholar?.profileId !== googleScholarAuthorId
      || googleScholarSource?.profileId !== googleScholarAuthorId
      || googleScholar?.profileId !== googleScholarSource?.profileId) {
    errors.push(`googleScholar profile identity must match ${googleScholarAuthorId}`);
  }
  if (metadata?.totals?.publications !== Object.keys(entries).length) {
    errors.push("totals.publications does not match the DOI record count");
  }
  for (const [doi, publication] of Object.entries(entries)) {
    if (normalizeDoi(doi) !== doi || normalizeDoi(publication?.doi) !== doi) {
      errors.push(`DOI key and record are not normalized consistently: ${doi}`);
    }
    for (const sourceName of ["semanticScholar", "openAlex"]) {
      const citations = publication?.[sourceName]?.citationCount;
      if (citations != null && (!Number.isFinite(citations) || citations < 0)) {
        errors.push(`${doi} has an invalid ${sourceName} citation count`);
      }
      const freshness = publication?.sourceFreshness?.[sourceName];
      if (freshness !== undefined) {
        if (!freshness
            || !["observed", "retained", "unavailable"].includes(freshness.status)) {
          errors.push(`${doi} has invalid ${sourceName} source freshness`);
        } else {
          if ((publication?.[sourceName] == null) !== (freshness.status === "unavailable")) {
            errors.push(`${doi} ${sourceName} source freshness does not match record availability`);
          }
          if (freshness.status === "retained"
              && metadata?.sources?.[sourceName]?.status !== "stale") {
            errors.push(`${doi} retains ${sourceName} data while the source is not stale`);
          }
          if (freshness.contentUpdatedAt !== null
              && !Number.isFinite(Date.parse(freshness.contentUpdatedAt || ""))) {
            errors.push(`${doi} has invalid ${sourceName} contentUpdatedAt freshness`);
          }
        }
      }
    }
    const scholar = publication?.googleScholar;
    const freshness = publication?.sourceFreshness?.googleScholar;
    if (scholar) {
      if (!Number.isInteger(scholar.citationCount) || scholar.citationCount < 0) {
        errors.push(`${doi} has an invalid googleScholar citation count`);
      }
      if (typeof scholar.title !== "string" || !scholar.title.trim()) {
        errors.push(`${doi} has an invalid googleScholar title`);
      }
      if (typeof scholar.citationId !== "string"
          || !scholar.citationId.startsWith(`${googleScholarAuthorId}:`)) {
        errors.push(`${doi} has a googleScholar citation ID for another profile`);
      }
      if (!["override", "prior-citation-id", "feed-title", "provider-title", "truncated-prefix"]
        .includes(scholar.matchedBy)) {
        errors.push(`${doi} has an invalid googleScholar match method`);
      }
      if (scholar.year !== null && !validPublicationYear(scholar.year)) {
        errors.push(`${doi} has an invalid googleScholar publication year`);
      }
      for (const name of ["url", "citedByUrl"]) {
        if (scholar[name] !== null && safeGoogleScholarUrl(scholar[name]) !== scholar[name]) {
          errors.push(`${doi} has an invalid googleScholar ${name}`);
        }
      }
      if (!freshness || !["fresh", "stale"].includes(freshness.status)) {
        errors.push(`${doi} googleScholar data must include fresh or stale sourceFreshness`);
      }
    } else if (freshness && !["unavailable", "stale"].includes(freshness.status)) {
      errors.push(`${doi} without googleScholar data has invalid sourceFreshness`);
    }
    if (freshness) {
      if (freshness.status !== "fresh" && !freshness.reason) {
        errors.push(`${doi} non-fresh googleScholar sourceFreshness must include a reason`);
      }
      if (freshness.contentUpdatedAt !== null
          && !Number.isFinite(Date.parse(freshness.contentUpdatedAt || ""))) {
        errors.push(`${doi} googleScholar sourceFreshness contentUpdatedAt must be null or ISO`);
      }
    }
  }
  const matchedScholar = Object.values(entries)
    .filter((publication) => publication?.googleScholar)
    .length;
  const freshMatchedScholar = Object.values(entries)
    .filter((publication) => publication?.sourceFreshness?.googleScholar?.status === "fresh")
    .length;
  if (googleScholarSource?.matched !== matchedScholar) {
    errors.push("googleScholar matched does not equal retained per-paper records");
  }
  if (googleScholarSource?.freshMatched !== freshMatchedScholar) {
    errors.push("googleScholar freshMatched does not equal fresh per-paper records");
  }
  if (metadata?.totals?.googleScholarCitations !== metadata?.googleScholar?.citations?.all) {
    errors.push("totals.googleScholarCitations must match googleScholar citations.all");
  }
  if (errors.length) throw new Error(`Invalid publication metadata snapshot:\n- ${errors.join("\n- ")}`);
  return true;
}

async function readPrevious(outputPath) {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const outputPath = path.resolve(process.env.PUBLICATION_METADATA_OUTPUT || defaultOutput);
  const publications = (await loadFeedPublications())
    .filter((publication) => publication.doi);
  const dois = unique(publications.map((publication) => publication.doi));
  if (process.argv.includes("--check")) {
    const snapshot = await readPrevious(outputPath);
    validateMetadataSnapshot(snapshot, dois);
    console.log(`Validated publication metadata snapshot with ${dois.length} DOI records.`);
    return;
  }
  const previous = await readPrevious(outputPath);
  const options = {
    semanticScholar: {
      apiKey: process.env.SEMANTIC_SCHOLAR_API_KEY || ""
    },
    openAlex: {
      apiKey: process.env.OPENALEX_API_KEY || ""
    },
    googleScholar: {
      authorId: googleScholarAuthorId,
      apiKey: process.env.SERPAPI_API_KEY || ""
    }
  };

  const [semanticOutcome, openAlexOutcome] = await Promise.allSettled([
    fetchSemanticScholar(dois, options.semanticScholar),
    fetchOpenAlex(dois, options.openAlex)
  ]);
  const semanticCoverage = semanticOutcome.status === "fulfilled"
    ? guardSourceCoverage({
      sourceName: "semanticScholar",
      records: semanticOutcome.value,
      previous,
      expectedCount: dois.length
    })
    : { records: {}, status: "stale", reason: "request-failed" };
  const openAlexCoverage = openAlexOutcome.status === "fulfilled"
    ? guardSourceCoverage({
      sourceName: "openAlex",
      records: openAlexOutcome.value,
      previous,
      expectedCount: dois.length
    })
    : { records: {}, status: "stale", reason: "request-failed" };
  let googleScholarCoverage = {
    profile: null,
    records: {},
    status: "stale",
    reason: options.googleScholar.apiKey ? "request-failed" : "unconfigured",
    freshMatched: 0
  };
  let googleScholarFailureDetail = null;
  if (options.googleScholar.apiKey) {
    try {
      const author = await fetchGoogleScholarAuthor(options.googleScholar);
      const semanticForMatching = {
        ...sourceProjection(previous.publications || {}, "semanticScholar"),
        ...semanticCoverage.records
      };
      const openAlexForMatching = {
        ...sourceProjection(previous.publications || {}, "openAlex"),
        ...openAlexCoverage.records
      };
      const matchResult = matchGoogleScholarArticles({
        publications,
        articles: author.articles,
        previous,
        semanticScholar: semanticForMatching,
        openAlex: openAlexForMatching
      });
      googleScholarCoverage = guardGoogleScholarCoverage({
        profile: author.profile,
        matchResult,
        previous,
        expectedCount: publications.length,
        responseTruncated: author.responseTruncated
      });
    } catch (error) {
      googleScholarFailureDetail = error?.message || "request failed";
    }
  }
  if (semanticOutcome.status === "rejected") {
    console.warn(`Semantic Scholar refresh failed; preserving previous values: ${semanticOutcome.reason?.message}`);
  } else if (semanticCoverage.status === "stale") {
    console.warn(
      `Semantic Scholar coverage collapsed to ${semanticCoverage.observedMatched} matches `
      + `(minimum ${semanticCoverage.minimumMatched}); preserving the previous snapshot.`
    );
  }
  if (openAlexOutcome.status === "rejected") {
    console.warn(`OpenAlex refresh failed; preserving previous values: ${openAlexOutcome.reason?.message}`);
  } else if (openAlexCoverage.status === "stale") {
    console.warn(
      `OpenAlex coverage collapsed to ${openAlexCoverage.observedMatched} matches `
      + `(minimum ${openAlexCoverage.minimumMatched}); preserving the previous snapshot.`
    );
  }
  if (googleScholarCoverage.reason === "citation-collapse") {
    console.warn(
      `Google Scholar citations unexpectedly fell to ${googleScholarCoverage.observedCitations} `
      + `(minimum ${googleScholarCoverage.minimumCitations}); preserving the previous snapshot.`
    );
  } else if (googleScholarCoverage.reason === "per-paper-coverage-collapse") {
    console.warn(
      `Google Scholar per-paper matching fell to ${googleScholarCoverage.observedMatched} DOI records `
      + `(minimum ${googleScholarCoverage.minimumMatched}); accepting the current profile aggregate `
      + "while preserving previous per-paper records."
    );
  } else if (googleScholarCoverage.reason === "response-truncated") {
    console.warn(
      "The Google Scholar author response exceeded the single-request 100-paper safety limit; "
      + "accepting the current profile aggregate while preserving previous per-paper records."
    );
  } else if (googleScholarCoverage.status === "partial") {
    console.warn(
      `Google Scholar refreshed ${googleScholarCoverage.freshMatched} of ${publications.length} `
      + "DOI records; unmatched prior records remain marked stale."
    );
  } else if (!options.googleScholar.apiKey) {
    console.warn("SERPAPI_API_KEY is not configured; preserving the previous Google Scholar snapshot.");
  } else if (googleScholarCoverage.status === "stale") {
    console.warn(
      `Google Scholar refresh is stale (${googleScholarCoverage.reason || "request-failed"})`
      + `${googleScholarFailureDetail ? `: ${googleScholarFailureDetail}` : ""}; `
      + "preserving the previous snapshot."
    );
  }
  if (!Object.keys(semanticCoverage.records).length
      && !Object.keys(openAlexCoverage.records).length
      && !Object.keys(previous.publications || {}).length) {
    throw new Error("No publication metadata source returned data and no previous snapshot exists.");
  }

  const next = buildMetadata({
    publications,
    semanticScholar: semanticCoverage.records,
    openAlex: openAlexCoverage.records,
    googleScholar: googleScholarCoverage.profile,
    googleScholarArticles: googleScholarCoverage.records,
    semanticScholarStatus: semanticCoverage.status,
    openAlexStatus: openAlexCoverage.status,
    googleScholarStatus: googleScholarCoverage.status,
    semanticScholarReason: semanticCoverage.reason,
    openAlexReason: openAlexCoverage.reason,
    googleScholarReason: googleScholarCoverage.reason,
    semanticScholarObservedMatched: semanticCoverage.observedMatched,
    openAlexObservedMatched: openAlexCoverage.observedMatched,
    previous
  });
  validateMetadataSnapshot(next, dois);
  if (metadataContentEquals(next, previous)) {
    console.log(`Publication metadata is unchanged (${next.totals.publications} DOI records).`);
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `Updated ${path.relative(repositoryRoot, outputPath)}: `
    + `${next.sources.semanticScholar.matched} Semantic Scholar matches, `
    + `${next.sources.openAlex.matched} OpenAlex matches, `
    + `${next.sources.googleScholar.freshMatched} fresh Google Scholar paper matches, `
    + `${next.totals.googleScholarCitations} Google Scholar profile citations.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

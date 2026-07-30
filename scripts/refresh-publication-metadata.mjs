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

export function normalizeDoi(value = "") {
  return String(value)
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
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
    "type", "is_retracted", "updated_date"
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

export async function fetchGoogleScholarProfile({
  authorId,
  apiKey,
  fetchImpl = fetch,
  maxAttempts = 5
} = {}) {
  const normalizedAuthorId = String(authorId || "").trim();
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedAuthorId) throw new Error("Google Scholar author ID is required.");
  if (!normalizedApiKey) throw new Error("SerpApi API key is required.");

  const params = new URLSearchParams({
    engine: "google_scholar_author",
    author_id: normalizedAuthorId,
    hl: "en",
    api_key: normalizedApiKey
  });
  const payload = await requestJson(
    `https://serpapi.com/search.json?${params}`,
    {},
    fetchImpl,
    { maxAttempts }
  );
  if (payload?.error) throw new Error("SerpApi Google Scholar request returned an error.");
  if (payload?.search_parameters?.author_id !== normalizedAuthorId) {
    throw new Error("SerpApi Google Scholar response did not match the configured author profile.");
  }

  const table = payload?.cited_by?.table || [];
  const citations = scholarMetric(table, "citations");
  const hIndex = scholarMetric(table, "h_index");
  const i10Index = scholarMetric(table, "i10_index");
  if (!Number.isFinite(citations.all)) {
    throw new Error("SerpApi Google Scholar response did not include a total citation count.");
  }

  return {
    profileId: normalizedAuthorId,
    profileUrl: `https://scholar.google.com/citations?user=${encodeURIComponent(normalizedAuthorId)}&hl=en`,
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

function sourceProperty(sourceName) {
  if (sourceName === "semanticScholar") return "semanticScholar";
  if (sourceName === "openAlex") return "openAlex";
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

function sourceState(previous, status, reason, matched, now, contentChanged) {
  return {
    status,
    reason: status === "stale" ? (reason || "request-failed") : null,
    matched,
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
  semanticScholarStatus = "ok",
  openAlexStatus = "ok",
  googleScholarStatus = "stale",
  semanticScholarReason = null,
  openAlexReason = null,
  googleScholarReason = "unconfigured",
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

  for (const publication of publications) {
    const doi = normalizeDoi(publication.doi);
    if (!doi) continue;
    const prior = previousPublications[doi] || {};
    const semantic = semanticScholar[doi] || prior.semanticScholar || null;
    const alex = openAlex[doi] || prior.openAlex || null;
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

    entries[doi] = {
      no: publication.no,
      doi,
      title: publication.title,
      year: publication.year || null,
      semanticScholar: semantic,
      openAlex: alex,
      fields,
      keywords
    };
  }

  const values = Object.values(entries);
  const semanticProjection = sourceProjection(entries, "semanticScholar");
  const openAlexProjection = sourceProjection(entries, "openAlex");
  const previousSemanticProjection = sourceProjection(previousPublications, "semanticScholar");
  const previousOpenAlexProjection = sourceProjection(previousPublications, "openAlex");
  const googleScholarChanged = JSON.stringify(retainedGoogleScholar) !== JSON.stringify(priorGoogleScholar);
  const metadata = {
    schemaVersion: 2,
    snapshotUpdatedAt: now,
    sources: {
      semanticScholar: sourceState(
        previous.sources?.semanticScholar,
        semanticScholarStatus,
        semanticScholarReason,
        Object.keys(semanticProjection).length,
        now,
        JSON.stringify(semanticProjection) !== JSON.stringify(previousSemanticProjection)
      ),
      openAlex: sourceState(
        previous.sources?.openAlex,
        openAlexStatus,
        openAlexReason,
        Object.keys(openAlexProjection).length,
        now,
        JSON.stringify(openAlexProjection) !== JSON.stringify(previousOpenAlexProjection)
      ),
      googleScholar: {
        status: googleScholarStatus,
        reason: googleScholarStatus === "stale" ? (googleScholarReason || "request-failed") : null,
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
          matched: source.matched
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

export function validateMetadataSnapshot(metadata, expectedDois = []) {
  const errors = [];
  if (metadata?.schemaVersion !== 2) errors.push("schemaVersion must be 2");
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
    if (!source || !["ok", "stale"].includes(source.status)) {
      errors.push(`${sourceName} status must be ok or stale`);
    }
    if (!Number.isInteger(source?.matched) || source.matched < 0) {
      errors.push(`${sourceName} matched must be a non-negative integer`);
    }
    if (source?.status === "stale" && !source.reason) {
      errors.push(`${sourceName} stale status must include a reason`);
    }
    if (source?.contentUpdatedAt !== null
        && !Number.isFinite(Date.parse(source?.contentUpdatedAt || ""))) {
      errors.push(`${sourceName} contentUpdatedAt must be null or an ISO timestamp`);
    }
  }
  const googleScholarSource = metadata?.sources?.googleScholar;
  if (!googleScholarSource || !["ok", "stale"].includes(googleScholarSource.status)) {
    errors.push("googleScholar status must be ok or stale");
  }
  if (googleScholarSource?.status === "stale" && !googleScholarSource.reason) {
    errors.push("googleScholar stale status must include a reason");
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
    }
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
    status: "stale",
    reason: options.googleScholar.apiKey ? "request-failed" : "unconfigured"
  };
  let googleScholarFailureDetail = null;
  if (options.googleScholar.apiKey) {
    try {
      const profile = await fetchGoogleScholarProfile(options.googleScholar);
      googleScholarCoverage = guardGoogleScholarProfile({ profile, previous });
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
    semanticScholarStatus: semanticCoverage.status,
    openAlexStatus: openAlexCoverage.status,
    googleScholarStatus: googleScholarCoverage.status,
    semanticScholarReason: semanticCoverage.reason,
    openAlexReason: openAlexCoverage.reason,
    googleScholarReason: googleScholarCoverage.reason,
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
    + `${next.totals.googleScholarCitations} Google Scholar profile citations.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

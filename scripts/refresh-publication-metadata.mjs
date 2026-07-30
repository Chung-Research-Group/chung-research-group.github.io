import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const defaultOutput = path.join(repositoryRoot, "data", "publication-metadata.json");

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

async function requestJson(url, options = {}, fetchImpl = fetch) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    let wait = Math.min(8000, 750 * (2 ** attempt));
    try {
      const response = await fetchImpl(url, options);
      if (response.ok) return await response.json();
      const body = await response.text();
      if (response.status !== 429 && response.status < 500) {
        const error = new Error(`${options.method || "GET"} ${url}: ${response.status} ${body}`);
        error.nonRetryable = true;
        throw error;
      }
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : wait;
      lastError = new Error(`${options.method || "GET"} ${url}: ${response.status} ${body}`);
    } catch (error) {
      if (error?.nonRetryable) throw error;
      lastError = error;
    }
    if (attempt < 4) await delay(wait);
  }
  throw lastError || new Error(`Request failed: ${url}`);
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
  semanticScholarStatus = "ok",
  openAlexStatus = "ok",
  semanticScholarReason = null,
  openAlexReason = null,
  previous = {},
  now = new Date().toISOString()
}) {
  const previousPublications = previous.publications || {};
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
      )
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
      )
    },
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
  if (!Object.keys(semanticCoverage.records).length
      && !Object.keys(openAlexCoverage.records).length
      && !Object.keys(previous.publications || {}).length) {
    throw new Error("No publication metadata source returned data and no previous snapshot exists.");
  }

  const next = buildMetadata({
    publications,
    semanticScholar: semanticCoverage.records,
    openAlex: openAlexCoverage.records,
    semanticScholarStatus: semanticCoverage.status,
    openAlexStatus: openAlexCoverage.status,
    semanticScholarReason: semanticCoverage.reason,
    openAlexReason: openAlexCoverage.reason,
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
    + `${next.sources.openAlex.matched} OpenAlex matches.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

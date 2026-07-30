import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMetadata,
  comparableMetadata,
  fetchOpenAlex,
  fetchSemanticScholar,
  guardSourceCoverage,
  metadataContentEquals,
  normalizeDoi,
  validateMetadataSnapshot
} from "../scripts/refresh-publication-metadata.mjs";

test("normalizes DOI identifiers from API URLs", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1000/ABC"), "10.1000/abc");
  assert.equal(normalizeDoi("DOI: 10.1000/ABC"), "10.1000/abc");
});

test("maps Semantic Scholar batch results back to DOI records", async () => {
  const fetchImpl = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).ids, ["DOI:10.1000/test"]);
    return {
      ok: true,
      json: async () => [{
        paperId: "paper-1",
        externalIds: { DOI: "10.1000/TEST" },
        title: "Test paper",
        citationCount: 12,
        influentialCitationCount: 3,
        referenceCount: 28,
        fieldsOfStudy: ["Chemistry"],
        s2FieldsOfStudy: [{ category: "Materials Science" }]
      }]
    };
  };
  const result = await fetchSemanticScholar(["10.1000/test"], { fetchImpl });
  assert.equal(result["10.1000/test"].citationCount, 12);
  assert.deepEqual(result["10.1000/test"].fields, ["Chemistry", "Materials Science"]);
});

test("maps OpenAlex topics and scored keywords", async () => {
  const fetchImpl = async (url) => {
    assert.equal(
      new URL(url).searchParams.get("filter"),
      "doi:10.1000/test|10.1000/second"
    );
    return {
    ok: true,
    json: async () => ({
      results: [{
        id: "https://openalex.org/W1",
        doi: "https://doi.org/10.1000/test",
        display_name: "Test paper",
        cited_by_count: 17,
        primary_topic: {
          id: "T1",
          display_name: "Adsorption in porous materials",
          score: 0.99,
          field: { display_name: "Chemical Engineering" },
          subfield: { display_name: "Materials Chemistry" },
          domain: { display_name: "Physical Sciences" }
        },
        topics: [{ id: "T1", display_name: "Adsorption in porous materials", score: 0.99 }],
        keywords: [
          { id: "K1", display_name: "Adsorption", score: 0.8 },
          { id: "K2", display_name: "Noise", score: 0.1 }
        ]
      }]
    })
    };
  };
  const result = await fetchOpenAlex(["10.1000/test", "10.1000/second"], { fetchImpl });
  assert.equal(result["10.1000/test"].citationCount, 17);
  assert.deepEqual(result["10.1000/test"].keywords.map((item) => item.name), ["Adsorption"]);
});

test("does not retry a non-retryable API client error", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return {
      ok: false,
      status: 400,
      text: async () => "invalid filter"
    };
  };
  await assert.rejects(
    fetchOpenAlex(["10.1000/test"], { fetchImpl }),
    /400 invalid filter/
  );
  assert.equal(requests, 1);
});

test("rejects a collapsed source response so prior records can be preserved", () => {
  const previousPublications = {};
  const fresh = {};
  for (let index = 0; index < 20; index += 1) {
    const doi = `10.1000/${index}`;
    previousPublications[doi] = { openAlex: { citationCount: index } };
    if (index < 3) fresh[doi] = { citationCount: index + 1 };
  }
  const guarded = guardSourceCoverage({
    sourceName: "openAlex",
    records: fresh,
    previous: {
      sources: { openAlex: { matched: 20 } },
      publications: previousPublications
    },
    expectedCount: 20
  });
  assert.equal(guarded.status, "stale");
  assert.equal(guarded.reason, "coverage-collapse");
  assert.deepEqual(guarded.records, {});
  assert.equal(guarded.minimumMatched, 16);

  const metadata = buildMetadata({
    publications: Object.keys(previousPublications).map((doi, index) => ({
      no: String(index + 1).padStart(2, "0"),
      doi,
      title: `Publication ${index + 1}`,
      year: 2026
    })),
    openAlex: guarded.records,
    openAlexStatus: guarded.status,
    openAlexReason: guarded.reason,
    previous: {
      schemaVersion: 2,
      snapshotUpdatedAt: "2026-07-01T00:00:00.000Z",
      sources: {
        openAlex: {
          status: "ok",
          reason: null,
          matched: 20,
          contentUpdatedAt: "2026-07-01T00:00:00.000Z"
        }
      },
      publications: previousPublications
    },
    now: "2026-07-30T00:00:00.000Z"
  });
  assert.equal(metadata.sources.openAlex.status, "stale");
  assert.equal(metadata.sources.openAlex.reason, "coverage-collapse");
  assert.equal(metadata.sources.openAlex.matched, 20);
  assert.equal(metadata.publications["10.1000/19"].openAlex.citationCount, 19);
});

test("builds combined fields and preserves previous data during a source outage", () => {
  const previous = {
    sources: {
      openAlex: { contentUpdatedAt: "2026-07-01T00:00:00.000Z" }
    },
    publications: {
      "10.1000/test": {
        openAlex: {
          citationCount: 9,
          primaryTopic: { field: "Chemistry", subfield: "Materials Chemistry" },
          topics: [{ name: "Porous materials" }],
          keywords: [{ name: "Adsorption" }]
        }
      }
    }
  };
  const metadata = buildMetadata({
    publications: [{ no: "01", doi: "10.1000/test", title: "Test", year: 2026 }],
    semanticScholar: {
      "10.1000/test": { citationCount: 8, fields: ["Materials Science"] }
    },
    openAlexStatus: "stale",
    previous,
    now: "2026-07-30T00:00:00.000Z"
  });
  const publication = metadata.publications["10.1000/test"];
  assert.equal(publication.openAlex.citationCount, 9);
  assert.deepEqual(publication.fields, ["Materials Science", "Chemistry", "Materials Chemistry"]);
  assert.deepEqual(publication.keywords, ["Porous materials", "Adsorption"]);
  assert.equal(metadata.sources.openAlex.status, "stale");
  assert.equal(metadata.sources.openAlex.contentUpdatedAt, "2026-07-01T00:00:00.000Z");
});

test("repeated total outages do not churn snapshot timestamps", () => {
  const publications = [{ no: "01", doi: "10.1000/test", title: "Test", year: 2026 }];
  const initial = buildMetadata({
    publications,
    semanticScholarStatus: "stale",
    openAlexStatus: "stale",
    semanticScholarReason: "request-failed",
    openAlexReason: "request-failed",
    previous: {},
    now: "2026-07-30T00:00:00.000Z"
  });
  const repeated = buildMetadata({
    publications,
    semanticScholarStatus: "stale",
    openAlexStatus: "stale",
    semanticScholarReason: "request-failed",
    openAlexReason: "request-failed",
    previous: initial,
    now: "2026-07-31T00:00:00.000Z"
  });
  assert.equal(repeated.snapshotUpdatedAt, initial.snapshotUpdatedAt);
  assert.equal(metadataContentEquals(repeated, initial), true);
  assert.deepEqual(comparableMetadata(repeated), comparableMetadata(initial));
  assert.equal(validateMetadataSnapshot(repeated, ["10.1000/test"]), true);
});

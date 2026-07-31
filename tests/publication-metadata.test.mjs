import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildMetadata,
  comparableMetadata,
  fetchGoogleScholarAuthor,
  fetchGoogleScholarProfile,
  fetchOpenAlex,
  fetchSemanticScholar,
  googleScholarCitationOverrides,
  guardGoogleScholarCoverage,
  guardGoogleScholarProfile,
  guardSourceCoverage,
  matchGoogleScholarArticles,
  metadataContentEquals,
  normalizeDoi,
  normalizePublicationTitle,
  summarizePublicationMetadataHealth,
  validateMetadataSnapshot
} from "../scripts/refresh-publication-metadata.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

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

test("maps Google Scholar author metrics without exposing the API key", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("engine"), "google_scholar_author");
    assert.equal(parsed.searchParams.get("author_id"), "q-UUrywAAAAJ");
    assert.equal(parsed.searchParams.get("sort"), "pubdate");
    assert.equal(parsed.searchParams.get("num"), "100");
    assert.equal(parsed.searchParams.get("api_key"), "private-key");
    return {
      ok: true,
      json: async () => ({
        search_parameters: { author_id: "q-UUrywAAAAJ" },
        author: {
          name: "Yongchul G. Chung",
          affiliations: "Pusan National University"
        },
        cited_by: {
          table: [
            { citations: { all: 6426, since_2021: 4012 } },
            { h_index: { all: 33, since_2021: 27 } },
            { i10_index: { all: 53, since_2021: 47 } }
          ],
          graph: [
            { year: 2025, citations: "911" },
            { year: 2026, citations: "438" }
          ]
        }
      })
    };
  };
  const profile = await fetchGoogleScholarProfile({
    authorId: "q-UUrywAAAAJ",
    apiKey: "private-key",
    fetchImpl
  });
  assert.equal(profile.citations.all, 6426);
  assert.equal(profile.citations.sinceYear, 2021);
  assert.equal(profile.hIndex.all, 33);
  assert.equal(profile.i10Index.since, 47);
  assert.deepEqual(profile.countsByYear, [
    { year: 2025, citationCount: 911 },
    { year: 2026, citationCount: 438 }
  ]);

  const failingFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => "invalid API key"
  });
  await assert.rejects(
    fetchGoogleScholarProfile({
      authorId: "q-UUrywAAAAJ",
      apiKey: "private-key",
      fetchImpl: failingFetch
    }),
    (error) => !error.message.includes("private-key") && /401/.test(error.message)
  );

  const leakingFetch = async () => {
    throw new Error("request failed for https://serpapi.com/?api_key=private-key");
  };
  await assert.rejects(
    fetchGoogleScholarProfile({
      authorId: "q-UUrywAAAAJ",
      apiKey: "private-key",
      fetchImpl: leakingFetch,
      maxAttempts: 1
    }),
    (error) => !error.message.includes("private-key") && /network request failed/.test(error.message)
  );

  const providerErrorFetch = async () => ({
    ok: true,
    json: async () => ({ error: "invalid private-key" })
  });
  await assert.rejects(
    fetchGoogleScholarProfile({
      authorId: "q-UUrywAAAAJ",
      apiKey: "private-key",
      fetchImpl: providerErrorFetch
    }),
    (error) => !error.message.includes("private-key") && /returned an error/.test(error.message)
  );
});

test("fetches profile and per-paper Scholar data in one page when all articles fit", async () => {
  let requests = 0;
  const result = await fetchGoogleScholarAuthor({
    authorId: "q-UUrywAAAAJ",
    apiKey: "private-key",
    fetchImpl: async (url) => {
      requests += 1;
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("sort"), "pubdate");
      assert.equal(parsed.searchParams.get("start"), "0");
      assert.equal(parsed.searchParams.get("num"), "100");
      return {
        ok: true,
        json: async () => ({
          search_parameters: { author_id: "q-UUrywAAAAJ" },
          author: { name: "Yongchul G. Chung" },
          cited_by: {
            table: [{ citations: { all: 6426 } }],
            graph: []
          },
          articles: [
            {
              title: "A paper",
              citation_id: "q-UUrywAAAAJ:paper",
              link: "https://scholar.google.com/citations?view_op=view_citation&citation_for_view=q-UUrywAAAAJ:paper",
              cited_by: {
                value: 17,
                link: "https://scholar.google.com/scholar?cites=123"
              },
              year: "2025",
              serpapi_link: "https://serpapi.com/private",
              private_field: "private-key"
            }
          ]
        })
      };
    }
  });
  assert.equal(requests, 1);
  assert.equal(result.profile.citations.all, 6426);
  assert.deepEqual(result.articles, [{
    title: "A paper",
    citationId: "q-UUrywAAAAJ:paper",
    citationCount: 17,
    url: "https://scholar.google.com/citations?view_op=view_citation&citation_for_view=q-UUrywAAAAJ:paper",
    citedByUrl: "https://scholar.google.com/scholar?cites=123",
    year: 2025
  }]);
  assert.equal(result.responseTruncated, false);
  assert.equal(result.pageCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-key|serpapi_link|private_field/);
});

test("paginates Scholar articles with bounded offsets and de-duplicates citation IDs", async () => {
  const authorId = "q-UUrywAAAAJ";
  const offsets = [];
  const rawArticle = (index) => ({
    title: `Article ${index}`,
    citation_id: `${authorId}:paper-${index}`,
    cited_by: { value: index },
    year: "2025"
  });
  const result = await fetchGoogleScholarAuthor({
    authorId,
    apiKey: "private-key",
    fetchImpl: async (url) => {
      const offset = Number(new URL(url).searchParams.get("start"));
      offsets.push(offset);
      const articles = offset === 0
        ? Array.from({ length: 100 }, (_, index) => rawArticle(index))
        : [rawArticle(99), rawArticle(100), rawArticle(101)];
      return {
        ok: true,
        json: async () => ({
          search_parameters: { author_id: authorId },
          author: { name: "Yongchul G. Chung" },
          cited_by: {
            table: [{ citations: { all: 6500 } }],
            graph: []
          },
          articles,
          ...(offset === 0
            ? { serpapi_pagination: { next: "https://serpapi.com/next" } }
            : {})
        })
      };
    }
  });

  assert.deepEqual(offsets, [0, 100]);
  assert.equal(result.pageCount, 2);
  assert.equal(result.articles.length, 102);
  assert.equal(new Set(result.articles.map(article => article.citationId)).size, 102);
  assert.equal(result.responseTruncated, false);
  assert.equal(result.profile.citations.all, 6500);
});

test("marks Scholar articles truncated when the bounded page limit is reached", async () => {
  const authorId = "q-UUrywAAAAJ";
  let requests = 0;
  const result = await fetchGoogleScholarAuthor({
    authorId,
    apiKey: "private-key",
    maxPages: 1,
    fetchImpl: async () => {
      requests += 1;
      return {
        ok: true,
        json: async () => ({
          search_parameters: { author_id: authorId },
          author: { name: "Yongchul G. Chung" },
          cited_by: {
            table: [{ citations: { all: 6500 } }],
            graph: []
          },
          articles: Array.from({ length: 100 }, (_, index) => ({
            title: `Article ${index}`,
            citation_id: `${authorId}:paper-${index}`,
            cited_by: { value: index },
            year: "2025"
          })),
          serpapi_pagination: { next: "https://serpapi.com/next" }
        })
      };
    }
  });

  assert.equal(requests, 1);
  assert.equal(result.pageCount, 1);
  assert.equal(result.articles.length, 100);
  assert.equal(result.responseTruncated, true);
  await assert.rejects(
    fetchGoogleScholarAuthor({
      authorId,
      apiKey: "private-key",
      maxPages: 6,
      fetchImpl: async () => {
        throw new Error("must not request");
      }
    }),
    /maxPages must be an integer from 1 to 5/
  );
});

test("stops Scholar pagination when a later page repeats citation IDs", async () => {
  const authorId = "q-UUrywAAAAJ";
  let requests = 0;
  const article = (index) => ({
    title: `Article ${index}`,
    citation_id: `${authorId}:paper-${index}`,
    cited_by: { value: index },
    year: "2025"
  });
  const result = await fetchGoogleScholarAuthor({
    authorId,
    apiKey: "private-key",
    fetchImpl: async () => {
      const firstPage = requests === 0;
      requests += 1;
      return {
        ok: true,
        json: async () => ({
          search_parameters: { author_id: authorId },
          author: { name: "Yongchul G. Chung" },
          cited_by: {
            table: [{ citations: { all: 6500 } }],
            graph: []
          },
          articles: firstPage
            ? Array.from({ length: 100 }, (_, index) => article(index))
            : [article(98), article(99)],
          ...(firstPage
            ? { serpapi_pagination: { next: "https://serpapi.com/next" } }
            : {})
        })
      };
    }
  });

  assert.equal(requests, 2);
  assert.equal(result.pageCount, 2);
  assert.equal(result.articles.length, 100);
  assert.equal(result.responseTruncated, true);
});

test("matches Scholar articles by reviewed deterministic precedence", () => {
  const authorId = "q-UUrywAAAAJ";
  const article = (title, id, citationCount, year = 2024) => ({
    title,
    citationId: `${authorId}:${id}`,
    citationCount,
    url: `https://scholar.google.com/citations?citation_for_view=${authorId}:${id}`,
    citedByUrl: null,
    year
  });
  const jpccDoi = "10.1021/acs.jpcc.9b02116";
  assert.equal(
    googleScholarCitationOverrides[jpccDoi],
    "q-UUrywAAAAJ:3fE2CSJIrl8C"
  );
  assert.equal(
    normalizePublicationTitle("CO\u2082 Adsorption\u2014A Caf\u00e9 Study &amp; Test"),
    "co2 adsorption a cafe study and test"
  );

  const publications = [
    {
      doi: jpccDoi,
      title: "Surface area determination of porous materials using the Brunauer-Emmett-Teller method",
      year: 2019
    },
    { doi: "10.1000/prior", title: "A title shared by profile duplicates", year: 2023 },
    { doi: "10.1000/feed", title: "CO\u2082 Adsorption\u2014A Caf\u00e9 Study &amp; Test", year: 2024 },
    { doi: "10.1000/provider", title: "Corrected website title", year: 2022 },
    {
      doi: "10.1000/prefix",
      title: "A deliberately long publication title describing molecular adsorption in porous materials with additional findings",
      year: 2021
    },
    { doi: "10.1000/ambiguous", title: "An ambiguous exact title", year: 2020 }
  ];
  const articles = [
    article(
      "Surface area determination of porous materials using the Brunauer-Emmett-Teller method",
      "3fE2CSJIrl8C",
      443,
      2019
    ),
    article(
      "Surface area determination of porous materials using the Brunauer-Emmett-Teller method",
      "similar-zero",
      0,
      2019
    ),
    article("A title shared by profile duplicates", "prior-right", 22, 2023),
    article("A title shared by profile duplicates", "prior-wrong", 0, 2023),
    article("CO2 adsorption - a cafe study & test", "feed", 17, 2025),
    article("Provider canonical title", "provider", 8, 2022),
    article(
      "A deliberately long publication title describing molecular adsorption in porous materials",
      "prefix",
      6,
      2021
    ),
    article("An ambiguous exact title", "ambiguous-a", 3, 2020),
    article("An ambiguous exact title", "ambiguous-b", 4, 2020)
  ];
  const previous = {
    publications: {
      "10.1000/prior": {
        googleScholar: { citationId: "q-UUrywAAAAJ:prior-right" }
      }
    }
  };
  const matched = matchGoogleScholarArticles({
    publications,
    articles,
    previous,
    semanticScholar: {
      "10.1000/provider": {
        title: "Provider canonical title",
        year: 2022
      }
    }
  });

  assert.equal(matched.records[jpccDoi].citationCount, 443);
  assert.equal(matched.records[jpccDoi].matchedBy, "override");
  assert.equal(
    matched.records[jpccDoi].citationId,
    "q-UUrywAAAAJ:3fE2CSJIrl8C"
  );
  assert.equal(matched.records["10.1000/prior"].matchedBy, "prior-citation-id");
  assert.equal(matched.records["10.1000/feed"].matchedBy, "feed-title");
  assert.equal(matched.records["10.1000/provider"].matchedBy, "provider-title");
  assert.equal(matched.records["10.1000/prefix"].matchedBy, "truncated-prefix");
  assert.equal(matched.records["10.1000/ambiguous"], undefined);
  assert.deepEqual(matched.ambiguousDois, ["10.1000/ambiguous"]);
});

test("guards Scholar profile totals and per-paper coverage independently", () => {
  const profile = { citations: { all: 6426 } };
  const previousPublications = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [
      `10.1000/${index}`,
      {
        googleScholar: {
          title: `Paper ${index}`,
          citationId: `q-UUrywAAAAJ:${index}`,
          citationCount: index,
          url: null,
          citedByUrl: null,
          year: 2024,
          matchedBy: "feed-title"
        }
      }
    ])
  );
  const previous = {
    googleScholar: { citations: { all: 6400 } },
    sources: { googleScholar: { matched: 20 } },
    publications: previousPublications
  };
  const partialRecords = Object.fromEntries(
    Object.entries(previousPublications).slice(0, 18)
      .map(([doi, publication]) => [doi, publication.googleScholar])
  );
  const partial = guardGoogleScholarCoverage({
    profile,
    matchResult: { records: partialRecords, ambiguousDois: ["10.1000/18"] },
    previous,
    expectedCount: 20
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.profile.citations.all, 6426);
  assert.equal(partial.freshMatched, 18);

  const collapsed = guardGoogleScholarCoverage({
    profile,
    matchResult: {
      records: Object.fromEntries(Object.entries(partialRecords).slice(0, 3)),
      ambiguousDois: []
    },
    previous,
    expectedCount: 20
  });
  assert.equal(collapsed.status, "partial");
  assert.equal(collapsed.reason, "per-paper-coverage-collapse");
  assert.equal(collapsed.profile, profile);
  assert.deepEqual(collapsed.records, {});

  const truncated = guardGoogleScholarCoverage({
    profile,
    matchResult: { records: partialRecords, ambiguousDois: [] },
    previous,
    expectedCount: 20,
    responseTruncated: true
  });
  assert.equal(truncated.status, "partial");
  assert.equal(truncated.reason, "response-truncated");
  assert.equal(truncated.profile, profile);
  assert.deepEqual(truncated.records, {});
});

test("refreshes a valid Scholar profile while retaining prior papers after article fail-closed guards", () => {
  const authorId = "q-UUrywAAAAJ";
  const publications = Array.from({ length: 10 }, (_, index) => ({
    no: String(index + 1).padStart(2, "0"),
    doi: `10.1000/scholar-${index}`,
    title: `Scholar publication ${index}`,
    year: 2024
  }));
  const profile = (citations, hIndex) => ({
    profileId: authorId,
    profileUrl: `https://scholar.google.com/citations?user=${authorId}&hl=en`,
    name: "Yongchul G. Chung",
    affiliations: "Pusan National University",
    citations: { all: citations, since: 4100, sinceYear: 2021 },
    hIndex: { all: hIndex, since: 28, sinceYear: 2021 },
    i10Index: { all: 54, since: 48, sinceYear: 2021 },
    countsByYear: [{ year: 2026, citationCount: 500 }],
    provider: "SerpApi Google Scholar Author API"
  });
  const priorArticles = Object.fromEntries(publications.map((publication, index) => [
    publication.doi,
    {
      title: publication.title,
      citationId: `${authorId}:paper-${index}`,
      citationCount: index + 1,
      url: `https://scholar.google.com/citations?citation_for_view=${authorId}:paper-${index}`,
      citedByUrl: null,
      year: publication.year,
      matchedBy: "feed-title"
    }
  ]));
  const previous = buildMetadata({
    publications,
    googleScholar: profile(6400, 33),
    googleScholarArticles: priorArticles,
    googleScholarStatus: "ok",
    googleScholarReason: null,
    now: "2026-07-01T00:00:00.000Z"
  });
  const currentProfile = profile(6500, 34);
  const scenarios = [
    {
      expectedReason: "per-paper-coverage-collapse",
      coverage: guardGoogleScholarCoverage({
        profile: currentProfile,
        matchResult: {
          records: {
            [publications[0].doi]: priorArticles[publications[0].doi]
          },
          ambiguousDois: []
        },
        previous,
        expectedCount: publications.length
      })
    },
    {
      expectedReason: "response-truncated",
      coverage: guardGoogleScholarCoverage({
        profile: currentProfile,
        matchResult: { records: priorArticles, ambiguousDois: [] },
        previous,
        expectedCount: publications.length,
        responseTruncated: true
      })
    }
  ];

  for (const { expectedReason, coverage } of scenarios) {
    assert.equal(coverage.status, "partial");
    assert.equal(coverage.reason, expectedReason);
    assert.equal(coverage.profile, currentProfile);
    assert.deepEqual(coverage.records, {});

    const refreshed = buildMetadata({
      publications,
      googleScholar: coverage.profile,
      googleScholarArticles: coverage.records,
      googleScholarStatus: coverage.status,
      googleScholarReason: coverage.reason,
      previous,
      now: "2026-07-30T00:00:00.000Z"
    });
    assert.equal(refreshed.googleScholar.citations.all, 6500);
    assert.equal(refreshed.googleScholar.hIndex.all, 34);
    assert.equal(refreshed.totals.googleScholarCitations, 6500);
    assert.equal(refreshed.sources.googleScholar.status, "partial");
    assert.equal(refreshed.sources.googleScholar.reason, expectedReason);
    assert.equal(refreshed.sources.googleScholar.matched, publications.length);
    assert.equal(refreshed.sources.googleScholar.freshMatched, 0);
    assert.deepEqual(
      refreshed.publications[publications[0].doi].googleScholar,
      priorArticles[publications[0].doi]
    );
    assert.deepEqual(
      refreshed.publications[publications[0].doi].sourceFreshness.googleScholar,
      {
        status: "stale",
        reason: expectedReason,
        contentUpdatedAt: "2026-07-01T00:00:00.000Z"
      }
    );
    assert.equal(validateMetadataSnapshot(
      refreshed,
      publications.map((publication) => publication.doi)
    ), true);
  }
});

test("rejects a Google Scholar response for a different author profile", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      search_parameters: { author_id: "another-profile" },
      cited_by: {
        table: [{ citations: { all: 9999 } }]
      }
    })
  });
  await assert.rejects(
    fetchGoogleScholarProfile({
      authorId: "q-UUrywAAAAJ",
      apiKey: "private-key",
      fetchImpl
    }),
    /did not match the configured author profile/
  );
});

test("rejects an implausible Google Scholar citation collapse", () => {
  const previous = {
    googleScholar: {
      citations: { all: 6400 }
    }
  };
  const guarded = guardGoogleScholarProfile({
    profile: { citations: { all: 1200 } },
    previous
  });
  assert.equal(guarded.status, "stale");
  assert.equal(guarded.reason, "citation-collapse");
  assert.equal(guarded.profile, null);

  const accepted = guardGoogleScholarProfile({
    profile: { citations: { all: 6390 } },
    previous
  });
  assert.equal(accepted.status, "ok");
  assert.equal(accepted.profile.citations.all, 6390);
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
    /HTTP 400/
  );
  assert.equal(requests, 1);
});

test("reports invalid JSON responses without retrying or leaking response content", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests++;
    return {
      ok: true,
      json: async () => {
        throw new SyntaxError("unexpected private response");
      }
    };
  };
  await assert.rejects(
    fetchOpenAlex(["10.1000/test"], { fetchImpl }),
    (error) => /invalid JSON response/.test(error.message)
      && !error.message.includes("private response")
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

test("marks a partial refresh stale when an omitted work is retained from the prior snapshot", () => {
  const publications = [
    { no: "01", doi: "10.1000/observed", title: "Observed", year: 2025 },
    { no: "02", doi: "10.1000/retained", title: "Retained", year: 2026 }
  ];
  const firstObservedAt = "2026-07-01T00:00:00.000Z";
  const refreshedAt = "2026-07-30T00:00:00.000Z";
  const previous = buildMetadata({
    publications,
    openAlex: {
      "10.1000/observed": { citationCount: 10 },
      "10.1000/retained": { citationCount: 20 }
    },
    openAlexObservedMatched: 2,
    now: firstObservedAt
  });

  const metadata = buildMetadata({
    publications,
    openAlex: {
      "10.1000/observed": { citationCount: 11 }
    },
    openAlexObservedMatched: 1,
    previous,
    now: refreshedAt
  });

  assert.deepEqual(metadata.sources.openAlex, {
    status: "stale",
    reason: "partial-refresh-retained-prior-records",
    matched: 2,
    observedMatched: 1,
    retainedMatched: 1,
    contentUpdatedAt: refreshedAt
  });
  assert.equal(metadata.totals.openAlexCitations, 31);
  assert.equal(metadata.publications["10.1000/observed"].openAlex.citationCount, 11);
  assert.deepEqual(
    metadata.publications["10.1000/observed"].sourceFreshness.openAlex,
    {
      status: "observed",
      contentUpdatedAt: refreshedAt
    }
  );
  assert.equal(metadata.publications["10.1000/retained"].openAlex.citationCount, 20);
  assert.deepEqual(
    metadata.publications["10.1000/retained"].sourceFreshness.openAlex,
    {
      status: "retained",
      contentUpdatedAt: firstObservedAt
    }
  );
  assert.equal(validateMetadataSnapshot(
    metadata,
    publications.map(publication => publication.doi)
  ), true);
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

test("keeps profile aggregate separate and preserves per-paper Scholar data on ambiguity", () => {
  const priorScholar = {
    title: "Ambiguous paper",
    citationId: "q-UUrywAAAAJ:retained",
    citationCount: 37,
    url: "https://scholar.google.com/citations?citation_for_view=q-UUrywAAAAJ:retained",
    citedByUrl: null,
    year: 2024,
    matchedBy: "prior-citation-id"
  };
  const previous = {
    schemaVersion: 3,
    snapshotUpdatedAt: "2026-07-01T00:00:00.000Z",
    sources: {
      googleScholar: {
        status: "ok",
        reason: null,
        matched: 1,
        freshMatched: 1,
        profileId: "q-UUrywAAAAJ",
        provider: "SerpApi Google Scholar Author API",
        contentUpdatedAt: "2026-07-01T00:00:00.000Z"
      }
    },
    totals: {
      publications: 1,
      semanticScholarCitations: 0,
      openAlexCitations: 0,
      googleScholarCitations: 6426
    },
    googleScholar: {
      profileId: "q-UUrywAAAAJ",
      profileUrl: "https://scholar.google.com/citations?user=q-UUrywAAAAJ&hl=en",
      name: "Yongchul G. Chung",
      affiliations: null,
      citations: { all: 6426, since: null, sinceYear: null },
      hIndex: { all: 33, since: null, sinceYear: null },
      i10Index: { all: 53, since: null, sinceYear: null },
      countsByYear: [],
      provider: "SerpApi Google Scholar Author API"
    },
    publications: {
      "10.1000/ambiguous": {
        no: "01",
        doi: "10.1000/ambiguous",
        title: "Ambiguous paper",
        year: 2024,
        googleScholar: priorScholar,
        sourceFreshness: {
          googleScholar: {
            status: "fresh",
            reason: null,
            contentUpdatedAt: "2026-07-01T00:00:00.000Z"
          }
        },
        fields: [],
        keywords: []
      }
    }
  };
  const metadata = buildMetadata({
    publications: [{
      no: "01",
      doi: "10.1000/ambiguous",
      title: "Ambiguous paper",
      year: 2024
    }],
    googleScholar: {
      ...previous.googleScholar,
      citations: { all: 6500, since: null, sinceYear: null }
    },
    googleScholarArticles: {},
    googleScholarStatus: "partial",
    googleScholarReason: "partial-match",
    semanticScholarStatus: "stale",
    semanticScholarReason: "request-failed",
    openAlexStatus: "stale",
    openAlexReason: "request-failed",
    previous,
    now: "2026-07-30T00:00:00.000Z"
  });

  assert.equal(metadata.schemaVersion, 3);
  assert.equal(metadata.totals.googleScholarCitations, 6500);
  assert.equal(metadata.publications["10.1000/ambiguous"].googleScholar.citationCount, 37);
  assert.equal(
    metadata.publications["10.1000/ambiguous"].sourceFreshness.googleScholar.status,
    "stale"
  );
  assert.equal(metadata.sources.googleScholar.matched, 1);
  assert.equal(metadata.sources.googleScholar.freshMatched, 0);
  assert.equal(validateMetadataSnapshot(metadata, ["10.1000/ambiguous"]), true);

  const repeatedFailure = buildMetadata({
    publications: [{
      no: "01",
      doi: "10.1000/ambiguous",
      title: "Ambiguous paper",
      year: 2024
    }],
    googleScholarStatus: "stale",
    googleScholarReason: "request-failed",
    semanticScholarStatus: "stale",
    semanticScholarReason: "request-failed",
    openAlexStatus: "stale",
    openAlexReason: "request-failed",
    previous: metadata,
    now: "2026-07-31T00:00:00.000Z"
  });
  assert.equal(repeatedFailure.googleScholar.citations.all, 6500);
  assert.equal(repeatedFailure.publications["10.1000/ambiguous"].googleScholar.citationCount, 37);
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

  const mismatchedProfile = structuredClone(repeated);
  mismatchedProfile.sources.googleScholar.profileId = "another-profile";
  assert.throws(
    () => validateMetadataSnapshot(mismatchedProfile, ["10.1000/test"]),
    /profile identity/
  );

  const invalidHistory = structuredClone(repeated);
  invalidHistory.googleScholar.countsByYear = {};
  assert.throws(
    () => validateMetadataSnapshot(invalidHistory, ["10.1000/test"]),
    /countsByYear must be an array/
  );
});

test("reports live Scholar profile and per-paper health independently", () => {
  const authorId = "q-UUrywAAAAJ";
  const publications = [{
    no: "01",
    doi: "10.1000/health",
    title: "Health check",
    year: 2026
  }];
  const profile = {
    profileId: authorId,
    profileUrl: `https://scholar.google.com/citations?user=${authorId}&hl=en`,
    name: "Yongchul G. Chung",
    affiliations: "Pusan National University",
    citations: { all: 6500, since: 4100, sinceYear: 2021 },
    hIndex: { all: 34, since: 28, sinceYear: 2021 },
    i10Index: { all: 54, since: 48, sinceYear: 2021 },
    countsByYear: [{ year: 2026, citationCount: 500 }],
    provider: "SerpApi Google Scholar Author API"
  };
  const article = {
    title: publications[0].title,
    citationId: `${authorId}:health`,
    citationCount: 12,
    url: `https://scholar.google.com/citations?citation_for_view=${authorId}:health`,
    citedByUrl: null,
    year: 2026,
    matchedBy: "feed-title"
  };
  const current = buildMetadata({
    publications,
    googleScholar: profile,
    googleScholarArticles: { "10.1000/health": article },
    googleScholarStatus: "ok",
    googleScholarReason: null,
    now: "2026-07-31T00:00:00.000Z"
  });
  const currentHealth = summarizePublicationMetadataHealth(current);
  assert.equal(currentHealth.scholarProfileCurrent, true);
  assert.equal(currentHealth.scholarPapersCurrent, true);
  assert.deepEqual(currentHealth.warnings, []);

  const profileOnly = buildMetadata({
    publications,
    googleScholar: { ...profile, citations: { ...profile.citations, all: 6510 } },
    googleScholarArticles: {},
    googleScholarStatus: "partial",
    googleScholarReason: "response-truncated",
    previous: current,
    now: "2026-08-01T00:00:00.000Z"
  });
  const profileOnlyHealth = summarizePublicationMetadataHealth(profileOnly);
  assert.equal(profileOnlyHealth.scholarProfileCurrent, true);
  assert.equal(profileOnlyHealth.scholarPapersCurrent, false);
  assert.match(profileOnlyHealth.warnings[0], /no per-paper matches are fresh/);

  const unconfigured = structuredClone(current);
  unconfigured.sources.googleScholar = {
    ...unconfigured.sources.googleScholar,
    status: "stale",
    reason: "unconfigured",
    freshMatched: 0,
    provider: "Legacy manual Google Scholar profile snapshot",
    contentUpdatedAt: null
  };
  unconfigured.googleScholar.provider = "Legacy manual Google Scholar profile snapshot";
  const unconfiguredHealth = summarizePublicationMetadataHealth(unconfigured);
  assert.equal(unconfiguredHealth.scholarProfileCurrent, false);
  assert.equal(unconfiguredHealth.scholarPapersCurrent, false);
  assert.match(unconfiguredHealth.warnings[0], /unconfigured/);
});

test("metadata workflow surfaces source health without blocking other providers", async () => {
  const workflow = await readFile(
    path.join(ROOT, ".github", "workflows", "publication-metadata.yml"),
    "utf8"
  );
  assert.match(workflow, /SERPAPI_API_KEY:\s*\$\{\{\s*secrets\.SERPAPI_API_KEY\s*\}\}/);
  assert.match(
    workflow,
    /name:\s*Summarize publication metadata source health\s+if:\s*always\(\)\s+run:\s*node scripts\/report-publication-metadata-health\.mjs/
  );
  for (const triggerPath of [
    ".github/workflows/publication-metadata.yml",
    "scripts/refresh-publication-metadata.mjs",
    "scripts/report-publication-metadata-health.mjs",
    "tests/publication-metadata.test.mjs"
  ]) {
    assert.match(workflow, new RegExp(triggerPath.replaceAll(".", "\\.")));
  }
});

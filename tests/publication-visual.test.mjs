import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parsePublicationBibliography,
  publicationJournalKey,
  synchronizePublicationFiles
} from "../scripts/publication-bot.mjs";
import {
  ALLOWED_RIGHTS_BASES,
  AVAILABILITY_STATUSES,
  generateJournalTitleCards,
  inspectRasterAsset,
  jpegDimensions,
  JOURNAL_CARD_HEIGHT,
  JOURNAL_CARD_WIDTH,
  journalCardPath,
  loadPublicationVisualState,
  MAX_REVIEWED_ASSET_BYTES,
  pngDimensions,
  renderJournalTitleCard,
  validatePublicationVisuals,
  validateReviewedVisualMetadata,
  validateSafeSvg
} from "../scripts/publication-visual.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("creates stable bounded paths for original journal title cards", () => {
  assert.equal(journalCardPath("jcp"), "images/publications/journal-cards/jcp.svg");
  assert.equal(journalCardPath("ACS JCED"), "images/publications/journal-cards/acs-jced.svg");
  assert.throws(() => journalCardPath(""), /Invalid journal key/);
});

test("renders deterministic safe journal title cards without publisher artwork", () => {
  const journal = {
    journalKey: "example",
    journal: "Journal of <Safe> Research & Reproducibility",
    journalUrl: "https://example.org/journal"
  };
  const first = renderJournalTitleCard(journal);
  const second = renderJournalTitleCard(journal);
  assert.equal(first, second);
  assert.match(first, new RegExp(`width="${JOURNAL_CARD_WIDTH}" height="${JOURNAL_CARD_HEIGHT}"`));
  assert.match(first, /Journal of Research &amp;/);
  assert.doesNotMatch(first, /<Safe>/);
  assert.match(first, /NOT PUBLISHER ARTWORK/);
  assert.equal(validateSafeSvg(first), true);
});

test("rejects active or remote SVG content", () => {
  const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.org/a.png"/></svg>`;
  assert.throws(() => validateSafeSvg(malicious), /forbidden/);
});

test("reads PNG dimensions from the IHDR chunk", () => {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
  buffer.writeUInt32BE(393, 16);
  buffer.writeUInt32BE(400, 20);
  assert.deepEqual(pngDimensions(buffer), { width: 393, height: 400 });
  assert.throws(() => pngDimensions(Buffer.from("not a png")), /truncated|not a PNG/);
});

test("validates raster MIME, extension, dimensions, pixels, and bounded file size", () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(393, 16);
  png.writeUInt32BE(400, 20);
  assert.deepEqual(inspectRasterAsset(png, ".png"), {
    width: 393,
    height: 400,
    mimeType: "image/png",
    bytes: 24
  });
  assert.throws(() => inspectRasterAsset(png, ".jpg"), /not a JPEG/);
  assert.throws(() => inspectRasterAsset(png, ".gif"), /PNG or JPEG extension/);
  assert.throws(
    () => inspectRasterAsset(Buffer.alloc(MAX_REVIEWED_ASSET_BYTES + 1), ".png"),
    /safety limit/
  );

  const oversizedDimensions = Buffer.from(png);
  oversizedDimensions.writeUInt32BE(10_000, 16);
  oversizedDimensions.writeUInt32BE(10_000, 20);
  assert.throws(() => inspectRasterAsset(oversizedDimensions, ".png"), /safety bounds/);
});

test("reads JPEG dimensions from baseline and progressive start-of-frame segments", () => {
  const jpeg = (marker) => Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46,
    0xff, marker, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x80, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
  assert.deepEqual(jpegDimensions(jpeg(0xc0)), { width: 640, height: 400 });
  assert.deepEqual(jpegDimensions(jpeg(0xc2)), { width: 640, height: 400 });
});

test("rejects truncated or malformed JPEG marker segments", () => {
  assert.throws(() => jpegDimensions(Buffer.from("not a jpeg")), /not a JPEG/);
  assert.throws(
    () => jpegDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x08, 0x00])),
    /truncated/
  );
  assert.throws(
    () => jpegDimensions(Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x80, 0x02,
      0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00
    ])),
    /invalid component data/
  );
});

test("enforces reviewed visual kind, provenance dates, and an explicit rights allowlist", () => {
  const base = {
    kind: "publisher-graphical-abstract",
    src: "images/publications/article-graphics/example.png",
    width: 393,
    height: 393,
    label: "Graphical abstract",
    alt: "Reviewed graphical abstract.",
    sourcePage: "https://doi.org/10.1000/example",
    credit: "Example credit.",
    attribution: "Example attribution",
    rightsBasis: "cc-by-4.0",
    rightsUrl: "https://creativecommons.org/licenses/by/4.0/",
    checksumSha256: "a".repeat(64),
    reviewedAt: "2026-07-30"
  };
  assert.ok(ALLOWED_RIGHTS_BASES.includes(base.rightsBasis));
  assert.doesNotThrow(() => validateReviewedVisualMetadata(base, "example", {
    expectedKind: "publisher-graphical-abstract",
    manifestReviewedAt: "2026-07-30"
  }));
  assert.throws(
    () => validateReviewedVisualMetadata({ ...base, rightsBasis: "publisher-page" }, "example"),
    /unsupported rightsBasis/
  );
  assert.throws(
    () => validateReviewedVisualMetadata({ ...base, rightsUrl: "https://example.org/license" }, "example"),
    /does not match cc-by-4.0/
  );
  assert.throws(
    () => validateReviewedVisualMetadata({ ...base, reviewedAt: "2026-02-30" }, "example"),
    /valid ISO date/
  );
  assert.throws(
    () => validateReviewedVisualMetadata(
      { ...base, kind: "journal-mark", src: "images/publications/journal-marks/example.png" },
      "example",
      { expectedKind: "publisher-graphical-abstract" }
    ),
    /must use visual kind/
  );

  const provided = {
    ...base,
    rightsBasis: "author-provided",
    rightsUrl: undefined,
    providedBy: "article author",
    providedAt: "2026-07-30"
  };
  assert.doesNotThrow(() => validateReviewedVisualMetadata(provided, "provided example"));
  assert.throws(
    () => validateReviewedVisualMetadata({ ...provided, providedBy: "" }, "provided example"),
    /missing providedBy/
  );
  assert.throws(
    () => validateReviewedVisualMetadata({ ...provided, providedAt: "2026-07-31" }, "provided example"),
    /reviewed before/
  );
});

test("resolves every publication to reviewed artwork, a reviewed mark, or an original title card", async () => {
  const state = await validatePublicationVisuals();
  assert.ok(state.publications.length > 0);
  assert.equal(state.publications.every((publication) => publication.publicationVisual?.src), true);
  assert.equal(Object.keys(state.availabilityByDoi).length, state.publications.length);
  assert.equal(
    Object.values(state.availabilityByDoi).every((outcome) => AVAILABILITY_STATUSES.includes(outcome.status)),
    true
  );

  const review = state.publications.find((publication) => publication.no === "72");
  assert.equal(review.publicationVisual.kind, "publisher-graphical-abstract");
  assert.equal(review.publicationVisual.availabilityStatus, "reviewed-article-graphic");
  assert.equal(review.publicationVisual.rightsBasis, "author-provided");
  assert.equal(review.publicationVisual.attribution, "Author-provided visual");

  const reviewedRscDois = new Set([
    "10.1039/d5me00131e",
    "10.1039/d2ta05420e",
    "10.1039/d2me00036a",
    "10.1039/d2ta00503d",
    "10.1039/c5sc01784j",
    "10.1039/c4ee03515a"
  ]);
  const reviewedRscPapers = state.publications.filter(
    (publication) => reviewedRscDois.has(String(publication.doi).toLowerCase())
  );
  assert.equal(reviewedRscPapers.length, reviewedRscDois.size);
  assert.equal(
    reviewedRscPapers.every((publication) => publication.publicationVisual.kind === "publisher-graphical-abstract"),
    true
  );
  assert.equal(
    reviewedRscPapers.every((publication) => /^RSC - /.test(publication.publicationVisual.attribution)),
    true
  );
  assert.equal(
    reviewedRscPapers.find((publication) => String(publication.doi).toLowerCase() === "10.1039/c5sc01784j")
      .publicationVisual.rightsBasis,
    "cc-by-3.0"
  );

  const reviewedElsevierDois = new Set([
    "10.1016/j.cej.2025.164419",
    "10.1016/j.memsci.2025.124298",
    "10.1016/j.matt.2025.102140",
    "10.1016/j.cej.2025.160517",
    "10.1016/j.seppur.2024.127752",
    "10.1016/j.cej.2023.143644",
    "10.1016/j.matt.2023.03.009",
    "10.1016/j.cattod.2022.07.024",
    "10.1016/j.apcatb.2019.117888"
  ]);
  const reviewedElsevierPapers = state.publications.filter(
    (publication) => reviewedElsevierDois.has(String(publication.doi).toLowerCase())
  );
  assert.equal(reviewedElsevierPapers.length, reviewedElsevierDois.size);
  assert.equal(
    reviewedElsevierPapers.every(
      (publication) => publication.publicationVisual.kind === "publisher-graphical-abstract"
    ),
    true
  );
  assert.equal(
    reviewedElsevierPapers.every(
      (publication) => /^Elsevier - /.test(publication.publicationVisual.attribution)
    ),
    true
  );
  assert.equal(
    reviewedElsevierPapers.find(
      (publication) => String(publication.doi).toLowerCase() === "10.1016/j.cattod.2022.07.024"
    ).publicationVisual.rightsBasis,
    "cc-by-4.0"
  );

  const reviewedWileyDois = new Set([
    "10.1002/advs.202201559",
    "10.1002/advs.202004999",
    "10.1002/advs.202004940"
  ]);
  const reviewedWileyPapers = state.publications.filter(
    (publication) => reviewedWileyDois.has(String(publication.doi).toLowerCase())
  );
  assert.equal(reviewedWileyPapers.length, reviewedWileyDois.size);
  assert.equal(
    reviewedWileyPapers.every(
      (publication) => publication.publicationVisual.kind === "publisher-graphical-abstract"
    ),
    true
  );
  assert.equal(
    reviewedWileyPapers.every(
      (publication) => publication.publicationVisual.rightsBasis === "cc-by-4.0"
    ),
    true
  );
  assert.equal(
    reviewedWileyPapers.every(
      (publication) => publication.publicationVisual.attribution === "Wiley - CC BY 4.0"
    ),
    true
  );

  const jcpPapers = state.publications.filter((publication) => publication.journalKey === "jcp");
  assert.ok(jcpPapers.length >= 2);
  assert.equal(jcpPapers.every((publication) => publication.publicationVisual.kind === "journal-mark"), true);
  assert.equal(
    jcpPapers.every((publication) => publication.publicationVisual.availabilityStatus === "reviewed-journal-mark"),
    true
  );
  assert.equal(jcpPapers.every((publication) => publication.publicationVisual.rightsBasis === "user-provided"), true);

  const joss = state.publications.find((publication) => publication.journalKey === "joss");
  assert.equal(joss.publicationVisual.kind, "journal-mark");
  assert.equal(joss.publicationVisual.rightsBasis, "cc-by-4.0");
  assert.equal(joss.publicationVisual.attribution, "JOSS - CC BY 4.0");

  const generic = state.publications.find((publication) => publication.publicationVisual.kind === "journal-title-card");
  assert.ok(generic);
  assert.match(generic.publicationVisual.src, /^images\/publications\/journal-cards\/.+\.svg$/);
  assert.equal(generic.publicationVisual.availabilityStatus, "neutral-original-title-card");
  assert.equal(generic.publicationVisual.attribution, "Original journal title card");
  assert.equal(generic.publicationVisual.fallbackSrc, generic.publicationVisual.src);
});

test("loads the reviewed manifest before feed.js", async () => {
  const { manifest, publications } = await loadPublicationVisualState();
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(publications[0].no, "72");
  assert.equal(publications[0].publicationVisual.kind, "publisher-graphical-abstract");
});

test("generates one safe runtime fallback card for every feed journal", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "publication-visual-"));
  const generated = await generateJournalTitleCards({ outputRoot });
  const { publications } = await loadPublicationVisualState();
  assert.equal(generated.length, new Set(publications.map((publication) => publication.journalKey)).size);
  assert.equal(new Set(generated.map((item) => item.journalKey)).size, generated.length);
  const first = generated[0];
  const content = await readFile(path.join(outputRoot, ...first.path.split("/")), "utf8");
  assert.equal(validateSafeSvg(content.trim()), true);
});

test("Slack-approved future DOI reaches bibliography, visual validation, and neutral-card build", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "future-publication-visual-"));
  try {
    const [feed, bibliography] = await Promise.all([
      readFile(path.join(repositoryRoot, "feed.js"), "utf8"),
      readFile(path.join(repositoryRoot, "data/publication-bibliography.json"), "utf8")
    ]);
    const candidate = {
      doi: "10.5555/future.visual.2027",
      title: "A synthetic future publication for visual automation validation",
      authors: "Chung, Y.G.",
      journal: "Future Journal of Molecular Systems",
      meta: ", 1, 100001 (2027)",
      year: "2027",
      abstract: "Synthetic test metadata; no publisher image is supplied.",
      topics: ["Molecular Dynamics"],
      bibliography: {
        doi: "10.5555/future.visual.2027",
        type: "article",
        title: "A synthetic future publication for visual automation validation",
        authors: [{ given: "Yongchul G.", family: "Chung" }],
        journal: "Future Journal of Molecular Systems",
        year: 2027,
        volume: "1",
        articleNumber: "100001",
        publisher: "Synthetic Test Publisher",
        source: { provider: "crossref" }
      }
    };
    const expectedJournalKey = publicationJournalKey(feed, candidate);
    const synchronized = synchronizePublicationFiles(
      feed,
      bibliography,
      candidate,
      "2027-01-02T03:04:05.000Z"
    );
    const feedPath = path.join(temporaryRoot, "feed.mjs");
    const bibliographyPath = path.join(temporaryRoot, "publication-bibliography.json");
    const outputRoot = path.join(temporaryRoot, "dist");
    await Promise.all([
      writeFile(feedPath, synchronized.feed, "utf8"),
      writeFile(bibliographyPath, synchronized.bibliography, "utf8")
    ]);

    assert.equal(synchronized.changed, true);
    assert.match(expectedJournalKey, /^doi-future-journal-of-molecular-syst-[a-f0-9]{20}$/);
    assert.doesNotMatch(synchronized.feed, /'auto'/);
    assert.ok(
      parsePublicationBibliography(await readFile(bibliographyPath, "utf8"))
        .publications[candidate.doi]
    );

    const visualsPath = path.join(repositoryRoot, "publication-visuals.js");
    const state = await validatePublicationVisuals({
      repository: repositoryRoot,
      visualsPath,
      feedPath
    });
    const publication = state.publications.find((item) => item.doi === candidate.doi);
    const doiUrl = `https://doi.org/${candidate.doi}`;
    assert.equal(publication.journalKey, expectedJournalKey);
    assert.equal(publication.publicationVisual.kind, "journal-title-card");
    assert.equal(publication.publicationVisual.availabilityStatus, "neutral-original-title-card");
    assert.equal(publication.publicationVisual.sourcePage, doiUrl);
    assert.equal(publication.publicationVisual.fallbackSourcePage, doiUrl);

    const generated = await generateJournalTitleCards({
      outputRoot,
      visualsPath,
      feedPath
    });
    const generatedFallback = generated.find((item) => item.journalKey === expectedJournalKey);
    assert.ok(generatedFallback);
    const svg = await readFile(
      path.join(outputRoot, ...generatedFallback.path.split("/")),
      "utf8"
    );
    assert.match(svg, /Future Journal of Molecular Systems/);
    assert.match(svg, /https:\/\/doi\.org\/10\.5555\/future\.visual\.2027/);
    assert.equal(validateSafeSvg(svg.trim()), true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GRAPHIC_HEIGHT,
  GRAPHIC_WIDTH,
  graphicPathForDoi,
  graphicSlugForDoi,
  groupPublicationTopics,
  loadFeedForGraphics,
  renderGraphicalAbstractSvg,
  validateGraphicalAbstractSvg,
  writePublicationGraphic
} from "../scripts/publication-graphic.mjs";

const publication = {
  title: "A <safe> graphical summary for adsorption & separation",
  journal: "Journal of Reproducible Graphics",
  meta: ", 1, 1–10 (2026)",
  year: "2026",
  doi: "https://doi.org/10.1000/ABC.Def",
  topics: [
    "Grand Canonical Monte Carlo",
    "Adsorption",
    "Reticular Materials",
    "Cyclic Swing Adsorber",
    "Carbon Capture"
  ]
};

test("normalizes a DOI into a stable local graphical-abstract path", () => {
  assert.equal(graphicSlugForDoi("https://doi.org/10.1000/ABC.Def"), "10-1000-abc-def");
  assert.equal(
    graphicPathForDoi("10.1000/ABC.Def"),
    "images/publications/graphical-abstracts/10-1000-abc-def.svg"
  );
  assert.throws(() => graphicSlugForDoi("not-a-doi"), /Invalid DOI/);
});

test("groups reviewed labels in the site taxonomy order", () => {
  assert.deepEqual(
    groupPublicationTopics(publication.topics).map((stage) => stage.group),
    ["Computation", "Physics", "Materials", "Systems", "Applications"]
  );
  assert.deepEqual(groupPublicationTopics(["Review"], "Materials"), [{
    group: "Materials",
    labels: ["Review article"]
  }]);
});

test("renders a deterministic, escaped, self-contained SVG", () => {
  const first = renderGraphicalAbstractSvg(publication);
  const second = renderGraphicalAbstractSvg(publication);
  assert.equal(first, second);
  assert.match(first, new RegExp(`width="${GRAPHIC_WIDTH}" height="${GRAPHIC_HEIGHT}"`));
  assert.match(first, /A graphical summary for adsorption &amp; separation/);
  assert.doesNotMatch(first, /<safe>/);
  assert.doesNotMatch(first, /<(?:script|foreignObject|image)\b/i);
  assert.equal(validateGraphicalAbstractSvg(first), true);
});

test("rejects active or remote SVG content", () => {
  const malicious = `<svg xmlns="http://www.w3.org/2000/svg" width="${GRAPHIC_WIDTH}" height="${GRAPHIC_HEIGHT}"><script>alert(1)</script></svg>`;
  assert.throws(() => validateGraphicalAbstractSvg(malicious), /forbidden/);
});

test("writes a generated graphic under the bounded publication asset path", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "publication-graphic-"));
  const result = await writePublicationGraphic(publication, outputRoot);
  const content = await readFile(path.join(outputRoot, ...result.path.split("/")), "utf8");
  assert.equal(result.path, graphicPathForDoi(publication.doi));
  assert.equal(validateGraphicalAbstractSvg(content.trim()), true);
});

test("loads every current DOI and its reviewed topic labels from feed.js", async () => {
  const publications = await loadFeedForGraphics();
  assert.ok(publications.length > 0);
  assert.equal(new Set(publications.map(item => item.doi)).size, publications.length);
  assert.equal(publications.every((item) => item.doi && item.title && item.topics.length), true);
});


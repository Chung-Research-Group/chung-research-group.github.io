import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  generatedLabStatisticsFile,
  generatedPublicationJcrBandsFile,
  generatedPublicationCitationFiles,
  requiredPages,
  requiredRuntimeFiles,
  rootFilePatterns,
  staticDirectories
} from "./site-files.mjs";
import {
  parseFeedDois,
  parseGeneratedBibtexDois
} from "./publication-citations.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const compareFlag = args.indexOf("--compare-source");
const siteRoot = path.resolve(repositoryRoot, rootFlag >= 0 ? args[rootFlag + 1] : ".");
const compareRoot = compareFlag >= 0 ? path.resolve(repositoryRoot, args[compareFlag + 1]) : null;
const errors = [];
const generatedCitationFileSet = new Set(generatedPublicationCitationFiles);
const generatedBuildFileSet = new Set([
  ...generatedPublicationCitationFiles,
  generatedLabStatisticsFile,
  generatedPublicationJcrBandsFile
]);

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!relative && root === repositoryRoot && [".git", "dist", "node_modules", "test-results"].includes(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child.split(path.sep).join("/"));
  }
  return files.sort();
}

function publishedSourceFile(file) {
  if (!file.includes("/")) return rootFilePatterns.some((pattern) => pattern.test(file));
  return staticDirectories.some((directory) => file === directory || file.startsWith(`${directory}/`));
}

function localReference(value) {
  const reference = value.trim();
  if (!reference || reference.startsWith("#") || reference.includes("{{")) return null;
  if (/^(?:[a-z]+:|\/\/)/i.test(reference)) return null;
  return decodeURIComponent(reference.split("#", 1)[0].split("?", 1)[0]);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeDoi(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

function reportDoiSetDifference(label, actualDois, expectedDoiSet) {
  const actualDoiSet = new Set(actualDois.map(normalizeDoi).filter(Boolean));
  const missing = [...expectedDoiSet].filter((doi) => !actualDoiSet.has(doi));
  const extra = [...actualDoiSet].filter((doi) => !expectedDoiSet.has(doi));
  if (actualDois.length !== actualDoiSet.size || missing.length || extra.length) {
    errors.push(
      `${label} DOI set must exactly match feed.js`
      + `${actualDois.length !== actualDoiSet.size ? "; duplicate DOI entries found" : ""}`
      + `${missing.length ? `; missing: ${missing.join(", ")}` : ""}`
      + `${extra.length ? `; extra: ${extra.join(", ")}` : ""}.`
    );
  }
}

function validatePublicationCitationExports(bibtex, cff, expectedDoiSet) {
  const bibtexEntries = [...bibtex.matchAll(/^@article\s*\{/gmi)];
  if (bibtexEntries.length !== expectedDoiSet.size) {
    errors.push(`BibTeX export must contain ${expectedDoiSet.size} article entries; found ${bibtexEntries.length}.`);
  }
  const bibtexDois = parseGeneratedBibtexDois(bibtex);
  reportDoiSetDifference("BibTeX export", bibtexDois, expectedDoiSet);

  for (const marker of [
    'cff-version: "1.2.0"',
    'type: "dataset"',
    'title: "Chung Research Group Publication Catalogue"',
    "references:"
  ]) {
    if (!cff.includes(marker)) errors.push(`CFF export is missing required marker: ${marker}`);
  }
  const cffArticleReferences = [...cff.matchAll(/^\s*-\s+type:\s*["']?article["']?\s*$/gmi)];
  if (cffArticleReferences.length !== expectedDoiSet.size) {
    errors.push(`CFF export must contain ${expectedDoiSet.size} article references; found ${cffArticleReferences.length}.`);
  }
  const cffDois = [...cff.matchAll(/^\s+doi:\s*["']?([^"'\s]+)["']?\s*$/gmi)]
    .map((match) => match[1]);
  reportDoiSetDifference("CFF export", cffDois, expectedDoiSet);
}

function normalizePublicAuthorNamePart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b([A-Za-z][A-Za-z'-]+)\.([A-Z])\./g, "$1 $2.")
    .replace(/\s+([,.;:])/g, "$1");
}

function publicBibliographyAuthorLabels(bibliography) {
  const labels = new Set();
  const records = bibliography?.publications;
  if (!records || typeof records !== "object" || Array.isArray(records)) return labels;
  for (const record of Object.values(records)) {
    if (!Array.isArray(record?.authors)) continue;
    for (const author of record.authors) {
      const given = normalizePublicAuthorNamePart(author?.given);
      const family = normalizePublicAuthorNamePart(author?.family);
      const structured = [given, family].filter(Boolean).join(" ").trim();
      const label = structured || normalizePublicAuthorNamePart(author?.literal);
      if (label) labels.add(label);
    }
  }
  return labels;
}

function comparePublicText(left, right) {
  const leftKey = String(left).normalize("NFKD").toLowerCase();
  const rightKey = String(right).normalize("NFKD").toLowerCase();
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function evaluateFeedPublications(source, label) {
  try {
    const sandbox = Object.create(null);
    sandbox.window = Object.create(null);
    const context = vm.createContext(sandbox, {
      name: `site-validator:${label}`,
      codeGeneration: { strings: false, wasm: false }
    });
    new vm.Script(source, { filename: label }).runInContext(context, { timeout: 1_000 });
    const publications = new vm.Script(
      "window.MTAP_FEED && window.MTAP_FEED.PUBS",
      { filename: `${label}:extract` }
    ).runInContext(context, { timeout: 1_000 });
    const plainPublications = JSON.parse(JSON.stringify(publications));
    if (!Array.isArray(plainPublications) || plainPublications.length === 0) {
      errors.push(`${label} must expose a nonempty window.MTAP_FEED.PUBS array.`);
      return null;
    }
    return plainPublications;
  } catch (error) {
    errors.push(`${label} could not be evaluated for independent statistics validation: ${error.message}`);
    return null;
  }
}

function deriveFeedPublicationFacts(publications, currentYear) {
  if (!Array.isArray(publications) || publications.length === 0) return null;
  const yearCounts = new Map();
  const journals = new Map();
  let reviews = 0;

  for (const [index, publication] of publications.entries()) {
    const year = Number(publication?.year);
    if (!Number.isInteger(year) || year < 1 || year > 9999) {
      errors.push(`feed.js publication ${index + 1} has an invalid year.`);
      return null;
    }
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    if (Array.isArray(publication?.topics) && publication.topics.includes("Review")) reviews += 1;

    const journal = String(publication?.journal || "").normalize("NFC").replace(/\s+/g, " ").trim();
    if (!journal) {
      errors.push(`feed.js publication ${index + 1} has no journal for statistics validation.`);
      return null;
    }
    const key = journal.toLocaleLowerCase("en-US").replace(/^the\s+/, "");
    const entry = journals.get(key) || { labels: new Map(), count: 0 };
    entry.labels.set(journal, (entry.labels.get(journal) || 0) + 1);
    entry.count += 1;
    journals.set(key, entry);
  }

  const firstPublicationYear = Math.min(...yearCounts.keys());
  const firstYear = Math.min(firstPublicationYear, currentYear);
  const lastPublicationYear = Math.max(...yearCounts.keys());
  const lastYear = Math.max(lastPublicationYear, currentYear);
  const byYear = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    byYear.push({ year, count: yearCounts.get(year) || 0, partial: year === currentYear });
  }
  const journalGroups = [...journals.values()]
    .map((entry) => ({
      name: [...entry.labels.entries()]
        .sort((left, right) => right[1] - left[1] || comparePublicText(left[0], right[0]))[0][0],
      count: entry.count
    }))
    .sort((left, right) => right.count - left.count || comparePublicText(left.name, right.name));

  return {
    total: publications.length,
    articles: publications.length - reviews,
    reviews,
    firstYear,
    lastPublicationYear,
    lastYear,
    currentYearPartial: true,
    byYear,
    journals: journalGroups
  };
}

function validateLabStatistics(
  stats,
  expectedPublicationFacts,
  publicationBibliography
) {
  if (!expectedPublicationFacts) {
    errors.push("Lab statistics could not be compared with independently evaluated feed.js data.");
    return;
  }
  const expectedPublicationCount = expectedPublicationFacts.total;
  const expectedReviewCount = expectedPublicationFacts.reviews;
  const nonnegativeInteger = (value) => Number.isInteger(value) && value >= 0;
  const validIsoCalendarDate = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const allowedKeys = (value, keys, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${label} must be an object.`);
      return false;
    }
    const unexpected = Object.keys(value).filter((key) => !keys.includes(key));
    if (unexpected.length) errors.push(`${label} contains unexpected fields: ${unexpected.join(", ")}.`);
    return true;
  };
  const requireKeys = (value, keys, label) => {
    const missing = keys.filter((key) => !Object.hasOwn(value, key));
    if (missing.length) errors.push(`${label} is missing required fields: ${missing.join(", ")}.`);
  };
  const uniqueBy = (items, key) => new Set(items.map((item) => item?.[key])).size === items.length;
  const expectedRootKeys = [
    "schemaVersion",
    "dataAsOf",
    "publications",
    "journals",
    "coauthors",
    "researchAreas",
    "citations",
    "metrics",
    "impactFactors",
    "journalStanding",
    "team"
  ];
  if (!allowedKeys(stats, expectedRootKeys, "Lab statistics root")) return;
  const missingRootKeys = expectedRootKeys.filter((key) => !Object.hasOwn(stats, key));
  if (missingRootKeys.length) {
    errors.push(`Lab statistics root is missing required fields: ${missingRootKeys.join(", ")}.`);
  }
  if (stats.schemaVersion !== 4) errors.push("Lab statistics schemaVersion must be 4.");
  if (typeof stats.dataAsOf !== "string" || !Number.isFinite(Date.parse(stats.dataAsOf))) {
    errors.push("Lab statistics dataAsOf must be an ISO date-time.");
  }

  const publicationStats = stats.publications;
  if (allowedKeys(
    publicationStats,
    [
      "total",
      "articles",
      "reviews",
      "firstYear",
      "lastPublicationYear",
      "lastYear",
      "currentYearPartial",
      "byYear"
    ],
    "Lab statistics publications"
  )) {
    for (const field of [
      "total",
      "articles",
      "reviews",
      "firstYear",
      "lastPublicationYear",
      "lastYear"
    ]) {
      if (!nonnegativeInteger(publicationStats[field])) {
        errors.push(`Lab statistics publications.${field} must be a nonnegative integer.`);
      }
    }
    if (publicationStats.total !== expectedPublicationCount) {
      errors.push(`Lab statistics publication total must equal feed.js count ${expectedPublicationCount}.`);
    }
    if (publicationStats.total !== publicationStats.articles + publicationStats.reviews) {
      errors.push("Lab statistics publication total must equal articles plus reviews.");
    }
    if (publicationStats.reviews !== expectedReviewCount) {
      errors.push(`Lab statistics review count must equal feed.js count ${expectedReviewCount}.`);
    }
    for (const field of [
      "articles",
      "firstYear",
      "lastPublicationYear",
      "lastYear",
      "currentYearPartial"
    ]) {
      if (publicationStats[field] !== expectedPublicationFacts[field]) {
        errors.push(
          `Lab statistics publications.${field} must equal the value independently derived from feed.js.`
        );
      }
    }
    if (typeof publicationStats.currentYearPartial !== "boolean") {
      errors.push("Lab statistics publications.currentYearPartial must be boolean.");
    }
    if (!Array.isArray(publicationStats.byYear) || publicationStats.byYear.length === 0) {
      errors.push("Lab statistics publications.byYear must be a nonempty array.");
    } else {
      let annualTotal = 0;
      for (const [index, row] of publicationStats.byYear.entries()) {
        if (!allowedKeys(row, ["year", "count", "partial"], `Lab statistics year row ${index + 1}`)) continue;
        if (!Number.isInteger(row.year) || !nonnegativeInteger(row.count) || typeof row.partial !== "boolean") {
          errors.push(`Lab statistics year row ${index + 1} has invalid year, count, or partial flag.`);
        }
        if (index > 0 && row.year !== publicationStats.byYear[index - 1].year + 1) {
          errors.push("Lab statistics publication years must be continuous.");
        }
        if (row.partial && row.year !== new Date().getUTCFullYear()) {
          errors.push("Only the current UTC year may be marked partial.");
        }
        annualTotal += Number.isInteger(row.count) ? row.count : 0;
      }
      const firstRow = publicationStats.byYear[0];
      const lastRow = publicationStats.byYear.at(-1);
      if (publicationStats.firstYear !== firstRow.year || publicationStats.lastYear !== lastRow.year) {
        errors.push("Lab statistics firstYear and lastYear must match the continuous year rows.");
      }
      const currentYear = new Date().getUTCFullYear();
      const currentYearRow = publicationStats.byYear.find((row) => row?.year === currentYear);
      if (!currentYearRow || currentYearRow.partial !== true) {
        errors.push(`Lab statistics must include UTC year ${currentYear} and mark it as YTD.`);
      }
      if (publicationStats.currentYearPartial !== currentYearRow?.partial) {
        errors.push("Lab statistics currentYearPartial must match the current UTC year row.");
      }
      if (lastRow.year !== expectedPublicationFacts.lastYear) {
        errors.push("The final lab statistics publication row must match the derived display range end.");
      }
      if (annualTotal !== publicationStats.total) {
        errors.push("Lab statistics yearly publication counts must sum to the publication total.");
      }
      if (JSON.stringify(publicationStats.byYear) !== JSON.stringify(expectedPublicationFacts.byYear)) {
        errors.push("Lab statistics publication year rows must exactly match counts independently derived from feed.js.");
      }
    }
  }

  const journalStats = stats.journals;
  if (allowedKeys(
    journalStats,
    ["publicationTotal", "distinctCount", "countingMethod", "groups"],
    "Lab statistics journals"
  )) {
    if (journalStats.publicationTotal !== expectedPublicationCount) {
      errors.push(`Lab statistics journals.publicationTotal must equal feed.js count ${expectedPublicationCount}.`);
    }
    if (!nonnegativeInteger(journalStats.distinctCount)) {
      errors.push("Lab statistics journals.distinctCount must be a nonnegative integer.");
    }
    if (typeof journalStats.countingMethod !== "string" || !journalStats.countingMethod.trim()) {
      errors.push("Lab statistics journals.countingMethod must explain how publications are counted.");
    }
    if (!Array.isArray(journalStats.groups) || journalStats.groups.length === 0) {
      errors.push("Lab statistics journals.groups must be a nonempty array.");
    } else {
      const normalizedJournalNames = journalStats.groups.map((group) =>
        typeof group?.name === "string" ? group.name.trim().toLocaleLowerCase("en-US") : ""
      );
      if (new Set(normalizedJournalNames).size !== journalStats.groups.length) {
        errors.push("Lab statistics journal names must be unique case-insensitively.");
      }
      let journalTotal = 0;
      journalStats.groups.forEach((group, index) => {
        if (!allowedKeys(group, ["name", "count"], `Lab statistics journal ${index + 1}`)) return;
        if (typeof group.name !== "string" || !group.name.trim()
            || !Number.isInteger(group.count) || group.count <= 0) {
          errors.push(`Lab statistics journal ${index + 1} must have a nonempty name and positive integer count.`);
        }
        journalTotal += Number.isInteger(group.count) ? group.count : 0;
      });
      if (journalStats.distinctCount !== journalStats.groups.length) {
        errors.push("Lab statistics journals.distinctCount must equal the number of journal groups.");
      }
      if (journalStats.distinctCount !== expectedPublicationFacts.journals.length) {
        errors.push("Lab statistics journal distinct count must match journals independently derived from feed.js.");
      }
      if (journalTotal !== expectedPublicationCount) {
        errors.push("Lab statistics journal counts must sum to the publication total.");
      }
      if (JSON.stringify(journalStats.groups) !== JSON.stringify(expectedPublicationFacts.journals)) {
        errors.push("Lab statistics journal groups must exactly match counts independently derived from feed.js.");
      }
    }
  }

  const coauthorStats = stats.coauthors;
  if (allowedKeys(
    coauthorStats,
    [
      "totalAuthors",
      "totalCollaborators",
      "displayedAuthors",
      "countingMethod",
      "bounded",
      "maxNodes",
      "maxEdges",
      "nodes",
      "edges"
    ],
    "Lab statistics coauthors"
  )) {
    for (const field of ["totalAuthors", "totalCollaborators", "displayedAuthors", "maxNodes", "maxEdges"]) {
      if (!nonnegativeInteger(coauthorStats[field])) {
        errors.push(`Lab statistics coauthors.${field} must be a nonnegative integer.`);
      }
    }
    if (coauthorStats.totalCollaborators !== coauthorStats.totalAuthors - 1) {
      errors.push("Lab statistics coauthors.totalCollaborators must exclude exactly one principal investigator.");
    }
    if (typeof coauthorStats.countingMethod !== "string" || !coauthorStats.countingMethod.trim()) {
      errors.push("Lab statistics coauthors.countingMethod must explain the bounded graph.");
    }
    if (coauthorStats.bounded !== true) {
      errors.push("Lab statistics coauthor network must declare that it is bounded.");
    }
    if (coauthorStats.maxNodes !== 25 || coauthorStats.maxEdges !== 80) {
      errors.push("Lab statistics coauthor network bounds must remain at 25 nodes and 80 edges.");
    }
    if (!Array.isArray(coauthorStats.nodes) || coauthorStats.nodes.length === 0) {
      errors.push("Lab statistics coauthors.nodes must be a nonempty array.");
    }
    if (!Array.isArray(coauthorStats.edges)) {
      errors.push("Lab statistics coauthors.edges must be an array.");
    }

    const nodes = Array.isArray(coauthorStats.nodes) ? coauthorStats.nodes : [];
    const edges = Array.isArray(coauthorStats.edges) ? coauthorStats.edges : [];
    if (nodes.length > coauthorStats.maxNodes || edges.length > coauthorStats.maxEdges) {
      errors.push("Lab statistics coauthor graph exceeds its declared node or edge bound.");
    }
    if (coauthorStats.displayedAuthors !== nodes.length) {
      errors.push("Lab statistics coauthors.displayedAuthors must equal the number of graph nodes.");
    }
    if (coauthorStats.totalAuthors < nodes.length) {
      errors.push("Lab statistics coauthors.totalAuthors cannot be smaller than displayedAuthors.");
    }

    const bibliographyLabels = publicBibliographyAuthorLabels(publicationBibliography);
    const nodeIds = new Set();
    let principalInvestigatorCount = 0;
    for (const [index, node] of nodes.entries()) {
      if (!allowedKeys(
        node,
        ["id", "label", "publicationCount", "isPrincipalInvestigator"],
        `Lab statistics coauthor node ${index + 1}`
      )) continue;
      if (typeof node.id !== "string" || !node.id.trim()) {
        errors.push(`Lab statistics coauthor node ${index + 1} must have a nonempty id.`);
      } else if (nodeIds.has(node.id)) {
        errors.push(`Lab statistics coauthor node ids must be unique: ${node.id}.`);
      } else {
        nodeIds.add(node.id);
      }
      if (typeof node.label !== "string" || !node.label.trim()) {
        errors.push(`Lab statistics coauthor node ${index + 1} must have a nonempty public label.`);
      } else if (!bibliographyLabels.has(node.label)) {
        errors.push(`Lab statistics coauthor label is not derived from the public bibliography: ${node.label}.`);
      }
      if (/https?:\/\/|mailto:|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(String(node.label || ""))) {
        errors.push(`Lab statistics coauthor node ${index + 1} must not expose a URL or email address.`);
      }
      if (!Number.isInteger(node.publicationCount)
          || node.publicationCount <= 0
          || node.publicationCount > expectedPublicationCount) {
        errors.push(`Lab statistics coauthor node ${index + 1} has an invalid publicationCount.`);
      }
      if (typeof node.isPrincipalInvestigator !== "boolean") {
        errors.push(`Lab statistics coauthor node ${index + 1} must have a boolean PI flag.`);
      }
      if (node.isPrincipalInvestigator === true) principalInvestigatorCount += 1;
    }
    if (principalInvestigatorCount !== 1) {
      errors.push("Lab statistics coauthor graph must identify exactly one principal investigator.");
    }

    const edgePairs = new Set();
    for (const [index, edge] of edges.entries()) {
      if (!allowedKeys(
        edge,
        ["source", "target", "publicationCount"],
        `Lab statistics coauthor edge ${index + 1}`
      )) continue;
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        errors.push(`Lab statistics coauthor edge ${index + 1} references a missing node.`);
      }
      if (edge.source === edge.target) {
        errors.push(`Lab statistics coauthor edge ${index + 1} must not be a self-edge.`);
      }
      const pair = [edge.source, edge.target].sort().join("\u0000");
      if (edgePairs.has(pair)) {
        errors.push(`Lab statistics coauthor edges must be unique: ${edge.source} / ${edge.target}.`);
      }
      edgePairs.add(pair);
      if (!Number.isInteger(edge.publicationCount)
          || edge.publicationCount <= 0
          || edge.publicationCount > expectedPublicationCount) {
        errors.push(`Lab statistics coauthor edge ${index + 1} has an invalid publicationCount.`);
      }
    }
    if (/https?:\/\/|mailto:|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(JSON.stringify(coauthorStats))) {
      errors.push("Lab statistics coauthor network must not contain contact URLs or email addresses.");
    }
  }

  const researchAreas = stats.researchAreas;
  if (allowedKeys(
    researchAreas,
    ["overlap", "countingMethod", "groups"],
    "Lab statistics researchAreas"
  )) {
    if (researchAreas.overlap !== true) {
      errors.push("Lab statistics research areas must declare overlapping counts.");
    }
    if (typeof researchAreas.countingMethod !== "string" || !researchAreas.countingMethod.trim()) {
      errors.push("Lab statistics researchAreas.countingMethod must explain the overlap.");
    }
    if (!Array.isArray(researchAreas.groups) || researchAreas.groups.length === 0) {
      errors.push("Lab statistics researchAreas.groups must be a nonempty array.");
    } else {
      if (!uniqueBy(researchAreas.groups, "id") || !uniqueBy(researchAreas.groups, "name")) {
        errors.push("Lab statistics research-area ids and names must be unique.");
      }
      researchAreas.groups.forEach((group, index) => {
        if (!allowedKeys(
          group,
          ["id", "name", "count", "articleCount", "reviewCount"],
          `Lab statistics research area ${index + 1}`
        )) return;
        if (typeof group.id !== "string" || !group.id
            || typeof group.name !== "string" || !group.name
            || !nonnegativeInteger(group.count)
            || !nonnegativeInteger(group.articleCount)
            || !nonnegativeInteger(group.reviewCount)
            || group.count > expectedPublicationCount
            || group.articleCount > publicationStats?.articles
            || group.reviewCount > publicationStats?.reviews) {
          errors.push(`Lab statistics research area ${index + 1} has invalid aggregate data.`);
        }
        if (group.count !== group.articleCount + group.reviewCount) {
          errors.push(`Lab statistics research area ${index + 1} count must equal articleCount plus reviewCount.`);
        }
      });
    }
  }

  const citationStats = stats.citations;
  if (allowedKeys(citationStats, ["sources"], "Lab statistics citations")) {
    if (!Array.isArray(citationStats.sources) || citationStats.sources.length === 0) {
      errors.push("Lab statistics citations.sources must be a nonempty array.");
    } else {
      if (!uniqueBy(citationStats.sources, "id")) {
        errors.push("Lab statistics citation source ids must be unique.");
      }
      const expectedCitationSources = ["googleScholar", "openAlex", "semanticScholar"];
      const actualCitationSources = citationStats.sources.map((source) => source?.id).sort();
      if (JSON.stringify(actualCitationSources) !== JSON.stringify(expectedCitationSources.sort())) {
        errors.push("Lab statistics must keep Google Scholar, OpenAlex, and Semantic Scholar as separate sources.");
      }
      citationStats.sources.forEach((source, index) => {
        if (!allowedKeys(
          source,
          [
            "id",
            "label",
            "status",
            "total",
            "provider",
            "reason",
            "matched",
            "publicationTotal",
            "updatedAt",
            "profileUrl",
            "countsByYear",
            "cumulativeCountsByYear",
            "history"
          ],
          `Lab statistics citation source ${index + 1}`
        )) return;
        requireKeys(source, [
          "id",
          "label",
          "status",
          "total",
          "provider",
          "reason",
          "matched",
          "publicationTotal",
          "updatedAt",
          "countsByYear",
          "cumulativeCountsByYear",
          "history"
        ], `Lab statistics citation source ${index + 1}`);
        if (typeof source.id !== "string" || !source.id
            || typeof source.label !== "string" || !source.label
            || !["ok", "stale", "partial", "unavailable"].includes(source.status)) {
          errors.push(`Lab statistics citation source ${index + 1} has invalid source metadata.`);
        }
        if (typeof source.provider !== "string" || !source.provider.trim()) {
          errors.push(`Lab statistics citation source ${index + 1} must identify a nonempty provider.`);
        }
        if (source.reason !== null
            && (typeof source.reason !== "string" || !source.reason.trim())) {
          errors.push(`Lab statistics citation source ${index + 1} reason must be null or nonempty text.`);
        }
        if (["stale", "partial", "unavailable"].includes(source.status)
            && (typeof source.reason !== "string" || !source.reason.trim())) {
          errors.push(`A stale, partial, or unavailable citation source ${index + 1} must explain its status.`);
        }
        if (source.publicationTotal !== expectedPublicationCount) {
          errors.push(
            `Lab statistics citation source ${index + 1} publicationTotal must equal feed.js count ${expectedPublicationCount}.`
          );
        }
        if (source.matched !== null
            && (!nonnegativeInteger(source.matched)
              || source.matched > source.publicationTotal)) {
          errors.push(
            `Lab statistics citation source ${index + 1} matched must be null or within publication coverage.`
          );
        }
        if (source.status !== "unavailable"
            && source.matched !== null
            && source.matched < source.publicationTotal
            && source.status !== "partial") {
          errors.push(
            `Citation source ${index + 1} with incomplete publication coverage must have partial status.`
          );
        }
        if (source.status === "unavailable") {
          if (source.total !== null) {
            errors.push(`Unavailable citation source ${index + 1} must have a null total.`);
          }
        } else if (!nonnegativeInteger(source.total)) {
          errors.push(`Available citation source ${index + 1} must have a nonnegative integer total.`);
        }
        if (source.updatedAt !== null && source.updatedAt !== undefined
            && (typeof source.updatedAt !== "string" || !Number.isFinite(Date.parse(source.updatedAt)))) {
          errors.push(`Lab statistics citation source ${index + 1} has an invalid updatedAt timestamp.`);
        }
        if (source.profileUrl !== undefined
            && (typeof source.profileUrl !== "string" || !/^https:\/\//.test(source.profileUrl))) {
          errors.push(`Lab statistics citation source ${index + 1} has an invalid profileUrl.`);
        }
        if (!Array.isArray(source.countsByYear)) {
          errors.push(`Lab statistics citation source ${index + 1} countsByYear must be an array.`);
        } else {
          if (source.status === "unavailable" && source.countsByYear.length !== 0) {
            errors.push(`Unavailable citation source ${index + 1} must have no yearly counts.`);
          }
          const citationYears = new Set();
          source.countsByYear.forEach((row, rowIndex) => {
            if (!allowedKeys(
              row,
              ["year", "count"],
              `Lab statistics citation source ${index + 1} year row ${rowIndex + 1}`
            )) return;
            if (!Number.isInteger(row.year) || !nonnegativeInteger(row.count)) {
              errors.push(`Lab statistics citation source ${index + 1} has an invalid yearly count.`);
            }
            if (citationYears.has(row.year)) {
              errors.push(`Lab statistics citation source ${index + 1} has a duplicate yearly count.`);
            }
            citationYears.add(row.year);
            if (rowIndex > 0 && row.year <= source.countsByYear[rowIndex - 1]?.year) {
              errors.push(`Lab statistics citation source ${index + 1} yearly counts must be sorted.`);
            }
          });

          if (!Array.isArray(source.cumulativeCountsByYear)) {
            errors.push(`Lab statistics citation source ${index + 1} cumulativeCountsByYear must be an array.`);
          } else {
            const expectedCumulative = [];
            if (source.countsByYear.length > 0) {
              const annualCounts = new Map(
                source.countsByYear.map(row => [row.year, row.count])
              );
              let cumulative = 0;
              const firstYear = source.countsByYear[0].year;
              const lastYear = source.countsByYear.at(-1).year;
              for (let year = firstYear; year <= lastYear; year += 1) {
                cumulative += annualCounts.get(year) || 0;
                expectedCumulative.push({ year, count: cumulative });
              }
            }
            source.cumulativeCountsByYear.forEach((row, rowIndex) => {
              if (!allowedKeys(
                row,
                ["year", "count"],
                `Lab statistics citation source ${index + 1} cumulative row ${rowIndex + 1}`
              )) return;
              if (!Number.isInteger(row.year) || !nonnegativeInteger(row.count)) {
                errors.push(`Lab statistics citation source ${index + 1} has an invalid cumulative count.`);
              }
            });
            if (JSON.stringify(source.cumulativeCountsByYear) !== JSON.stringify(expectedCumulative)) {
              errors.push(
                `Lab statistics citation source ${index + 1} cumulative counts must be the unmodified running sum of provider-assigned yearly counts.`
              );
            }
          }

          const history = source.history;
          const historyLabel = `Lab statistics citation source ${index + 1} history`;
          if (allowedKeys(
            history,
            [
              "status",
              "annualTotal",
              "reportedTotal",
              "reconciliationDelta",
              "unassignedCount",
              "excessAnnualCount",
              "reason"
            ],
            historyLabel
          )) {
            requireKeys(history, [
              "status",
              "annualTotal",
              "reportedTotal",
              "reconciliationDelta",
              "unassignedCount",
              "excessAnnualCount",
              "reason"
            ], historyLabel);
            const hasAnnualHistory = source.countsByYear.length > 0;
            const annualTotal = source.countsByYear.reduce((sum, row) => sum + row.count, 0);
            const delta = hasAnnualHistory && nonnegativeInteger(source.total)
              ? source.total - annualTotal
              : null;
            const expectedHistoryStatus = !hasAnnualHistory
              ? "unavailable"
              : delta !== 0 || source.status === "partial"
                ? "partial"
                : source.status === "stale"
                  ? "stale"
                  : "ok";
            if (!["ok", "stale", "partial", "unavailable"].includes(history?.status)) {
              errors.push(`${historyLabel} has an invalid status.`);
            }
            if (history?.status !== expectedHistoryStatus) {
              errors.push(`${historyLabel} status does not reflect availability, freshness, and reconciliation.`);
            }
            if (history?.reportedTotal !== source.total) {
              errors.push(`${historyLabel} reportedTotal must equal the source current total.`);
            }
            if (history?.annualTotal !== (hasAnnualHistory ? annualTotal : null)) {
              errors.push(`${historyLabel} annualTotal must equal the provider-assigned yearly sum.`);
            }
            if (history?.reconciliationDelta !== delta) {
              errors.push(`${historyLabel} reconciliationDelta must equal current total minus yearly sum.`);
            }
            if (history?.unassignedCount !== (delta === null ? null : Math.max(0, delta))) {
              errors.push(`${historyLabel} unassignedCount must preserve a positive provider-total delta.`);
            }
            if (history?.excessAnnualCount !== (delta === null ? null : Math.max(0, -delta))) {
              errors.push(`${historyLabel} excessAnnualCount must preserve a negative provider-total delta.`);
            }
            if (history?.reason !== null
                && (typeof history?.reason !== "string" || !history.reason.trim())) {
              errors.push(`${historyLabel} reason must be null or nonempty text.`);
            }
            if (history?.status !== "ok"
                && (typeof history?.reason !== "string" || !history.reason.trim())) {
              errors.push(`${historyLabel} must explain a stale, partial, or unavailable state.`);
            }
          }
        }
      });
    }
  }

  const metrics = stats.metrics;
  if (allowedKeys(metrics, ["hIndex"], "Lab statistics metrics")) {
    if (!Object.hasOwn(metrics, "hIndex")) {
      errors.push("Lab statistics metrics must contain hIndex.");
    } else {
      const hIndex = metrics.hIndex;
      if (allowedKeys(
        hIndex,
        [
          "status",
          "value",
          "since",
          "sinceYear",
          "source",
          "provider",
          "reason",
          "updatedAt",
          "matched",
          "publicationTotal",
          "method",
          "profileUrl"
        ],
        "Lab statistics h-index"
      )) {
        requireKeys(hIndex, [
          "status",
          "value",
          "since",
          "sinceYear",
          "source",
          "provider",
          "reason",
          "updatedAt",
          "matched",
          "publicationTotal",
          "method"
        ], "Lab statistics h-index");
        if (!["ok", "stale", "partial", "unavailable"].includes(hIndex.status)) {
          errors.push("Lab statistics h-index status must be ok, stale, partial, or unavailable.");
        }
        const validNullableInteger = (value) => value === null || nonnegativeInteger(value);
        if (!validNullableInteger(hIndex.value) || !validNullableInteger(hIndex.since)) {
          errors.push("Lab statistics h-index values must be nonnegative integers or null.");
        }
        if (hIndex.sinceYear !== null
            && (!Number.isInteger(hIndex.sinceYear) || hIndex.sinceYear < 1000 || hIndex.sinceYear > 9999)) {
          errors.push("Lab statistics h-index sinceYear must be a four-digit year or null.");
        }
        if ((hIndex.since === null) !== (hIndex.sinceYear === null)) {
          errors.push("Lab statistics h-index since and sinceYear must either both be present or both be null.");
        }
        if (nonnegativeInteger(hIndex.value)
            && nonnegativeInteger(hIndex.since)
            && hIndex.since > hIndex.value) {
          errors.push("Lab statistics recent-period h-index cannot exceed the all-time h-index.");
        }
        if (hIndex.status === "unavailable" && hIndex.value !== null) {
          errors.push("An unavailable h-index must have a null value.");
        }
        if (["ok", "stale", "partial"].includes(hIndex.status) && !nonnegativeInteger(hIndex.value)) {
          errors.push("An available, stale, or partial h-index must have a nonnegative integer value.");
        }
        if (hIndex.publicationTotal !== expectedPublicationCount) {
          errors.push(`Lab statistics h-index publicationTotal must equal feed.js count ${expectedPublicationCount}.`);
        }
        if (hIndex.matched !== null
            && (!nonnegativeInteger(hIndex.matched) || hIndex.matched > hIndex.publicationTotal)) {
          errors.push("Lab statistics h-index matched must be null or within publication coverage.");
        }
        if (typeof hIndex.method !== "string" || !hIndex.method.trim()) {
          errors.push("Lab statistics h-index must disclose a nonempty method.");
        }
        if (hIndex.reason !== null
            && (typeof hIndex.reason !== "string" || !hIndex.reason.trim())) {
          errors.push("Lab statistics h-index reason must be null or nonempty text.");
        }
        if (hIndex.status === "unavailable"
            && (typeof hIndex.reason !== "string" || !hIndex.reason.trim())) {
          errors.push("An unavailable h-index must explain its status.");
        }
        if (hIndex.updatedAt !== null
            && (typeof hIndex.updatedAt !== "string" || !Number.isFinite(Date.parse(hIndex.updatedAt)))) {
          errors.push("Lab statistics h-index updatedAt must be an ISO timestamp or null.");
        }
        if (hIndex.profileUrl !== undefined
            && (typeof hIndex.profileUrl !== "string" || !/^https:\/\//.test(hIndex.profileUrl))) {
          errors.push("Lab statistics h-index profileUrl must be an HTTPS URL when present.");
        }
        if (hIndex.status === "unavailable") {
          if (hIndex.source !== null || hIndex.provider !== null || hIndex.matched !== 0) {
            errors.push("An unavailable h-index must have null source/provider and zero matched coverage.");
          }
        } else {
          if (!["Google Scholar", "OpenAlex"].includes(hIndex.source)
              || typeof hIndex.provider !== "string"
              || !hIndex.provider.trim()) {
            errors.push("An available h-index must identify Google Scholar or OpenAlex and its provider.");
          }
          if (hIndex.source === "Google Scholar") {
            if (hIndex.matched !== null || !/Google Scholar author profile/i.test(hIndex.method)) {
              errors.push("A Google Scholar h-index must be labelled as a reported profile metric.");
            }
          }
          if (hIndex.source === "OpenAlex") {
            if (!nonnegativeInteger(hIndex.matched)
                || !/OpenAlex/i.test(hIndex.method)
                || !/catalog(?:ue)?/i.test(hIndex.method)) {
              errors.push("An OpenAlex h-index must disclose its catalogue-derived method and coverage.");
            }
          }
        }
      }
    }
  }

  const impactFactors = stats.impactFactors;
  if (allowedKeys(
    impactFactors,
    [
      "status",
      "metric",
      "total",
      "coveredPublications",
      "publicationTotal",
      "source",
      "edition",
      "licenseConfirmed",
      "aggregatePublicationAuthorized",
      "updatedAt",
      "reason"
    ],
    "Lab statistics impactFactors"
  )) {
    requireKeys(impactFactors, [
      "status",
      "metric",
      "total",
      "coveredPublications",
      "publicationTotal",
      "source",
      "edition",
      "licenseConfirmed",
      "aggregatePublicationAuthorized",
      "updatedAt",
      "reason"
    ], "Lab statistics impactFactors");
    if (!["ok", "partial", "unavailable"].includes(impactFactors.status)) {
      errors.push("Lab statistics impactFactors.status must be ok, partial, or unavailable.");
    }
    if (impactFactors.metric !== "Journal Impact Factor") {
      errors.push("Lab statistics impactFactors.metric must be Journal Impact Factor.");
    }
    if (impactFactors.publicationTotal !== expectedPublicationCount) {
      errors.push(`Lab statistics impactFactors.publicationTotal must equal feed.js count ${expectedPublicationCount}.`);
    }
    if (!nonnegativeInteger(impactFactors.coveredPublications)
        || impactFactors.coveredPublications > expectedPublicationCount) {
      errors.push("Lab statistics impactFactors.coveredPublications is invalid.");
    }
    if (impactFactors.updatedAt !== null
        && (typeof impactFactors.updatedAt !== "string"
          || !Number.isFinite(Date.parse(impactFactors.updatedAt)))) {
      errors.push("Lab statistics impactFactors.updatedAt must be an ISO timestamp or null.");
    }
    if (impactFactors.reason !== null
        && (typeof impactFactors.reason !== "string" || !impactFactors.reason.trim())) {
      errors.push("Lab statistics impactFactors.reason must be null or nonempty text.");
    }

    if (impactFactors.status === "unavailable") {
      if (impactFactors.total !== null
          || impactFactors.coveredPublications !== 0) {
        errors.push("Unavailable impact factors must have a null total and zero coverage.");
      }
      if (typeof impactFactors.reason !== "string" || !impactFactors.reason.trim()) {
        errors.push("Unavailable impact factors must explain why no value is published.");
      }
      if (impactFactors.licenseConfirmed === false) {
        if (impactFactors.source !== null
            || impactFactors.edition !== null
            || impactFactors.aggregatePublicationAuthorized !== false
            || impactFactors.updatedAt !== null) {
          errors.push("Unconfigured impact factors must have null provenance and false authorization flags.");
        }
      } else if (impactFactors.licenseConfirmed === true) {
        if (impactFactors.aggregatePublicationAuthorized !== true
            || typeof impactFactors.source !== "string"
            || !/\b(?:Clarivate|Journal Citation Reports?|JCR)\b/i.test(impactFactors.source)
            || typeof impactFactors.edition !== "string"
            || !impactFactors.edition.trim()
            || typeof impactFactors.updatedAt !== "string"
            || !Number.isFinite(Date.parse(impactFactors.updatedAt))) {
          errors.push("Configured but unavailable impact factors must retain valid licensed JCR provenance and authorization.");
        }
      } else {
        errors.push("Lab statistics impactFactors.licenseConfirmed must be boolean.");
      }
    } else {
      if (typeof impactFactors.total !== "number"
          || !Number.isFinite(impactFactors.total)
          || impactFactors.total < 0) {
        errors.push("Available impact-factor totals must be nonnegative finite numbers.");
      }
      if (impactFactors.coveredPublications <= 0) {
        errors.push("Available impact-factor totals must report positive publication coverage.");
      }
      if (impactFactors.status === "ok"
          && impactFactors.coveredPublications !== impactFactors.publicationTotal) {
        errors.push("An ok impact-factor aggregate must cover every publication.");
      }
      if (impactFactors.status === "partial"
          && impactFactors.coveredPublications >= impactFactors.publicationTotal) {
        errors.push("A partial impact-factor aggregate must disclose incomplete publication coverage.");
      }
      if (impactFactors.status === "partial"
          && (typeof impactFactors.reason !== "string" || !impactFactors.reason.trim())) {
        errors.push("A partial impact-factor aggregate must explain its incomplete coverage.");
      }
      if (typeof impactFactors.source !== "string"
          || !/\b(?:Clarivate|Journal Citation Reports?|JCR)\b/i.test(impactFactors.source)) {
        errors.push("Impact factors may only use an identified licensed Clarivate Journal Citation Reports source.");
      }
      if (typeof impactFactors.edition !== "string" || !impactFactors.edition.trim()) {
        errors.push("Available impact factors must identify the licensed JCR edition.");
      }
      if (impactFactors.licenseConfirmed !== true
          || impactFactors.aggregatePublicationAuthorized !== true) {
        errors.push("Available impact factors require confirmed licensing and aggregate-publication authorization.");
      }
      if (typeof impactFactors.updatedAt !== "string"
          || !Number.isFinite(Date.parse(impactFactors.updatedAt))) {
        errors.push("Available impact factors must include an ISO source timestamp.");
      }
    }
    if (typeof impactFactors.source === "string"
        && /\b(?:OpenAlex|Semantic Scholar|Crossref|CiteScore|SJR)\b/i.test(impactFactors.source)) {
      errors.push("Citation databases and proxy journal metrics must not be presented as Journal Impact Factors.");
    }
    if (/10\.\d{4,9}\/[^\s"']+/i.test(JSON.stringify(impactFactors))) {
      errors.push("Lab statistics impactFactors must not redistribute raw per-DOI JCR data.");
    }
  }

  const journalStanding = stats.journalStanding;
  const journalStandingKeys = [
    "status",
    "publicationTotal",
    "coveredPublications",
    "unavailablePublications",
    "bands",
    "source",
    "edition",
    "licenseConfirmed",
    "aggregatePublicationAuthorized",
    "aggregateRankingDisplayAuthorized",
    "updatedAt",
    "authorizationReference",
    "authorizationDate",
    "yearBasis",
    "reason"
  ];
  if (allowedKeys(
    journalStanding,
    journalStandingKeys,
    "Lab statistics journalStanding"
  )) {
    requireKeys(journalStanding, [
      "status",
      "publicationTotal",
      "coveredPublications",
      "unavailablePublications",
      "bands",
      "source",
      "edition",
      "licenseConfirmed",
      "aggregatePublicationAuthorized",
      "aggregateRankingDisplayAuthorized",
      "updatedAt",
      "yearBasis",
      "reason"
    ], "Lab statistics journalStanding");
    if (!["ok", "partial", "unavailable"].includes(journalStanding.status)) {
      errors.push("Lab statistics journalStanding.status must be ok, partial, or unavailable.");
    }
    if (journalStanding.publicationTotal !== expectedPublicationCount) {
      errors.push(`Lab statistics journalStanding.publicationTotal must equal feed.js count ${expectedPublicationCount}.`);
    }
    if (!nonnegativeInteger(journalStanding.coveredPublications)
        || !nonnegativeInteger(journalStanding.unavailablePublications)
        || journalStanding.coveredPublications + journalStanding.unavailablePublications
          !== journalStanding.publicationTotal) {
      errors.push("Lab statistics journalStanding coverage counts must be nonnegative and account for every publication.");
    }
    if (journalStanding.yearBasis
        !== "Previous-year JCR: publication year Y uses JCR year Y-1.") {
      errors.push("Lab statistics journalStanding must use the disclosed previous-year JCR basis.");
    }
    if (journalStanding.reason !== null
        && (typeof journalStanding.reason !== "string" || !journalStanding.reason.trim())) {
      errors.push("Lab statistics journalStanding.reason must be null or nonempty text.");
    }
    if (!Array.isArray(journalStanding.bands)) {
      errors.push("Lab statistics journalStanding.bands must be an array.");
    }

    const expectedBands = [
      ["top1", "Top 1%"],
      ["top5", "Top 5%"],
      ["top10", "Top 10%"],
      ["otherQ1", "Other Q1"],
      ["q2", "Q2"],
      ["q3", "Q3"],
      ["q4", "Q4"],
      ["unavailable", "Unavailable"]
    ];
    const bands = Array.isArray(journalStanding.bands) ? journalStanding.bands : [];
    if (journalStanding.status === "unavailable") {
      if (bands.length !== 0) {
        errors.push("Unavailable journal standing must not publish licensed band counts.");
      }
      if (journalStanding.coveredPublications !== 0
          || journalStanding.unavailablePublications !== journalStanding.publicationTotal) {
        errors.push("Unavailable journal standing must report zero coverage and the full catalogue as unavailable.");
      }
      if (typeof journalStanding.reason !== "string" || !journalStanding.reason.trim()) {
        errors.push("Unavailable journal standing must explain why no bands are published.");
      }
    } else {
      if (bands.length !== expectedBands.length) {
        errors.push("Available journal standing must include all exclusive Top 1%, Top 5%, Top 10%, Other Q1, Q2, Q3, Q4, and unavailable bands.");
      }
      let bandTotal = 0;
      let coveredBandTotal = 0;
      bands.forEach((band, index) => {
        if (!allowedKeys(
          band,
          ["id", "label", "count"],
          `Lab statistics journalStanding band ${index + 1}`
        )) return;
        const expectedBand = expectedBands[index];
        if (!expectedBand
            || band.id !== expectedBand[0]
            || band.label !== expectedBand[1]
            || !nonnegativeInteger(band.count)) {
          errors.push(`Lab statistics journalStanding band ${index + 1} has invalid identity, order, label, or count.`);
        }
        if (nonnegativeInteger(band.count)) {
          bandTotal += band.count;
          if (band.id !== "unavailable") coveredBandTotal += band.count;
        }
      });
      if (bandTotal !== journalStanding.publicationTotal
          || coveredBandTotal !== journalStanding.coveredPublications) {
        errors.push("Journal standing exclusive band counts must account for covered and total publications exactly once.");
      }
      const unavailableBand = bands.find(band => band?.id === "unavailable");
      if (unavailableBand?.count !== journalStanding.unavailablePublications) {
        errors.push("Journal standing unavailable band must equal unavailable publication coverage.");
      }
      if (journalStanding.status === "ok") {
        if (journalStanding.coveredPublications !== journalStanding.publicationTotal
            || journalStanding.unavailablePublications !== 0
            || journalStanding.reason !== null) {
          errors.push("An ok journal-standing aggregate must cover every publication and have no availability reason.");
        }
      }
      if (journalStanding.status === "partial") {
        if (journalStanding.coveredPublications <= 0
            || journalStanding.coveredPublications >= journalStanding.publicationTotal
            || journalStanding.unavailablePublications <= 0
            || typeof journalStanding.reason !== "string"
            || !journalStanding.reason.trim()) {
          errors.push("A partial journal-standing aggregate must disclose positive but incomplete coverage and a reason.");
        }
      }
    }

    const authorizationFieldsPresent =
      Object.hasOwn(journalStanding, "authorizationReference")
      || Object.hasOwn(journalStanding, "authorizationDate");
    if (journalStanding.licenseConfirmed === false) {
      if (journalStanding.source !== null
          || journalStanding.edition !== null
          || journalStanding.aggregatePublicationAuthorized !== false
          || journalStanding.aggregateRankingDisplayAuthorized !== false
          || journalStanding.updatedAt !== null
          || authorizationFieldsPresent) {
        errors.push("Unconfigured journal standing must have null provenance, false authorization flags, and no authorization reference.");
      }
    } else if (journalStanding.licenseConfirmed === true) {
      if (journalStanding.aggregatePublicationAuthorized !== true
          || typeof journalStanding.source !== "string"
          || !/\b(?:Clarivate|Journal Citation Reports?|JCR)\b/i.test(journalStanding.source)
          || typeof journalStanding.edition !== "string"
          || !journalStanding.edition.trim()
          || typeof journalStanding.updatedAt !== "string"
          || !Number.isFinite(Date.parse(journalStanding.updatedAt))) {
        errors.push("Configured journal standing must retain valid licensed JCR provenance and aggregate-publication authorization.");
      }
      if (typeof journalStanding.aggregateRankingDisplayAuthorized !== "boolean") {
        errors.push("Lab statistics journalStanding.aggregateRankingDisplayAuthorized must be boolean.");
      } else if (journalStanding.aggregateRankingDisplayAuthorized) {
        if (typeof journalStanding.authorizationReference !== "string"
            || !journalStanding.authorizationReference.trim()
            || !validIsoCalendarDate(journalStanding.authorizationDate)) {
          errors.push("Authorized journal-standing display must include a nonempty permission reference and valid permission date.");
        }
      } else if (authorizationFieldsPresent) {
        errors.push("Unauthorized journal standing must not publish permission reference fields.");
      }
    } else {
      errors.push("Lab statistics journalStanding.licenseConfirmed must be boolean.");
    }
    if (journalStanding.status !== "unavailable"
        && journalStanding.aggregateRankingDisplayAuthorized !== true) {
      errors.push("Available journal-standing bands require explicit aggregate ranking display authorization.");
    }
    if (typeof journalStanding.source === "string"
        && /\b(?:OpenAlex|Semantic Scholar|Crossref|CiteScore|SJR)\b/i.test(journalStanding.source)) {
      errors.push("Citation databases and proxy journal metrics must not be presented as JCR standing.");
    }
    if (/10\.\d{4,9}\/[^\s"']+|rankingsByDoi|jcrYear|categoryTotal|jifPercentile|"(?:category|rank|quartile)"\s*:/i.test(
      JSON.stringify(journalStanding)
    )) {
      errors.push("Lab statistics journalStanding must not redistribute raw per-DOI or per-category licensed JCR records.");
    }
  }

  const teamStats = stats.team;
  if (allowedKeys(teamStats, ["total", "groups"], "Lab statistics team")) {
    if (!nonnegativeInteger(teamStats.total)) {
      errors.push("Lab statistics team.total must be a nonnegative integer.");
    }
    if (!Array.isArray(teamStats.groups) || teamStats.groups.length === 0) {
      errors.push("Lab statistics team.groups must be a nonempty array.");
    } else {
      if (!uniqueBy(teamStats.groups, "id") || !uniqueBy(teamStats.groups, "label")) {
        errors.push("Lab statistics team group ids and labels must be unique.");
      }
      let teamTotal = 0;
      teamStats.groups.forEach((group, index) => {
        if (!allowedKeys(group, ["id", "label", "count"], `Lab statistics team group ${index + 1}`)) return;
        if (typeof group.id !== "string" || !group.id
            || typeof group.label !== "string" || !group.label
            || !nonnegativeInteger(group.count)) {
          errors.push(`Lab statistics team group ${index + 1} has invalid aggregate data.`);
        }
        teamTotal += nonnegativeInteger(group.count) ? group.count : 0;
      });
      if (teamStats.total !== teamTotal) {
        errors.push("Lab statistics team.total must equal the sum of aggregate role groups.");
      }
    }
  }
}

function validatePublicationJcrBands(
  snapshot,
  expectedPublicationCount,
  expectedDoiSet
) {
  const label = "Publication JCR band snapshot";
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    errors.push(`${label} must be an object.`);
    return;
  }
  const expectedKeys = [
    "schemaVersion",
    "status",
    "displayAuthorized",
    "publicationTotal",
    "coveredPublications",
    "yearBasis",
    "bandsByDoi",
    "reason"
  ];
  const unexpected = Object.keys(snapshot).filter((key) => !expectedKeys.includes(key));
  const missing = expectedKeys.filter((key) => !Object.hasOwn(snapshot, key));
  if (unexpected.length) errors.push(`${label} contains unexpected fields: ${unexpected.join(", ")}.`);
  if (missing.length) errors.push(`${label} is missing required fields: ${missing.join(", ")}.`);

  if (snapshot.schemaVersion !== 1) {
    errors.push(`${label}.schemaVersion must equal 1.`);
  }
  if (!["ok", "partial", "unavailable"].includes(snapshot.status)) {
    errors.push(`${label}.status must be ok, partial, or unavailable.`);
  }
  if (typeof snapshot.displayAuthorized !== "boolean") {
    errors.push(`${label}.displayAuthorized must be boolean.`);
  }
  if (snapshot.publicationTotal !== expectedPublicationCount) {
    errors.push(`${label}.publicationTotal must equal feed.js count ${expectedPublicationCount}.`);
  }
  if (!Number.isInteger(snapshot.coveredPublications)
      || snapshot.coveredPublications < 0
      || snapshot.coveredPublications > expectedPublicationCount) {
    errors.push(`${label}.coveredPublications must be within the catalogue size.`);
  }
  if (snapshot.yearBasis !== "Previous-year JCR: publication year Y uses JCR year Y-1.") {
    errors.push(`${label} must use the exact previous-year JCR basis.`);
  }
  if (snapshot.reason !== null
      && (typeof snapshot.reason !== "string" || !snapshot.reason.trim())) {
    errors.push(`${label}.reason must be null or nonempty text.`);
  }
  if (!snapshot.bandsByDoi
      || typeof snapshot.bandsByDoi !== "object"
      || Array.isArray(snapshot.bandsByDoi)) {
    errors.push(`${label}.bandsByDoi must be an object.`);
    return;
  }

  const allowedBands = new Set(["top1", "top5", "top10", "otherQ1", "q2", "q3", "q4"]);
  const entries = Object.entries(snapshot.bandsByDoi);
  for (const [doi, band] of entries) {
    if (doi !== normalizeDoi(doi) || !expectedDoiSet.has(doi)) {
      errors.push(`${label} contains a non-catalogue or non-normalized DOI key: ${doi}.`);
    }
    if (!allowedBands.has(band)) {
      errors.push(`${label} DOI ${doi} has an invalid derived band.`);
    }
  }
  if (entries.length !== snapshot.coveredPublications) {
    errors.push(`${label}.coveredPublications must equal the number of derived DOI bands.`);
  }

  if (snapshot.displayAuthorized !== true) {
    if (snapshot.status !== "unavailable"
        || snapshot.coveredPublications !== 0
        || entries.length !== 0
        || typeof snapshot.reason !== "string"
        || !snapshot.reason.trim()) {
      errors.push(`${label} must publish no DOI bands when per-publication display is unauthorized.`);
    }
  } else if (snapshot.status === "unavailable") {
    if (snapshot.coveredPublications !== 0
        || entries.length !== 0
        || typeof snapshot.reason !== "string"
        || !snapshot.reason.trim()) {
      errors.push(`${label} unavailable state must contain no DOI bands and explain why.`);
    }
  } else if (snapshot.status === "partial") {
    if (snapshot.coveredPublications <= 0
        || snapshot.coveredPublications >= expectedPublicationCount
        || typeof snapshot.reason !== "string"
        || !snapshot.reason.trim()) {
      errors.push(`${label} partial state must have positive incomplete coverage and a reason.`);
    }
  } else if (snapshot.status === "ok") {
    if (snapshot.coveredPublications !== expectedPublicationCount
        || snapshot.reason !== null) {
      errors.push(`${label} ok state must cover the full catalogue and have no reason.`);
    }
  }

  if (/rankingsByDoi|jcrYear|categor(?:y|ies)|categoryTotal|jifPercentile|impactFactor|"(?:rank|quartile|jif)"\s*:/i.test(
    JSON.stringify(snapshot)
  )) {
    errors.push(`${label} must not expose raw category, rank, percentile, quartile, or JIF values.`);
  }
}

for (const file of [...requiredPages, ...requiredRuntimeFiles]) {
  if (!await exists(path.join(siteRoot, file))) errors.push(`Missing required file: ${file}`);
}

const files = await listFiles(siteRoot);
const htmlFiles = files.filter((file) => /\.html$/i.test(file));
const jsFiles = files.filter((file) => /\.js$/i.test(file));
const cssFiles = files.filter((file) => /\.css$/i.test(file));

for (const file of htmlFiles) {
  const absolute = path.join(siteRoot, file);
  const html = await readFile(absolute, "utf8");
  const label = `${path.relative(repositoryRoot, siteRoot) || "."}/${file}`;

  if (!html.includes("<x-dc>")) errors.push(`${label}: missing <x-dc> runtime root.`);
  if (html.includes("{{") && !html.includes("data-dc-script")) {
    errors.push(`${label}: template expressions exist without a page data script.`);
  }
  if (!html.includes("support.js")) errors.push(`${label}: missing local runtime.`);
  if (!/<script\s+src=["']\.\/vendor\/react\.production\.min\.js["']><\/script>\s*<script\s+src=["']\.\/vendor\/react-dom\.production\.min\.js["']><\/script>\s*<script\s+src=["']\.\/support\.js["']><\/script>/i.test(html)) {
    errors.push(`${label}: React, ReactDOM, and the local runtime must load synchronously in dependency order.`);
  }
  if (!html.includes("_ds_bundle.js")) errors.push(`${label}: missing design-system bundle.`);
  if (!html.includes("styles.css")) errors.push(`${label}: missing design-system stylesheet.`);
  if (!/<html\b[^>]*\blang=["']en["']/i.test(html)) errors.push(`${label}: missing English document language.`);
  if (!/<title>[^<]+<\/title>/i.test(html)) errors.push(`${label}: missing page title.`);
  if (!/<meta\b[^>]*name=["']description["']/i.test(html)) errors.push(`${label}: missing meta description.`);
  if (!/<link\b[^>]*rel=["']canonical["']/i.test(html)) errors.push(`${label}: missing canonical URL.`);
  if (!/<meta\b[^>]*property=["']og:title["']/i.test(html)) errors.push(`${label}: missing Open Graph metadata.`);

  const inlineDataScripts = [...html.matchAll(/<script\b[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/gi)];
  if (html.includes("data-dc-script") && inlineDataScripts.length === 0) errors.push(`${label}: unclosed page data script.`);
  for (const match of inlineDataScripts) {
    const result = spawnSync(process.execPath, ["--check", "-"], { input: match[1], encoding: "utf8" });
    if (result.status !== 0) errors.push(`${label}: inline data script syntax error\n${result.stderr.trim()}`);
  }

  const referencePattern = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(referencePattern)) {
    const reference = localReference(match[1]);
    if (!reference) continue;
    const target = reference.startsWith("/")
      ? path.join(siteRoot, reference.slice(1))
      : path.resolve(path.dirname(absolute), reference);
    if (!await exists(target)) {
      const siteRelativeTarget = path.relative(siteRoot, target).split(path.sep).join("/");
      const isBuildGeneratedLink = siteRoot === repositoryRoot
        && generatedBuildFileSet.has(siteRelativeTarget);
      if (!isBuildGeneratedLink) errors.push(`${label}: broken local reference ${match[1]}`);
    }
  }

  const primaryNav = (html.match(
    /<nav\b[^>]*class=["'][^"']*\bnav\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i
  ) || [])[1] || "";
  const linksToStatistics = [...primaryNav.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .some(([, href]) => {
      try {
        const target = new URL(href, "https://chung-research-group.github.io/");
        const normalizedPath = decodeURIComponent(target.pathname)
          .replace(/\/{2,}/g, "/")
          .toLowerCase();
        return normalizedPath === "/statistics.dc.html";
      } catch {
        return false;
      }
    });
  if (linksToStatistics) {
    errors.push(`${label}: primary navigation must not contain a Statistics link.`);
  }
}

for (const file of cssFiles) {
  const absolute = path.join(siteRoot, file);
  const css = await readFile(absolute, "utf8");
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const reference = localReference(match[1]);
    if (!reference) continue;
    const target = path.resolve(path.dirname(absolute), reference);
    if (!await exists(target)) errors.push(`${file}: broken CSS asset ${match[1]}`);
  }
}

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(siteRoot, file)], {
    encoding: "utf8"
  });
  if (result.status !== 0) errors.push(`${file}: JavaScript syntax error\n${result.stderr.trim()}`);
}

const indexHtml = await readFile(path.join(siteRoot, "index.html"), "utf8");
const publicationsHtml = await readFile(path.join(siteRoot, "Publications.dc.html"), "utf8");
const statisticsHtml = await readFile(path.join(siteRoot, "Statistics.dc.html"), "utf8");
const feedHtml = await readFile(path.join(siteRoot, "feed.js"), "utf8");
const peopleData = await readFile(path.join(siteRoot, "people-data.js"), "utf8");
const feedPublications = evaluateFeedPublications(
  feedHtml,
  `${path.relative(repositoryRoot, siteRoot) || "."}/feed.js`
);
const expectedPublicationFacts = deriveFeedPublicationFacts(
  feedPublications,
  new Date().getUTCFullYear()
);
const publicationBlock = (feedHtml.match(/const PUBS = \[([\s\S]*?)\n\];/) || [])[1] || "";
let publicationDois = [];
try {
  publicationDois = parseFeedDois(feedHtml);
} catch (error) {
  errors.push(`feed.js publication DOI parsing failed: ${error.message}`);
}
const publicationDoiSet = new Set(publicationDois);
if (publicationDoiSet.size !== publicationDois.length) {
  errors.push("feed.js contains duplicate publication DOIs.");
}
const publicationMetadataPath = path.join(siteRoot, "data/publication-metadata.json");
if (await exists(publicationMetadataPath)) {
  let metadata;
  try {
    metadata = JSON.parse(await readFile(publicationMetadataPath, "utf8"));
  } catch (error) {
    errors.push(`Publication metadata is not valid JSON: ${error.message}`);
  }

  if (metadata) {
    if (metadata.schemaVersion !== 3) {
      errors.push(`Publication metadata schemaVersion must be 3; found ${JSON.stringify(metadata.schemaVersion)}.`);
    }
    if (!Number.isFinite(Date.parse(metadata.snapshotUpdatedAt || ""))) {
      errors.push("Publication metadata snapshotUpdatedAt must be an ISO timestamp.");
    }
    if (!metadata.publications || typeof metadata.publications !== "object" || Array.isArray(metadata.publications)) {
      errors.push("Publication metadata must contain a publications object keyed by normalized DOI.");
    } else {
      const feedPublicationBlock = (feedHtml.match(/const PUBS = \[([\s\S]*?)\n\];/) || [])[1] || "";
      const feedDois = new Set(
        [...feedPublicationBlock.matchAll(/'(10\.[^']+)'/gi)]
          .map((match) => normalizeDoi(match[1]))
          .filter(Boolean)
      );
      for (const [key, record] of Object.entries(metadata.publications)) {
        const normalizedKey = normalizeDoi(key);
        if (!normalizedKey || key !== normalizedKey) {
          errors.push(`Publication metadata DOI key is not normalized: ${key}`);
        }
        if (!feedDois.has(normalizedKey)) {
          errors.push(`Publication metadata contains a DOI not present in feed.js: ${key}`);
        }
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          errors.push(`Publication metadata record must be an object: ${key}`);
          continue;
        }
        if (normalizeDoi(record.doi) !== normalizedKey) {
          errors.push(`Publication metadata record DOI does not match its key: ${key}`);
        }
        for (const source of ["semanticScholar", "openAlex", "googleScholar"]) {
          const citationCount = record[source]?.citationCount;
          if (citationCount !== undefined && (
            typeof citationCount !== "number"
            || !Number.isFinite(citationCount)
            || citationCount < 0
          )) {
            errors.push(`${key}: ${source}.citationCount must be a nonnegative finite number.`);
          }
        }
        if (record.googleScholar) {
          if (!Number.isInteger(record.googleScholar.citationCount)) {
            errors.push(`${key}: googleScholar.citationCount must be an integer.`);
          }
          if (typeof record.googleScholar.title !== "string" || !record.googleScholar.title.trim()) {
            errors.push(`${key}: googleScholar.title must be a nonempty string.`);
          }
          if (typeof record.googleScholar.citationId !== "string"
              || !record.googleScholar.citationId.startsWith(`${metadata.googleScholar?.profileId}:`)) {
            errors.push(`${key}: googleScholar.citationId must belong to the configured profile.`);
          }
          if (!["fresh", "stale"].includes(record.sourceFreshness?.googleScholar?.status)) {
            errors.push(`${key}: googleScholar data must include fresh or stale sourceFreshness.`);
          }
        }
        const influentialCitationCount = record.semanticScholar?.influentialCitationCount;
        if (influentialCitationCount !== undefined && (
          typeof influentialCitationCount !== "number"
          || !Number.isFinite(influentialCitationCount)
          || influentialCitationCount < 0
        )) {
          errors.push(`${key}: semanticScholar.influentialCitationCount must be a nonnegative finite number.`);
        }
        if (record.openAlex?.countsByYear !== undefined) {
          if (!Array.isArray(record.openAlex.countsByYear)) {
            errors.push(`${key}: openAlex.countsByYear must be an array.`);
          } else {
            for (const annual of record.openAlex.countsByYear) {
              if (
                typeof annual?.citationCount !== "number"
                || !Number.isFinite(annual.citationCount)
                || annual.citationCount < 0
              ) {
                errors.push(`${key}: OpenAlex annual citation counts must be nonnegative finite numbers.`);
                break;
              }
            }
          }
        }
      }
    }
    for (const totalName of [
      "publications",
      "semanticScholarCitations",
      "openAlexCitations",
      "googleScholarCitations"
    ]) {
      const value = metadata.totals?.[totalName];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        errors.push(`Publication metadata totals.${totalName} must be a nonnegative finite number.`);
      }
    }
    const scholarSource = metadata.sources?.googleScholar;
    if (!scholarSource || !["ok", "partial", "stale"].includes(scholarSource.status)) {
      errors.push("Publication metadata sources.googleScholar must have ok, partial, or stale status.");
    }
    if (scholarSource?.status !== "ok" && !scholarSource?.reason) {
      errors.push("A non-ok Google Scholar source must include a reason.");
    }
    for (const countName of ["matched", "freshMatched"]) {
      if (!Number.isInteger(scholarSource?.[countName]) || scholarSource[countName] < 0) {
        errors.push(`Publication metadata sources.googleScholar.${countName} must be a nonnegative integer.`);
      }
    }
    if (!metadata.googleScholar?.profileId
        || metadata.googleScholar.profileId !== scholarSource?.profileId) {
      errors.push("Google Scholar profile identity must be present and consistent.");
    }
    if (metadata.googleScholar?.citations?.all !== metadata.totals?.googleScholarCitations) {
      errors.push("Google Scholar profile and aggregate citation totals must match.");
    }
  }
}

const publicationBibliographyPath = path.join(siteRoot, "data/publication-bibliography.json");
let publicationBibliography = null;
if (await exists(publicationBibliographyPath)) {
  try {
    publicationBibliography = JSON.parse(await readFile(publicationBibliographyPath, "utf8"));
  } catch (error) {
    errors.push(`Publication bibliography is not valid JSON: ${error.message}`);
  }

  if (publicationBibliography) {
    const bibliography = publicationBibliography;
    if (bibliography.schemaVersion !== 1) {
      errors.push(`Publication bibliography schemaVersion must be 1; found ${JSON.stringify(bibliography.schemaVersion)}.`);
    }
    if (!Number.isFinite(Date.parse(bibliography.snapshotUpdatedAt || ""))) {
      errors.push("Publication bibliography snapshotUpdatedAt must be an ISO timestamp.");
    }
    if (!bibliography.publications
        || typeof bibliography.publications !== "object"
        || Array.isArray(bibliography.publications)) {
      errors.push("Publication bibliography must contain a publications object keyed by normalized DOI.");
    } else {
      const bibliographyDois = Object.keys(bibliography.publications);
      const normalizedBibliographyDois = bibliographyDois.map(normalizeDoi);
      const bibliographyDoiSet = new Set(normalizedBibliographyDois);
      for (const doi of bibliographyDois) {
        if (!doi || doi !== normalizeDoi(doi)) {
          errors.push(`Publication bibliography DOI key is not normalized: ${doi}`);
        }
      }
      const missingBibliographyDois = [...publicationDoiSet]
        .filter((doi) => !bibliographyDoiSet.has(doi));
      const extraBibliographyDois = [...bibliographyDoiSet]
        .filter((doi) => !publicationDoiSet.has(doi));
      if (missingBibliographyDois.length || extraBibliographyDois.length) {
        errors.push(
          "Publication bibliography DOI set must exactly match feed.js"
          + `${missingBibliographyDois.length ? `; missing: ${missingBibliographyDois.join(", ")}` : ""}`
          + `${extraBibliographyDois.length ? `; extra: ${extraBibliographyDois.join(", ")}` : ""}.`
        );
      }

      for (const [doi, record] of Object.entries(bibliography.publications)) {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          errors.push(`Publication bibliography record must be an object: ${doi}`);
          continue;
        }
        if (normalizeDoi(record.doi) !== doi) {
          errors.push(`Publication bibliography record DOI does not match its key: ${doi}`);
        }
        if (record.type !== "article") {
          errors.push(`${doi}: bibliography type must be article.`);
        }
        for (const field of ["title", "journal"]) {
          if (typeof record[field] !== "string" || !record[field].trim()) {
            errors.push(`${doi}: bibliography ${field} must be a nonempty string.`);
          }
        }
        for (const field of ["volume", "issue", "pages", "articleNumber", "publisher"]) {
          if (record[field] !== undefined
              && (typeof record[field] !== "string" || !record[field].trim())) {
            errors.push(`${doi}: bibliography ${field} must be a nonempty string when present.`);
          }
        }
        if (!Number.isInteger(record.year) || record.year < 1000 || record.year > 9999) {
          errors.push(`${doi}: bibliography year must be a four-digit integer.`);
        }
        if (!Array.isArray(record.authors) || record.authors.length === 0) {
          errors.push(`${doi}: bibliography authors must be a nonempty array.`);
        } else {
          for (const [index, author] of record.authors.entries()) {
            const hasLiteral = typeof author?.literal === "string" && author.literal.trim();
            const hasFamily = typeof author?.family === "string" && author.family.trim();
            if (!author || typeof author !== "object" || Array.isArray(author) || (!hasLiteral && !hasFamily)) {
              errors.push(`${doi}: bibliography author ${index + 1} must have family or literal name data.`);
            }
            const authorText = [author?.given, author?.family, author?.literal]
              .filter((value) => typeof value === "string")
              .join(" ");
            if (/\bet al\.|\*|#/i.test(authorText)) {
              errors.push(`${doi}: bibliography author ${index + 1} contains a display-only author marker.`);
            }
          }
        }
        if (!record.source
            || typeof record.source !== "object"
            || !["crossref", "doi-csl"].includes(record.source.provider)) {
          errors.push(`${doi}: bibliography source.provider must be crossref or doi-csl.`);
        }
        if (record.source?.retrievedAt !== undefined
            && !Number.isFinite(Date.parse(record.source.retrievedAt))) {
          errors.push(`${doi}: bibliography source.retrievedAt must be an ISO timestamp when present.`);
        }
      }
    }
  }
}

if (!publicationsHtml.includes("data/publication-metadata.json")) {
  errors.push("Publications page must load the static publication metadata snapshot.");
}
if (!publicationsHtml.includes("data/publication-jcr-bands.json")) {
  errors.push("Publications page must load the build-generated public per-publication JCR band snapshot.");
}
for (const [file, label] of [
  ["exports/publications/publications.bib", "BibTeX"],
  ["exports/publications/CITATION.cff", "CFF"]
]) {
  if (!publicationsHtml.includes(`href="${file}"`)) {
    errors.push(`Publications page must link to the generated ${label} export.`);
  }
}
if (!publicationsHtml.includes("Download BibTeX file of all publications")
    || !publicationsHtml.includes("Download CFF file of all publications")) {
  errors.push("Publication citation downloads must have descriptive accessible names.");
}
if (!statisticsHtml.includes("fetch('data/lab-statistics.json', { cache: 'no-store' })")) {
  errors.push("Statistics page must load the build-generated lab statistics snapshot without caching.");
}
for (const marker of [
  'data-screen-label="Lab Statistics"',
  "data-lab-statistics",
  "data-publications-by-year",
  "data-journal-distribution",
  "data-journal-highlights",
  "data-research-footprint",
  "data-citation-source-card",
  "data-citation-trend",
  "data-h-index-status",
  "data-impact-factor-status",
  "data-impact-factor-provenance",
  "data-coauthor-network",
  "data-top-collaborators",
  "data-team-composition",
  "data-statistics-status"
]) {
  if (!statisticsHtml.includes(marker)) {
    errors.push(`Statistics page is missing required rendering marker: ${marker}`);
  }
}
if (!statisticsHtml.includes(".statistics-bar-row:hover .statistics-bar-value")
    || !statisticsHtml.includes(".statistics-bar-row:focus-visible .statistics-bar-value")
    || (statisticsHtml.match(/class=["'][^"']*statistics-bar-row[^"']*["'][^>]*tabindex=["']0["']/g) || []).length !== 7
    || !statisticsHtml.includes("@media (hover:none)")) {
  errors.push("Statistics bar values must be available as hover and keyboard-focus tooltips.");
}
if (!/\.statistics-network\{[^}]*width:min\(100%,760px\)[^}]*margin:0 auto/.test(statisticsHtml)) {
  errors.push("Statistics coauthor network must use the compact centered viewport.");
}
if (!publicationsHtml.includes("data-publication-metadata-status")) {
  errors.push("Publications page must expose citation sources and metadata freshness.");
}
for (const retiredAggregateLabel of [
  "Publications · 논문",
  "Citations (Google Scholar)",
  "Citations (OpenAlex)",
  "Citations (Semantic Scholar)"
]) {
  if (publicationsHtml.includes(retiredAggregateLabel)) {
    errors.push(`Publications page must leave aggregate metrics to Statistics: ${retiredAggregateLabel}`);
  }
}
if (!publicationsHtml.includes("snapshotUpdatedAt")) {
  errors.push("Publications page must display freshness from metadata snapshotUpdatedAt.");
}
if (!publicationsHtml.includes("data-publication-enrichment")) {
  errors.push("Publications page must render static metadata fields or keywords.");
}
if (/<script\b[^>]*\bdata-props=["'][^"']*\bscholarCitations\b[^"']*["']/i.test(publicationsHtml)) {
  errors.push("Publications page must read Google Scholar citations from the metadata snapshot, not a hardcoded property.");
}
if (!publicationsHtml.includes("enrichment?.googleScholar?.citationCount")
    || !/hasGoogleScholarCount[\s\S]*hasOpenAlexCount[\s\S]*hasSemanticScholarCount/.test(publicationsHtml)) {
  errors.push("Publication cards must prefer per-paper Google Scholar citations before OpenAlex and Semantic Scholar.");
}
if (publicationsHtml.includes("data-publication-visual") || publicationsHtml.includes("data-publication-visual-image")) {
  errors.push("Publications page must keep artwork out of the compact bibliography layout.");
}
if (!publicationsHtml.includes("data-publication-jcr-band")
    || !publicationsHtml.includes("snapshot.displayAuthorized !== true")
    || !publicationsHtml.includes("jcrBandsByDoi")) {
  errors.push("Publication cards must fail closed and render only explicitly authorized derived JCR bands.");
}
if (!publicationsHtml.includes("publication-number")
    || !publicationsHtml.includes("publication-bibliography")) {
  errors.push("Publication cards must expose the number and bibliography columns.");
}
if (feedHtml.includes("journalCardPath") || feedHtml.includes("p.publicationVisual")) {
  errors.push("Publication feed must not construct retired publication artwork.");
}
if (publicationsHtml.includes("publication-visuals.js")) {
  errors.push("Publications page must not load the retired publication visual manifest.");
}
if (await exists(path.join(siteRoot, "publication-visuals.js"))
    || await exists(path.join(siteRoot, "images", "publications"))) {
  errors.push("Retired publication artwork code and assets must not be deployed.");
}
for (const forbiddenRuntimeMetadata of [
  "api.crossref.org",
  "api.semanticscholar.org",
  "api.openalex.org",
  "resolveDois"
]) {
  if (publicationsHtml.includes(forbiddenRuntimeMetadata)) {
    errors.push(`Publications page must not call metadata APIs at runtime: ${forbiddenRuntimeMetadata}`);
  }
}
const publicationThemes = ["Density Functional Theory", "Grand Canonical Monte Carlo", "Molecular Dynamics", "Enhanced Sampling", "Data Curation", "Machine Learning", "Large Language Models", "Infrastructure", "Material Characterization", "Techno-Economic Analysis", "Adsorption", "Diffusion", "Reaction", "Electrochemistry", "Reticular Materials", "Oxides", "Polymers", "Carbons", "Graphene Oxide", "Graphene Quantum Dots", "Zeolites", "Molecules", "Electrolytes", "Perovskites", "Membranes", "Chiller", "Cyclic Swing Adsorber", "Carbon Capture", "Hydrogen Storage", "Biogas Upgrading", "Carbon Monoxide Separation", "Natural Gas Sweetening", "Noble Gas Separation", "SF6/N2 Separation", "Olefin/Paraffin Separation", "Xylene Separation", "Alkane Isomer Separation", "Methane Storage", "Adsorption Cooling", "Secondary Battery", "Supercapacitor", "Organic Solvent Nanofiltration", "Organic Liquid Separation", "CO2 Conversion", "Catalysis", "Sensing", "Air Pollution Control", "Distillation", "Review"];
for (const theme of publicationThemes) {
  if (!publicationsHtml.includes(`'${theme}'`)) errors.push(`Publication taxonomy is missing: ${theme}`);
}
if (!publicationsHtml.includes("themeGroups") || !publicationsHtml.includes("p.tags")) {
  errors.push("Publication label rendering or filtering is missing.");
}
if (!/feed\.js\?v=[^"']+/.test(publicationsHtml)) {
  errors.push("Publication feed must use a cache-busting version query.");
}
if (!publicationsHtml.includes(".filter(Boolean)")) {
  errors.push("Publication rendering must tolerate stale or unknown cached labels.");
}
const topicBlock = (feedHtml.match(/const PUB_TOPICS = \{([\s\S]*?)\n\};/) || [])[1] || "";
const topicAssignments = [...topicBlock.matchAll(/'\d{2}':\s*\[/g)];
const publicationEntries = [...publicationBlock.matchAll(/\bF\('\d{2}'/g)];
if (topicAssignments.length !== publicationEntries.length) {
  errors.push(`Expected one explicit topic assignment per publication; found ${topicAssignments.length} assignments for ${publicationEntries.length} publications.`);
}
if (topicBlock.includes("'Process & Systems'")) errors.push("Deprecated Process & Systems publication label remains.");
if (topicBlock.includes("'Swing Adsorption'")) errors.push("Deprecated Swing Adsorption publication label remains.");
for (const deprecated of ["Device", "Gas Separation", "Energy Storage", "Membrane Separation", "Transport", "Statistical Mechanics", "2D", "DFT", "GCMC", "MD", "LLM", "Characterization"]) {
  if (topicBlock.includes(`'${deprecated}'`)) errors.push(`Deprecated generic publication label remains: ${deprecated}`);
}
const reviewAssignments = [...topicBlock.matchAll(/'(\d{2})':\s*\[([^\]]*'Review'[^\]]*)\]/g)];
if (!reviewAssignments.length || reviewAssignments.some(match => match[2].trim() !== "'Review'")) errors.push("Review publications must carry only the Review label.");
if (!feedHtml.includes("const REVIEW_TOPIC = { '72': 'Materials', '70': 'Applications', '48': 'Computation', '37': 'Computation', '21': 'Applications', '17': 'Materials' }")) {
  errors.push("Review publications must have explicit Computation, Materials, or Applications subcategories.");
}
if (!publicationsHtml.includes("sortByCount") || !publicationsHtml.includes("applicationSections")) {
  errors.push("Publication filters must sort by usage count and expose application subcategories.");
}
if (!publicationsHtml.includes("openGroups: ['Computation']") || !publicationsHtml.includes("applicationSections.map(section => section.title)") || !publicationsHtml.includes("Group::") || !publicationsHtml.includes("Section::Applications::") || publicationsHtml.includes("publication-filter-total")) {
  errors.push("Publication filters must support collapsed major and middle categories with aggregate selection.");
}
for (const color of ["#B4235A", "#A43E55", "#873E6E", "#6F4A58", "#4E2A84"]) {
  if (!publicationsHtml.includes(color)) errors.push(`Application filter subcategory color is missing: ${color}`);
}
for (const displayName of ["Xylene Isomer", "Alkane Isomer", "Noble Gases", "Organic Liquids", "Hydrogen", "Methane"]) {
  if (!publicationsHtml.includes(`'${displayName}'`)) errors.push(`Concise application filter name is missing: ${displayName}`);
}
if (!peopleData.includes("Master's Program, Graduate School of Data Science") || peopleData.includes("Graduate School of Data Science, Pusan National University 데이터사이언스 전문대학원")) {
  errors.push("Graduate program and education data are not normalized.");
}
if (!peopleData.includes("https://scholar.google.com/citations?user=2z24SzAAAAAJ&hl=en")) {
  errors.push("Chen Yu's Google Scholar profile is missing or incorrect.");
}
const joinUsHtml = await readFile(path.join(siteRoot, "Join Us.dc.html"), "utf8");
const peopleHtml = await readFile(path.join(siteRoot, "People.dc.html"), "utf8");
if (!joinUsHtml.includes("drygchung AT gmail DOT com")) {
  errors.push("Join Us professor email obfuscation is missing.");
}
if (!peopleHtml.includes("data-prof-pnu-email") || !peopleHtml.includes('href="mailto:&#100;&#114;&#121;&#103;&#99;&#104;&#117;&#110;&#103;&#64;&#112;&#117;&#115;&#97;&#110;&#46;&#97;&#99;&#46;&#107;&#114;"')) {
  errors.push("People professor email link is missing or incorrect.");
}
if (`${joinUsHtml}\n${peopleHtml}`.includes("drygchung@gmail.com") || peopleHtml.includes("drygchung@pusan.ac.kr")) {
  errors.push("Raw professor email remains exposed in published HTML.");
}
if ((joinUsHtml.match(/<a\s+data-prof-email\b/g) || []).length !== 2 || (joinUsHtml.match(/href="mailto:&#100;&#114;&#121;/g) || []).length !== 2) {
  errors.push("Join Us email links must be clickable without exposing the raw address in HTML.");
}
const designCss = await readFile(
  path.join(siteRoot, "ds/modernist-57044450-0faf-4c69-9e3d-613b0ce48058/styles.css"),
  "utf8"
);
if (!designCss.includes("family=Archivo") || !designCss.includes('--font-heading: "Archivo"')) {
  errors.push("Typography contract changed: Archivo font wiring is missing.");
}
if (!indexHtml.includes("data-hero-interactive") || !indexHtml.includes("requestAnimationFrame")) {
  errors.push("Homepage motion contract changed: interactive hero animation is missing.");
}
if (!indexHtml.includes("prefers-reduced-motion")) {
  errors.push("Homepage motion accessibility fallback is missing.");
}
const supportJs = await readFile(path.join(siteRoot, "support.js"), "utf8");
for (const runtime of ["vendor/react.production.min.js", "vendor/react-dom.production.min.js"]) {
  if (!supportJs.includes(`./${runtime}`) || !await exists(path.join(siteRoot, runtime))) errors.push(`Local browser runtime is missing: ${runtime}`);
}

const labStatisticsPath = path.join(siteRoot, generatedLabStatisticsFile);
const labStatisticsExists = await exists(labStatisticsPath);
if (siteRoot === repositoryRoot && labStatisticsExists) {
  errors.push(`${generatedLabStatisticsFile} is build-generated and must not be committed as source.`);
}
if (compareRoot || labStatisticsExists) {
  if (!labStatisticsExists) {
    errors.push(`Missing generated lab statistics snapshot: ${generatedLabStatisticsFile}`);
  } else {
    try {
      const labStatistics = JSON.parse(await readFile(labStatisticsPath, "utf8"));
      validateLabStatistics(
        labStatistics,
        expectedPublicationFacts,
        publicationBibliography
      );
    } catch (error) {
      errors.push(`Lab statistics snapshot is not valid JSON: ${error.message}`);
    }
  }
}

const publicationJcrBandsPath = path.join(siteRoot, generatedPublicationJcrBandsFile);
const publicationJcrBandsExists = await exists(publicationJcrBandsPath);
if (siteRoot === repositoryRoot && publicationJcrBandsExists) {
  errors.push(`${generatedPublicationJcrBandsFile} is build-generated and must not be committed as source.`);
}
if (compareRoot || publicationJcrBandsExists) {
  if (!publicationJcrBandsExists) {
    errors.push(`Missing generated publication JCR band snapshot: ${generatedPublicationJcrBandsFile}`);
  } else {
    try {
      validatePublicationJcrBands(
        JSON.parse(await readFile(publicationJcrBandsPath, "utf8")),
        expectedPublicationFacts.total,
        publicationDoiSet
      );
    } catch (error) {
      errors.push(`Publication JCR band snapshot is not valid JSON: ${error.message}`);
    }
  }
}

const citationExportPresence = await Promise.all(
  generatedPublicationCitationFiles.map((file) => exists(path.join(siteRoot, file)))
);
if (compareRoot || citationExportPresence.some(Boolean)) {
  for (const [index, file] of generatedPublicationCitationFiles.entries()) {
    if (!citationExportPresence[index]) errors.push(`Missing generated publication citation export: ${file}`);
  }
  if (citationExportPresence.every(Boolean)) {
    const [bibtex, cff] = await Promise.all(
      generatedPublicationCitationFiles.map((file) => readFile(path.join(siteRoot, file), "utf8"))
    );
    validatePublicationCitationExports(bibtex, cff, publicationDoiSet);
  }
}

if (compareRoot) {
  const sourceFiles = (await listFiles(compareRoot)).filter(publishedSourceFile);
  const builtFiles = files.filter((file) => file !== "site-manifest.json" && file !== ".nojekyll");
  const expectedFiles = sourceFiles.filter((file) => file !== ".nojekyll");
  const comparableBuiltFiles = builtFiles.filter(
    (file) => !generatedBuildFileSet.has(file)
  );
  if (JSON.stringify(comparableBuiltFiles) !== JSON.stringify(expectedFiles)) {
    errors.push("Built file set differs from the published source file set.");
  }
  const unexpectedCitationExports = builtFiles.filter(
    (file) => file.startsWith("exports/publications/")
      && !generatedCitationFileSet.has(file)
  );
  if (unexpectedCitationExports.length) {
    errors.push(`Unexpected generated publication citation exports: ${unexpectedCitationExports.join(", ")}`);
  }
  for (const file of expectedFiles) {
    const [source, built] = await Promise.all([
      readFile(path.join(compareRoot, file)),
      readFile(path.join(siteRoot, file))
    ]);
    if (sha256(source) !== sha256(built)) errors.push(`${file}: build changed published bytes.`);
  }
}

if (errors.length) {
  console.error(`Site validation failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`Validated ${htmlFiles.length} pages, ${jsFiles.length} scripts, and ${cssFiles.length} stylesheets.`);

import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generatePublicationCitationFiles } from "./publication-citations.mjs";
import {
  generateLabStatisticsFile,
  generatePublicationJcrBandsFile
} from "./lab-statistics.mjs";
import { rootFilePatterns, staticDirectories } from "./site-files.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repoRoot, "dist");

function isPublishedRootFile(name) {
  return rootFilePatterns.some((pattern) => pattern.test(name));
}

async function listFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child.split(path.sep).join("/"));
  }
  return files.sort();
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const rootEntries = await readdir(repoRoot, { withFileTypes: true });
const rootFiles = rootEntries
  .filter((entry) => entry.isFile() && isPublishedRootFile(entry.name))
  .map((entry) => entry.name)
  .sort();

for (const file of rootFiles) {
  await cp(path.join(repoRoot, file), path.join(outputRoot, file));
}

for (const directory of staticDirectories) {
  await cp(path.join(repoRoot, directory), path.join(outputRoot, directory), {
    recursive: true,
    force: true
  });
}

await generatePublicationCitationFiles({
  feedPath: path.join(repoRoot, "feed.js"),
  bibliographyPath: path.join(repoRoot, "data/publication-bibliography.json"),
  outputRoot
});

await generateLabStatisticsFile({
  feedPath: path.join(repoRoot, "feed.js"),
  metadataPath: path.join(repoRoot, "data/publication-metadata.json"),
  bibliographyPath: path.join(repoRoot, "data/publication-bibliography.json"),
  peoplePath: path.join(repoRoot, "people-data.js"),
  outputPath: path.join(outputRoot, "data/lab-statistics.json"),
  impactFactorJson: process.env.JOURNAL_IMPACT_FACTORS_JSON || null,
  currentYear: new Date().getUTCFullYear()
});

await generatePublicationJcrBandsFile({
  feedPath: path.join(repoRoot, "feed.js"),
  outputPath: path.join(outputRoot, "data/publication-jcr-bands.json"),
  impactFactorJson: process.env.JOURNAL_IMPACT_FACTORS_JSON || null
});

await writeFile(path.join(outputRoot, ".nojekyll"), "");

const manifest = {};
for (const file of await listFiles(outputRoot)) {
  if (file === "site-manifest.json") continue;
  const bytes = await readFile(path.join(outputRoot, file));
  manifest[file] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

await writeFile(
  path.join(outputRoot, "site-manifest.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2)}\n`
);

console.log(
  `Built ${Object.keys(manifest).length} site files in dist/, including `
  + "citation exports, the lab statistics snapshot, and the public "
  + "per-publication JCR band snapshot."
);


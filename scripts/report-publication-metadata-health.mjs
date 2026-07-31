import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { summarizePublicationMetadataHealth } from "./refresh-publication-metadata.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const metadataPath = path.resolve(
  process.env.PUBLICATION_METADATA_OUTPUT
    || path.join(repositoryRoot, "data", "publication-metadata.json")
);
const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const health = summarizePublicationMetadataHealth(metadata);
const cell = (value) => String(value ?? "—")
  .replaceAll("|", "\\|")
  .replaceAll("\r", " ")
  .replaceAll("\n", " ");
const rows = health.sourceRows.map((source) => (
  `| ${cell(source.label)} | ${cell(source.status)} | ${source.matched} `
  + `| ${source.freshMatched ?? "—"} | ${cell(source.contentUpdatedAt)} `
  + `| ${cell(source.provider)} | ${cell(source.reason)} |`
));
const summary = [
  "## Publication metadata source health",
  "",
  "| Source | Status | Matched | Fresh paper matches | Content updated | Provider | Reason |",
  "| --- | --- | ---: | ---: | --- | --- | --- |",
  ...rows,
  "",
  `Google Scholar profile metrics current: **${health.scholarProfileCurrent ? "yes" : "no"}**`,
  "",
  `Google Scholar per-paper refresh current: **${health.scholarPapersCurrent ? "yes" : "no"}**`,
  "",
  ...(health.warnings.length
    ? ["### Warnings", "", ...health.warnings.map(message => `- ${message}`), ""]
    : [])
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
}
console.log(summary);
if (process.env.GITHUB_ACTIONS === "true") {
  for (const warning of health.warnings) {
    const safeWarning = warning
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D")
      .replaceAll("\n", "%0A");
    console.log(`::warning title=Publication metadata source health::${safeWarning}`);
  }
}

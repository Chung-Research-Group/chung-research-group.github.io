import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TOPIC_GROUPS, candidateFromCrossref, normalizeDoi } from "./publication-bot.mjs";

export const GRAPHIC_WIDTH = 1200;
export const GRAPHIC_HEIGHT = 630;
export const GRAPHIC_SCHEMA_VERSION = 1;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

const GROUP_STYLES = Object.freeze({
  Computation: { foreground: "#1C4FA1", background: "#EAF1FB" },
  Physics: { foreground: "#00794A", background: "#E7F5EE" },
  Materials: { foreground: "#A86700", background: "#FFF3DC" },
  Systems: { foreground: "#006B73", background: "#E5F5F6" },
  Applications: { foreground: "#9B2948", background: "#FAEAF0" },
  Review: { foreground: "#4E2A84", background: "#F0EAF7" },
  Research: { foreground: "#5B6770", background: "#EEF1F3" }
});

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanText(value = "") {
  return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function wrapText(value, maximumCharacters, maximumLines) {
  const words = cleanText(value).split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maximumCharacters || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maximumLines - 1) break;
  }
  if (current && lines.length < maximumLines) lines.push(current);
  const consumed = lines.join(" ").length;
  if (consumed < cleanText(value).length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:\s]+$/g, "")}…`;
  }
  return lines;
}

function textLines(lines, {
  x,
  y,
  lineHeight,
  className,
  anchor = "start"
}) {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" class="${className}" text-anchor="${anchor}">${escapeXml(line)}</text>`
  )).join("");
}

export function graphicSlugForDoi(value) {
  const doi = normalizeDoi(value);
  if (!/^10\.\d{4,9}\/\S+$/i.test(doi)) throw new Error(`Invalid DOI for graphical abstract: ${value}`);
  return doi
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function graphicPathForDoi(doi) {
  return `images/publications/graphical-abstracts/${graphicSlugForDoi(doi)}.svg`;
}

export function groupPublicationTopics(topics = [], reviewTopic = "") {
  if (topics.includes("Review")) {
    return [{
      group: reviewTopic && GROUP_STYLES[reviewTopic] ? reviewTopic : "Review",
      labels: ["Review article"]
    }];
  }

  const grouped = [];
  for (const [group, labels] of Object.entries(TOPIC_GROUPS)) {
    const matches = labels.filter((label) => topics.includes(label));
    if (matches.length) grouped.push({ group, labels: matches.slice(0, 3) });
  }
  return grouped.length ? grouped : [{ group: "Research", labels: ["Scholarly publication"] }];
}

function groupIcon(group, centerX, centerY, color) {
  const common = `fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"`;
  if (group === "Computation") {
    return `<g ${common}><rect x="${centerX - 24}" y="${centerY - 20}" width="48" height="40" rx="6"/><path d="M${centerX - 14} ${centerY - 7}h28M${centerX - 14} ${centerY + 6}h18"/></g>`;
  }
  if (group === "Physics") {
    return `<g ${common}><path d="M${centerX - 26} ${centerY}c10-25 19-25 28 0s18 25 28 0"/><circle cx="${centerX - 28}" cy="${centerY}" r="4" fill="${color}" stroke="none"/><circle cx="${centerX + 30}" cy="${centerY}" r="4" fill="${color}" stroke="none"/></g>`;
  }
  if (group === "Materials") {
    const points = [
      [centerX, centerY - 27], [centerX + 24, centerY - 13], [centerX + 24, centerY + 14],
      [centerX, centerY + 28], [centerX - 24, centerY + 14], [centerX - 24, centerY - 13]
    ].map(([x, y]) => `${x},${y}`).join(" ");
    return `<g ${common}><polygon points="${points}"/><circle cx="${centerX}" cy="${centerY}" r="5" fill="${color}" stroke="none"/></g>`;
  }
  if (group === "Systems") {
    return `<g ${common}><path d="M${centerX - 25} ${centerY - 5}a27 27 0 0 1 45-15l8 9M${centerX + 28} ${centerY - 11}l-2-13M${centerX + 25} ${centerY + 5}a27 27 0 0 1-45 15l-8-9M${centerX - 28} ${centerY + 11}l2 13"/></g>`;
  }
  if (group === "Applications") {
    return `<g ${common}><circle cx="${centerX}" cy="${centerY}" r="27"/><circle cx="${centerX}" cy="${centerY}" r="15"/><circle cx="${centerX}" cy="${centerY}" r="4" fill="${color}" stroke="none"/></g>`;
  }
  if (group === "Review") {
    return `<g ${common}><path d="M${centerX - 22} ${centerY - 27}h33l13 13v41h-46z"/><path d="M${centerX + 11} ${centerY - 27}v14h13M${centerX - 12} ${centerY}h26M${centerX - 12} ${centerY + 12}h20"/></g>`;
  }
  return `<g ${common}><circle cx="${centerX}" cy="${centerY}" r="25"/><path d="M${centerX - 14} ${centerY}h28M${centerX} ${centerY - 14}v28"/></g>`;
}

export function renderGraphicalAbstractSvg(publication) {
  const doi = normalizeDoi(publication?.doi);
  const title = cleanText(publication?.title).slice(0, 500);
  const journal = cleanText(publication?.journal).slice(0, 180);
  const year = cleanText(publication?.year || (publication?.meta?.match(/\((\d{4})\)/) || [])[1]).slice(0, 4);
  const topics = Array.isArray(publication?.topics)
    ? [...new Set(publication.topics.map(cleanText).filter(Boolean))]
    : [];
  if (!doi || !title) throw new Error("Graphical abstract requires a DOI and title.");

  const stages = groupPublicationTopics(topics, publication?.reviewTopic).slice(0, 5);
  const titleLines = wrapText(title, 66, 3);
  const stageGap = 18;
  const stageAreaWidth = 1080;
  const stageWidth = Math.min(
    360,
    Math.floor((stageAreaWidth - stageGap * (stages.length - 1)) / stages.length)
  );
  const stageStartX = Math.floor((GRAPHIC_WIDTH - (stageWidth * stages.length + stageGap * (stages.length - 1))) / 2);
  const stageY = 245;
  const stageHeight = 220;

  const stageMarkup = stages.map((stage, index) => {
    const x = stageStartX + index * (stageWidth + stageGap);
    const style = GROUP_STYLES[stage.group] || GROUP_STYLES.Research;
    const centerX = x + stageWidth / 2;
    const labelLines = wrapText(stage.labels.join(" · "), Math.max(14, Math.floor(stageWidth / 10)), 4);
    const arrow = index === stages.length - 1
      ? ""
      : `<path d="M${x + stageWidth + 4} ${stageY + stageHeight / 2}h${stageGap - 8}" class="flow-arrow"/><path d="M${x + stageWidth + stageGap - 9} ${stageY + stageHeight / 2 - 6}l7 6-7 6" class="flow-arrow"/>`;
    return [
      `<g data-topic-group="${escapeXml(stage.group)}">`,
      `<rect x="${x}" y="${stageY}" width="${stageWidth}" height="${stageHeight}" rx="16" fill="${style.background}" stroke="${style.foreground}" stroke-width="2"/>`,
      groupIcon(stage.group, centerX, stageY + 58, style.foreground),
      `<text x="${centerX}" y="${stageY + 111}" class="stage-group" text-anchor="middle" fill="${style.foreground}">${escapeXml(stage.group)}</text>`,
      textLines(labelLines, {
        x: centerX,
        y: stageY + 143,
        lineHeight: 24,
        className: "stage-label",
        anchor: "middle"
      }),
      "</g>",
      arrow
    ].join("");
  }).join("");

  const description = [
    `Auto-generated visual summary for ${title}.`,
    ...stages.map((stage) => `${stage.group}: ${stage.labels.join(", ")}`)
  ].join(" ");
  const footerLeft = [journal, year].filter(Boolean).join(" · ");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${GRAPHIC_WIDTH}" height="${GRAPHIC_HEIGHT}" viewBox="0 0 ${GRAPHIC_WIDTH} ${GRAPHIC_HEIGHT}" role="img" aria-labelledby="graphic-title graphic-description">`,
    `<title id="graphic-title">${escapeXml(title)}</title>`,
    `<desc id="graphic-description">${escapeXml(description)}</desc>`,
    "<style>",
    "text{font-family:Arial,Helvetica,sans-serif}.eyebrow{font-size:16px;font-weight:700;letter-spacing:2.2px}.title{font-size:32px;font-weight:700;fill:#12233F}.stage-group{font-size:17px;font-weight:700;letter-spacing:1px}.stage-label{font-size:17px;font-weight:600;fill:#24364F}.footer{font-size:16px;font-weight:600;fill:#53657C}.flow-arrow{fill:none;stroke:#7A889B;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}",
    "</style>",
    `<rect width="${GRAPHIC_WIDTH}" height="${GRAPHIC_HEIGHT}" fill="#F8FAFD"/>`,
    `<rect width="${GRAPHIC_WIDTH}" height="12" fill="#005BAA"/>`,
    `<text x="60" y="54" class="eyebrow" fill="#005BAA">CHUNG RESEARCH GROUP · VISUAL ABSTRACT</text>`,
    textLines(titleLines, { x: 60, y: 98, lineHeight: 39, className: "title" }),
    stageMarkup,
    `<line x1="60" y1="520" x2="1140" y2="520" stroke="#D7DFE9" stroke-width="2"/>`,
    `<text x="60" y="558" class="footer">${escapeXml(footerLeft)}</text>`,
    `<text x="1140" y="558" class="footer" text-anchor="end">${escapeXml(doi)}</text>`,
    `<text x="60" y="595" class="footer">Generated from DOI metadata and reviewed website labels · not the publisher&apos;s official graphical abstract</text>`,
    "</svg>"
  ].join("");

  validateGraphicalAbstractSvg(svg);
  return svg;
}

export function validateGraphicalAbstractSvg(svg) {
  const value = String(svg || "");
  if (!value.startsWith("<svg ") || !value.endsWith("</svg>")) {
    throw new Error("Graphical abstract is not a complete SVG document.");
  }
  if (!value.includes(`width="${GRAPHIC_WIDTH}"`) || !value.includes(`height="${GRAPHIC_HEIGHT}"`)) {
    throw new Error("Graphical abstract dimensions are invalid.");
  }
  if (Buffer.byteLength(value, "utf8") > 100_000) {
    throw new Error("Graphical abstract exceeds the 100 KB safety limit.");
  }
  if (/<(?:script|foreignObject|image|iframe|object|embed)\b|\bon[a-z]+\s*=|\bhref\s*=|url\s*\(/i.test(value)) {
    throw new Error("Graphical abstract contains forbidden active or remote content.");
  }
  return true;
}

export async function loadFeedForGraphics(feedPath = path.join(repositoryRoot, "feed.js")) {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    await import(`${pathToFileURL(feedPath).href}?graphics=${Date.now()}`);
    return (globalThis.window.MTAP_FEED?.PUBS || []).map((publication) => ({
      no: String(publication.no || ""),
      title: publication.title,
      journal: publication.journal,
      meta: publication.meta,
      year: publication.year,
      doi: normalizeDoi(publication.doi),
      topics: [...(publication.topics || [])],
      reviewTopic: publication.reviewTopic || ""
    }));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

export async function writePublicationGraphic(publication, outputRoot) {
  const relativePath = graphicPathForDoi(publication.doi);
  const absolutePath = path.join(outputRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const svg = renderGraphicalAbstractSvg(publication);
  await writeFile(absolutePath, `${svg}\n`, "utf8");
  return { doi: normalizeDoi(publication.doi), path: relativePath, bytes: Buffer.byteLength(svg, "utf8") + 1 };
}

export async function generateAllPublicationGraphics({
  feedPath = path.join(repositoryRoot, "feed.js"),
  outputRoot = path.join(repositoryRoot, "dist")
} = {}) {
  const publications = (await loadFeedForGraphics(feedPath)).filter((publication) => publication.doi);
  const generated = [];
  for (const publication of publications) {
    generated.push(await writePublicationGraphic(publication, outputRoot));
  }
  return generated;
}

async function publicationFromDoi(doi) {
  const normalized = normalizeDoi(doi);
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(normalized)}`, {
    headers: { "user-agent": "ChungResearchPublicationGraphic/1.0" }
  });
  if (!response.ok) throw new Error(`Crossref DOI lookup failed: ${response.status}`);
  const payload = await response.json();
  return candidateFromCrossref(payload.message || {});
}

async function cli() {
  const args = process.argv.slice(2);
  const doiIndex = args.indexOf("--doi");
  const outputIndex = args.indexOf("--output-root");
  const outputRoot = path.resolve(
    repositoryRoot,
    outputIndex >= 0 ? args[outputIndex + 1] : "dist"
  );
  if (doiIndex >= 0) {
    const publication = await publicationFromDoi(args[doiIndex + 1]);
    const result = await writePublicationGraphic(publication, outputRoot);
    console.log(`Generated ${result.path} from DOI ${result.doi}.`);
    return;
  }
  const generated = await generateAllPublicationGraphics({ outputRoot });
  console.log(`Generated ${generated.length} publication graphical abstracts.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}


import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const JOURNAL_CARD_WIDTH = 960;
export const JOURNAL_CARD_HEIGHT = 540;
export const MAX_REVIEWED_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_REVIEWED_ASSET_DIMENSION = 10_000;
export const MAX_REVIEWED_ASSET_PIXELS = 24_000_000;
export const MIN_REVIEWED_ASSET_DIMENSION = 64;
export const AVAILABILITY_STATUSES = Object.freeze([
  "reviewed-article-graphic",
  "reviewed-journal-mark",
  "neutral-original-title-card"
]);

const rightsRules = Object.freeze({
  "author-provided": Object.freeze({ providerMetadata: true }),
  "user-provided": Object.freeze({ providerMetadata: true }),
  "cc-by-3.0": Object.freeze({
    rightsUrl: "https://creativecommons.org/licenses/by/3.0/"
  }),
  "cc-by-4.0": Object.freeze({
    rightsUrl: "https://creativecommons.org/licenses/by/4.0/"
  }),
  "elsevier-author-reuse": Object.freeze({
    rightsUrlPattern: /^https:\/\/(?:www\.)?elsevier\.com\/about\/policies-and-standards\/copyright\/?$/i
  }),
  "rsc-author-reuse": Object.freeze({
    rightsUrlPattern: /^https:\/\/(?:www\.)?rsc\.org\/.+\/permissions\/?$/i
  })
});
export const ALLOWED_RIGHTS_BASES = Object.freeze(Object.keys(rightsRules));

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

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

function wrapText(value, maximumCharacters = 30, maximumLines = 4) {
  const words = cleanText(value).split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || candidate.length <= maximumCharacters) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maximumLines - 1) break;
  }
  if (current && lines.length < maximumLines) lines.push(current);
  return lines;
}

function textLines(lines, { x, y, lineHeight, className }) {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" class="${className}">${escapeXml(line)}</text>`
  )).join("");
}

export function journalCardPath(journalKey) {
  const slug = String(journalKey || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`Invalid journal key: ${journalKey}`);
  return `images/publications/journal-cards/${slug}.svg`;
}

export function renderJournalTitleCard({ journalKey, journal, journalUrl }) {
  const title = cleanText(journal);
  if (!title) throw new Error(`Missing journal title for ${journalKey}.`);
  const titleLines = wrapText(title, 30, 4);
  const titleStart = 218 - ((titleLines.length - 1) * 44);
  const destination = String(journalUrl || "");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${JOURNAL_CARD_WIDTH}" height="${JOURNAL_CARD_HEIGHT}" viewBox="0 0 ${JOURNAL_CARD_WIDTH} ${JOURNAL_CARD_HEIGHT}" role="img" aria-labelledby="title description">`,
    `<title id="title">${escapeXml(title)} publication venue</title>`,
    `<desc id="description">An original Chung Research Group text card used when reviewed article artwork is unavailable. It is not publisher artwork.</desc>`,
    "<style>",
    "text{font-family:Arial,Helvetica,sans-serif}.eyebrow{font-size:22px;font-weight:700;letter-spacing:4px}.journal{font-size:54px;font-weight:800}.notice{font-size:17px;font-weight:700;letter-spacing:2px}.url{font-size:18px;font-weight:600}",
    "</style>",
    `<rect width="${JOURNAL_CARD_WIDTH}" height="${JOURNAL_CARD_HEIGHT}" fill="#F4F7FB"/>`,
    `<rect width="20" height="${JOURNAL_CARD_HEIGHT}" fill="#005BAA"/>`,
    `<rect x="62" y="64" width="78" height="8" fill="#FFA500"/>`,
    `<text x="62" y="116" class="eyebrow" fill="#005BAA">PUBLICATION VENUE</text>`,
    textLines(titleLines, { x: 62, y: titleStart, lineHeight: 62, className: "journal" }),
    `<line x1="62" y1="424" x2="898" y2="424" stroke="#C9D5E4" stroke-width="2"/>`,
    `<text x="62" y="468" class="notice" fill="#5B6770">CHUNG RESEARCH GROUP TITLE CARD - NOT PUBLISHER ARTWORK</text>`,
    destination ? `<text x="62" y="506" class="url" fill="#53657C">${escapeXml(destination)}</text>` : "",
    "</svg>"
  ].join("");

  validateSafeSvg(svg);
  return svg;
}

export function validateSafeSvg(svg) {
  const value = String(svg || "");
  if (!value.startsWith("<svg ") || !value.endsWith("</svg>")) {
    throw new Error("Publication visual is not a complete SVG document.");
  }
  if (Buffer.byteLength(value, "utf8") > 100_000) {
    throw new Error("Publication visual exceeds the 100 KB SVG safety limit.");
  }
  if (/<(?:script|foreignObject|image|iframe|object|embed)\b|\bon[a-z]+\s*=|\bhref\s*=|url\s*\(/i.test(value)) {
    throw new Error("Publication visual contains forbidden active or remote content.");
  }
  return true;
}

export function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) throw new Error("PNG is truncated.");
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Publication visual is not a PNG.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

export function jpegDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) throw new Error("JPEG is truncated.");
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Publication visual is not a JPEG.");
  }

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf
  ]);
  const standaloneMarkers = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error("JPEG contains malformed marker data.");
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) throw new Error("JPEG is truncated.");

    const marker = buffer[offset];
    offset += 1;
    if (marker === 0x00) throw new Error("JPEG contains malformed marker data.");
    if (marker === 0xd9 || marker === 0xda) {
      throw new Error("JPEG does not contain a start-of-frame marker.");
    }
    if (standaloneMarkers.has(marker)) continue;
    if (marker === 0xd8) throw new Error("JPEG contains an unexpected start-of-image marker.");
    if (offset + 2 > buffer.length) throw new Error("JPEG is truncated.");

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) throw new Error("JPEG contains an invalid segment length.");
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > buffer.length) throw new Error("JPEG is truncated.");

    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 8) throw new Error("JPEG start-of-frame segment is truncated.");
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      const componentCount = buffer[offset + 7];
      if (componentCount === 0 || segmentLength !== 8 + (3 * componentCount)) {
        throw new Error("JPEG start-of-frame segment has invalid component data.");
      }
      if (width === 0 || height === 0) {
        throw new Error("JPEG has invalid dimensions.");
      }
      return { width, height };
    }

    offset = segmentEnd;
  }

  throw new Error("JPEG does not contain a start-of-frame marker.");
}

function isIsoDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function requireIsoDate(value, location) {
  if (!isIsoDate(value)) throw new Error(`${location} must be a valid ISO date (YYYY-MM-DD).`);
}

function requireHttpsUrl(value, location) {
  const text = String(value || "");
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${location} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${location} must be a valid HTTPS URL.`);
  return text;
}

export function inspectRasterAsset(buffer, extension, location = "publication visual") {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error(`${location} is empty or unreadable.`);
  }
  if (buffer.length > MAX_REVIEWED_ASSET_BYTES) {
    throw new Error(`${location} exceeds the ${MAX_REVIEWED_ASSET_BYTES} byte safety limit.`);
  }

  const normalizedExtension = String(extension || "").toLowerCase();
  let dimensions;
  let mimeType;
  if (normalizedExtension === ".png") {
    dimensions = pngDimensions(buffer);
    mimeType = "image/png";
  } else if (normalizedExtension === ".jpg" || normalizedExtension === ".jpeg") {
    dimensions = jpegDimensions(buffer);
    mimeType = "image/jpeg";
  } else {
    throw new Error(`${location} must use a PNG or JPEG extension.`);
  }

  if (
    dimensions.width < MIN_REVIEWED_ASSET_DIMENSION
    || dimensions.height < MIN_REVIEWED_ASSET_DIMENSION
    || dimensions.width > MAX_REVIEWED_ASSET_DIMENSION
    || dimensions.height > MAX_REVIEWED_ASSET_DIMENSION
    || dimensions.width * dimensions.height > MAX_REVIEWED_ASSET_PIXELS
  ) {
    throw new Error(`${location} dimensions exceed the reviewed raster safety bounds.`);
  }

  return {
    ...dimensions,
    mimeType,
    bytes: buffer.length
  };
}

let publicationVisualLoadSequence = 0;

export async function loadPublicationVisualState({
  visualsPath = path.join(repositoryRoot, "publication-visuals.js"),
  feedPath = path.join(repositoryRoot, "feed.js")
} = {}) {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const loadId = `${Date.now()}-${++publicationVisualLoadSequence}`;
    await import(`${pathToFileURL(visualsPath).href}?visuals=${loadId}`);
    await import(`${pathToFileURL(feedPath).href}?feed=${loadId}`);
    return {
      manifest: globalThis.window.MTAP_PUBLICATION_VISUALS,
      publications: (globalThis.window.MTAP_FEED?.PUBS || []).map((publication) => ({
        ...publication,
        publicationVisual: { ...publication.publicationVisual }
      }))
    };
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

export function validateReviewedVisualMetadata(
  visual,
  location,
  { expectedKind, manifestReviewedAt } = {}
) {
  const allowedKinds = new Set(["publisher-graphical-abstract", "journal-mark"]);
  if (!visual || !allowedKinds.has(visual.kind)) {
    throw new Error(`${location} has an unsupported visual kind.`);
  }
  if (expectedKind && visual.kind !== expectedKind) {
    throw new Error(`${location} must use visual kind ${expectedKind}.`);
  }

  const expectedDirectory = visual.kind === "publisher-graphical-abstract"
    ? "article-graphics"
    : "journal-marks";
  const boundedAssetPattern = new RegExp(
    `^images/publications/${expectedDirectory}/[a-z0-9._-]+\\.(?:png|jpe?g)$`,
    "i"
  );
  if (!boundedAssetPattern.test(visual.src || "")) {
    throw new Error(`${location} must reference a bounded local ${expectedDirectory} PNG or JPEG asset.`);
  }
  if (
    !Number.isInteger(visual.width)
    || !Number.isInteger(visual.height)
    || visual.width < MIN_REVIEWED_ASSET_DIMENSION
    || visual.height < MIN_REVIEWED_ASSET_DIMENSION
    || visual.width > MAX_REVIEWED_ASSET_DIMENSION
    || visual.height > MAX_REVIEWED_ASSET_DIMENSION
    || visual.width * visual.height > MAX_REVIEWED_ASSET_PIXELS
  ) {
    throw new Error(`${location} has dimensions outside the reviewed raster safety bounds.`);
  }
  requireHttpsUrl(visual.sourcePage, `${location} sourcePage`);

  for (const required of ["alt", "label", "credit", "attribution", "rightsBasis", "reviewedAt", "checksumSha256"]) {
    if (!String(visual[required] || "").trim()) throw new Error(`${location} is missing ${required}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(visual.checksumSha256)) {
    throw new Error(`${location} has an invalid SHA-256 checksum.`);
  }

  requireIsoDate(visual.reviewedAt, `${location} reviewedAt`);
  if (manifestReviewedAt && visual.reviewedAt > manifestReviewedAt) {
    throw new Error(`${location} was reviewed after the manifest review date.`);
  }

  const rightsRule = rightsRules[visual.rightsBasis];
  if (!rightsRule) {
    throw new Error(`${location} has unsupported rightsBasis ${visual.rightsBasis}.`);
  }
  if (rightsRule.rightsUrl) {
    requireHttpsUrl(visual.rightsUrl, `${location} rightsUrl`);
    if (visual.rightsUrl !== rightsRule.rightsUrl) {
      throw new Error(`${location} rightsUrl does not match ${visual.rightsBasis}.`);
    }
  } else if (rightsRule.rightsUrlPattern) {
    requireHttpsUrl(visual.rightsUrl, `${location} rightsUrl`);
    if (!rightsRule.rightsUrlPattern.test(visual.rightsUrl)) {
      throw new Error(`${location} rightsUrl does not match ${visual.rightsBasis}.`);
    }
  } else if (visual.rightsUrl) {
    requireHttpsUrl(visual.rightsUrl, `${location} rightsUrl`);
  }

  if (rightsRule.providerMetadata) {
    if (!String(visual.providedBy || "").trim()) throw new Error(`${location} is missing providedBy.`);
    requireIsoDate(visual.providedAt, `${location} providedAt`);
    if (visual.providedAt > visual.reviewedAt) {
      throw new Error(`${location} was reviewed before the asset was provided.`);
    }
  }
}

export async function validatePublicationVisuals({
  repository = repositoryRoot,
  visualsPath = path.join(repository, "publication-visuals.js"),
  feedPath = path.join(repository, "feed.js")
} = {}) {
  const { manifest, publications } = await loadPublicationVisualState({ visualsPath, feedPath });
  if (manifest?.schemaVersion !== 3) throw new Error("Publication visual manifest schema is unsupported.");
  requireIsoDate(manifest.reviewedAt, "Publication visual manifest reviewedAt");
  if (!String(manifest.reviewedBy || "").trim()) {
    throw new Error("Publication visual manifest is missing reviewedBy.");
  }

  const publicationDois = publications.map((publication) => String(publication.doi || "").toLowerCase());
  if (publicationDois.some((doi) => !doi)) {
    throw new Error("Every feed publication must have a DOI to resolve a deterministic visual outcome.");
  }
  const dois = new Set(publicationDois);
  if (dois.size !== publications.length) {
    throw new Error("Feed publication DOI values must be unique.");
  }

  for (const [doi, visual] of Object.entries(manifest.byDoi || {})) {
    if (doi !== doi.toLowerCase() || !dois.has(doi)) {
      throw new Error(`Reviewed publication visual has an unknown DOI: ${doi}`);
    }
    validateReviewedVisualMetadata(visual, `DOI ${doi}`, {
      expectedKind: "publisher-graphical-abstract",
      manifestReviewedAt: manifest.reviewedAt
    });
  }

  const journalKeys = new Set(publications.map((publication) => publication.journalKey));
  const journalIdentityByKey = new Map();
  const journalKeyByFallbackPath = new Map();
  for (const publication of publications) {
    const identity = cleanText(publication.journal)
      .toLowerCase()
      .replace(/^the\s+/, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const existingIdentity = journalIdentityByKey.get(publication.journalKey);
    if (existingIdentity && existingIdentity !== identity) {
      throw new Error(
        `Journal key ${publication.journalKey} is shared by different publication venues.`
      );
    }
    journalIdentityByKey.set(publication.journalKey, identity);

    const fallbackPath = journalCardPath(publication.journalKey);
    const existingKey = journalKeyByFallbackPath.get(fallbackPath);
    if (existingKey && existingKey !== publication.journalKey) {
      throw new Error(
        `Journal keys ${existingKey} and ${publication.journalKey} resolve to the same fallback card.`
      );
    }
    journalKeyByFallbackPath.set(fallbackPath, publication.journalKey);
  }
  for (const [journalKey, visual] of Object.entries(manifest.byJournal || {})) {
    if (!journalKeys.has(journalKey)) {
      throw new Error(`Reviewed journal visual has an unknown journal key: ${journalKey}`);
    }
    validateReviewedVisualMetadata(visual, `journal ${journalKey}`, {
      expectedKind: "journal-mark",
      manifestReviewedAt: manifest.reviewedAt
    });
  }

  const availabilityByDoi = {};
  for (const publication of publications) {
    const visual = publication.publicationVisual;
    if (!visual?.src || !visual?.kind || !visual?.alt || !visual?.sourcePage || !visual?.attribution) {
      throw new Error(`Publication ${publication.no} does not resolve to a complete visual.`);
    }
    const doi = String(publication.doi).toLowerCase();
    const reviewed = manifest.byDoi?.[doi];
    const journalMark = manifest.byJournal?.[publication.journalKey];
    const expected = reviewed
      ? {
          kind: "publisher-graphical-abstract",
          src: reviewed.src,
          availabilityStatus: "reviewed-article-graphic"
        }
      : journalMark
        ? {
            kind: "journal-mark",
            src: journalMark.src,
            availabilityStatus: "reviewed-journal-mark"
          }
        : {
            kind: "journal-title-card",
            src: journalCardPath(publication.journalKey),
            availabilityStatus: "neutral-original-title-card"
          };
    if (
      visual.kind !== expected.kind
      || visual.src !== expected.src
      || visual.availabilityStatus !== expected.availabilityStatus
    ) {
      throw new Error(`Publication ${publication.no} has a non-deterministic visual outcome.`);
    }
    if (!AVAILABILITY_STATUSES.includes(visual.availabilityStatus)) {
      throw new Error(`Publication ${publication.no} has an unsupported availability status.`);
    }

    const expectedFallback = journalCardPath(publication.journalKey);
    if (
      visual.fallbackSrc !== expectedFallback
      || visual.fallbackWidth !== JOURNAL_CARD_WIDTH
      || visual.fallbackHeight !== JOURNAL_CARD_HEIGHT
      || visual.fallbackAvailabilityStatus !== "neutral-original-title-card"
      || !String(visual.fallbackAlt || "").includes(publication.journal)
      || /^https?:/i.test(visual.fallbackSrc)
    ) {
      throw new Error(`Publication ${publication.no} does not define a safe local title-card fallback.`);
    }
    requireHttpsUrl(
      visual.fallbackSourcePage,
      `Publication ${publication.no} fallbackSourcePage`
    );

    availabilityByDoi[doi] = Object.freeze({
      publicationNumber: publication.no,
      journalKey: publication.journalKey,
      status: expected.availabilityStatus,
      kind: expected.kind,
      src: expected.src
    });
  }
  if (Object.keys(availabilityByDoi).length !== publications.length) {
    throw new Error("Publication visual availability does not cover every feed DOI.");
  }

  for (const [location, visual] of [
    ...Object.entries(manifest.byDoi || {}).map(([doi, entry]) => [`DOI ${doi}`, entry]),
    ...Object.entries(manifest.byJournal || {}).map(([key, entry]) => [`journal ${key}`, entry])
  ]) {
    const bytes = await readFile(path.join(repository, ...visual.src.split("/")));
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== visual.checksumSha256) throw new Error(`${location} checksum does not match its local asset.`);
    const extension = path.extname(visual.src).toLowerCase();
    const asset = inspectRasterAsset(bytes, extension, location);
    if (asset.width !== visual.width || asset.height !== visual.height) {
      throw new Error(`${location} dimensions do not match its local ${asset.mimeType}.`);
    }
  }

  return {
    manifest,
    publications,
    availabilityByDoi: Object.freeze(availabilityByDoi)
  };
}

export async function generateJournalTitleCards({
  outputRoot = path.join(repositoryRoot, "dist"),
  visualsPath = path.join(repositoryRoot, "publication-visuals.js"),
  feedPath = path.join(repositoryRoot, "feed.js")
} = {}) {
  const { publications } = await validatePublicationVisuals({
    repository: repositoryRoot,
    visualsPath,
    feedPath
  });
  const fallbackJournals = new Map();
  for (const publication of publications) {
    if (!fallbackJournals.has(publication.journalKey)) {
      fallbackJournals.set(publication.journalKey, {
        journalKey: publication.journalKey,
        journal: publication.journal,
        journalUrl: publication.publicationVisual.fallbackSourcePage
      });
    }
  }

  const generated = [];
  for (const journal of [...fallbackJournals.values()].sort((a, b) => a.journalKey.localeCompare(b.journalKey))) {
    const relativePath = journalCardPath(journal.journalKey);
    const absolutePath = path.join(outputRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const svg = renderJournalTitleCard(journal);
    await writeFile(absolutePath, `${svg}\n`, "utf8");
    generated.push({
      journalKey: journal.journalKey,
      path: relativePath,
      bytes: Buffer.byteLength(svg, "utf8") + 1
    });
  }
  return generated;
}

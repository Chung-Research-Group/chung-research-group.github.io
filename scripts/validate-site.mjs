import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  requiredPages,
  requiredRuntimeFiles,
  rootFilePatterns,
  staticDirectories
} from "./site-files.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const compareFlag = args.indexOf("--compare-source");
const siteRoot = path.resolve(repositoryRoot, rootFlag >= 0 ? args[rootFlag + 1] : ".");
const compareRoot = compareFlag >= 0 ? path.resolve(repositoryRoot, args[compareFlag + 1]) : null;
const errors = [];

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
    if (!await exists(target)) errors.push(`${label}: broken local reference ${match[1]}`);
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
const feedHtml = await readFile(path.join(siteRoot, "feed.js"), "utf8");
const peopleData = await readFile(path.join(siteRoot, "people-data.js"), "utf8");
const publicationThemes = ["DFT", "GCMC", "MD", "Data Curation", "Machine Learning", "LLM", "Infrastructure", "Characterization", "Adsorption", "Transport", "Reaction", "Statistical Mechanics", "Electrochemistry", "Techno-Economic Analysis", "Swing Adsorption", "Device", "2D", "Reticular Materials", "Oxides", "Polymers", "Carbons", "Zeolites", "Molecules", "Electrolytes", "Perovskites", "Membranes", "Review"];
for (const theme of publicationThemes) {
  if (!publicationsHtml.includes(`'${theme}'`)) errors.push(`Publication taxonomy is missing: ${theme}`);
}
if (!publicationsHtml.includes("themeGroups") || !publicationsHtml.includes("p.tags")) {
  errors.push("Publication label rendering or filtering is missing.");
}
const topicBlock = (feedHtml.match(/const PUB_TOPICS = \{([\s\S]*?)\n\};/) || [])[1] || "";
const topicAssignments = [...topicBlock.matchAll(/'\d{2}':\s*\[/g)];
const publicationBlock = (feedHtml.match(/const PUBS = \\[([\\s\\S]*?)\\n\\];/) || [])[1] || "";
const publicationEntries = [...publicationBlock.matchAll(/\\bF\\('\\d{2}'/g)];
if (topicAssignments.length !== publicationEntries.length) {
  errors.push(`Expected one explicit topic assignment per publication; found ${topicAssignments.length} assignments for ${publicationEntries.length} publications.`);
}
if (topicBlock.includes("'Process & Systems'")) errors.push("Deprecated Process & Systems publication label remains.");
const reviewAssignments = [...topicBlock.matchAll(/'(\d{2})':\s*\[([^\]]*'Review'[^\]]*)\]/g)];
if (!reviewAssignments.length || reviewAssignments.some(match => match[2].trim() !== "'Review'")) errors.push("Review publications must carry only the Review label.");
if (!peopleData.includes("Master's Program, Graduate School of Data Science") || peopleData.includes("Graduate School of Data Science, Pusan National University 데이터사이언스 전문대학원")) {
  errors.push("Graduate program and education data are not normalized.");
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

if (compareRoot) {
  const sourceFiles = (await listFiles(compareRoot)).filter(publishedSourceFile);
  const builtFiles = files.filter((file) => file !== "site-manifest.json" && file !== ".nojekyll");
  const expectedFiles = sourceFiles.filter((file) => file !== ".nojekyll");
  if (JSON.stringify(builtFiles) !== JSON.stringify(expectedFiles)) {
    errors.push("Built file set differs from the published source file set.");
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

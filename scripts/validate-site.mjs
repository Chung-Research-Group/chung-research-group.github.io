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
const publicationBlock = (feedHtml.match(/const PUBS = \[([\s\S]*?)\n\];/) || [])[1] || "";
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
if (!publicationsHtml.includes("openGroups: ['Computation']") || !publicationsHtml.includes("applicationSections.map(section => section.title)") || !publicationsHtml.includes("Group::") || !publicationsHtml.includes("Section::Applications::") || !publicationsHtml.includes("publication-filter-total")) {
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
if (!peopleData.includes("https://scholar.google.com/citations?user=2z24SzAAAAJ")) {
  errors.push("Chen Yu's Google Scholar profile is missing or incorrect.");
}
const joinUsHtml = await readFile(path.join(siteRoot, "Join Us.dc.html"), "utf8");
const peopleHtml = await readFile(path.join(siteRoot, "People.dc.html"), "utf8");
if (![joinUsHtml, peopleHtml].every(html => html.includes("drygchung AT gmail DOT com"))) {
  errors.push("Professor email obfuscation is missing.");
}
if (`${joinUsHtml}\n${peopleHtml}`.includes("drygchung@gmail.com")) {
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

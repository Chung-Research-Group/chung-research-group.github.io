import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { generateJcrInputRequirementsFile } from './lab-statistics.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const outputPath = path.resolve(
  repositoryRoot,
  process.argv[2] || 'jcr-input-requirements.json'
);
const requirements = await generateJcrInputRequirementsFile({
  feedPath: path.join(repositoryRoot, 'feed.js'),
  outputPath
});

console.log(
  `Wrote ${requirements.publicationTotal} DOI/JCR-year requirements to ${outputPath}.`
);

import path from 'node:path';
import process from 'node:process';

import { generateJcrInputRequirementsFile } from './lab-statistics.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
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

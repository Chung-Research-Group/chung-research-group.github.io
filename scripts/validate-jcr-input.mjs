import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateLicensedJcrInputFile } from './lab-statistics.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..');
const args = process.argv.slice(2);
const inputArgument = args.shift();
let compactOutputArgument = null;
const usage =
  'Usage: npm run jcr:validate -- <private-input.json> [--compact-output <private-output.json>]';

if (!inputArgument || inputArgument.startsWith('-')) {
  throw new TypeError(usage);
}

while (args.length) {
  const option = args.shift();
  if (option !== '--compact-output' || compactOutputArgument !== null) {
    throw new TypeError(usage);
  }
  compactOutputArgument = args.shift();
  if (!compactOutputArgument) {
    throw new TypeError('--compact-output requires a path.');
  }
}

const inputPath = path.resolve(process.cwd(), inputArgument);
const compactOutputPath = compactOutputArgument
  ? path.resolve(process.cwd(), compactOutputArgument)
  : null;
const summary = await validateLicensedJcrInputFile({
  feedPath: path.join(repositoryRoot, 'feed.js'),
  inputPath,
  compactOutputPath
});

console.log('Licensed JCR/JIF input is valid.');
console.log(`Catalogue publications: ${summary.publicationTotal}`);
console.log(`JIF records: ${summary.factorRecords}`);
console.log(`JCR ranking records: ${summary.rankingRecords}`);
console.log(
  `Compact GitHub secret size: ${summary.compactBytes}/${summary.maxSecretBytes} bytes`
);
if (compactOutputPath) {
  console.log(`Wrote compact private JSON to ${compactOutputPath}.`);
}

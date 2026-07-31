import path from 'node:path';
import process from 'node:process';

import { validateLicensedJcrInputFile } from './lab-statistics.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const inputArgument = args.shift();
let compactOutputArgument = null;

while (args.length) {
  const option = args.shift();
  if (option !== '--compact-output' || compactOutputArgument !== null) {
    throw new TypeError(
      'Usage: npm run jcr:validate -- <private-input.json> [--compact-output <private-output.json>]'
    );
  }
  compactOutputArgument = args.shift();
  if (!compactOutputArgument) {
    throw new TypeError('--compact-output requires a path.');
  }
}

if (!inputArgument) {
  throw new TypeError(
    'Usage: npm run jcr:validate -- <private-input.json> [--compact-output <private-output.json>]'
  );
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

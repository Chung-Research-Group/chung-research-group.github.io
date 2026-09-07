import { readFile, writeFile } from 'node:fs/promises';
import '../assets/mof-renderer.js';

const model = JSON.parse(await readFile(new URL('../data/irmof-1.json', import.meta.url), 'utf8'));
const number = value => value.toFixed(3);
const shapes = globalThis.MofRenderer.project(model, 750, 500).map(p => {
  if (p.kind === 'bond') return `<path d="M${number(p.x)} ${number(p.y)}L${number(p.x2)} ${number(p.y2)}" stroke="${p.color}" stroke-width="${number(p.width)}" stroke-linecap="round"/>`;
  return `<circle cx="${number(p.x)}" cy="${number(p.y)}" r="${number(p.r)}" fill="${p.color}"/><circle cx="${number(p.x - p.r * .25)}" cy="${number(p.y - p.r * .3)}" r="${number(p.r * .33)}" fill="white" opacity=".45"/>`;
});
await writeFile(new URL('../images/irmof-1.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 500" role="img" aria-labelledby="title desc"><title id="title">MOF-5 / IRMOF-1</title><desc id="desc">CIF-derived zinc–oxygen nodes and organic linkers. Hydrogen atoms omitted. RASPA2 structure; see data/irmof-1-provenance.md.</desc>${shapes.join('')}</svg>\n`);
console.log(`Rendered ${model.atoms.length} atoms and ${model.bonds.length} bonds from the verified CIF.`);

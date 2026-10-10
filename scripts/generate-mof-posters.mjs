// Static fallback uses exactly the same projection and coordinates as the canvas.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import '../assets/mof-pore-renderer.js';
const gallery = JSON.parse(await readFile(new URL('../data/mof-gallery.json', import.meta.url), 'utf8'));
const directory = new URL('../images/mofs/', import.meta.url);
await mkdir(directory, { recursive: true });
const n = value => value.toFixed(3);
for (const model of gallery.models) {
  const projected = MofRenderer.project(model, 750, 500);
  const gradients = [...new Set(projected.filter(p => p.kind === 'atom').map(p => p.color))].map(color =>
    `<radialGradient id="sphere-${color.slice(1)}" cx="50%" cy="50%" r="50%" fx="34%" fy="30%">${MofRenderer.sphereStops(color).map((stop, i) => `<stop offset="${[0, .3, .65, 1][i]}" stop-color="${stop}"/>`).join('')}</radialGradient>`).join('');
  const shapes = projected.map(p => {
    if (p.kind === 'bond' || p.kind === 'cell') return `<path d="M${n(p.x)} ${n(p.y)}L${n(p.x2)} ${n(p.y2)}" stroke="${p.color}" stroke-width="${n(p.width)}" stroke-linecap="round" opacity="${p.opacity}"/>`;
    if (p.kind === 'label') return `<text x="${n(p.x)}" y="${n(p.y)}" fill="${p.color}" stroke="#f2f2f2" stroke-width="3" stroke-linejoin="round" paint-order="stroke" font-size="12" font-style="italic" font-family="system-ui,sans-serif" text-anchor="middle" dominant-baseline="central">${p.text}</text>`;
    return `<circle opacity="${p.opacity}" cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.r)}" fill="url(#sphere-${p.color.slice(1)})"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 500" width="750" height="500" role="img" aria-labelledby="title desc"><title id="title">${model.name} periodic supercell and pore connectivity</title><desc id="desc">${model.name} crystal structure shown as a pore-facing periodic supercell.</desc><defs>${gradients}</defs>${shapes}</svg>\n`;
  await writeFile(new URL(`${model.id}.svg`, directory), svg);
  console.log(`${model.name}: ${model.atoms.length} displayed atoms, supercell boundary`);
}

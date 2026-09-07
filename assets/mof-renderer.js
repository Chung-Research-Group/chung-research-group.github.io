/* Coordinate-based projection shared by the live canvas and the static SVG.
   Atom positions come from the attributed CIF, never from decorative geometry. */
(() => {
  'use strict';
  const colors = { Zn: '#2879b8', O: '#c75a57', C: '#657786' };
  const radii = { Zn: 0.68, O: 0.43, C: 0.32 };
  function project(model, width, height, angle = 0.38) {
    const cx = Math.cos(-0.24), sx = Math.sin(-0.24);
    const cy = Math.cos(angle), sy = Math.sin(angle);
    const extent = Math.max(...model.atoms.map(a => Math.hypot(...a.slice(1))));
    const scale = Math.min(width, height) * 0.43 / extent;
    const points = model.atoms.map(([element, x, y, z]) => {
      const rx = x * cy + z * sy, rz = -x * sy + z * cy;
      const ry = y * cx - rz * sx, depth = y * sx + rz * cx;
      return { x: width / 2 + rx * scale, y: height / 2 - ry * scale, z: depth,
        r: Math.max(1.35, radii[element] * scale), color: colors[element] };
    });
    const shapes = [];
    for (const [i, j] of model.bonds) {
      const a = points[i], b = points[j];
      // Short segments sort correctly against atoms at different depths.
      for (let part = 0; part < 4; part++) {
        const t = part / 4, u = (part + 1) / 4;
        shapes.push({ kind: 'bond', x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
          x2: a.x + (b.x - a.x) * u, y2: a.y + (b.y - a.y) * u,
          z: a.z + (b.z - a.z) * (t + u) / 2,
          width: Math.max(1, scale * 0.16), color: part < 2 ? a.color : b.color });
      }
    }
    shapes.push(...points.map(point => ({ kind: 'atom', ...point })));
    return shapes.sort((a, b) => a.z - b.z);
  }
  function draw(ctx, model, width, height, angle) {
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    for (const p of project(model, width, height, angle)) {
      if (p.kind === 'bond') {
        ctx.strokeStyle = p.color; ctx.lineWidth = p.width;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.beginPath(); ctx.arc(p.x - p.r * .25, p.y - p.r * .3, p.r * .33, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  globalThis.MofRenderer = { project, draw };
})();

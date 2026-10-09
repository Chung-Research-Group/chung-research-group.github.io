/* CIF-derived atoms, periodic bond segments and actual lattice vectors.
   All catalog structures share the same physical angstrom-to-pixel scale. */
(() => {
  'use strict';
  const colors = { Cu: '#b77a49', Zn: '#2879b8', Mg: '#58a17c', Zr: '#8064ad',
    O: '#c75a57', N: '#436fb7', C: '#657786' };
  const radii = { Cu: .65, Zn: .64, Mg: .60, Zr: .70, O: .40, N: .35, C: .30 };
  const prepared = new WeakMap();
  const catalogs = new WeakMap();
  const cameraTilt = .60;
  function geometry(model) {
    if (prepared.has(model)) return prepared.get(model);
    const vectors = model.cell_vectors;
    const corners = Array.from({ length: 8 }, (_, i) => [0, 1, 2].map(d =>
      vectors.reduce((sum, v, axis) => sum + (((i >> axis) & 1) - .5) * v[d], 0)));
    const edges = [];
    for (let i = 0; i < 8; i++) for (let axis = 0; axis < 3; axis++) {
      if (!(i & (1 << axis))) edges.push([i, i | (1 << axis)]);
    }
    const extent = Math.max(...corners.map(p => Math.hypot(...p)),
      ...model.atoms.map(a => Math.hypot(...a.slice(1)) + (radii[a[0]] || .35)));
    const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
    const normalize = v => { const length = Math.hypot(...v); return v.map(x => x / length); };
    const c = normalize(vectors[2]);
    const a = normalize(vectors[0].map((x, i) => x - dot(vectors[0], c) * c[i]));
    const b = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]];
    // Orthonormal camera coordinates preserve every real lattice angle and length.
    const basis = [a, b, c];
    let envelopeX = 0, envelopeY = 0;
    function include(p, radius = 0) {
      const [x, y, z] = basis.map(v => dot(v, p)), rho = Math.hypot(x, y);
      // Exact maxima over a full c-axis revolution, before screen scaling.
      envelopeX = Math.max(envelopeX, rho + radius);
      envelopeY = Math.max(envelopeY, Math.cos(cameraTilt) * rho + Math.sin(cameraTilt) * Math.abs(z) + radius);
    }
    corners.forEach(p => include(p));
    model.atoms.forEach(([element, ...p]) => include(p, radii[element] || .35));
    const value = { corners, edges, extent, basis, envelopeX, envelopeY };
    prepared.set(model, value);
    return value;
  }
  function chooseModel(models, random = Math.random) {
    return models[Math.min(models.length - 1, Math.floor(random() * models.length))];
  }
  function viewScale(model, width, height) {
    const models = globalThis.MOF_MODELS?.length ? globalThis.MOF_MODELS : [model];
    let bounds = catalogs.get(models);
    if (!bounds) {
      bounds = { x: Math.max(...models.map(m => geometry(m).envelopeX)),
        y: Math.max(...models.map(m => geometry(m).envelopeY)) };
      catalogs.set(models, bounds);
    }
    const padding = Math.min(24, Math.min(width, height) * .2);
    // Every MOF uses the same fixed pixels/angstrom at the same viewport size.
    return Math.max(.001, Math.min((width - 2 * padding) / (2 * bounds.x),
      (height - 2 * padding) / (2 * bounds.y)));
  }
  function project(model, width, height, angle = .38) {
    const { corners, edges, basis } = geometry(model);
    const cx = Math.cos(cameraTilt), sx = Math.sin(cameraTilt);
    const cy = Math.cos(angle), sy = Math.sin(angle);
    function rotate(p) {
      const [x, y, z] = basis.map(v => v.reduce((sum, x, i) => sum + x * p[i], 0));
      const rx = x * cy - y * sy, ry = x * sy + y * cy;
      // Orbit about lattice c; keep an oblique view instead of turning channels edge-on.
      return { x: rx, y: ry * cx - z * sx, z: ry * sx + z * cx };
    }
    const rawCorners = corners.map(rotate);
    const rawAtoms = model.atoms.map(([element, ...p]) => ({ ...rotate(p), element }));
    const scale = viewScale(model, width, height);
    function screen(p) {
      return { x: width / 2 + p.x * scale,
        y: height / 2 - p.y * scale, z: p.z };
    }
    const point = p => screen(rotate(p));
    const points = rawAtoms.map(p => ({ ...screen(p),
      r: Math.max(.95, (radii[p.element] || .35) * scale), color: colors[p.element] || '#657786' }));
    const cell = rawCorners.map(screen), shapes = [];
    function segment(a, b, kind, color, lineWidth, parts, extra = {}) {
      for (let part = 0; part < parts; part++) {
        const t = part / parts, u = (part + 1) / parts;
        shapes.push({ kind, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
          x2: a.x + (b.x - a.x) * u, y2: a.y + (b.y - a.y) * u,
          z: a.z + (b.z - a.z) * (t + u) / 2, color, width: lineWidth, ...extra });
      }
    }
    for (const [i, j] of edges) {
      const back = (cell[i].z + cell[j].z) < 0;
      segment(cell[i], cell[j], 'cell', '#52718d', 1.25, 4,
        { alpha: back ? .38 : .78, dashed: back });
    }
    for (const [element, ...p] of model.bond_segments) {
      segment(point(p.slice(0, 3)), point(p.slice(3)), 'bond',
        colors[element] || '#657786', Math.max(.85, scale * .14), 2);
    }
    shapes.push(...points.map(p => ({ kind: 'atom', ...p })));
    shapes.sort((a, b) => a.z - b.z);
    // Lattice directions stay attached to their own edges, including oblique cells.
    for (let axis = 0; axis < 3; axis++) {
      const a = cell[0], b = cell[1 << axis];
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      const dx = x - width / 2, dy = y - height / 2, length = Math.hypot(dx, dy) || 1;
      shapes.push({ kind: 'label', x: x + dx / length * 12,
        y: y + dy / length * 12, text: 'abc'[axis], color: '#52718d' });
    }
    return shapes;
  }
  function draw(ctx, model, width, height, angle) {
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    for (const p of project(model, width, height, angle)) {
      ctx.globalAlpha = p.alpha ?? 1;
      if (p.kind === 'bond' || p.kind === 'cell') {
        ctx.setLineDash(p.dashed ? [3, 4] : []);
        ctx.strokeStyle = p.color; ctx.lineWidth = p.width;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke();
      } else if (p.kind === 'label') {
        ctx.fillStyle = p.color; ctx.font = 'italic 13px Archivo, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.beginPath(); ctx.arc(p.x - p.r * .25, p.y - p.r * .3, p.r * .33, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }
  function toSvg(model, width = 750, height = 500, angle = .38) {
    const escape = text => String(text).replace(/[&<>"']/g, ch =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);
    const number = n => n.toFixed(3);
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img"><title>${escape(model.name)}</title><desc>Full crystallographic unit cell with periodic bonds. Hydrogen atoms omitted.</desc>`];
    for (const p of project(model, width, height, angle)) {
      if (p.kind === 'cell' || p.kind === 'bond') {
        parts.push(`<path d="M${number(p.x)} ${number(p.y)}L${number(p.x2)} ${number(p.y2)}" stroke="${p.color}" stroke-width="${number(p.width)}" stroke-linecap="round" opacity="${p.alpha ?? 1}"${p.dashed ? ' stroke-dasharray="3 4"' : ''}/>`);
      } else if (p.kind === 'label') {
        parts.push(`<text x="${number(p.x)}" y="${number(p.y)}" fill="${p.color}" font-family="sans-serif" font-size="13" font-style="italic" text-anchor="middle" dominant-baseline="middle">${p.text}</text>`);
      } else {
        parts.push(`<circle cx="${number(p.x)}" cy="${number(p.y)}" r="${number(p.r)}" fill="${p.color}"/><circle cx="${number(p.x - p.r * .25)}" cy="${number(p.y - p.r * .3)}" r="${number(p.r * .33)}" fill="white" opacity=".45"/>`);
      }
    }
    return parts.join('') + '</svg>';
  }
  globalThis.MofRenderer = { project, draw, toSvg, geometry, chooseModel, viewScale };
})();

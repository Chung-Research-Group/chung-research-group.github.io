/* Coordinate-based projection shared by the live canvas and the static SVG.
   Atom positions come from the attributed CIF, never from decorative geometry. */
(() => {
  'use strict';
  const colors = { Zn: '#2c80b5', Cu: '#c27c50', Mg: '#63957a', Zr: '#248e9b',
    O: '#cc514e', N: '#7564a5', C: '#405c70' };
  const radii = { Zn: .65, Cu: .63, Mg: .63, Zr: .72, O: .36, N: .34, C: .27 };
  const extents = new WeakMap(), bases = new WeakMap();
  const sprites = new Map(), palettes = new Map();
  function mix(color, target, fraction) {
    const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const a = channels(color), b = channels(target);
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * fraction).toString(16).padStart(2, '0')).join('');
  }
  function sphereStops(color) {
    if (!palettes.has(color)) palettes.set(color, [mix(color, '#ffffff', .65),
      mix(color, '#ffffff', .25), color, mix(color, '#132c3c', .65)]);
    return palettes.get(color);
  }
  function sphereSprite(ctx, color, radius) {
    const key = `${color}:${radius.toFixed(3)}`;
    if (!sprites.has(key)) {
      if (sprites.size > 128) sprites.clear();
      const size = Math.ceil((radius + 1) * 4);
      const image = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(size, size)
        : ctx.canvas.ownerDocument.createElement('canvas');
      image.width = image.height = size;
      const paint = image.getContext('2d');
      paint.setTransform(2, 0, 0, 2, size / 2, size / 2);
      const gradient = paint.createRadialGradient(-radius * .32, -radius * .4, 0, 0, 0, radius);
      sphereStops(color).forEach((stop, i) => gradient.addColorStop([0, .3, .65, 1][i], stop));
      paint.fillStyle = gradient; paint.beginPath(); paint.arc(0, 0, radius, 0, Math.PI * 2); paint.fill();
      sprites.set(key, { image, size: size / 2 });
    }
    return sprites.get(key);
  }
  function project(model, width, height, angle = model.display_view?.initial_yaw ?? 0) {
    if (!bases.has(model)) {
      const cell = model.cell_vectors || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
      const normalize = a => { const length = Math.hypot(...a); return a.map(v => v / length); };
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const front = normalize(model.display_view?.front || cell[2]);
      const upHint = normalize(model.display_view?.up || cell[1]);
      const component = dot(upHint, front);
      const up = normalize(upHint.map((value, i) => value - component * front[i]));
      const right = normalize(cross(up, front));
      bases.set(model, { up, right, front, dot });
    }
    const { up, right, front, dot } = bases.get(model);
    // Face the channel with a fixed screen-up direction. No pitch or roll.
    const cx = 1, sx = 0;
    const cy = Math.cos(angle), sy = Math.sin(angle);
    if (!extents.has(model)) {
      const positions = [...model.atoms.map(a => a.slice(1, 4)), ...(model.cell_vertices || [])];
      extents.set(model, {
        horizontal: Math.max(...positions.map(p => Math.hypot(dot(p, right), dot(p, front)))),
        vertical: Math.max(...positions.map(p => Math.abs(dot(p, up))))
      });
    }
    const extent = extents.get(model);
    const scale = Math.min(width * .43 / extent.horizontal, height * .39 / extent.vertical);
    const transform = ([x, y, z]) => {
      const p = [x, y, z], horizontal = dot(p, right), vertical = dot(p, up), forward = dot(p, front);
      const rx = horizontal * cy + forward * sy, rz = -horizontal * sy + forward * cy;
      const ry = vertical * cx - rz * sx, depth = vertical * sx + rz * cx;
      return { x: width / 2 + rx * scale, y: height / 2 - ry * scale, z: depth };
    };
    const points = model.atoms.map(([element, x, y, z, image = 0]) => {
      const radius = radii[element] || .4;
      return { ...transform([x, y, z]), r: Math.max(1.05, Math.min(6, radius * scale)),
        color: colors[element] || '#405c70', opacity: image ? .24 : 1 };
    });
    const shapes = [];
    for (const [i, j, periodic = 0] of model.bonds) {
      const a = points[i], b = points[j];
      // Short segments sort correctly against atoms at different depths.
      for (let part = 0; part < 4; part++) {
        const t = part / 4, u = (part + 1) / 4;
        shapes.push({ kind: 'bond', x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
          x2: a.x + (b.x - a.x) * u, y2: a.y + (b.y - a.y) * u,
          z: a.z + (b.z - a.z) * (t + u) / 2,
          width: Math.max(.8, Math.min(2.2, scale * .16)), color: part < 2 ? a.color : b.color,
          opacity: periodic ? .28 : .95 });
      }
    }
    const corners = (model.cell_vertices || []).map(transform);
    for (const [i, j] of model.cell_edges || []) {
      const a = corners[i], b = corners[j];
      shapes.push({ kind: 'cell', x: a.x, y: a.y, x2: b.x, y2: b.y,
        z: (a.z + b.z) / 2, width: .85, color: '#547387', opacity: .55, cellEdge: [i, j] });
    }
    shapes.push(...points.map(point => ({ kind: 'atom', ...point })));
    shapes.sort((a, b) => a.z - b.z);
    return shapes;
  }
  function draw(ctx, model, width, height, angle) {
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    for (const p of project(model, width, height, angle)) {
      ctx.globalAlpha = p.opacity ?? 1;
      if (p.kind === 'bond' || p.kind === 'cell') {
        ctx.setLineDash([]);
        ctx.strokeStyle = p.kind === 'cell' ? p.color : sphereStops(p.color)[3]; ctx.lineWidth = p.width;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke();
        if (p.kind === 'bond') {
          ctx.strokeStyle = sphereStops(p.color)[1]; ctx.lineWidth = p.width * .42;
          ctx.stroke();
        }
      } else if (p.kind === 'label') {
        ctx.font = 'italic 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
      } else {
        const sprite = sphereSprite(ctx, p.color, p.r);
        ctx.drawImage(sprite.image, p.x - sprite.size / 2, p.y - sprite.size / 2, sprite.size, sprite.size);
      }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }
  globalThis.MofRenderer = { project, draw, sphereStops };
})();

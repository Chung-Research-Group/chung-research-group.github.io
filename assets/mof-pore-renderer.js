/* Coordinate-based projection shared by the live canvas and the static SVG.
   Atom positions come from the attributed CIF, never from decorative geometry. */
(() => {
  'use strict';
  const colors = { Zn: '#2c80b5', Cu: '#c27c50', Mg: '#63957a', Zr: '#248e9b',
    O: '#cc514e', N: '#7564a5', C: '#405c70' };
  const radii = { Zn: .65, Cu: .63, Mg: .63, Zr: .72, O: .36, N: .34, C: .27 };
  const bases = new WeakMap();
  const sprites = new Map(), palettes = new Map(), scenes = new WeakMap();
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
    // Reuse the scene and its projected coordinates at every animation step.
    // The orthographic pore-facing basis has no pitch or roll.
    if (!scenes.has(model)) {
      const point = (p, extra = {}) => ({
        _horizontal: dot(p, right), _vertical: dot(p, up), _forward: dot(p, front), ...extra
      });
      const points = model.atoms.map(([element, x, y, z, image = 0]) => point([x,y,z], {
        kind: 'atom', _radius: radii[element] || .4,
        color: colors[element] || '#405c70', opacity: image ? .24 : 1
      }));
      const corners = (model.cell_vertices || []).map(p => point(p));
      const shapes = [];
      for (const [i,j,periodic = 0] of model.bonds || []) {
        for (let part = 0; part < 4; part++) shapes.push({
          kind: 'bond', _a: points[i], _b: points[j], _t: part/4, _u: (part+1)/4,
          color: part < 2 ? points[i].color : points[j].color, opacity: periodic ? .28 : .95
        });
      }
      // Restore the already clipped source segments without artificial endpoint atoms.
      const helpers = [], endpoints = new Map();
      const key = p => p.map(value => value.toFixed(6)).join(',');
      model.atoms.forEach((atom,i) => endpoints.set(key(atom.slice(1,4)),points[i]));
      const endpoint = p => {
        const id = key(p);
        if (!endpoints.has(id)) { const projected = point(p); endpoints.set(id,projected); helpers.push(projected); }
        return endpoints.get(id);
      };
      for (const [element,...coordinates] of model.bond_segments || []) {
        const a = endpoint(coordinates.slice(0,3)), b = endpoint(coordinates.slice(3));
        // Each retained colored half is split in two for the same depth resolution.
        for (let part = 0; part < 2; part++) shapes.push({
          kind:'bond', _a:a, _b:b, _t:part/2, _u:(part+1)/2,
          color:colors[element] || '#405c70', opacity:.95
        });
      }
      for (const [i,j] of model.cell_edges || []) shapes.push({
        kind: 'cell', _a: corners[i], _b: corners[j], _t: 0, _u: 1,
        width: .85, color: '#547387', opacity: .55, cellEdge: [i,j]
      });
      shapes.push(...points);
      shapes.forEach((shape, i) => { shape._order = i; });
      // Reserve only the declared gentle yaw range, rather than a full rotation.
      const center = model.display_view?.initial_yaw ?? 0, amplitude = model.display_view?.yaw_amplitude ?? .12;
      const lower = center-amplitude, upper = center+amplitude;
      const envelope = p => {
        const h = p._horizontal, f = p._forward;
        let bound = Math.max(Math.abs(h*Math.cos(lower)+f*Math.sin(lower)),Math.abs(h*Math.cos(upper)+f*Math.sin(upper)));
        const critical = Math.atan2(f,h);
        for (const angle of [critical-Math.PI,critical,critical+Math.PI]) {
          if (angle >= lower && angle <= upper) bound = Math.hypot(h,f);
        }
        return bound;
      };
      scenes.set(model, { points, helpers, corners, shapes,
        horizontal: Math.max(...[...points,...corners].map(envelope)),
        vertical: Math.max(...[...points,...corners].map(p => Math.abs(p._vertical)))
      });
    }
    const scene = scenes.get(model);
    const scale = Math.min(width*.43/scene.horizontal, height*.39/scene.vertical);
    const cy = Math.cos(angle), sy = Math.sin(angle);
    const update = p => {
      p.x = width/2 + (p._horizontal*cy+p._forward*sy)*scale;
      p.y = height/2 - p._vertical*scale;
      p.z = -p._horizontal*sy+p._forward*cy;
    };
    for (const p of scene.points) {
      update(p); p.r = Math.max(1.05,Math.min(6,p._radius*scale));
    }
    for (const p of scene.corners) update(p);
    for (const p of scene.helpers) update(p);
    for (const shape of scene.shapes) {
      if (shape.kind === 'atom') continue;
      const a = shape._a, b = shape._b, t = shape._t, u = shape._u;
      shape.x = a.x+(b.x-a.x)*t; shape.y = a.y+(b.y-a.y)*t;
      shape.x2 = a.x+(b.x-a.x)*u; shape.y2 = a.y+(b.y-a.y)*u;
      shape.z = a.z+(b.z-a.z)*(t+u)/2;
      if (shape.kind === 'bond') shape.width = Math.max(.8,Math.min(2.2,scale*.16));
    }
    scene.shapes.sort((a,b) => a.z-b.z || a._order-b._order);
    return scene.shapes;
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

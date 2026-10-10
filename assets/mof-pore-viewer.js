(() => {
  'use strict';
  const instances = new WeakSet();
  const pauseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 5v14M16 5v14"></path></svg>';
  const playIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m8 4 12 8-12 8z"></path></svg>';
  let modelPromise;
  function chooseModel(gallery) {
    const models = gallery.models;
    if (!Array.isArray(models) || models.length !== 6) throw new Error('MOF gallery unavailable');
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    return models[Math.floor(random[0] / 4294967296 * models.length)];
  }
  async function init(figure) {
    if (instances.has(figure)) return;
    instances.add(figure);
    const canvas = figure.querySelector('canvas'), button = figure.querySelector('button');
    const ctx = canvas?.getContext('2d');
    if (!ctx || !globalThis.MofRenderer) return; // The CIF-derived poster remains visible.
    let model;
    try {
      modelPromise ||= (globalThis.MOF_GALLERY ? Promise.resolve(globalThis.MOF_GALLERY) : fetch(figure.dataset.mofViewer || 'data/mof-gallery.json').then(response => {
        if (!response.ok) throw new Error('MOF data unavailable');
        return response.json();
      })).then(chooseModel);
      model = await modelPromise;
      if (!Array.isArray(model.atoms) || !model.atoms.length || (!Array.isArray(model.bonds) && !Array.isArray(model.bond_segments))) return;
    } catch { return; }
    if (!figure.isConnected) return;
    // Selection is shared across runtime remounts, and changes only on page load.
    const name = figure.querySelector('[data-mof-name]'), poster = figure.querySelector('.mof-poster');
    name.textContent = `${model.name} (${model.publication.journal}, ${model.publication.year})`;
    name.href = model.publication.url;
    name.title = model.publication.title;
    poster.src = model.poster_path;
    const cellLabel = model.supercell?.repeats.some(n => n > 1) ? 'periodic supercell' : 'unit cell';
    poster.alt = `${model.name} crystal structure shown as a pore-facing ${cellLabel}.`;
    figure.dataset.selectedMof = model.id;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let paused = motion.matches, visible = true, frame = 0, last = 0, angle = model.display_view?.initial_yaw ?? 0, phase = 0;
    let width = 1, height = 1, destroyed = false;
    const draw = () => MofRenderer.draw(ctx, model, width, height, angle);
    function stop() { cancelAnimationFrame(frame); frame = 0; last = 0; }
    function tick(now) {
      frame = 0;
      if (!figure.isConnected) { destroy(); return; }
      if (paused || !visible || document.hidden) return;
      // Slow, continuous yaw near the pore-facing view keeps the aperture visible.
      if (!last || now - last >= 1000 / 15) {
        if (last) phase += Math.min(now - last, 100) * Math.PI * 2 / ((model.display_view?.period_seconds ?? 32) * 1000);
        angle = (model.display_view?.initial_yaw ?? 0) + (model.display_view?.yaw_amplitude ?? .12) * Math.sin(phase);
        last = now; draw();
      }
      frame = requestAnimationFrame(tick);
    }
    function start() { if (!destroyed && !frame && !paused && visible && !document.hidden) frame = requestAnimationFrame(tick); }
    function syncButton() {
      const label = paused ? 'Resume rotation' : 'Pause rotation';
      button.innerHTML = paused ? playIcon : pauseIcon;
      button.setAttribute('aria-label', label); button.title = label;
      button.setAttribute('aria-pressed', String(paused));
    }
    function toggle() { paused = !paused; syncButton(); paused ? stop() : start(); }
    function preference() { if (motion.matches) { paused = true; syncButton(); stop(); } }
    function visibility() { document.hidden ? stop() : start(); }
    function resize() {
      if (!figure.isConnected) { destroy(); return; }
      const bounds = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
    }
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting; visible ? start() : stop();
    });
    function destroy() {
      if (destroyed) return;
      destroyed = true; stop(); resizeObserver.disconnect(); intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', preference); button.removeEventListener('click', toggle);
    }
    resizeObserver.observe(figure.querySelector('.mof-stage'));
    intersectionObserver.observe(figure);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', preference); button.addEventListener('click', toggle);
    resize(); syncButton(); figure.dataset.mofReady = 'true'; start();
  }
  function scan(root) {
    if (root.matches?.('[data-mof-viewer]')) init(root);
    root.querySelectorAll?.('[data-mof-viewer]').forEach(init);
  }
  function boot() {
    scan(document);
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

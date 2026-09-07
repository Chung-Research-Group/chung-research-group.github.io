(() => {
  'use strict';
  const instances = new WeakSet();
  let modelPromise;
  async function init(figure) {
    if (instances.has(figure)) return;
    instances.add(figure);
    const canvas = figure.querySelector('canvas'), button = figure.querySelector('button');
    const ctx = canvas?.getContext('2d');
    if (!ctx || !globalThis.MofRenderer) return; // The CIF-derived poster remains visible.
    let model;
    try {
      modelPromise ||= fetch('data/irmof-1.json').then(response => {
        if (!response.ok) throw new Error('MOF data unavailable');
        return response.json();
      });
      model = await modelPromise;
      if (!Array.isArray(model.atoms) || !model.atoms.length || !Array.isArray(model.bonds)) return;
    } catch { return; }
    if (!figure.isConnected) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let paused = true, visible = true, frame = 0, last = 0, angle = .38;
    let width = 1, height = 1, destroyed = false;
    const draw = () => MofRenderer.draw(ctx, model, width, height, angle);
    function stop() { cancelAnimationFrame(frame); frame = 0; last = 0; }
    function tick(now) {
      frame = 0;
      if (!figure.isConnected) { destroy(); return; }
      if (paused || !visible || document.hidden) return;
      // At most 30 frames/s; one revolution every 100 s.
      if (!last || now - last >= 1000 / 30) {
        if (last) angle += Math.min(now - last, 100) * Math.PI * 2 / 100000;
        last = now; draw();
      }
      frame = requestAnimationFrame(tick);
    }
    function start() { if (!destroyed && !frame && !paused && visible && !document.hidden) frame = requestAnimationFrame(tick); }
    function syncButton() {
      button.textContent = paused ? 'Resume rotation' : 'Pause rotation';
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

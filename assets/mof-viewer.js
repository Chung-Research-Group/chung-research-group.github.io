(() => {
  'use strict';
  const instances = new WeakSet();
  let catalog;
  function loadCatalog(url) {
    return catalog ||= fetch(url).then(response => {
      if (!response.ok) throw new Error('MOF catalog could not be loaded.');
      return response.json();
    }).then(models => {
      globalThis.MOF_MODELS = models;
      return models;
    });
  }
  async function init(figure) {
    if (instances.has(figure) || !globalThis.MofRenderer) return;
    instances.add(figure);
    try { await loadCatalog(figure.dataset.mofViewer); }
    catch { return; } // Keep the source image visible when the catalog is unavailable.
    if (!figure.isConnected || !globalThis.MOF_MODELS?.length) return;
    // One equally likely structure per page load; it keeps rotating while visible.
    const model = MofRenderer.chooseModel(globalThis.MOF_MODELS);
    const canvas = figure.querySelector('canvas');
    const poster = figure.querySelector('.mof-poster'), link = figure.querySelector('.mof-name');
    const scaleLine = figure.querySelector('.mof-scale-line');
    const description = `${model.name}: complete unit cell, periodic bonds; hydrogen atoms omitted.`;
    figure.dataset.mofName = model.name; figure.dataset.mofSlug = model.slug;
    link.textContent = model.name; link.href = model.download_url || model.source_url;
    poster.alt = description;
    poster.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(MofRenderer.toSvg(model, 750, 750));
    canvas.setAttribute('aria-label', description);
    let ctx;
    try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
    if (!ctx) {
      const fallbackObserver = new ResizeObserver(updateFallback);
      function updateFallback() {
        if (!figure.isConnected) { fallbackObserver.disconnect(); return; }
        const bounds = canvas.getBoundingClientRect();
        const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
        poster.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(MofRenderer.toSvg(model, width, height));
        if (scaleLine) {
          const cssToScreen = bounds.width / canvas.clientWidth || 1;
          scaleLine.style.width = (10 * MofRenderer.viewScale(model, width, height) / cssToScreen) + 'px';
        }
      }
      figure.dataset.mofFallback = 'true';
      fallbackObserver.observe(figure.querySelector('.mof-stage')); updateFallback(); return;
    }
    let visible = true, frame = 0, last = 0, angle = .38;
    let width = 1, height = 1, destroyed = false;
    const draw = () => MofRenderer.draw(ctx, model, width, height, angle);
    function stop() { cancelAnimationFrame(frame); frame = 0; last = 0; }
    function tick(now) {
      frame = 0;
      if (!figure.isConnected) { destroy(); return; }
      if (!visible || document.hidden) return;
      if (!last || now - last >= 1000 / 30) {
        if (last) angle += Math.min(now - last, 100) * Math.PI * 2 / 100000;
        last = now; draw();
      }
      frame = requestAnimationFrame(tick);
    }
    function start() { if (!destroyed && !frame && visible && !document.hidden) frame = requestAnimationFrame(tick); }
    function visibility() { document.hidden ? stop() : start(); }
    function resize() {
      if (!figure.isConnected) { destroy(); return; }
      const bounds = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
      if (scaleLine) {
        const cssToScreen = bounds.width / canvas.clientWidth || 1;
        scaleLine.style.width = (10 * MofRenderer.viewScale(model, width, height) / cssToScreen) + 'px';
      }
    }
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting; visible ? start() : stop();
    });
    function destroy() {
      if (destroyed) return;
      destroyed = true; stop(); resizeObserver.disconnect(); intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    }
    resizeObserver.observe(figure.querySelector('.mof-stage'));
    intersectionObserver.observe(figure);
    document.addEventListener('visibilitychange', visibility);
    resize(); figure.dataset.mofReady = 'true';
    poster.setAttribute('aria-hidden', 'true'); start();
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

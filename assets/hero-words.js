(() => {
  'use strict';
  const initialized = new WeakSet();
  function init(root) {
    if (initialized.has(root)) return;
    const terms = [...root.querySelectorAll('.hero-term')];
    if (terms.length !== 2) return;
    initialized.add(root);
    let index = 0, timer = 0;
    function stop() { clearTimeout(timer); timer = 0; }
    function schedule() {
      stop();
      if (document.hidden || !root.isConnected) return;
      timer = setTimeout(() => {
        if (!root.isConnected) { destroy(); return; }
        index = (index + 1) % terms.length;
        terms.forEach((term, i) => term.classList.toggle('is-active', i === index));
        schedule();
      }, 6000);
    }
    function visibility() { document.hidden ? stop() : schedule(); }
    function destroy() {
      stop(); document.removeEventListener('visibilitychange', visibility);
    }
    terms.forEach((term, i) => term.classList.toggle('is-active', i === index));
    document.addEventListener('visibilitychange', visibility);
    schedule();
  }
  function scan(root) {
    if (root.matches?.('.hero-copy')) init(root);
    root.querySelectorAll?.('.hero-copy').forEach(init);
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

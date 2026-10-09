(() => {
  'use strict';
  const initialized = new WeakSet();
  const pauseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 5v14M16 5v14"></path></svg>';
  const playIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m8 4 12 8-12 8z"></path></svg>';
  function init(root) {
    if (initialized.has(root)) return;
    const terms = [...root.querySelectorAll('.hero-term')];
    const button = root.querySelector('.hero-words-toggle');
    if (terms.length !== 2 || !button) return;
    initialized.add(root);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let index = 0, userPaused = false, timer = 0;
    const stopped = () => userPaused || motion.matches;
    function stop() { clearTimeout(timer); timer = 0; }
    function schedule() {
      stop();
      if (stopped() || document.hidden || !root.isConnected) return;
      timer = setTimeout(() => {
        if (!root.isConnected) { destroy(); return; }
        index = (index + 1) % terms.length;
        terms.forEach((term, i) => term.classList.toggle('is-active', i === index));
        schedule();
      }, 6000);
    }
    function sync() {
      const paused = stopped();
      button.hidden = motion.matches;
      button.setAttribute('aria-pressed', String(paused));
      button.setAttribute('aria-label', paused ? 'Resume headline' : 'Pause headline');
      button.title = paused ? 'Resume headline' : 'Pause headline';
      button.innerHTML = paused ? playIcon : pauseIcon;
      schedule();
    }
    function toggle() { userPaused = !userPaused; sync(); }
    function visibility() { document.hidden ? stop() : schedule(); }
    function destroy() {
      stop(); button.removeEventListener('click', toggle);
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', visibility);
    }
    terms.forEach((term, i) => term.classList.toggle('is-active', i === index));
    root.classList.add('hero-words-ready');
    button.addEventListener('click', toggle);
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', visibility);
    sync();
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

(() => {
  'use strict';
  const initialized = new WeakSet();
  function init(workflow) {
    if (initialized.has(workflow)) return;
    const tabs = [...workflow.querySelectorAll('[role="tab"]')];
    if (tabs.length !== 4) return;
    initialized.add(workflow);
    function select(index, focus = false) {
      tabs.forEach((tab, i) => {
        const selected = i === index;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        workflow.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
      });
      if (focus) tabs[index].focus();
    }
    select(0);
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(index));
      tab.addEventListener('keydown', event => {
        const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        select(next, true);
      });
    });
  }
  function scan(root) {
    if (root.matches?.('.agentic-workflow')) init(root);
    root.querySelectorAll?.('.agentic-workflow').forEach(init);
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

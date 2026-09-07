(() => {
  'use strict';
  if (customElements.get('publication-metrics')) return;

  let timer;
  let requested = false;
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // One unavailable provider must not prevent the other from rendering.
      try { window._altmetric_embed_init?.(); } catch { /* Bibliography stays usable. */ }
      try { window.__dimensions_embed?.addBadges?.(); } catch { /* Bibliography stays usable. */ }
    }, 50);
  }
  function loadProviders() {
    if (requested) return;
    requested = true;
    for (const src of [
      'https://embed.altmetric.com/assets/embed.js',
      'https://badge.dimensions.ai/static/ai/badge.js'
    ]) {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.addEventListener('load', refresh, { once: true });
      document.head.append(script);
    }
  }

  // The template renderer reuses list rows by index. Own the widget children
  // here so a DOI change discards the old hosts, including pending callbacks.
  class PublicationMetrics extends HTMLElement {
    static get observedAttributes() { return ['data-doi']; }
    connectedCallback() { this.renderBadges(); }
    attributeChangedCallback() { if (this.isConnected) this.renderBadges(); }
    renderBadges() {
      const doi = (this.getAttribute('data-doi') || '').trim();
      if (this.currentDoi === doi) return;
      this.currentDoi = doi;
      this.replaceChildren();
      if (!doi || !/^10\.\d{4,9}\/\S+$/i.test(doi)) return;
      this.setAttribute('role', 'group');
      this.setAttribute('aria-label', 'Publication metrics');

      const altmetric = document.createElement('div');
      altmetric.className = 'altmetric-embed';
      altmetric.dataset.doi = doi;
      altmetric.dataset.badgeType = '4';
      altmetric.dataset.hideNoMentions = 'true';
      altmetric.setAttribute('aria-label', 'Altmetric attention score');
      const dimensions = document.createElement('span');
      dimensions.className = '__dimensions_badge_embed__';
      dimensions.dataset.doi = doi;
      dimensions.dataset.style = 'small_rectangle';
      dimensions.setAttribute('aria-label', 'Dimensions citation count');
      this.append(altmetric, dimensions);
      loadProviders();
      refresh();
    }
  }
  customElements.define('publication-metrics', PublicationMetrics);
})();

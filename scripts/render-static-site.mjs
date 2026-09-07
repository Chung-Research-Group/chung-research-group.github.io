import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { sharedChrome, site } from './site-chrome.mjs';

// Evaluate only checked-in page logic. No requests, timers or lifecycle hooks run.
export async function renderPublishedPage(source, { filename, dataRoot }) {
  const html = sharedChrome(source, filename);
  const { document } = parseHTML(html);
  const root = document.querySelector('x-dc');
  if (!root) throw new Error(`${filename}: missing template`);
  const window = {};
  const context = vm.createContext({ window, URL, console, DCLogic: class {} });
  for (const name of ['feed.js', 'people-data.js', 'force-layout.js']) {
    vm.runInContext(await readFile(path.join(dataRoot, name), 'utf8'), context, { timeout: 5000 });
  }
  let values = {};
  const script = document.querySelector('script[data-dc-script]');
  if (script) {
    const instance = vm.runInContext(script.textContent + '\nnew Component()', context, { timeout: 5000 });
    instance._feed = window.MTAP_FEED;
    instance.props = { showKorean: false };
    instance.state = { ...instance.state };
    if (filename === 'News.dc.html') instance.state.news = window.MTAP_FEED.NEWS;
    if (filename === 'Publications.dc.html') {
      instance.state.metadata = JSON.parse(await readFile(path.join(dataRoot, 'data/publication-metadata.json'), 'utf8'));
      instance.state.jcrBands = JSON.parse(await readFile(path.join(dataRoot, 'data/publication-jcr-bands.json'), 'utf8'));
    }
    if (filename === 'Statistics.dc.html') {
      instance.state.statistics = JSON.parse(await readFile(path.join(dataRoot, 'data/lab-statistics.json'), 'utf8'));
      instance.state.loading = false;
    }
    context.page = instance;
    values = vm.runInContext('page.renderVals()', context, { timeout: 5000 });
  }
  const evaluate = (text, scope) => {
    const expression = text.replace(/^\s*{{\s*|\s*}}\s*$/g, '');
    // Expressions and scope originate only from the local, trusted templates.
    return Function(...Object.keys(scope), `return (${expression});`)(...Object.values(scope));
  };
  const fill = (text, scope) => text.replace(/{{([\s\S]*?)}}/g, (_, expr) => String(evaluate(expr, scope) ?? ''));
  function visit(node, scope) {
    if (node.nodeType === 3) { node.textContent = fill(node.textContent, scope); return; }
    if (node.nodeType !== 1) return;
    if (node.localName === 'sc-for') {
      const list = evaluate(node.getAttribute('list'), scope) || [];
      for (const item of list) for (const child of [...node.childNodes]) {
        const clone = child.cloneNode(true);
        node.before(clone);
        visit(clone, { ...scope, [node.getAttribute('as')]: item });
      }
      node.remove(); return;
    }
    if (node.localName === 'sc-if') {
      if (evaluate(node.getAttribute('value'), scope)) {
        for (const child of [...node.childNodes]) { node.before(child); visit(child, scope); }
      }
      node.remove(); return;
    }
    for (const attr of [...node.attributes]) {
      if (/^on|^hint-|^data-|^style-hover/.test(attr.name)) node.removeAttribute(attr.name);
      else if (['open', 'disabled', 'selected', 'checked'].includes(attr.name) && attr.value.includes('{{')) {
        if (evaluate(attr.value, scope)) node.setAttribute(attr.name, '');
        else node.removeAttribute(attr.name);
      } else node.setAttribute(attr.name, fill(attr.value, scope));
    }
    for (const child of [...node.childNodes]) visit(child, scope);
  }
  const styles = [...root.querySelectorAll('helmet style, helmet link[rel="stylesheet"]')].map(n => n.outerHTML).join('\n');
  for (const n of root.querySelectorAll('helmet, script, .publication-filter-panel, .filter-chip, input, select, canvas, publication-metrics, .altmetric-embed, .__dimensions_badge_embed__')) n.remove();
  visit(root, values);
  for (const n of root.querySelectorAll('button')) n.remove();
  // Keep no-JS controls honest: native links/details still work; filters require JS.
  const fallback = `<noscript data-static-fallback>${styles}<link rel="stylesheet" href="assets/site-common.css"><div class="static-page"><p class="service-note" style="padding:12px 24px">Static view. Enable JavaScript for search, filters, and interactive charts.</p>${root.innerHTML}</div></noscript>`
    .replaceAll(site.email, site.email.replace('@', '&#64;'));
  if (/{{|<sc-(?:for|if)\b/.test(fallback)) throw new Error(`${filename}: unresolved static template`);
  // These data globals must exist before the runtime evaluates renderVals.
  // Scripts cloned out of an inert template do not retain parser-blocking order.
  const dataScripts = [...html.matchAll(/<script src="((?:\.\/)?(?:feed|people-data)\.js[^\"]*)"/g)]
    .map(match => match[1])
    .map(src => `<script src="${src}"></script>`).join('\n');
  return html
    .replace('<script src="./vendor/react.production.min.js">', dataScripts + '\n<script src="assets/site-template.js"></script>\n<script src="./vendor/react.production.min.js">')
    .replace(/<x-dc>[\s\S]*?<\/x-dc>/, match => `<template data-site-template>${match}</template>\n${fallback}`);
}

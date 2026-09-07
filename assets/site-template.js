/* Register before support.js. The source template is inert without JavaScript. */
document.addEventListener('DOMContentLoaded', () => {
  const template = document.querySelector('template[data-site-template]');
  if (template) template.replaceWith(template.content.cloneNode(true));
});

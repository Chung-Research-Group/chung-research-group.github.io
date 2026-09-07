// Published navigation and contact details have one source of truth.
export const site = {
  name: 'Chung Research Group',
  email: 'drygchung@pusan.ac.kr',
  address: 'School of Chemical Engineering, Pusan National University · 2 Busandaehak-ro 63beon-gil, Geumjeong-gu, Busan 46241, Republic of Korea',
  navigation: [['News.dc.html', 'News'], ['People.dc.html', 'People'], ['Software & Data.dc.html', 'Software &amp; Data'], ['Publications.dc.html', 'Publications'], ['Join Us.dc.html', 'Join Us']]
};
const encode = value => [...value].map(c => `&#${c.codePointAt(0)};`).join('');
export function sharedChrome(html, filename) {
  const active = /^(AIM|CoRE MOF Database|GWP-estimator|MOFClassifier|PACMAN|SESAMI-APP)\./.test(filename) ? 'Software & Data.dc.html' : filename;
  const links = site.navigation.map(([file, title]) => {
    const current = file === active ? ' aria-current="page"' : '';
    const style = file === 'Join Us.dc.html' ? ' class="btn-primary" style="background:var(--color-accent);color:var(--color-bg);text-decoration:none;padding:6px 16px;font-weight:700"' : file === active ? ' style="color:var(--color-accent)"' : '';
    return `<a href="${encodeURI(file).replaceAll('&', '%26')}"${current}${style}>${title}</a>`;
  }).join('\n    ');
  html = html.replace(/(<nav\b[^>]*class="nav"[^>]*>)[\s\S]*?<\/nav>/, (_, open) => `${open}\n    <a class="nav-brand" href="index.html" style="display:inline-flex;align-items:baseline;gap:8px;text-decoration:none;color:inherit"><span style="font-size:24px">${site.name}</span><span style="color:var(--color-accent);font-size:24px;font-family:var(--font-heading);font-weight:800">@ PNU</span></a>\n    ${links}\n  </nav>`);
  html = html.replace(/(<a\b[^>]*data-prof-(?:pnu-)?email[^>]*href=")mailto:[^"]+/g, `$1mailto:${encode(site.email)}`);
  return html.replace(/<span style="display:block;margin-top:2px">School of Chemical Engineering,[\s\S]*?<\/span>/g, `<span style="display:block;margin-top:2px">${site.address}</span>`);
}

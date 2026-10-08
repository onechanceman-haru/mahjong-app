// mock/parts/*.body.html から A案 / B案 のモックを生成する
//   node mock/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PARTS = join(HERE, 'parts');

const NAV_ICONS = {
  home: {
    line: '<path d="M12 3.4 3.6 10v10.2h6.1v-6h4.6v6h6.1V10z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    fill: '<path d="M12 3.4 3.6 10v10.2h6.1v-6h4.6v6h6.1V10z"/>',
  },
  input: {
    line: '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8.4v7.2M8.4 12h7.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    fill: '<path d="M7.8 3.8h8.4a4 4 0 0 1 4 4v8.4a4 4 0 0 1-4 4H7.8a4 4 0 0 1-4-4V7.8a4 4 0 0 1 4-4Zm4.9 4.6a.7.7 0 0 0-1.4 0V11.3H8.4a.7.7 0 0 0 0 1.4h2.9V15.6a.7.7 0 0 0 1.4 0V12.7h2.9a.7.7 0 0 0 0-1.4h-2.9Z"/>',
  },
  stats: {
    line: '<path d="M5.2 20V12.6M12 20V4.8M18.8 20v-5.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    fill: '<rect x="4.1" y="12.2" width="2.2" height="8" rx="1.1"/><rect x="10.9" y="4.4" width="2.2" height="15.8" rx="1.1"/><rect x="17.7" y="14.2" width="2.2" height="6" rx="1.1"/>',
  },
};
const NAV = [
  { key: 'home',  href: 'home.html',  label: 'ホーム' },
  { key: 'input', href: 'input.html', label: '入力' },
  { key: 'stats', href: 'stats.html', label: '成績' },
];

function navHtml(active) {
  return `<nav class="bottom-nav">${NAV.map(it => `
  <a href="${it.href}" class="nav-link${it.key === active ? ' active' : ''}"${it.key === active ? ' aria-current="page"' : ''}>
    <svg class="ico ico-line" viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[it.key].line}</svg>
    <svg class="ico ico-fill" viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[it.key].fill}</svg>
    <span>${it.label}</span>
  </a>`).join('')}
</nav>`;
}

const TITLES = { home: 'ホーム', input: '入力', stats: '成績確認', seasons: 'シーズン管理' };
const PAGES = ['home', 'input', 'stats', 'seasons'];
const VARIANTS = [{ key: 'a', name: 'A案 墨' }, { key: 'b', name: 'B案 雀卓' }];

for (const v of VARIANTS) {
  const dir = join(HERE, v.key);
  mkdirSync(dir, { recursive: true });
  for (const page of PAGES) {
    let body = readFileSync(join(PARTS, `${page}.body.html`), 'utf8');
    body = body.replace(/<!--NAV:(\w+)-->/g, (_, k) => navHtml(k));
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${TITLES[page]} | ${v.name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../parts/tokens-${v.key}.css">
<link rel="stylesheet" href="../parts/ui.css">
</head>
<body>
${body}
</body>
</html>
`;
    writeFileSync(join(dir, `${page}.html`), html, 'utf8');
  }
  console.log(`生成: mock/${v.key}/ (${PAGES.join(', ')})`);
}

// shots/compare.html を生成する（刷新前 / A案 / B案 を横に並べて比較する）
//   node scripts/compare.mjs
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots', 'compare.html');

// [見出し, 刷新前のファイル名, モックのファイル名]
const PAGES = [
  ['ホーム',                 'index',   'home'],
  ['入力',                   'input',   'input'],
  ['成績（個人成績・履歴）', 'history', 'stats'],
  ['シーズン一覧',           'past',    'seasons'],
];
const SCHEMES = [['light', '通常']];
const W = '375';

const cell = (src, label) => {
  const abs = join(ROOT, 'shots', src);
  const ok = existsSync(abs);
  return `<figure><figcaption>${label}</figcaption>${
    ok ? `<img src="${src}" alt="${label}">` : `<div class="missing">未撮影<br><code>${src}</code></div>`
  }</figure>`;
};

const body = SCHEMES.map(([sc, scLabel]) => `
<h2>${scLabel}モード（幅 ${W}px）</h2>
${PAGES.map(([title, before]) => `
<section>
  <h3>${title}</h3>
  <div class="row">
    ${cell(`before/${before}-${W}-${sc}.png`, '変更前')}
    ${cell(`after/${before}-${W}-${sc}.png`, '変更後')}
  </div>
</section>`).join('')}
`).join('');

writeFileSync(OUT, `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>見た目の比較 — 変更前 / 変更後</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: 'Noto Sans JP', -apple-system, Meiryo, sans-serif;
         background: #f4f4f6; color: #18181b; }
  @media (prefers-color-scheme: dark) { body { background: #121214; color: #f2f2f4; } }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 8px; }
  .lead { font-size: 14px; opacity: 0.7; margin-bottom: 24px; }
  h2 { font-size: 16px; font-weight: 700; margin: 32px 0 8px; }
  h3 { font-size: 14px; font-weight: 600; margin: 16px 0 8px; opacity: 0.8; }
  section { margin-bottom: 24px; }
  .row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 8px; }
  figure { margin: 0; flex: 0 0 auto; width: 320px; }
  figcaption { font-size: 12px; font-weight: 600; margin-bottom: 4px; opacity: 0.7; }
  img { width: 320px; height: auto; display: block; border-radius: 8px;
        border: 1px solid rgba(128,128,128,0.35); background: #fff; }
  @media (prefers-color-scheme: dark) { img { background: #1b1b1e; } }
  .missing { width: 320px; height: 200px; display: flex; align-items: center; justify-content: center;
             text-align: center; font-size: 12px; border: 1px dashed rgba(128,128,128,0.5); border-radius: 8px; }
</style>
</head>
<body>
<h1>見た目の調整 — 変更前後の比較</h1>
<div class="lead">左: 変更前 / 右: 変更後。いずれも本番データ・幅 375px・1画面分。</div>
${body}
</body>
</html>
`, 'utf8');
console.log('生成: shots/compare.html');

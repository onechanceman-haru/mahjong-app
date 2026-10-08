// スクリーンショット撮影（Playwright）
//   NODE_PATH="$LOCALAPPDATA/Temp/mj-pw/node_modules" node scripts/shots.mjs mock
//   NODE_PATH="..." node scripts/shots.mjs before   （刷新前の本体ページ。Supabaseに接続する）
//   NODE_PATH="..." node scripts/shots.mjs after    （刷新後の本体ページ）
// 幅 375px / 430px × ライト / ダーク の全組み合わせを撮り、横スクロールの有無も記録する。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require_('playwright')); }
catch {
  console.error('playwright が見つかりません。リポジトリ外に用意してから NODE_PATH を指定して実行してください。');
  process.exit(2);
}

const MODE = process.argv[2] || 'mock';
const TARGETS = {
  a: [
    ['home',    'mock/a/home.html'],
    ['input',   'mock/a/input.html'],
    ['stats',   'mock/a/stats.html'],
    ['seasons', 'mock/a/seasons.html'],
  ],
  b: [
    ['home',    'mock/b/home.html'],
    ['input',   'mock/b/input.html'],
    ['stats',   'mock/b/stats.html'],
    ['seasons', 'mock/b/seasons.html'],
  ],
  before: [
    ['index',   'index.html?season=1'],
    ['input',   'input.html?season=1'],
    ['history', 'history.html?season=1'],
    ['past',    'past.html'],
  ],
  after: [
    ['index',   'index.html?season=1'],
    ['input',   'input.html?season=1'],
    ['history', 'history.html?season=1'],
    ['past',    'past.html'],
  ],
};
const pages = TARGETS[MODE];
if (!pages) { console.error(`不明なモード: ${MODE}`); process.exit(1); }

const OUT = join(ROOT, 'shots', MODE);
mkdirSync(OUT, { recursive: true });

// 静的サーバ（file:// だと一部APIが使えないため）
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const buf = await readFile(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const VIEWPORTS = [{ name: '375', width: 375, height: 812 }, { name: '430', width: 430, height: 932 }];
const SCHEMES = ['light', 'dark'];

const browser = await chromium.launch();
const report = [];

for (const scheme of SCHEMES) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      colorScheme: scheme,
      isMobile: true, hasTouch: true,
      locale: 'ja-JP', timezoneId: 'Asia/Tokyo',
    });
    for (const [name, path] of pages) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      await page.goto(base + path, { waitUntil: 'load' });
      // データ読み込み待ち（モックは即時）
      await page.waitForTimeout((MODE === 'a' || MODE === 'b') ? 350 : 3000);
      const metrics = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        bodyScrollW: document.body.scrollWidth,
      }));
      const overflow = metrics.scrollW > metrics.clientW + 1;
      // 1枚目: 実際の1画面（固定ナビが正しい位置に写る）
      const file = `${name}-${vp.name}-${scheme}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: false });
      // 2枚目: ページ全体。fullPageでは position:fixed の要素が写り込むので外して撮る
      await page.addStyleTag({ content: '.sheet:not(.open),.sheet-backdrop:not(.open),.nav,.sticky-bar{display:none !important}body{padding-bottom:16px !important}' });
      await page.screenshot({ path: join(OUT, `${name}-${vp.name}-${scheme}-full.png`), fullPage: true });
      report.push({ page: name, vp: vp.name, scheme, overflow, scrollW: metrics.scrollW, clientW: metrics.clientW, errors });
      console.log(`${overflow ? '❌' : '✅'} ${file}  scrollW=${metrics.scrollW}/${metrics.clientW}${errors.length ? `  console error ${errors.length}件` : ''}`);
      errors.forEach(e => console.log(`     ${e.slice(0, 160)}`));
      await page.close();
    }
    await ctx.close();
  }
}

await browser.close();
server.close();
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

const bad = report.filter(r => r.overflow);
const errd = report.filter(r => r.errors.length);
console.log(`\n撮影: ${report.length}枚 → shots/${MODE}/`);
console.log(`横スクロールあり: ${bad.length}件 ${bad.map(b => `${b.page}-${b.vp}-${b.scheme}`).join(' ')}`);
console.log(`コンソールエラーあり: ${errd.length}件 ${errd.map(b => `${b.page}-${b.vp}-${b.scheme}`).join(' ')}`);
process.exit(bad.length || errd.length ? 1 : 0);

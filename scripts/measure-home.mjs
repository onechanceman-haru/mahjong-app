// ホームの通算成績ランキングが「1スクショに12人入るか」を実測する
//   NODE_PATH=".../mj-pw/node_modules" node scripts/measure-home.mjs
// 幅375px(iPhone SE/13 mini相当) と 390px(iPhone 13/14) で、
// ランキングカードを画面の一番上に合わせたときに何人まで収まるかを数える。
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require_('playwright')); }
catch { console.error('playwright が必要です（NODE_PATH を指定してください）'); process.exit(2); }

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const srv = createServer((req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(join(ROOT, p)));
  } catch { res.writeHead(404); res.end('404'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;

const DEVICES = [
  { name: 'iPhone SE/13 mini', w: 375, h: 667 },
  { name: 'iPhone 13 mini',    w: 375, h: 812 },
  { name: 'iPhone 14',         w: 390, h: 844 },
];

const browser = await chromium.launch();
console.log('| 端末 | 画面 | ヘッダー | ナビ | 使える高さ | 1行の高さ | 収まる人数 | 全12人 |');
console.log('|---|---|---|---|---|---|---|---|');
let allOk = true;

for (const d of DEVICES) {
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await ctx.newPage();
  await page.goto(base + 'index.html?season=1', { waitUntil: 'load' });
  await page.waitForTimeout(3500);

  const m = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#rankings .rank-item')];
    const card = document.getElementById('rankings').closest('.card'); void card;
    const header = document.querySelector('header.header');
    const nav = document.querySelector('.bottom-nav');
    // 1位の行を固定ヘッダーの直下に合わせる（スクショで12人を写す想定）
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    window.scrollTo(0, items[0].getBoundingClientRect().top + window.scrollY - headerH);
    const vh = window.innerHeight;
    const bottomLimit = vh - navH;
    let visible = 0;
    for (const it of items) {
      const r = it.getBoundingClientRect();
      if (r.top >= headerH - 0.5 && r.bottom <= bottomLimit + 0.5) visible++;
    }
    const rowH = items.length > 1
      ? (items[items.length - 1].getBoundingClientRect().bottom - items[0].getBoundingClientRect().top) / items.length
      : 0;
    return { total: items.length, visible, rowH: Math.round(rowH * 10) / 10,
             headerH: Math.round(headerH), navH: Math.round(navH), usable: Math.round(bottomLimit - headerH) };
  });
  const ok = m.visible >= Math.min(12, m.total);
  if (!ok) allOk = false;
  console.log(`| ${d.name} | ${d.w}×${d.h} | ${m.headerH}px | ${m.navH}px | ${m.usable}px | ${m.rowH}px | **${m.visible}人** / ${m.total}人 | ${ok ? '✅' : '❌'} |`);
  await ctx.close();
}

await browser.close(); srv.close();
console.log(`\n${allOk ? '✅ どの端末でも12人が1画面に収まる' : '❌ 12人に届かない端末がある'}`);
process.exit(allOk ? 0 : 1);

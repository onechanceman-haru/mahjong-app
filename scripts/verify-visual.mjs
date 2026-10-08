// 刷新前後で「表示される数値」が完全に同じかを比較する（読み取りのみ）
//   NODE_PATH=".../mj-pw/node_modules" node scripts/verify-visual.mjs
// 刷新前のコミットのHTMLを一時ディレクトリに取り出し、同じ本番データで
// 両方をブラウザで描画し、画面に出る数値・順位・件数を文字列として突き合わせる。
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require_('playwright')); }
catch { console.error('playwright が必要です（NODE_PATH を指定してください）'); process.exit(2); }

const BASE = '10a1017'; // 刷新前
const FILES = ['index.html', 'input.html', 'history.html', 'past.html', 'stats.js', 'scoring.js'];

// 刷新前のファイルを一時ディレクトリに展開
const oldDir = mkdtempSync(join(tmpdir(), 'mj-before-'));
for (const f of FILES) {
  writeFileSync(join(oldDir, f), execSync(`git show ${BASE}:${f}`, { encoding: 'utf8', maxBuffer: 1 << 26 }), 'utf8');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function serve(root) {
  const srv = createServer((req, res) => {
    try {
      const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
      res.end(readFileSync(join(root, p)));
    } catch { res.writeHead(404); res.end('404'); }
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}/` })));
}

// 画面から数値だけを抜き出す（装飾やクラス名は無視する）
const EXTRACT = {
  // ホーム: グループ収支サマリー / 統計 / 通算ランキング / チップ枚数
  'index.html?season=1': () => {
    const t = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      stats: [t(document.getElementById('stat-games')), t(document.getElementById('stat-players'))],
      balances: [...document.querySelectorAll('#group-summary-content .balance-row')]
        .map(r => t(r.querySelector('.balance-name')) + '=' + t(r.querySelector('.balance-val'))),
      settle: [...document.querySelectorAll('#group-summary-content .settle-item')].map(r => t(r)),
      rankings: [...document.querySelectorAll('#rankings .rank-item')]
        .map(r => t(r.querySelector('.rank-badge')) + '|' + t(r.querySelector('.rank-name')) + '|' + t(r.querySelector('.rank-sub')) + '|' + t(r.querySelector('.rank-pts'))),
      chips: [...document.querySelectorAll('#chip-rankings .rank-item')]
        .map(r => t(r.querySelector('.rank-badge')) + '|' + t(r.querySelector('.rank-name')) + '|' + t(r.querySelector('.rank-pts'))),
      groupOptions: [...document.querySelectorAll('#group-select option')].map(o => t(o)),
    };
  },
  // 成績: 個人成績（総合と人数別）
  'history.html?season=1': () => {
    const t = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    // 収支や1位率の表示順は刷新で変わるため、数値は「並べ替えた集合」として比べる
    const grab = () => [...document.querySelectorAll('#stats-content .player-stat')].map(p => {
      const nums = (t(p).match(/[+\-]?[\d,]+(?:\.\d+)?%?/g) || []).slice().sort();
      return t(p.querySelector('.player-stat-name')) + '|' + t(p.querySelector('.player-stat-pt')) + '|' + nums.join(',');
    });
    const out = {};
    for (const [key, tab] of [['all', null], ['p3', 3], ['p4', 4], ['p5', 5]]) {
      S.statTab = tab; renderStats(); out[key] = grab();
    }
    S.statTab = null; renderStats();
    return out;
  },
  // シーズン一覧: 全シーズン通算 / チップ枚数
  'past.html': () => {
    const t = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      seasons: [...document.querySelectorAll('#season-list .season-card')].map(c => t(c.querySelector('.season-name'))),
      score: [...document.querySelectorAll('#all-score-ranking .ranking-row')]
        .map(r => t(r.querySelector('.ranking-name')) + '|' + t(r.querySelector('.ranking-games')) + '|' + t(r.querySelector('.ranking-val'))),
      chips: [...document.querySelectorAll('#all-chip-ranking .ranking-row')]
        .map(r => t(r.querySelector('.ranking-name')) + '|' + t(r.querySelector('.ranking-val'))),
    };
  },
};

const browser = await chromium.launch();
const a = await serve(oldDir);
const b = await serve(ROOT);

async function snap(base, path, fn) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const data = await page.evaluate(`(${fn.toString()})()`);
  await ctx.close();
  return { data, errors };
}

const report = [];
for (const [path, fn] of Object.entries(EXTRACT)) {
  const before = await snap(a.base, path, fn);
  const after = await snap(b.base, path, fn);
  for (const key of Object.keys(before.data)) {
    // 「pt」の単位表示は今回追加した差分なので、数値の比較からは外す
    const strip = v => JSON.stringify(v).replace(/pt/g, '');
    const x = strip(before.data[key]), y = strip(after.data[key]);
    const n = Array.isArray(before.data[key]) ? before.data[key].length : 1;
    report.push({ path, key, n, same: x === y, before: x, after: y });
  }
  // 追加した単位表示そのものを確認する
  for (const [key, label] of [['rankings', 'ホームのランキングに pt が付く'], ['all', '個人成績に pt が付く']]) {
    const rows = after.data[key];
    if (!Array.isArray(rows) || !rows.length) continue;
    const ok = rows.every(r => /pt/.test(r));
    report.push({ path, key: label, n: rows.length, same: ok,
      before: JSON.stringify(before.data[key]?.slice(0, 1)), after: JSON.stringify(rows.slice(0, 1)) });
  }
  report.push({ path, key: 'コンソールエラー', n: '-', same: after.errors.length === 0,
    before: `${before.errors.length}件`, after: `${after.errors.length}件` });
  if (after.errors.length) after.errors.forEach(e => console.log('  ⚠️', e.slice(0, 200)));
}

await browser.close(); a.srv.close(); b.srv.close();

console.log('| ページ | 項目 | 件数 | 刷新前と同じか |');
console.log('|---|---|---|---|');
report.forEach(r => console.log(`| ${r.path} | ${r.key} | ${r.n} | ${r.same ? '✅ 完全一致' : '❌ 差分あり'} |`));
const ng = report.filter(r => !r.same);
if (ng.length) {
  console.log('\n差分の詳細:');
  ng.forEach(r => {
    console.log(`\n### ${r.path} / ${r.key}`);
    console.log(' 刷新前:', r.before.slice(0, 1200));
    console.log(' 刷新後:', r.after.slice(0, 1200));
  });
}
console.log(`\n${ng.length === 0 ? '✅ 表示される数値は刷新前と完全に一致' : `❌ ${ng.length}件に差分`}`);
process.exit(ng.length ? 1 : 0);

// デザインルールの遵守チェック（刷新前のコミットと比較する）
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const FILES = ['index.html', 'input.html', 'history.html', 'past.html'];
const BASE = '10a1017'; // 刷新前のコミット
const oldRaw = FILES.map(f => execSync(`git show ${BASE}:${f}`, { encoding: 'utf8', maxBuffer: 1 << 26 }));
const nowRaw = FILES.map(f => readFileSync(f, 'utf8'));
const css = readFileSync('common.css', 'utf8');
// コメントを除いて数える（説明文の中の語を拾わないように）
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
const all = [...nowRaw, css].map(strip);
const old = oldRaw.map(strip);
const now = nowRaw.map(strip);

const count = (re, src) => src.reduce((n, s) => n + (s.match(re) || []).length, 0);
const uniqNum = (re, src) => [...new Set(src.flatMap(s => [...s.matchAll(re)].map(m => +m[1])))].sort((a, b) => a - b);
const PASS = ok => (ok ? '✅' : '❌');
const rows = [];
const add = (label, before, after, ok) => rows.push({ label, before, after, ok });

add('font-weight:900 の使用', `${count(/font-weight:\s*900/g, old)}箇所`, `${count(/font-weight:\s*900/g, all)}箇所`, count(/font-weight:\s*900/g, all) === 0);
add('グラデーション', `${count(/linear-gradient/g, old)}箇所`, `${count(/linear-gradient/g, all)}箇所`, count(/linear-gradient/g, all) === 0);
add('box-shadow', `${count(/box-shadow/g, old)}箇所`, `${count(/box-shadow/g, all)}箇所`, count(/box-shadow/g, all) === 0);
add('text-transform', `${count(/text-transform/g, old)}箇所`, `${count(/text-transform/g, all)}箇所`, count(/text-transform/g, all) === 0);
add('letter-spacing（0以外）', `${count(/letter-spacing:\s*0\.\d+em/g, old)}箇所`, `${count(/letter-spacing:\s*0\.\d+em/g, all)}箇所`, count(/letter-spacing:\s*0\.\d+em/g, all) === 0);
add(':root をページ内に定義', `${count(/:root\s*\{/g, old)}ファイル`, `${count(/:root\s*\{/g, now)}ファイル`, count(/:root\s*\{/g, now) === 0);

const so = uniqNum(/font-size:\s*(\d+)px/g, old), sn = uniqNum(/font-size:\s*(\d+)px/g, all);
add('font-size の種類', `${so.length}種 ${so.join('/')}`, `${sn.length}種 ${sn.join('/')}`, sn.every(v => [12, 14, 16, 20, 28].includes(v)));
const ro = uniqNum(/border-radius:\s*(\d+)px/g, old), rn = uniqNum(/border-radius:\s*(\d+)px/g, all);
add('border-radius の種類', `${ro.length}種 ${ro.join('/')}`, `${rn.length}種 ${rn.join('/')}`, rn.every(v => [8, 12].includes(v)));
const wo = uniqNum(/font-weight:\s*(\d+)/g, old), wn = uniqNum(/font-weight:\s*(\d+)/g, all);
add('font-weight の種類', `${wo.length}種 ${wo.join('/')}`, `${wn.length}種 ${wn.join('/')}`, wn.every(v => [400, 600, 700].includes(v)));

// 16px未満の入力欄（iOSで自動ズームされる）
const smallInputs = src => src.reduce((n, s) => {
  for (const m of s.matchAll(/\.[\w-]*(?:input)[\w-]*\s*\{([^}]*)\}/g)) {
    const fs = m[1].match(/font-size:\s*(\d+)px/);
    if (fs && +fs[1] < 16) n++;
  }
  return n;
}, 0);
add('16px未満の入力欄', `${smallInputs(old)}件`, `${smallInputs(all)}件`, smallInputs(all) === 0);
add('HTML内のハードコード色', `${count(/#[0-9a-fA-F]{6}/g, old)}箇所`, `${count(/#[0-9a-fA-F]{6}/g, now)}箇所`, count(/#[0-9a-fA-F]{6}/g, now) === 0);

// グラフ系列にプラス・マイナスの色を使っていないか
const chartOld = count(/#10b981|#ef4444/g, old);
add('グラフ系列に収支の色を流用', `${chartOld}箇所`, `${count(/#10b981|#ef4444/g, all)}箇所`, count(/#10b981|#ef4444/g, all) === 0);

console.log('| 項目 | 刷新前 | 刷新後 | 判定 |');
console.log('|---|---|---|---|');
rows.forEach(r => console.log(`| ${r.label} | ${r.before} | ${r.after} | ${PASS(r.ok)} |`));
const ng = rows.filter(r => !r.ok).length;
console.log(`\n${ng === 0 ? '✅ すべてのルールを満たす' : `❌ ${ng}件 未達`}`);
process.exit(ng ? 1 : 0);

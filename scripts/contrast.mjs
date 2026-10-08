// コントラスト比の検証（WCAG 2.1）
//   node scripts/contrast.mjs            … A案/B案のトークンを検証
//   node scripts/contrast.mjs before     … 現状の配色を検証
// 本文は 4.5:1 以上、大きい文字(>=24px bold 相当)と図形は 3:1 以上が基準。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] || 'tokens';

const hex = h => {
  const s = h.replace('#', '').trim();
  const v = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
};
const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = h => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const fmt = n => n.toFixed(2);

// CSSからトークンを読む（:root と dark ブロックを別に）
function readTokens(file) {
  const css = readFileSync(join(ROOT, file), 'utf8');
  const blocks = [...css.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map(m => m[1]);
  const parse = b => Object.fromEntries([...b.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|transparent)\s*;/g)].map(m => [m[1], m[2]]));
  const light = parse(blocks[0] || '');
  const dark = { ...light, ...parse(blocks[1] || '') };
  return { light, dark };
}

// 検証する組み合わせ: [ラベル, 前景トークン, 背景トークン, 基準]
const PAIRS = [
  ['本文（面の上）',            'ink',     'surface', 4.5],
  ['本文（背景の上）',          'ink',     'bg',      4.5],
  ['補助文字（面の上）',        'ink-2',   'surface', 4.5],
  ['補助文字（背景の上）',      'ink-2',   'bg',      4.5],
  ['キャプション12px（面）',    'ink-3',   'surface', 4.5],
  ['キャプション12px（背景）',  'ink-3',   'bg',      4.5],
  ['プラスの数値',              'pos',     'surface', 4.5],
  ['マイナスの数値',            'neg',     'surface', 4.5],
  ['アクセント文字（面）',      'accent',  'surface', 4.5],
  ['アクセント文字（薄地）',    'accent',  'accent-bg', 4.5],
  ['主要ボタンの文字',          'accent-on', 'accent', 4.5],
  ['警告文字（面）',            'warn',    'surface', 4.5],
  ['警告文字（薄地）',          'warn-ink', 'warn-bg', 4.5],
  ['トーストの文字',            'toast-ink', 'toast-bg', 4.5],
  ['1位バッジの文字',           'r1-fg',   'r1-bg',   4.5],
  ['2位バッジの文字',           'r2-fg',   'r2-bg',   4.5],
  ['3位バッジの文字',           'r3-fg',   'r3-bg',   4.5],
  ['グラフ系列1（図形3:1）',    's1',      'surface', 3.0],
  ['グラフ系列2（図形3:1）',    's2',      'surface', 3.0],
  ['グラフ系列3（図形3:1）',    's3',      'surface', 3.0],
  ['グラフ系列4（図形3:1）',    's4',      'surface', 3.0],
  ['グラフ系列5（図形3:1）',    's5',      'surface', 3.0],
  ['グラフ系列6（図形3:1）',    's6',      'surface', 3.0],
  ['部品の輪郭（3:1）',         'line-strong', 'surface', 3.0],
  ['部品の輪郭（入力欄の地）',  'line-strong', 'field',   3.0],
];

function check(name, tokens) {
  console.log(`\n### ${name}`);
  console.log('| 用途 | 前景 | 背景 | 比 | 基準 | 判定 |');
  console.log('|---|---|---|---|---|---|');
  let ng = 0;
  for (const [label, fg, bg, min] of PAIRS) {
    const f = tokens[fg], b = tokens[bg];
    if (!f || !b) continue;
    // 透明の背景は、その上に載る面の色で評価する
    const bb = b === 'transparent' ? tokens.surface : b;
    if (f === 'transparent') continue;
    const r = ratio(f, bb);
    const ok = r >= min;
    if (!ok) ng++;
    console.log(`| ${label} | \`${f}\` | \`${bb}\`${b === 'transparent' ? '（透明）' : ''} | **${fmt(r)}** | ${min} | ${ok ? '✅' : '❌'} |`);
  }
  console.log(`\n→ ${ng === 0 ? '✅ すべて基準を満たす' : `❌ ${ng}件が基準未達`}`);
  return ng;
}

if (MODE === 'before') {
  // 現状（index.html 等の :root）の主な組み合わせ
  const T = {
    primary: '#4f46e5', 'primary-light': '#818cf8', success: '#10b981', danger: '#ef4444',
    warning: '#f59e0b', bg: '#f3f4f8', surface: '#ffffff', border: '#e5e7eb',
    text: '#1f2937', muted: '#6b7280', dim: '#9ca3af', navbg: '#0d0d1a',
    navoff: '#94a3b8', navon: '#818cf8', white: '#ffffff',
  };
  const rows = [
    ['本文 --text / 面',           T.text, T.surface, 4.5],
    ['補助 --muted / 面',          T.muted, T.surface, 4.5],
    ['淡色 --dim / 面',            T.dim, T.surface, 4.5],
    ['プラス --success / 面',      T.success, T.surface, 4.5],
    ['マイナス --danger / 面',     T.danger, T.surface, 4.5],
    ['精算額 --warning / 面',      T.warning, T.surface, 4.5],
    ['主色の文字 --primary / 面',  T.primary, T.surface, 4.5],
    ['ボタン文字 白 / --primary',  T.white, T.primary, 4.5],
    ['ナビ 非選択 / 黒帯',         T.navoff, T.navbg, 4.5],
    ['ナビ 選択 / 黒帯',           T.navon, T.navbg, 4.5],
    ['グラフ緑 #10b981 / 面',      T.success, T.surface, 3.0],
    ['グラフ赤 #ef4444 / 面',      T.danger, T.surface, 3.0],
    ['グラフ橙 #f59e0b / 面',      T.warning, T.surface, 3.0],
  ];
  console.log('## 現状（刷新前）の配色');
  console.log('| 用途 | 前景 | 背景 | 比 | 基準 | 判定 |');
  console.log('|---|---|---|---|---|---|');
  let ng = 0;
  for (const [label, f, b, min] of rows) {
    const r = ratio(f, b); const ok = r >= min; if (!ok) ng++;
    console.log(`| ${label} | \`${f}\` | \`${b}\` | **${fmt(r)}** | ${min} | ${ok ? '✅' : '❌'} |`);
  }
  console.log(`\n→ ❌ ${ng} / ${rows.length} 件が基準未達`);
} else {
  const c = readTokens('common.css');
  console.log('## common.css（実装）のトークン');
  const c1 = check('ライト', c.light);
  const c2 = check('ダーク', c.dark);
  console.log(`\n\n合計 未達: ${c1 + c2}件 / 検証した組み合わせ: ${2 * PAIRS.length}件`);
  process.exit(c1 + c2 ? 1 : 0);
}

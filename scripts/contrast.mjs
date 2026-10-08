// 現在の配色のコントラスト比（WCAG 2.1）
//   node scripts/contrast.mjs
// 本文は 4.5:1 以上、図形・グラフは 3:1 以上が基準。
// 色は「刷新前の値に戻した」ため、元からあった未達もそのまま残っている点を可視化する。
const hex = h => { const s = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)); };
const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = h => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const f = n => n.toFixed(2);

const T = {
  // 元のまま（今回戻した色）
  text: '#1f2937', muted: '#6b7280', dim: '#9ca3af',
  primary: '#4f46e5', success: '#10b981', danger: '#ef4444', warning: '#f59e0b',
  white: '#ffffff',
  // 今回変えた色（緑ベースの背景）
  bg: '#f4f8f5', surface: '#ffffff', field: '#f8fbf9', border: '#e2e8e3',
  // 今回変えた色（下部ナビ）
  navbg: '#ffffff', navoff: '#6b7280', navon: '#4f46e5',
  // 個人成績の色付きチップ（今回色で囲んだ部分）
  c1fg: '#b45309', c1bg: '#fef3c7', c2fg: '#4338ca', c2bg: '#eef2ff',
  c3fg: '#047857', c3bg: '#ecfdf5', c4fg: '#b91c1c', c4bg: '#fef2f2',
  rateFg: '#4f46e5', rateBg: '#eef2ff',
};

const ROWS = [
  ['【変更あり】本文 / 緑ベースの背景', T.text, T.bg, 4.5],
  ['【変更あり】本文 / 面', T.text, T.surface, 4.5],
  ['【変更あり】補助文字 / 緑ベースの背景', T.muted, T.bg, 4.5],
  ['【変更あり】入力欄の文字 / 入力地', T.text, T.field, 4.5],
  ['【変更あり】ナビ 非選択 / 明るい地', T.navoff, T.navbg, 4.5],
  ['【変更あり】ナビ 選択中 / 明るい地', T.navon, T.navbg, 4.5],
  ['【変更あり】1位率の文字 / 主色の薄地', T.rateFg, T.rateBg, 4.5],
  ['【変更あり】順位分布 1位 / 薄地', T.c1fg, T.c1bg, 4.5],
  ['【変更あり】順位分布 2位 / 薄地', T.c2fg, T.c2bg, 4.5],
  ['【変更あり】順位分布 3位 / 薄地', T.c3fg, T.c3bg, 4.5],
  ['【変更あり】順位分布 4位 / 薄地', T.c4fg, T.c4bg, 4.5],
  ['【元のまま】主色の文字 / 面', T.primary, T.surface, 4.5],
  ['【元のまま】主要ボタンの文字 / 主色', T.white, T.primary, 4.5],
  ['【元のまま】プラスの数値 / 面', T.success, T.surface, 4.5],
  ['【元のまま】マイナスの数値 / 面', T.danger, T.surface, 4.5],
  ['【元のまま】精算額（警告色）/ 面', T.warning, T.surface, 4.5],
  ['【元のまま】淡色の文字 / 面', T.dim, T.surface, 4.5],
  ['【元のまま】グラフの緑（図形3:1）', T.success, T.surface, 3.0],
  ['【元のまま】グラフの橙（図形3:1）', T.warning, T.surface, 3.0],
  ['【元のまま】グラフの赤（図形3:1）', T.danger, T.surface, 3.0],
];

console.log('| 用途 | 前景 | 背景 | 比 | 基準 | 判定 |');
console.log('|---|---|---|---|---|---|');
let changedNg = 0, keptNg = 0;
for (const [label, fg, bg, min] of ROWS) {
  const r = ratio(fg, bg), ok = r >= min;
  if (!ok) (label.startsWith('【変更あり】') ? changedNg++ : keptNg++);
  console.log(`| ${label} | \`${fg}\` | \`${bg}\` | **${f(r)}** | ${min} | ${ok ? '✅' : '❌'} |`);
}
console.log(`\n今回변更した色の未達: ${changedNg}件`.replace('변', '変'));
console.log(`元に戻した色の未達: ${keptNg}件（刷新前から存在。色を変えないと解消できない）`);
process.exit(changedNg ? 1 : 0);

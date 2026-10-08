// 操作フローのテスト（jsdom で実際のDOMを動かす・DBへの書き込みは一切しない）
//   input.html : 入力 → 合計チェック → 自動入力 → 登録ボタン活性 → 保存される行の中身
//   history.html: 編集 → 再計算プレビュー → 保存される行の中身
//
// jsdom はリポジトリに入れていないため、別の場所に入れてから実行する:
//   mkdir -p "$LOCALAPPDATA/Temp/mj-jsdom" && (cd "$LOCALAPPDATA/Temp/mj-jsdom" && npm install jsdom --no-save)
//   NODE_PATH="$LOCALAPPDATA/Temp/mj-jsdom/node_modules" node scripts/test-ui-flow.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);

let JSDOM;
try { ({ JSDOM } = require_('jsdom')); }
catch {
  console.error('jsdom が見つかりません。ファイル先頭のコメントの手順で用意してから実行してください。');
  process.exit(2);
}

let pass = 0, fail = 0;
const log = [];
const pending = [];
function t(name, fn) {
  const slot = log.length;
  log.push(`… ${name}`);
  const good = () => { pass++; log[slot] = `✅ ${name}`; };
  const bad  = e => { fail++; log[slot] = `❌ ${name}\n    ${e.message}`; };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(good, bad));
    else good();
  } catch (e) { bad(e); }
}
function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}\n      期待: ${b}\n      実際: ${a}`);
}
function ok(cond, what) { if (!cond) throw new Error(what); }

// ── HTMLをjsdomで開き、外部js＋インラインscriptを1つのスコープで実行する ──────
// Supabase は偽物に差し替え、DBアクセスは一切行わない（書き込み内容だけ記録する）
function openPage(file, { seasonParam = '?season=1', playersData = [], seedStorage, captureNav = false } = {}) {
  const html = readFileSync(join(ROOT, file), 'utf8');
  const captured = { inserts: [], updates: [], deletes: [] };

  const makeQuery = (table) => {
    const q = {
      select() { return q; }, order() { return q; }, eq() { return q; }, in() { return q; },
      is() { return q; }, gte() { return q; }, lt() { return q; }, limit() { return q; },
      range: () => Promise.resolve({ data: [], error: null }),
      single: () => Promise.resolve({
        data: table === 'seasons' ? { name: 'シーズン3(令和8年度)' } : null, error: null }),
      insert(rows) {
        captured.inserts.push({ table, rows });
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 9999 }, error: null }) }) };
      },
      update(patch) {
        const u = { table, patch, id: null };
        captured.updates.push(u);
        return { eq: (_c, v) => { u.id = v; return Promise.resolve({ error: null }); } };
      },
      delete() { return { eq: (_c, v) => { captured.deletes.push({ table, id: v }); return Promise.resolve({ error: null }); } }; },
      then(res) { return Promise.resolve({ data: table === 'players' ? playersData : [], error: null }).then(res); },
    };
    return q;
  };

  const dom = new JSDOM(html, {
    url: 'http://localhost/' + file + seasonParam,
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.supabase = { createClient: () => ({ from: makeQuery }) };
  w.Chart = class { constructor() {} destroy() {} };
  w.Element.prototype.scrollIntoView = function () {};
  w.localStorage.clear();
  if (seedStorage) Object.entries(seedStorage).forEach(([k, v]) => w.localStorage.setItem(k, v));

  const externals = ['stats.js', 'scoring.js']
    .filter(f => html.includes(`src="${f}"`))
    .map(f => readFileSync(join(ROOT, f), 'utf8'));
  // 末尾の init() は呼ばせない（ネットワークに触らせない）
  let inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n')
    .replace(/^[ \t]*init\(\);[ \t]*$/gm, '/* init() skipped */');
  // jsdom では location.href を差し替えられないため、遷移先を記録できるよう代入先だけ置き換える
  if (captureNav) inline = inline.replace(/location\.href\s*=/g, 'window.__dest =');

  w.eval([
    ...externals,
    inline,
    // ページ内の let/const は window のプロパティにならないため、
    // 同じスコープの直接 eval 経由で読み書きできる窓口を用意する
    'window.__run = (code) => eval(code);',
    'window.__captured = { toasts: [] };',
    'window.toast = (m, ty) => window.__captured.toasts.push([m, ty || ""]);',
  ].join('\n;\n'));

  return { dom, w, captured };
}

const run = (w, code) => w.__run(code);
const txt = (w, id) => (w.document.getElementById(id)?.textContent || '').replace(/\s+/g, ' ').trim();
const el  = (w, id) => w.document.getElementById(id);
const toasts = w => w.__captured.toasts;

const PLAYERS = [
  { id: 1, name: '安部' }, { id: 2, name: '井上' }, { id: 3, name: '谷口' },
  { id: 5, name: '豊田' }, { id: 4, name: '中田' },
];

// ══════════════════════════════════════════════════════════════════════════
console.log('########## input.html 操作フロー ##########');
// ══════════════════════════════════════════════════════════════════════════

function setupInput(playerCount, pids, opts = {}) {
  const { w, captured } = openPage('input.html', { playersData: PLAYERS, ...opts });
  run(w, `
    players = ${JSON.stringify(PLAYERS)};
    cfg.playerCount = ${playerCount};
    cfg.rankPoints = [...RANK_DEFAULTS[${playerCount}]];
    cfg.selectedPids = ${JSON.stringify(pids.map(String))};
    cfg.groupDate = '2026-10-08';
    cfg.groupName = '2026/10/08';
    updateRankPointsUI();
    buildGameRows();
  `);
  return { w, captured };
}
// 入力欄に100点単位で入力する（マイナスは±ボタンを押す）
function type(w, pid, hundreds) {
  el(w, `raw-${pid}`).value = String(Math.abs(hundreds));
  if (hundreds < 0) w.toggleRawSign(String(pid)); else w.updateRawSum();
}

t('参加者選択で素点入力欄と固定の「00」が並ぶ（例外で中断しない）', () => {
  const { w } = setupInput(4, [1, 2, 3, 5]);
  eq(w.document.querySelectorAll('.game-row').length, 4, '4行');
  eq(w.document.querySelectorAll('.game-row-00').length, 4, '「00」が4つ');
  [...w.document.querySelectorAll('.game-row-00')].forEach(e => eq(e.textContent, '00'));
  eq(txt(w, 'base-label'), '素点を入力（100点単位）', '見出しが素点入力になっている');
  ok(el(w, 'raw-1'), '入力欄 raw-1 がある');
  eq(el(w, 'sign-1').textContent, '＋', '±ボタンの初期状態は＋');
  eq(el(w, 'raw-1').getAttribute('inputmode'), 'numeric', 'スマホで数字キーボード');
});

t('未入力のうちは黄色・残り人数を表示し、登録ボタンは無効', () => {
  const { w } = setupInput(4, [1, 2, 3, 5]);
  eq(el(w, 'raw-sum').className, 'score-val warn');
  ok(txt(w, 'raw-hint').includes('残り 4 名'), `実際: ${txt(w, 'raw-hint')}`);
  eq(el(w, 'submit-game-btn').disabled, true, '登録ボタンは無効');
  eq(el(w, 'autofill-btn').style.display, 'none', '自動入力は出ない');
  eq(txt(w, 'live-1'), '—', '未入力の行は —');
});

t('入力中のリアルタイム表示（順位・差分pt・順位点・合計pt）', () => {
  const { w } = setupInput(4, [1, 2, 3, 5]);
  type(w, 1, 423); type(w, 2, 351); type(w, 3, 260); type(w, 5, 366);
  eq(txt(w, 'live-1'), '1位 · +730 pt · 順位点 +2,000 · 合計 +2,730 pt');
  eq(txt(w, 'live-5'), '2位 · +160 pt · 順位点 +1,000 · 合計 +1,160 pt');
  eq(txt(w, 'live-2'), '3位 · +10 pt · 順位点 -1,000 · 合計 -990 pt');
  eq(txt(w, 'live-3'), '4位 · -900 pt · 順位点 -2,000 · 合計 -2,900 pt');
});

t('合計一致（140,000 / 140,000）で緑・登録ボタンが有効', () => {
  const { w } = setupInput(4, [1, 2, 3, 5]);
  type(w, 1, 423); type(w, 2, 351); type(w, 3, 260); type(w, 5, 366);
  eq(txt(w, 'raw-sum'), '140,000 / 140,000');
  eq(el(w, 'raw-sum').className, 'score-val ok');
  ok(txt(w, 'raw-hint').includes('合計が一致'), `実際: ${txt(w, 'raw-hint')}`);
  eq(el(w, 'submit-game-btn').disabled, false, '登録ボタンが有効');
});

t('合計不一致（138,600 / 140,000）で赤・残り +1,400点・登録不可', () => {
  const { w } = setupInput(4, [1, 2, 3, 5]);
  type(w, 1, 423); type(w, 2, 351); type(w, 3, 260); type(w, 5, 352);
  eq(txt(w, 'raw-sum'), '138,600 / 140,000');
  eq(el(w, 'raw-sum').className, 'score-val error');
  ok(txt(w, 'raw-hint').includes('残り +1,400点'), `実際: ${txt(w, 'raw-hint')}`);
  eq(el(w, 'submit-game-btn').disabled, true, '登録できない');
});

t('未入力が1人だけになったら「残りを自動入力」が出る → 押すと一致する', () => {
  const { w } = setupInput(4, [1, 2, 3, 5]);
  type(w, 1, 423); type(w, 2, 351); type(w, 3, 260);
  eq(el(w, 'autofill-btn').style.display, 'flex', '自動入力ボタンが出る');
  w.autoFillLast();
  eq(el(w, 'raw-5').value, '366', '残り素点 36,600点 → 366');
  eq(txt(w, 'raw-sum'), '140,000 / 140,000');
  eq(el(w, 'submit-game-btn').disabled, false);
  eq(el(w, 'autofill-btn').style.display, 'none', '埋まったら消える');
});

t('自動入力: 残りがマイナスの素点でも正しく入る', () => {
  const { w } = setupInput(4, [1, 2, 3, 5]);
  type(w, 1, 731); type(w, 2, 500); type(w, 3, 200);
  eq(el(w, 'autofill-btn').style.display, 'flex');
  w.autoFillLast();
  eq(el(w, 'raw-5').value, '31', '残り -3,100点 → 31');
  eq(el(w, 'sign-5').textContent, '－', '±が－になる');
  eq(txt(w, 'raw-sum'), '140,000 / 140,000');
});

t('マイナスの素点（飛び）を±ボタンで入力できる / 同点は同じ順位', () => {
  const { w } = setupInput(4, [1, 2, 3, 5]);
  type(w, 3, 731); type(w, 2, 350); type(w, 1, 350); type(w, 5, -31);
  eq(el(w, 'sign-5').textContent, '－');
  eq(txt(w, 'raw-sum'), '140,000 / 140,000');
  eq(txt(w, 'live-3'), '1位 · +3,810 pt · 順位点 +2,000 · 合計 +5,810 pt');
  eq(txt(w, 'live-2'), '2位 · +0 pt · 順位点 +0 · 合計 +0 pt', '同点は2位タイで順位点を分け合う');
  eq(txt(w, 'live-1'), '2位 · +0 pt · 順位点 +0 · 合計 +0 pt');
  eq(txt(w, 'live-5'), '4位 · -3,810 pt · 順位点 -2,000 · 合計 -5,810 pt');
});

t('3人打ち: 目標 105,000', () => {
  const { w } = setupInput(3, [1, 2, 3]);
  type(w, 1, 468); type(w, 2, 350); type(w, 3, 232);
  eq(txt(w, 'raw-sum'), '105,000 / 105,000');
  eq(el(w, 'submit-game-btn').disabled, false);
});

t('5人打ち: 目標 175,000', () => {
  const { w } = setupInput(5, [1, 2, 3, 5, 4]);
  type(w, 1, 620); type(w, 2, 438); type(w, 3, 350); type(w, 5, 340); type(w, 4, 2);
  eq(txt(w, 'raw-sum'), '175,000 / 175,000');
  eq(el(w, 'submit-game-btn').disabled, false);
});

t('順位点合計が0でなければ登録できない', () => {
  const { w } = setupInput(4, [1, 2, 3, 5]);
  type(w, 1, 423); type(w, 2, 351); type(w, 3, 260); type(w, 5, 366);
  eq(el(w, 'submit-game-btn').disabled, false);
  run(w, `cfg.rankPoints[0] = 3000; updateRankSum();`);
  eq(el(w, 'submit-game-btn').disabled, true, '順位点合計≠0で無効');
});

t('順位点を変えると各行の順位点・合計もその場で変わる', () => {
  const { w } = setupInput(4, [1, 2, 3, 5]);
  type(w, 1, 423); type(w, 2, 351); type(w, 3, 260); type(w, 5, 366);
  run(w, `cfg.rankPoints = [3000, 1000, -1000, -3000]; updateRankSum();`);
  eq(txt(w, 'live-1'), '1位 · +730 pt · 順位点 +3,000 · 合計 +3,730 pt');
  eq(txt(w, 'live-3'), '4位 · -900 pt · 順位点 -3,000 · 合計 -3,900 pt');
});

t('登録 → games / game_results が従来形式で保存され、サマリー付きURLへ遷移', () => {
  const { w, captured } = setupInput(4, [1, 2, 3, 5], { captureNav: true });
  type(w, 1, 423); type(w, 2, 351); type(w, 3, 260); type(w, 5, 366);
  return w.submitGame().then(() => {
    const g = captured.inserts.find(x => x.table === 'games');
    const r = captured.inserts.find(x => x.table === 'game_results');
    ok(g, 'games に insert された');
    eq([g.rows.date, g.rows.player_count, g.rows.group_name, g.rows.season_id], ['2026-10-08', 4, '2026/10/08', 1]);
    ok(r, 'game_results に insert された');
    eq(r.rows.length, 4);
    eq(Object.keys(r.rows[0]).sort(), ['bonus_pt', 'game_id', 'player_id', 'rank', 'score_pt', 'total_pt'], '保存する列は従来どおり');
    const by = Object.fromEntries(r.rows.map(x => [x.player_id, x]));
    eq([by[1].rank, by[1].score_pt, by[1].bonus_pt, by[1].total_pt], [1, 730, 2000, 2730], '安部 42,300点');
    eq([by[5].rank, by[5].score_pt, by[5].bonus_pt, by[5].total_pt], [2, 160, 1000, 1160], '豊田 36,600点');
    eq([by[2].rank, by[2].score_pt, by[2].bonus_pt, by[2].total_pt], [3, 10, -1000, -990], '井上 35,100点');
    eq([by[3].rank, by[3].score_pt, by[3].bonus_pt, by[3].total_pt], [4, -900, -2000, -2900], '谷口 26,000点');
    eq(r.rows.reduce((s, x) => s + x.total_pt, 0), 0, '対局の total_pt 合計が0');
    const dest = run(w, 'window.__dest');
    eq(dest, 'index.html?season=1&summary=1&date=2026-10-08&group=2026%2F10%2F08', '遷移先URL');
  });
});

t('合計が一致しないまま submitGame を呼んでも保存されない', () => {
  const { w, captured } = setupInput(4, [1, 2, 3, 5]);
  type(w, 1, 423); type(w, 2, 351); type(w, 3, 260); type(w, 5, 352);
  return w.submitGame().then(() => {
    eq(captured.inserts.length, 0, 'insert されない');
    ok(toasts(w).some(([m]) => m.includes('138,600')), `警告が出る: ${JSON.stringify(toasts(w))}`);
  });
});

t('素点が未入力のまま submitGame を呼んでも保存されない', () => {
  const { w, captured } = setupInput(4, [1, 2, 3, 5]);
  type(w, 1, 423);
  return w.submitGame().then(() => {
    eq(captured.inserts.length, 0, 'insert されない');
    ok(toasts(w).some(([m]) => m.includes('全員の素点')), `警告が出る: ${JSON.stringify(toasts(w))}`);
  });
});

t('古い localStorage（差分入力時代の形式）が残っていてもエラーにならない', () => {
  const { w } = openPage('input.html', {
    playersData: PLAYERS,
    seedStorage: { 'mj_cfg_v1_s1': JSON.stringify({
      playerCount: 7, rankPoints: ['abc', null, 1000, 2000], selectedPids: 'notarray', baseDiff: 25000 }) },
  });
  eq(run(w, 'cfg.playerCount'), 4, '不正な人数は4に戻る');
  eq(run(w, 'cfg.rankPoints'), [2000, 1000, -1000, -2000], 'rankPoints は既定値に戻る');
  eq(run(w, 'cfg.selectedPids'), [], 'selectedPids は空配列');
});

t('localStorage が壊れたJSONでもエラーにならない', () => {
  const { w } = openPage('input.html', { playersData: PLAYERS, seedStorage: { 'mj_cfg_v1_s1': '{broken' } });
  eq(run(w, 'cfg.playerCount'), 4);
  eq(run(w, 'cfg.rankPoints'), [2000, 1000, -1000, -2000]);
});

t('順位点の既定値（RANK_DEFAULTS）は変わっていない', () => {
  const { w } = openPage('input.html', { playersData: PLAYERS });
  eq(run(w, 'RANK_DEFAULTS'), { 3: [2000, 0, -2000], 4: [2000, 1000, -1000, -2000], 5: [3000, 1500, 0, -1500, -3000] });
});

// ══════════════════════════════════════════════════════════════════════════
console.log('########## history.html 編集フロー ##########');
// ══════════════════════════════════════════════════════════════════════════

function setupHistory(rows, game) {
  const { w, captured } = openPage('history.html', { playersData: PLAYERS });
  run(w, `
    S.players = ${JSON.stringify(PLAYERS)};
    S.games = ${JSON.stringify([game])};
    S.results = ${JSON.stringify(rows)};
    S.chips = [];
    histAllResults = ${JSON.stringify(rows)};
  `);
  w.document.body.insertAdjacentHTML('beforeend', `<div id="results-view-${game.id}"></div>`);
  return { w, captured };
}
const GAME4 = { id: 700, date: '2026-10-08', group_name: '2026/10/08', player_count: 4, season_id: 1 };
// 同点なしの通常対局（順位点 [2000,1000,-1000,-2000] が一意に復元できる）
const ROWS4 = [
  { id: 8001, game_id: 700, player_id: 1, rank: 1, score_pt: 730,  bonus_pt: 2000,  total_pt: 2730 },
  { id: 8002, game_id: 700, player_id: 5, rank: 2, score_pt: 160,  bonus_pt: 1000,  total_pt: 1160 },
  { id: 8003, game_id: 700, player_id: 2, rank: 3, score_pt: 10,   bonus_pt: -1000, total_pt: -990 },
  { id: 8004, game_id: 700, player_id: 3, rank: 4, score_pt: -900, bonus_pt: -2000, total_pt: -2900 },
];
const TIE678 = { id: 678, date: '2026-06-23', group_name: '2026/06/23', player_count: 4, season_id: 1 };
const TIEROWS = [
  { id: 9001, game_id: 678, player_id: 3, rank: 1, score_pt: 3810,  bonus_pt: 2000,  total_pt: 5810 },
  { id: 9002, game_id: 678, player_id: 2, rank: 2, score_pt: 0,     bonus_pt: 0,     total_pt: 0 },
  { id: 9003, game_id: 678, player_id: 1, rank: 2, score_pt: 0,     bonus_pt: 0,     total_pt: 0 },
  { id: 9004, game_id: 678, player_id: 5, rank: 4, score_pt: -3810, bonus_pt: -2000, total_pt: -5810 },
];

t('編集を開くと素点が100点単位で初期表示され、順位点が復元される', () => {
  const { w } = setupHistory(ROWS4, GAME4);
  w.startEditGame('700');
  eq([...w.document.querySelectorAll('.edit-raw-700')].map(i => i.value), ['423', '366', '351', '260'], '素点/100 が初期値');
  const html = el(w, 'results-view-700').innerHTML;
  ok(html.includes('修正前：42,300点'), '修正前が素点表示');
  ok(html.includes('復元した順位点'), '復元した順位点を表示');
  ok(!html.includes('一意に復元できません'), '同点なしなら確認画面は出ない');
  ok(txt(w, 'edit-sum-700').includes('140,000 / 140,000'), `実際: ${txt(w, 'edit-sum-700')}`);
  ok(txt(w, 'edit-sum-700').includes('一致'), '合計が一致');
  eq(el(w, 'edit-save-700').disabled, false, '保存できる');
  eq(txt(w, 'edit-live-700-0'), '1位 · +730 pt · 順位点 +2,000 · 合計 +2,730 pt', 'プレビューが現状と一致');
});

t('素点を直すと順位・順位点・合計が再計算される（プレビュー）', () => {
  const { w } = setupHistory(ROWS4, GAME4);
  w.startEditGame('700');
  const ins = [...w.document.querySelectorAll('.edit-raw-700')];
  ins[0].value = '200'; ins[1].value = '589';   // 安部 20,000 / 豊田 58,900（合計は140,000のまま）
  w.updateEditSum('700');
  ok(txt(w, 'edit-sum-700').includes('一致'), `実際: ${txt(w, 'edit-sum-700')}`);
  eq(txt(w, 'edit-live-700-1'), '1位 · +2,390 pt · 順位点 +2,000 · 合計 +4,390 pt', '豊田が1位に');
  eq(txt(w, 'edit-live-700-0'), '4位 · -1,500 pt · 順位点 -2,000 · 合計 -3,500 pt', '安部が4位に');
});

t('保存で rank / bonus_pt / total_pt / score_pt がすべて再計算されて更新される', () => {
  const { w, captured } = setupHistory(ROWS4, GAME4);
  w.startEditGame('700');
  const ins = [...w.document.querySelectorAll('.edit-raw-700')];
  ins[0].value = '200'; ins[1].value = '589';
  w.updateEditSum('700');
  return w.saveEditGame('700').then(() => {
    const ups = captured.updates.filter(u => u.table === 'game_results');
    eq(ups.length, 4, '4行とも更新');
    eq(Object.keys(ups[0].patch).sort(), ['bonus_pt', 'rank', 'score_pt', 'total_pt'], '更新する列は従来どおり');
    const by = Object.fromEntries(ups.map(u => [u.id, u.patch]));
    eq(by[8001], { rank: 4, score_pt: -1500, bonus_pt: -2000, total_pt: -3500 }, '安部(id8001)');
    eq(by[8002], { rank: 1, score_pt: 2390,  bonus_pt: 2000,  total_pt: 4390 },  '豊田(id8002)');
    eq(by[8003], { rank: 2, score_pt: 10,    bonus_pt: 1000,  total_pt: 1010 },  '井上(id8003) 35,100点で2位');
    eq(by[8004], { rank: 3, score_pt: -900,  bonus_pt: -1000, total_pt: -1900 }, '谷口(id8004) 26,000点で3位');
    eq(Object.values(by).reduce((s, p) => s + p.total_pt, 0), 0, '対局の total_pt 合計が0');
  });
});

t('合計が目標と合わない編集は保存できない', () => {
  const { w, captured } = setupHistory(ROWS4, GAME4);
  w.startEditGame('700');
  w.document.querySelectorAll('.edit-raw-700')[0].value = '999';
  w.updateEditSum('700');
  eq(el(w, 'edit-save-700').disabled, true, '保存ボタンが無効');
  ok(txt(w, 'edit-sum-700').includes('残り'), `実際: ${txt(w, 'edit-sum-700')}`);
  return w.saveEditGame('700').then(() => eq(captured.updates.length, 0, '更新されない'));
});

t('編集でマイナスの素点（飛び）を入力できる', () => {
  const { w, captured } = setupHistory(ROWS4, GAME4);
  w.startEditGame('700');
  const ins = [...w.document.querySelectorAll('.edit-raw-700')];
  ins[0].value = '731'; ins[1].value = '350'; ins[2].value = '350'; ins[3].value = '-31';
  w.updateEditSum('700');
  ok(txt(w, 'edit-sum-700').includes('一致'), `実際: ${txt(w, 'edit-sum-700')}`);
  eq(txt(w, 'edit-live-700-3'), '4位 · -3,810 pt · 順位点 -2,000 · 合計 -5,810 pt');
  return w.saveEditGame('700').then(() => {
    const by = Object.fromEntries(captured.updates.map(u => [u.id, u.patch]));
    eq(by[8004], { rank: 4, score_pt: -3810, bonus_pt: -2000, total_pt: -5810 }, '谷口が -3,100点');
    eq(Object.values(by).reduce((s, p) => s + p.total_pt, 0), 0, '対局の total_pt 合計が0');
  });
});

t('同点を含む対局（game 678 相当）は順位点の確認画面が出る', () => {
  const { w } = setupHistory(TIEROWS, TIE678);
  w.startEditGame('678');
  ok(el(w, 'results-view-678').innerHTML.includes('一意に復元できません'), '確認メッセージが出る');
  eq([...w.document.querySelectorAll('.edit-rankpt-678')].map(i => i.value),
     ['2000', '1000', '-1000', '-2000'], '既定値が初期表示（分け合った後の値を推測に使わない）');
  ok(txt(w, 'edit-rankpt-sum-678').includes('+0 pt'), '順位点合計が0');
  eq(el(w, 'edit-save-678').disabled, false);
});

t('同点を含む対局（旧形式 rank 3,4 の game 89 相当）も確認画面が出る', () => {
  const game = { id: 89, date: '2025-12-20', group_name: '12/20', player_count: 5, season_id: 5 };
  const rows = [
    { id: 9101, game_id: 89, player_id: 4, rank: 1, score_pt: 2700,  bonus_pt: 3000,  total_pt: 5700 },
    { id: 9102, game_id: 89, player_id: 3, rank: 2, score_pt: 880,   bonus_pt: 1500,  total_pt: 2380 },
    { id: 9103, game_id: 89, player_id: 2, rank: 3, score_pt: 0,     bonus_pt: -750,  total_pt: -750 },
    { id: 9104, game_id: 89, player_id: 1, rank: 4, score_pt: 0,     bonus_pt: -750,  total_pt: -750 },
    { id: 9105, game_id: 89, player_id: 5, rank: 5, score_pt: -3580, bonus_pt: -3000, total_pt: -6580 },
  ];
  const { w } = setupHistory(rows, game);
  w.startEditGame('89');
  ok(el(w, 'results-view-89').innerHTML.includes('一意に復元できません'));
  eq([...w.document.querySelectorAll('.edit-rankpt-89')].map(i => i.value),
     ['3000', '1500', '0', '-1500', '-3000'], '5人打ちの既定値');
  ok(txt(w, 'edit-sum-89').includes('175,000 / 175,000'), `実際: ${txt(w, 'edit-sum-89')}`);
});

t('確認画面で順位点を確定して保存すると、その順位点で再計算される', () => {
  const { w, captured } = setupHistory(TIEROWS, TIE678);
  w.startEditGame('678');
  w.updateEditSum('678');
  return w.saveEditGame('678').then(() => {
    const by = Object.fromEntries(captured.updates.map(u => [u.id, u.patch]));
    // 素点はそのまま（73,100 / 35,000 / 35,000 / -3,100）、既定の順位点で再計算
    eq(by[9001], { rank: 1, score_pt: 3810,  bonus_pt: 2000,  total_pt: 5810 }, '谷口');
    eq(by[9002], { rank: 2, score_pt: 0,     bonus_pt: 0,     total_pt: 0 },    '井上（2位タイ）');
    eq(by[9003], { rank: 2, score_pt: 0,     bonus_pt: 0,     total_pt: 0 },    '安部（2位タイ）');
    eq(by[9004], { rank: 4, score_pt: -3810, bonus_pt: -2000, total_pt: -5810 }, '豊田');
    eq(Object.values(by).reduce((s, p) => s + p.total_pt, 0), 0, '対局の total_pt 合計が0');
  });
});

t('確認画面で順位点合計が0でなければ保存できない', () => {
  const { w, captured } = setupHistory(TIEROWS, TIE678);
  w.startEditGame('678');
  w.document.querySelectorAll('.edit-rankpt-678')[0].value = '5000';
  w.updateEditSum('678');
  eq(el(w, 'edit-save-678').disabled, true, '保存ボタンが無効');
  ok(txt(w, 'edit-rankpt-sum-678').includes('+3,000'), `実際: ${txt(w, 'edit-rankpt-sum-678')}`);
  return w.saveEditGame('678').then(() => eq(captured.updates.length, 0, '更新されない'));
});

t('履歴の一覧表示に素点が併記される', () => {
  const src = readFileSync(join(ROOT, 'history.html'), 'utf8');
  ok(/result-sub">素点 \$\{mjScorePtToRaw\(r\.score_pt\)\.toLocaleString\(\)\}/.test(src), 'result-sub に素点が入っている');
  const { w } = setupHistory(ROWS4, GAME4);
  eq(run(w, 'mjScorePtToRaw(730).toLocaleString()'), '42,300', '素点の復元');
  eq(run(w, 'mjScorePtToRaw(-3810).toLocaleString()'), '-3,100');
});

// ── 結果 ──────────────────────────────────────────────────────────────────
await Promise.all(pending);
console.log('\n' + log.join('\n'));
console.log(`\n合格 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);

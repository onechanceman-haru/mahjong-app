// 画面の動作テスト（jsdom・インメモリの偽DB。本番DBには一切アクセスしない）
//   history.html : 日ごと→対局ごとの2段表示 / 開閉の維持 / 対局の移動 / 空グループ削除 / 期間フィルタ
//   index.html   : 「＋ 同じ設定で結果入力」ボタン
//   input.html   : gid / pc / pids / focus の受け取り
//
// jsdom はリポジトリに入れていないため、別の場所に入れてから実行する:
//   mkdir -p "$LOCALAPPDATA/Temp/mj-jsdom" && (cd "$LOCALAPPDATA/Temp/mj-jsdom" && npm install jsdom --no-save)
//   NODE_PATH="$LOCALAPPDATA/Temp/mj-jsdom/node_modules" node scripts/test-history-ui.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require_('jsdom')); }
catch { console.error('jsdom が見つかりません。ファイル先頭の手順で用意してください。'); process.exit(2); }

let pass = 0, fail = 0;
const log = [];
const pending = [];
function t(name, fn) {
  const slot = log.length;
  log.push(`… ${name}`);
  const good = () => { pass++; log[slot] = `✅ ${name}`; };
  const bad  = e => { fail++; log[slot] = `❌ ${name}\n    ${e.message}`; };
  try { const r = fn(); if (r && typeof r.then === 'function') pending.push(r.then(good, bad)); else good(); }
  catch (e) { bad(e); }
}
function eq(a, b, what = '') {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${what}\n      期待: ${y}\n      実際: ${x}`);
}
function ok(c, what) { if (!c) throw new Error(what); }

// ── インメモリの偽Supabase ─────────────────────────────────────────────────
function makeDb(tables, captured) {
  const from = (table) => {
    const q = {
      _f: [], _order: null, _limit: null,
      select() { return q; },
      order(col, opt) { q._order = { col, asc: !opt || opt.ascending !== false }; return q; },
      eq(c, v)  { q._f.push(r => String(r[c]) === String(v)); return q; },
      neq(c, v) { q._f.push(r => String(r[c]) !== String(v)); return q; },
      is(c, v)  { q._f.push(r => (v === null ? r[c] == null : r[c] === v)); return q; },
      in(c, vs) { const s = new Set(vs.map(String)); q._f.push(r => s.has(String(r[c]))); return q; },
      gte(c, v) { q._f.push(r => String(r[c]) >= String(v)); return q; },
      lte(c, v) { q._f.push(r => String(r[c]) <= String(v)); return q; },
      lt(c, v)  { q._f.push(r => String(r[c]) <  String(v)); return q; },
      limit(n)  { q._limit = n; return q; },
      _rows() {
        let rows = (tables[table] || []).filter(r => q._f.every(f => f(r)));
        if (q._order) {
          const { col, asc } = q._order;
          rows = rows.slice().sort((a, b) => {
            const x = a[col], y = b[col];
            const c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y));
            return asc ? c : -c;
          });
        }
        if (q._limit != null) rows = rows.slice(0, q._limit);
        return rows.map(r => ({ ...r }));
      },
      range(a, b) { return Promise.resolve({ data: q._rows().slice(a, b + 1), error: null }); },
      single()    { return Promise.resolve({ data: q._rows()[0] || null, error: null }); },
      then(res)   { return Promise.resolve({ data: q._rows(), error: null }).then(res); },
      insert(rows) {
        const list = Array.isArray(rows) ? rows : [rows];
        captured.inserts.push({ table, rows });
        const added = list.map((r, i) => ({ id: 9000 + (tables[table] || []).length + i, ...r }));
        tables[table] = (tables[table] || []).concat(added);
        return { select: () => ({ single: () => Promise.resolve({ data: added[0], error: null }) }) };
      },
      update(patch) {
        return {
          eq(c, v) {
            const hit = (tables[table] || []).filter(r => String(r[c]) === String(v));
            hit.forEach(r => Object.assign(r, patch));
            captured.updates.push({ table, patch, where: [c, v], n: hit.length });
            return Promise.resolve({ error: null });
          }
        };
      },
      delete() {
        const run = (pred, where) => {
          const before = (tables[table] || []).length;
          tables[table] = (tables[table] || []).filter(r => !pred(r));
          captured.deletes.push({ table, where, n: before - tables[table].length });
          return Promise.resolve({ error: null });
        };
        return {
          eq: (c, v)  => run(r => String(r[c]) === String(v), [c, v]),
          in: (c, vs) => { const s = new Set(vs.map(String)); return run(r => s.has(String(r[c])), [c, vs]); },
        };
      },
    };
    return q;
  };
  return { from };
}

function openPage(file, { tables, search = '?season=1', captureNav = false, seedStorage } = {}) {
  const html = readFileSync(join(ROOT, file), 'utf8');
  const captured = { inserts: [], updates: [], deletes: [], confirms: [], toasts: [] };
  const dom = new JSDOM(html, { url: 'http://localhost/' + file + search, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.supabase = { createClient: () => makeDb(tables, captured) };
  w.Chart = class { constructor() {} destroy() {} };
  w.Element.prototype.scrollIntoView = function () {};
  w.localStorage.clear();
  if (seedStorage) Object.entries(seedStorage).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.__confirmResult = true;
  w.confirm = (m) => { captured.confirms.push(m); return w.__confirmResult; };

  const externals = ['stats.js', 'scoring.js'].filter(f => html.includes(`src="${f}"`))
    .map(f => readFileSync(join(ROOT, f), 'utf8'));
  let inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n')
    .replace(/^[ \t]*init\(\);[ \t]*$/gm, '/* init() skipped */');
  if (captureNav) inline = inline.replace(/location\.href\s*=/g, 'window.__dest =');

  w.eval([
    ...externals, inline,
    'window.__run = (code) => eval(code);',
    `window.__toasts = []; window.toast = (m, ty) => window.__toasts.push([m, ty || '']);`,
  ].join('\n;\n'));
  captured.toasts = w.__toasts;
  return { w, captured, tables };
}
const run = (w, code) => w.__run(code);
const el  = (w, id) => w.document.getElementById(id);
const txt = (w, id) => (el(w, id)?.textContent || '').replace(/\s+/g, ' ').trim();
const dayId = (date, name) => 'day-' + encodeURIComponent(`${date}|${name || ''}`);

// ── テスト用データ（本番DBとは無関係） ─────────────────────────────────────
const PLAYERS = [
  { id: 1, name: '安部' }, { id: 2, name: '井上' }, { id: 3, name: '谷口' },
  { id: 4, name: '中田' }, { id: 5, name: '豊田' },
];
// 4人打ち: 素点 42,300 / 36,600 / 35,100 / 26,000 → total 2730 / 1160 / -990 / -2900
const R4 = (gid, [a, b, c, d]) => ([
  { id: gid * 10 + 1, game_id: gid, player_id: a, rank: 1, score_pt: 730,  bonus_pt: 2000,  total_pt: 2730 },
  { id: gid * 10 + 2, game_id: gid, player_id: b, rank: 2, score_pt: 160,  bonus_pt: 1000,  total_pt: 1160 },
  { id: gid * 10 + 3, game_id: gid, player_id: c, rank: 3, score_pt: 10,   bonus_pt: -1000, total_pt: -990 },
  { id: gid * 10 + 4, game_id: gid, player_id: d, rank: 4, score_pt: -900, bonus_pt: -2000, total_pt: -2900 },
]);
const R3 = (gid, [a, b, c]) => ([
  { id: gid * 10 + 1, game_id: gid, player_id: a, rank: 1, score_pt: 1180,  bonus_pt: 2000,  total_pt: 3180 },
  { id: gid * 10 + 2, game_id: gid, player_id: b, rank: 2, score_pt: 0,     bonus_pt: 0,     total_pt: 0 },
  { id: gid * 10 + 3, game_id: gid, player_id: c, rank: 3, score_pt: -1180, bonus_pt: -2000, total_pt: -3180 },
]);

function freshTables() {
  return {
    players: PLAYERS.map(p => ({ ...p })),
    seasons: [{ id: 1, name: 'テストシーズン', created_at: '2026-04-01T00:00:00' }],
    groups: [
      { id: 101, date: '2026-10-08', name: 'B卓', season_id: 1, created_at: '2026-10-08T08:00:00' },
      { id: 102, date: '2026-10-06', name: 'A卓', season_id: 1, created_at: '2026-10-06T08:00:00' },
      { id: 103, date: '2026-10-06', name: 'C卓', season_id: 1, created_at: '2026-10-06T08:30:00' },
    ],
    games: [
      { id: 1, date: '2026-10-06', group_name: 'A卓', player_count: 4, season_id: 1, created_at: '2026-10-06T09:00:00' },
      { id: 2, date: '2026-10-06', group_name: 'A卓', player_count: 4, season_id: 1, created_at: '2026-10-06T10:30:00' },
      { id: 3, date: '2026-10-06', group_name: 'A卓', player_count: 4, season_id: 1, created_at: '2026-10-06T14:32:00' },
      { id: 4, date: '2026-10-06', group_name: 'C卓', player_count: 3, season_id: 1, created_at: '2026-10-06T12:00:00' },
      { id: 5, date: '2026-10-08', group_name: 'B卓', player_count: 4, season_id: 1, created_at: '2026-10-08T09:15:00' },
      { id: 9, date: '1900-01-01', group_name: null,  player_count: 4, season_id: 1, created_at: '2026-04-01T00:00:00' },
    ],
    game_results: [
      ...R4(1, [1, 5, 2, 3]), ...R4(2, [5, 1, 3, 2]), ...R4(3, [1, 5, 2, 3]),
      ...R3(4, [2, 4, 1]), ...R4(5, [3, 2, 1, 5]),
      { id: 901, game_id: 9, player_id: 1, rank: 0, score_pt: 5000,  bonus_pt: 0, total_pt: 5000 },
      { id: 902, game_id: 9, player_id: 2, rank: 0, score_pt: -5000, bonus_pt: 0, total_pt: -5000 },
    ],
    chip_settlements: [
      { id: 201, date: '2026-10-06', group_name: 'A卓', player_id: 1, chip_count: 3,  chip_pt: 900,   season_id: 1, created_at: '2026-10-06T18:05:00' },
      { id: 202, date: '2026-10-06', group_name: 'A卓', player_id: 5, chip_count: -3, chip_pt: -900,  season_id: 1, created_at: '2026-10-06T18:05:01' },
    ],
    memos: [],
  };
}

async function openHistory(tables = freshTables(), search = '?season=1') {
  const h = openPage('history.html', { tables, search });
  run(h.w, `document.getElementById('hist-from').value = ''; document.getElementById('hist-to').value = '';`);
  await h.w.loadData();
  await h.w.loadHistory();
  return h;
}

// ══════════════════════════════════════════════════════════════════════════
console.log('########## history.html: 日ごと → 対局ごとの2段表示 ##########');
// ══════════════════════════════════════════════════════════════════════════

t('1段目: 日×グループのカードが日付の新しい順に並び、初期状態は全部閉じている', async () => {
  const { w } = await openHistory();
  const cards = [...w.document.querySelectorAll('.day-card')];
  eq(cards.length, 3, '日カード3枚（10/8 B卓 / 10/6 A卓 / 10/6 C卓）');
  eq(cards.map(c => c.querySelector('.day-title').textContent),
     ['10/8（木） · B卓', '10/6（火） · A卓', '10/6（火） · C卓'], '新しい順');
  eq(cards.filter(c => c.classList.contains('expanded')).length, 0, '全部閉じている');
});

t('1段目: 日付と参加者だけが出る（局数・チップ・結果は出さない）', async () => {
  const { w } = await openHistory();
  const card = el(w, dayId('2026-10-06', 'A卓'));
  eq(card.querySelector('.day-players').textContent, '安部 / 井上 / 谷口 / 豊田', 'プレイヤー名順');
  const head = card.querySelector('.day-card-header').textContent;
  ok(!head.includes('局'), `局数を出さない: ${head.replace(/\s+/g, ' ')}`);
  ok(!head.includes('チップ'), 'チップの有無を出さない');
  ok(!head.includes('pt'), '結果(pt)を出さない');
});

t('1段目: 同じ日に2グループあれば別々のカードになる', async () => {
  const { w } = await openHistory();
  ok(el(w, dayId('2026-10-06', 'A卓')), 'A卓のカード');
  ok(el(w, dayId('2026-10-06', 'C卓')), 'C卓のカード');
  eq(el(w, dayId('2026-10-06', 'C卓')).querySelector('.day-players').textContent, '安部 / 井上 / 中田');
});

t('2段目: チップが一番上、対局は新しい順。第◯局は古い順に採番され時刻が出る', async () => {
  const { w } = await openHistory();
  const body = el(w, dayId('2026-10-06', 'A卓')).querySelector('.day-card-body');
  const kids = [...body.children];
  ok(kids[0].classList.contains('chip-card'), 'チップが一番上');
  ok(kids[0].textContent.includes('🎯 チップ精算 · 18:05'), `チップに時刻: ${kids[0].textContent.replace(/\s+/g,' ').slice(0,40)}`);
  const heads = kids.slice(1).map(c => c.querySelector('.game-date').textContent.replace(/\s+/g, ' ').trim());
  eq(heads, ['第3局 14:32 · 4人打ち', '第2局 10:30 · 4人打ち', '第1局 09:00 · 4人打ち'], '新しい順・採番は古い順');
});

t('2段目: 対局の1行目に上位の結果が出る', async () => {
  const { w } = await openHistory();
  const card = el(w, 'gc-3');
  eq(card.querySelector('.game-title').textContent.replace(/\s+/g, ' ').trim(), '1位 安部 +2,730 ／ 2位 豊田 +1,160');
});

t('詳細: 順位・素点・順位点・合計と 編集/移動/削除 が出る', async () => {
  const { w } = await openHistory();
  w.toggleGameCard('3');
  ok(el(w, 'gc-3').classList.contains('expanded'), '開いた');
  const view = el(w, 'results-view-3').textContent.replace(/\s+/g, ' ');
  ok(view.includes('素点 42,300'), `素点: ${view.slice(0, 80)}`);
  ok(view.includes('+730 + +2000'), '素点pt + 順位点');
  ok(view.includes('+2,730 pt'), '合計pt');
  const btns = [...el(w, 'results-view-3').querySelectorAll('button')].map(b => b.textContent.trim());
  eq(btns, ['✏️ 編集', '↔ 移動', '🗑 削除']);
});

t('引継ぎ対局は日カードに入らず、一番下の専用カードになる', async () => {
  const { w } = await openHistory();
  const list = [...el(w, 'hist-list').children];
  eq(list.length, 4, '日カード3枚 + 引継ぎ1枚');
  eq(list[3].id, 'gc-9', '引継ぎが一番下');
  ok(list[3].textContent.includes('過去分引継ぎ'));
  // 引継ぎが日カードの中に入っていないこと
  eq([...w.document.querySelectorAll('.day-card .game-card')].some(c => c.id === 'gc-9'), false);
});

t('編集のあとも日のカードは開いたまま', async () => {
  const { w } = await openHistory();
  w.toggleDayCard(encodeURIComponent('2026-10-06|A卓'));
  w.toggleGameCard('3');
  w.startEditGame('3');
  const ins = [...w.document.querySelectorAll('.edit-raw-3')];
  eq(ins.length, 4, '編集欄が出る');
  ins[0].value = '200'; ins[1].value = '589';
  w.updateEditSum('3');
  await w.saveEditGame('3');
  ok(el(w, dayId('2026-10-06', 'A卓')).classList.contains('expanded'), '日のカードが開いたまま');
  ok(el(w, 'gc-3').classList.contains('expanded'), '対局も開いたまま');
});

t('削除のあとも日のカードは開いたまま（対局だけ消える）', async () => {
  const { w, tables } = await openHistory();
  w.toggleDayCard(encodeURIComponent('2026-10-06|A卓'));
  await w.deleteGame('2');
  ok(el(w, dayId('2026-10-06', 'A卓')).classList.contains('expanded'), '開いたまま');
  eq(tables.games.some(g => g.id === 2), false, 'games から消えた');
  eq(tables.game_results.some(r => r.game_id === 2), false, 'game_results も消えた');
  const heads = [...el(w, dayId('2026-10-06', 'A卓')).querySelectorAll('.game-date')].map(e => e.textContent.replace(/\s+/g, ' ').trim());
  eq(heads, ['第2局 14:32 · 4人打ち', '第1局 09:00 · 4人打ち'], '番号が振り直される');
});

t('期間フィルタが効く', async () => {
  const { w } = await openHistory();
  eq(w.document.querySelectorAll('.day-card').length, 3);
  run(w, `document.getElementById('hist-from').value='2026-10-07'; document.getElementById('hist-to').value='2026-10-09';`);
  await w.loadHistory();
  const cards = [...w.document.querySelectorAll('.day-card')];
  eq(cards.length, 1, '10/8 のみ');
  eq(cards[0].querySelector('.day-title').textContent, '10/8（木） · B卓');
  run(w, `document.getElementById('hist-from').value='2026-10-06'; document.getElementById('hist-to').value='2026-10-06';`);
  await w.loadHistory();
  eq(w.document.querySelectorAll('.day-card').length, 2, '10/6 の2グループ');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('########## history.html: 対局の移動 ##########');
// ══════════════════════════════════════════════════════════════════════════

t('移動パネル: 同じシーズンのグループが日付の新しい順。今いるグループは除外', async () => {
  const { w } = await openHistory();
  w.startMoveGame('3');
  const panel = el(w, 'move-panel-3');
  eq(panel.style.display, 'block');
  const opts = [...el(w, 'move-sel-3').options].map(o => [o.value, o.textContent]);
  eq(opts, [['101', '10/8（木） · B卓'], ['103', '10/6（火） · C卓']], 'A卓(102)は除外・新しい順');
});

t('移動: games の date/group_name/season_id だけが更新され、game_results は変わらない', async () => {
  const { w, captured, tables } = await openHistory();
  const before = JSON.stringify(tables.game_results.filter(r => r.game_id === 3));
  w.startMoveGame('3');
  el(w, 'move-sel-3').value = '101';            // 10/8 B卓 へ
  await w.confirmMoveGame('3');
  const upd = captured.updates.filter(u => u.table === 'games');
  eq(upd.length, 1, 'games を1回だけ更新');
  eq(Object.keys(upd[0].patch).sort(), ['date', 'group_name', 'season_id'], '更新する列');
  eq(upd[0].patch, { date: '2026-10-08', group_name: 'B卓', season_id: 1 });
  eq(captured.updates.filter(u => u.table === 'game_results').length, 0, 'game_results は更新しない');
  eq(JSON.stringify(tables.game_results.filter(r => r.game_id === 3)), before, 'score/bonus/total/rank が不変');
});

t('移動の確認文', async () => {
  const { w, captured } = await openHistory();
  w.startMoveGame('3');
  el(w, 'move-sel-3').value = '101';
  await w.confirmMoveGame('3');
  const msg = captured.confirms[0].replace(/\n/g, ' ');
  eq(msg, '10/6（火） · A卓 の第3局（14:32）を 10/8（木） · B卓 に移動しますか？');
});

t('移動をキャンセルすると何も起きない', async () => {
  const { w, captured } = await openHistory();
  w.__confirmResult = false;
  w.startMoveGame('3');
  el(w, 'move-sel-3').value = '101';
  await w.confirmMoveGame('3');
  eq(captured.updates.length, 0, '更新なし');
  w.cancelMoveGame('3');
  eq(el(w, 'move-panel-3').style.display, 'none', 'パネルが閉じる');
});

t('移動後: 移動先の日のカードが開き、移した対局がハイライトされる', async () => {
  const { w } = await openHistory();
  w.startMoveGame('3');
  el(w, 'move-sel-3').value = '101';
  await w.confirmMoveGame('3');
  const dest = el(w, dayId('2026-10-08', 'B卓'));
  ok(dest.classList.contains('expanded'), '移動先の日が開いている');
  ok(el(w, 'gc-3').classList.contains('just-moved'), 'ハイライトされている');
  ok(dest.contains(el(w, 'gc-3')), '移動先のカードの中にある');
});

t('移動後: 第◯局が両方の日で振り直される（created_at に合った位置）', async () => {
  const { w } = await openHistory();
  w.startMoveGame('1');                           // 10/6 A卓 の第1局(09:00)
  el(w, 'move-sel-1').value = '101';              // → 10/8 B卓（既存は 09:15）
  await w.confirmMoveGame('1');
  const dest = [...el(w, dayId('2026-10-08', 'B卓')).querySelectorAll('.game-date')]
    .map(e => e.textContent.replace(/\s+/g, ' ').trim());
  eq(dest, ['第2局 09:15 · 4人打ち', '第1局 09:00 · 4人打ち'], '移動先: 09:00 が第1局になる');
  const src = [...el(w, dayId('2026-10-06', 'A卓')).querySelectorAll('.game-date')]
    .map(e => e.textContent.replace(/\s+/g, ' ').trim());
  eq(src, ['第2局 14:32 · 4人打ち', '第1局 10:30 · 4人打ち'], '移動元: 番号が振り直される');
});

t('移動でプレイヤー別の合計は変わらない', async () => {
  const tables = freshTables();
  const sum = () => {
    const m = {};
    tables.game_results.forEach(r => { m[r.player_id] = (m[r.player_id] || 0) + r.total_pt; });
    tables.chip_settlements.forEach(c => { m[c.player_id] = (m[c.player_id] || 0) + (c.chip_pt || 0); });
    return m;
  };
  const before = sum();
  const { w } = await openHistory(tables);
  w.startMoveGame('3');
  el(w, 'move-sel-3').value = '101';
  await w.confirmMoveGame('3');
  eq(sum(), before, '移動前後でプレイヤー別合計が同じ');
  eq(Object.values(before).reduce((a, b) => a + b, 0), 0, '総和は0');
});

t('移動元が空になったら「空になったグループを削除しますか？」と聞いて削除できる', async () => {
  const tables = freshTables();
  const { w, captured } = await openHistory(tables);
  // 10/6 C卓 は対局1件・チップ0件 → 移動すると空になる
  w.startMoveGame('4');
  el(w, 'move-sel-4').value = '101';
  await w.confirmMoveGame('4');
  const q = captured.confirms.find(m => m.includes('空になったグループ'));
  ok(q, `確認が出る: ${JSON.stringify(captured.confirms)}`);
  eq(q, '空になったグループ 10/6（火） · C卓 を削除しますか？');
  eq(tables.groups.some(g => g.id === 103), false, 'groups 行が削除された');
  eq(el(w, dayId('2026-10-06', 'C卓')), null, '日カードも消える');
});

t('空グループの削除は「いいえ」なら残る', async () => {
  const tables = freshTables();
  const { w } = await openHistory(tables);
  w.startMoveGame('4');
  el(w, 'move-sel-4').value = '101';
  w.__confirmResult = true;
  const origConfirm = w.confirm;
  let n = 0;
  w.confirm = (m) => { n++; return n === 1; };   // 移動はOK、空グループ削除はキャンセル
  await w.confirmMoveGame('4');
  w.confirm = origConfirm;
  eq(tables.groups.some(g => g.id === 103), true, 'groups 行は残る');
});

t('移動元にチップが残っていれば空グループの確認は出ない', async () => {
  const tables = freshTables();
  const { w, captured } = await openHistory(tables);
  // 10/6 A卓 の3局すべてを移すが、チップが残る
  for (const gid of ['1', '2', '3']) {
    w.startMoveGame(gid);
    el(w, `move-sel-${gid}`).value = '101';
    await w.confirmMoveGame(gid);
  }
  eq(captured.confirms.filter(m => m.includes('空になったグループ')).length, 0, '確認は出ない');
  eq(tables.groups.some(g => g.id === 102), true, 'A卓の groups 行は残る');
});

t('移動先の候補が無いときは案内を出す', async () => {
  const tables = freshTables();
  tables.groups = [{ id: 102, date: '2026-10-06', name: 'A卓', season_id: 1, created_at: '2026-10-06T08:00:00' }];
  const { w } = await openHistory(tables);
  w.startMoveGame('3');
  const panel = el(w, 'move-panel-3');
  eq(panel.style.display, 'block');
  ok(panel.textContent.includes('移動先のグループがありません'), panel.textContent.replace(/\s+/g, ' '));
  eq(el(w, 'move-sel-3'), null, '選択欄は出ない');
});

t('編集を開くと移動パネルは閉じる', async () => {
  const { w } = await openHistory();
  w.startMoveGame('3');
  eq(el(w, 'move-panel-3').style.display, 'block');
  w.startEditGame('3');
  eq(el(w, 'move-panel-3').style.display, 'none');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('########## index.html: ＋ 同じ設定で結果入力 ##########');
// ══════════════════════════════════════════════════════════════════════════

async function openIndex(tables = freshTables()) {
  const h = openPage('index.html', { tables, captureNav: true });
  await h.w.loadData();
  h.w.initGroupSummary();
  return h;
}

t('ボタンが「最小精算」の上に出る', async () => {
  const { w } = await openIndex();
  const html = el(w, 'group-summary-content').innerHTML;
  const btn = html.indexOf('同じ設定で結果入力');
  const settle = html.indexOf('最小精算');
  ok(btn > 0, 'ボタンがある');
  ok(btn < settle, `最小精算より上（btn=${btn} settle=${settle}）`);
});

t('サマリーの収支は共通集計（stats.js）で従来どおり', async () => {
  const { w } = await openIndex();
  // 10/8 B卓: 谷口 +2730 / 井上 +1160 / 安部 -990 / 豊田 -2900
  const rows = [...el(w, 'group-summary-content').querySelectorAll('.balance-row')]
    .map(r => r.textContent.replace(/\s+/g, ' ').trim());
  eq(rows, ['谷口+2,730 pt', '井上+1,160 pt', '安部-990 pt', '豊田-2,900 pt'].map(s => s.replace(/(\D)\+/, '$1 +').replace(/(\D)-/, '$1 -')).map(s => s.replace(/\s+/g, ' ')),
     JSON.stringify(rows));
});

t('押すと input.html?season&gid&pids&pc&focus へ遷移する', async () => {
  const { w } = await openIndex();
  w.goInputSameSetup();
  eq(run(w, 'window.__dest'), 'input.html?season=1&gid=101&pids=3,2,1,5&pc=4&focus=score');
});

t('グループを切り替えるとボタンの受け渡し内容も変わる', async () => {
  const { w } = await openIndex();
  const sel = el(w, 'group-select');
  const idx = [...sel.options].findIndex(o => o.textContent.includes('10/6') && o.textContent.includes('C卓'));
  sel.value = String(idx);
  w.onGroupSelectChange();
  w.goInputSameSetup();
  // 10/6 C卓 の最後の対局（3人打ち・井上/中田/安部）
  eq(run(w, 'window.__dest'), 'input.html?season=1&gid=103&pids=2,4,1&pc=3&focus=score');
});

t('groups 行が無いグループではボタンを出さない', async () => {
  const tables = freshTables();
  tables.groups = tables.groups.filter(g => g.id !== 101); // 10/8 B卓 の groups 行を消す
  const { w } = await openIndex(tables);
  const html = el(w, 'group-summary-content').innerHTML;
  ok(!html.includes('同じ設定で結果入力'), 'ボタンは出ない');
  ok(html.includes('最小精算'), 'サマリー自体は出る');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('########## input.html: gid / pc / pids / focus の受け取り ##########');
// ══════════════════════════════════════════════════════════════════════════

async function openInput(search) {
  const h = openPage('input.html', { tables: freshTables(), search });
  await h.w.init();
  return h;
}

t('グループ・人数・参加者が復元され、入力欄にフォーカスが当たる', async () => {
  const { w } = await openInput('?season=1&gid=101&pids=3,2,1,5&pc=4&focus=score');
  eq(run(w, 'selectedGid'), '101', 'グループが選択済み');
  eq(el(w, 'groups-select').value, '101', 'セレクトも反映');
  eq(run(w, 'cfg.playerCount'), 4);
  eq(run(w, 'cfg.selectedPids'), ['3', '2', '1', '5'], '参加者（渡された順）');
  eq(w.document.querySelectorAll('.game-row').length, 4, '入力欄が4行');
  eq(txt(w, 'selected-count'), '4/4名 選択中');
  await new Promise(r => setTimeout(r, 30));
  eq(w.document.activeElement?.id, 'raw-3', '1人目の入力欄にフォーカス');
});

t('3人打ちの受け渡しも復元される', async () => {
  const { w } = await openInput('?season=1&gid=103&pids=2,4,1&pc=3&focus=score');
  eq(run(w, 'cfg.playerCount'), 3);
  eq(run(w, 'cfg.selectedPids'), ['2', '4', '1']);
  eq(w.document.querySelectorAll('.game-row').length, 3);
  eq(run(w, 'cfg.rankPoints'), [2000, 0, -2000], '3人の順位点');
});

t('順位点は localStorage の値を使う（人数が同じなら保存値のまま）', async () => {
  const h = openPage('input.html', {
    tables: freshTables(), search: '?season=1&gid=101&pids=3,2,1,5&pc=4&focus=score',
    seedStorage: { 'mj_cfg_v1_s1': JSON.stringify({ playerCount: 4, rankPoints: [3000, 1000, -1000, -3000], selectedPids: [] }) },
  });
  await h.w.init();
  eq(run(h.w, 'cfg.rankPoints'), [3000, 1000, -1000, -3000], '保存した順位点が使われる');
  eq(run(h.w, 'cfg.selectedPids'), ['3', '2', '1', '5'], 'URLの参加者が優先される');
});

t('人数が変わって順位点の長さが合わないときは既定値に戻す', async () => {
  const h = openPage('input.html', {
    tables: freshTables(), search: '?season=1&gid=103&pids=2,4,1&pc=3',
    seedStorage: { 'mj_cfg_v1_s1': JSON.stringify({ playerCount: 4, rankPoints: [3000, 1000, -1000, -3000], selectedPids: [] }) },
  });
  await h.w.init();
  eq(run(h.w, 'cfg.playerCount'), 3);
  eq(run(h.w, 'cfg.rankPoints'), [2000, 0, -2000], '3人の既定値');
});

t('存在しないプレイヤーを含む pids は選び直しに戻して通知する', async () => {
  const { w } = await openInput('?season=1&gid=101&pids=3,2,1,999&pc=4&focus=score');
  eq(run(w, 'cfg.selectedPids'), [], '選択は空');
  eq(w.document.querySelectorAll('.game-row').length, 0, '入力欄は出ない');
  ok(w.__toasts.some(([m]) => m.includes('参加者を復元できませんでした')), JSON.stringify(w.__toasts));
  eq(txt(w, 'selected-count'), '0/4名 選択中');
});

t('人数と pids の数が合わない場合も選び直しに戻す', async () => {
  const { w } = await openInput('?season=1&gid=101&pids=3,2,1&pc=4&focus=score');
  eq(run(w, 'cfg.selectedPids'), []);
  ok(w.__toasts.some(([m]) => m.includes('参加者を復元できませんでした')));
});

t('存在しない gid は通知して通常状態にする', async () => {
  const { w } = await openInput('?season=1&gid=999&pids=3,2,1,5&pc=4');
  ok(w.__toasts.some(([m]) => m.includes('グループが見つかりませんでした')), JSON.stringify(w.__toasts));
  ok(run(w, 'selectedGid') !== '999', 'gid は採用されない');
  eq(run(w, 'cfg.selectedPids'), ['3', '2', '1', '5'], '参加者は復元される');
});

t('パラメータなしは従来どおり（グループは先頭・参加者は保存値）', async () => {
  const { w } = await openInput('?season=1');
  eq(run(w, 'selectedGid'), '101', '従来どおり先頭のグループ');
  eq(run(w, 'cfg.selectedPids'), [], '保存値なしなので空');
  eq(w.document.querySelectorAll('.game-row').length, 0);
  eq(w.__toasts.length, 0, '通知は出ない');
});

t('登録後はサマリー付きURLに戻る（繰り返しが成立する）', async () => {
  const h = openPage('input.html', { tables: freshTables(), search: '?season=1&gid=101&pids=3,2,1,5&pc=4&focus=score', captureNav: true });
  await h.w.init();
  const w = h.w;
  const type = (pid, v) => { el(w, `raw-${pid}`).value = String(v); w.updateRawSum(); };
  type(3, 423); type(2, 366); type(1, 351); type(5, 260);
  eq(el(w, 'submit-game-btn').disabled, false, '登録できる状態');
  await w.submitGame();
  const dest = run(w, 'window.__dest');
  eq(dest, 'index.html?season=1&summary=1&date=2026-10-08&group=B%E5%8D%93', '10/8 B卓のサマリーへ戻る');
  const ins = h.captured.inserts.find(x => x.table === 'games');
  eq([ins.rows.date, ins.rows.group_name, ins.rows.player_count], ['2026-10-08', 'B卓', 4]);
});

// ── 結果 ──────────────────────────────────────────────────────────────────
await Promise.all(pending);
console.log('\n' + log.join('\n'));
console.log(`\n合格 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);

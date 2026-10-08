// 検証スクリプト: 完了条件の確認 + リファクタ前後のロジック一致確認
import { readFileSync } from 'node:fs';
import { selAll, ROOT } from './db.mjs';
import { join } from 'node:path';

// stats.js（ブラウザ用グローバル関数）を Node 上で読み込む
const code = readFileSync(join(ROOT, 'stats.js'), 'utf8');
const MJ = new Function(code + `
  return { mjComputeStats, mjComputeChipCounts, mjScopeToSeasons, mjExcludeFromTotal, mjIsCarryover, MJ_TOTAL_EXCLUDED_PLAYERS };
`)();

const yen = n => (n >= 0 ? '+' : '') + n.toLocaleString();
const PASS = ok => (ok ? '✅ OK' : '❌ NG');

const [players, seasons, games, results, chips] = await Promise.all([
  selAll('players'), selAll('seasons'), selAll('games'),
  selAll('game_results'), selAll('chip_settlements'),
]);
const pname = id => players.find(p => p.id === id)?.name ?? `ID:${id}`;
const seasonIds = seasons.map(s => s.id);
const verdicts = [];
const check = (label, ok, detail = '') => { verdicts.push({ label, ok, detail }); };

// ───────────────────────────────────────────── 旧ロジック（index.html 旧 computeStats 相当）
const CARRYOVER_DATE = '1900-01-01';
const isCarry = g => !!g && g.date === CARRYOVER_DATE;
function oldComputeStats(S, pcFilter) {
  const gameSet = new Set(S.games.filter(g => {
    if (isCarry(g)) return !pcFilter;
    return !pcFilter || g.player_count === pcFilter;
  }).map(g => g.id));
  const map = {};
  S.players.forEach(p => { map[p.id] = { id: p.id, name: p.name, games: 0, totalPt: 0 }; });
  S.results.filter(r => gameSet.has(r.game_id)).forEach(r => {
    const g = S.games.find(x => x.id === r.game_id);
    const s = map[r.player_id]; if (!s) return;
    if (!isCarry(g)) s.games++;
    s.totalPt += r.total_pt;
  });
  if (!pcFilter) S.chips.forEach(c => { const s = map[c.player_id]; if (s) s.totalPt += (c.chip_pt || 0); });
  return Object.values(map).filter(s => s.games > 0 || (!pcFilter && s.totalPt !== 0)).sort((a, b) => b.totalPt - a.totalPt);
}

// シーズン別データ（index.html / history.html の loadData 相当）
function seasonData(sid) {
  const gs = games.filter(g => String(g.season_id) === String(sid));
  const ids = new Set(gs.map(g => g.id));
  return { players, games: gs, results: results.filter(r => ids.has(r.game_id)), chips: chips.filter(c => String(c.season_id) === String(sid)) };
}

console.log('########## A. リファクタ前後のロジック一致 ##########');
let mismatch = 0;
for (const s of seasons) {
  const d = seasonData(s.id);
  for (const pc of [null, 3, 4, 5]) {
    const a = oldComputeStats(d, pc).map(x => `${x.name}:${x.games}:${x.totalPt}`).join(',');
    const b = MJ.mjComputeStats(d, pc).map(x => `${x.name}:${x.games}:${x.totalPt}`).join(',');
    if (a !== b) { mismatch++; console.log(` ❌ season=${s.id} pc=${pc}\n   旧: ${a}\n   新: ${b}`); }
  }
}
console.log(` 一致しなかった組み合わせ: ${mismatch}件 （seasons ${seasons.length} × タブ4 = ${seasons.length * 4}通り）`);
check('旧ロジックと新ロジックの集計結果が一致（対局数・収支）', mismatch === 0, `${seasons.length * 4}通りすべて一致`);

// ───────────────────────────────────────────── タスク1
console.log('\n########## B. タスク1: 端数 ##########');
const badTotal = results.filter(r => (r.total_pt || 0) % 10 !== 0);
const badScore = results.filter(r => (r.score_pt || 0) % 10 !== 0);
const badBonus = results.filter(r => (r.bonus_pt || 0) % 10 !== 0);
const badChip  = chips.filter(c => (c.chip_pt ?? 0) % 10 !== 0);
console.log(` total_pt %10!=0 : ${badTotal.length}件 ${badTotal.map(r => `gr${r.id}=${r.total_pt}`).join(' ')}`);
console.log(` score_pt %10!=0 : ${badScore.length}件 ${badScore.map(r => `gr${r.id}=${r.score_pt}`).join(' ')}`);
console.log(` bonus_pt %10!=0 : ${badBonus.length}件`);
console.log(` chip_pt  %10!=0 : ${badChip.length}件`);
check('全 game_results の total_pt が10の倍数', badTotal.length === 0, `${badTotal.length}件`);
check('全 chip_settlements の chip_pt が10の倍数', badChip.length === 0, `${badChip.length}件`);

const badSum = results.filter(r => (r.total_pt || 0) !== (r.score_pt || 0) + (r.bonus_pt || 0));
check('total_pt = score_pt + bonus_pt', badSum.length === 0, `${badSum.length}件`);

const perGame = new Map();
results.forEach(r => { if (!perGame.has(r.game_id)) perGame.set(r.game_id, []); perGame.get(r.game_id).push(r); });
const nonZero = [...perGame.entries()].filter(([, rs]) => rs.reduce((s, r) => s + (r.total_pt || 0), 0) !== 0);
console.log(` total_pt 合計≠0 の対局 : ${nonZero.length}件 ${nonZero.map(([g]) => g).join(' ')}`);
check('全対局の total_pt 合計が0', nonZero.length === 0, `${nonZero.length}件`);

// ───────────────────────────────────────────── タスク3
console.log('\n########## C. タスク3: 全シーズン通算 = 各シーズン総合の合計 ##########');
const perSeasonStats = {};
seasons.forEach(s => {
  perSeasonStats[s.id] = {};
  MJ.mjComputeStats(seasonData(s.id), null).forEach(x => { perSeasonStats[s.id][x.name] = x.totalPt; });
});
// past.html の新実装と同じ計算
const scoped = MJ.mjScopeToSeasons({ players, games, results, chips }, seasonIds);
const pastRows = MJ.mjExcludeFromTotal(MJ.mjComputeStats(scoped, null));

const cols = seasons.map(s => s.name);
console.log(['プレイヤー', ...cols, 'シーズン合計', '通算(past)', '差', '一の位'].join(' | '));
let diffNg = 0, modNg = 0;
const allNames = [...new Set([...pastRows.map(r => r.name), ...seasons.flatMap(s => Object.keys(perSeasonStats[s.id]))])];
allNames.forEach(name => {
  const vals = seasons.map(s => perSeasonStats[s.id][name] || 0);
  const sumS = vals.reduce((a, b) => a + b, 0);
  const past = pastRows.find(r => r.name === name)?.totalPt;
  const excluded = MJ.MJ_TOTAL_EXCLUDED_PLAYERS.includes(name);
  if (excluded) {
    console.log([name, ...vals.map(yen), yen(sumS), '（通算から除外）', '-', '-'].join(' | '));
    return;
  }
  const d = (past ?? 0) - sumS;
  if (d !== 0) diffNg++;
  if (sumS % 10 !== 0) modNg++;
  console.log([name, ...vals.map(yen), yen(sumS), yen(past ?? 0), yen(d), ((sumS % 10) + 10) % 10].join(' | '));
});
check('全プレイヤーで 通算 = 各シーズン総合の合計', diffNg === 0, `不一致 ${diffNg}名`);
check('全プレイヤーの通算値が10の倍数', modNg === 0, `${modNg}名が端数`);
const abe = pastRows.find(r => r.name === '安部')?.totalPt;
check('安部の全シーズン通算が +329,780', abe === 329780, `実際=${yen(abe ?? 0)}`);

console.log('\n 残った不整合データ:');
const gNull = games.filter(g => g.season_id === null || !seasonIds.includes(g.season_id));
const cNull = chips.filter(c => c.season_id === null || !seasonIds.includes(c.season_id));
const cNullPt = chips.filter(c => c.chip_pt === null);
console.log(`  シーズン未設定/孤児の games: ${gNull.length}件 ${gNull.map(g => g.id).join(' ')}`);
console.log(`  シーズン未設定/孤児の chips: ${cNull.length}件`);
console.log(`  chip_pt が null の chips  : ${cNullPt.length}件`);
check('シーズン未設定/孤児の games が0件', gNull.length === 0, `${gNull.length}件`);
check('chip_pt が null の chip_settlements が0件', cNullPt.length === 0, `${cNullPt.length}件`);

// ───────────────────────────────────────────── タスク2
console.log('\n########## D. タスク2: 「その他」 ##########');
const other = players.find(p => p.name === 'その他');
const inPast = pastRows.some(r => r.name === 'その他');
const inPastChip = MJ.mjExcludeFromTotal(MJ.mjComputeChipCounts(scoped)).some(r => r.name === 'その他');
console.log(` players に「その他」: ${other ? 'あり(id=' + other.id + ')' : 'なし'}`);
console.log(` 全シーズン通算ランキングに出現: ${inPast ? 'はい' : 'いいえ'} / チップランキング: ${inPastChip ? 'はい' : 'いいえ'}`);
if (other) {
  seasons.forEach(s => {
    const v = perSeasonStats[s.id]['その他'];
    if (v !== undefined) console.log(`   ${s.name} のランキングには表示: ${yen(v)}`);
  });
}
check('全シーズン通算ランキングに「その他」が出ない', !inPast && !inPastChip);

// ───────────────────────────────────────────── 結果まとめ
console.log('\n\n########## 完了条件サマリー ##########');
console.log('| 項目 | 結果 | 詳細 |');
console.log('|---|---|---|');
verdicts.forEach(v => console.log(`| ${v.label} | ${PASS(v.ok)} | ${v.detail} |`));
const ng = verdicts.filter(v => !v.ok).length;
console.log(`\n${ng === 0 ? '✅ すべての検証項目に合格' : `❌ ${ng}件 未達`}`);

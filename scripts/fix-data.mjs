// DBデータ修正
//   確認(dry-run): node scripts/fix-data.mjs
//   実行         : node scripts/fix-data.mjs --execute
// 想定と違う状態を見つけたら、1行も書き込まずに中止する。
import { selAll, patch, del } from './db.mjs';

const EXECUTE = process.argv.includes('--execute');

// ── タスク1: 一の位が5の score_pt を10の倍数に直す ──────────────────────────
// 同一対局内で「順位が上の行を切り上げ、下の行を切り下げ」て±5を相殺する。
// → 対局の total_pt 合計は0のまま、他プレイヤーの値も変わらない。
const SCORE_FIXES = [
  { id: 306, game: 96, player: '森田', from: 1425,   to: 1430 },
  { id: 308, game: 96, player: '豊田', from: 525,    to: 520 },
  { id: 311, game: 97, player: '谷口', from: 19645,  to: 19650 },
  { id: 310, game: 97, player: '森田', from: -18185, to: -18190 },
];

// ── タスク3: 重複登録された season_id=null の対局を削除 ──────────────────────
// game 685 は game 686（2026-06-23, season 1）と素点・順位点・プレイヤーが完全に一致する
// 重複登録。past.html にだけ混入してシーズン別との差を生んでいた。
const DEL_GAME = 685;
const DEL_RESULT_IDS = [2225, 2226, 2227, 2228];
const DEL_GROUP = 5; // 2026-06-19 / season_id=null の迷子グループ（誤登録の原因）

const errors = [];
const [players, games, results, groups] = await Promise.all([
  selAll('players'), selAll('games'), selAll('game_results'), selAll('groups'),
]);
const pname = id => players.find(p => p.id === id)?.name ?? `ID:${id}`;
const resById = new Map(results.map(r => [r.id, r]));

console.log('########## タスク1: game_results の端数修正（UPDATE） ##########');
for (const f of SCORE_FIXES) {
  const r = resById.get(f.id);
  if (!r) { errors.push(`gr.id=${f.id} が存在しません`); continue; }
  if (r.game_id !== f.game) errors.push(`gr.id=${f.id} の game_id が想定(${f.game})と違う: ${r.game_id}`);
  if (pname(r.player_id) !== f.player) errors.push(`gr.id=${f.id} のプレイヤーが想定(${f.player})と違う: ${pname(r.player_id)}`);
  if (r.score_pt !== f.from) errors.push(`gr.id=${f.id} の score_pt が想定(${f.from})と違う: ${r.score_pt}`);
  if (r.total_pt !== f.from) errors.push(`gr.id=${f.id} の total_pt が想定(${f.from})と違う: ${r.total_pt}`);
  if (r.bonus_pt !== 0) errors.push(`gr.id=${f.id} の bonus_pt が0ではない: ${r.bonus_pt}`);
  console.log(`  gr.id=${f.id} (game ${f.game} / ${f.player}) score_pt,total_pt: ${f.from} → ${f.to}`);
}
// 修正後も各対局の合計が0になることを確認
for (const gid of [...new Set(SCORE_FIXES.map(f => f.game))]) {
  const rs = results.filter(r => r.game_id === gid);
  const after = rs.reduce((s, r) => {
    const f = SCORE_FIXES.find(x => x.id === r.id);
    return s + (f ? f.to : r.total_pt);
  }, 0);
  console.log(`  → game ${gid} の修正後 total_pt 合計 = ${after}`);
  if (after !== 0) errors.push(`game ${gid} の修正後合計が0でない: ${after}`);
  rs.forEach(r => {
    const v = SCORE_FIXES.find(x => x.id === r.id)?.to ?? r.total_pt;
    if (v % 10 !== 0) errors.push(`game ${gid} gr.id=${r.id} の修正後 total_pt が10の倍数でない: ${v}`);
  });
}

console.log('\n########## タスク3: 重複対局の削除（DELETE） ##########');
const dg = games.find(g => g.id === DEL_GAME);
if (!dg) errors.push(`game ${DEL_GAME} が存在しません`);
else {
  if (dg.season_id !== null) errors.push(`game ${DEL_GAME} の season_id が null ではない: ${dg.season_id}`);
  if (dg.date !== '2026-06-19') errors.push(`game ${DEL_GAME} の date が想定と違う: ${dg.date}`);
  console.log(`  games id=${DEL_GAME} (date=${dg.date} season_id=${dg.season_id} group=${dg.group_name})`);
}
const delRows = results.filter(r => r.game_id === DEL_GAME);
if (delRows.length !== DEL_RESULT_IDS.length) errors.push(`game ${DEL_GAME} の game_results が ${delRows.length}件（想定 ${DEL_RESULT_IDS.length}件）`);
delRows.forEach(r => {
  if (!DEL_RESULT_IDS.includes(r.id)) errors.push(`想定外の game_results id=${r.id}`);
  console.log(`  game_results id=${r.id} ${pname(r.player_id)} rank=${r.rank} total=${r.total_pt}`);
});
// 重複相手（game 686）が残っていることを必ず確認する
const twin = games.find(g => g.id === 686);
const sig = gid => results.filter(r => r.game_id === gid).map(r => `${r.player_id}:${r.score_pt}:${r.bonus_pt}`).sort().join('|');
if (!twin) errors.push('重複相手の game 686 が見つかりません');
else if (sig(686) !== sig(DEL_GAME)) errors.push('game 685 と 686 の内容が一致しません（重複ではない可能性）');
else console.log(`  ✓ 重複相手 game 686 (date=${twin.date} season_id=${twin.season_id}) は残ります`);

const grp = groups.find(g => g.id === DEL_GROUP);
if (!grp) errors.push(`groups ${DEL_GROUP} が存在しません`);
else {
  if (grp.season_id !== null) errors.push(`groups ${DEL_GROUP} の season_id が null ではない: ${grp.season_id}`);
  const stillUsed = games.filter(g => g.id !== DEL_GAME && g.date === grp.date && (g.group_name || '') === (grp.name || ''));
  if (stillUsed.length) errors.push(`groups ${DEL_GROUP} をまだ使っている対局があります: ${stillUsed.map(g => g.id).join(',')}`);
  console.log(`  groups id=${DEL_GROUP} (date=${grp.date} name=${grp.name} season_id=${grp.season_id})`);
}

const counts = { 'game_results UPDATE': SCORE_FIXES.length, 'game_results DELETE': delRows.length, 'games DELETE': dg ? 1 : 0, 'groups DELETE': grp ? 1 : 0 };
console.log('\n########## 影響する件数 ##########');
Object.entries(counts).forEach(([k, v]) => console.log(`  ${k}: ${v}件`));
console.log(`  合計: ${Object.values(counts).reduce((a, b) => a + b, 0)}件`);

if (errors.length) {
  console.error('\n❌ 想定と違う状態を検出しました。1行も書き込まずに中止します:');
  errors.forEach(e => console.error('   - ' + e));
  process.exit(1);
}

if (!EXECUTE) {
  console.log('\n(dry-run) 実行するには --execute を付けてください');
  process.exit(0);
}

console.log('\n書き込みを開始します...');
for (const f of SCORE_FIXES) {
  const out = await patch('game_results', `id=eq.${f.id}`, { score_pt: f.to, total_pt: f.to });
  if (out.length !== 1) { console.error(`❌ gr.id=${f.id} の更新件数が ${out.length} 件（想定1件）。中止します`); process.exit(1); }
  console.log(`  ✓ game_results id=${f.id} → ${f.to}`);
}
const d1 = await del('game_results', `game_id=eq.${DEL_GAME}`);
if (d1.length !== delRows.length) { console.error(`❌ game_results の削除件数が ${d1.length} 件（想定 ${delRows.length} 件）。中止します`); process.exit(1); }
console.log(`  ✓ game_results ${d1.length}件 削除`);
const d2 = await del('games', `id=eq.${DEL_GAME}`);
if (d2.length !== 1) { console.error(`❌ games の削除件数が ${d2.length} 件（想定1件）。中止します`); process.exit(1); }
console.log('  ✓ games 1件 削除');
const d3 = await del('groups', `id=eq.${DEL_GROUP}`);
if (d3.length !== 1) { console.error(`❌ groups の削除件数が ${d3.length} 件（想定1件）。中止します`); process.exit(1); }
console.log('  ✓ groups 1件 削除');

console.log('\n✅ DB修正完了');

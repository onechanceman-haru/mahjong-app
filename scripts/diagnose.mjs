// Phase 1 調査スクリプト（読み取りのみ）
import { selAll } from './db.mjs';

const DATA_START = '2026-04-07';
const CARRYOVER_DATE = '1900-01-01';
const yen = n => (n >= 0 ? '+' : '') + n.toLocaleString();

const [players, seasons, games, results, chips] = await Promise.all([
  selAll('players'), selAll('seasons'), selAll('games'),
  selAll('game_results'), selAll('chip_settlements'),
]);
const pname = id => players.find(p => p.id === id)?.name ?? `ID:${id}`;
const gameById = new Map(games.map(g => [g.id, g]));
const seasonIds = new Set(seasons.map(s => s.id));

console.log('=== 行数 ===');
console.log({ players: players.length, seasons: seasons.length, games: games.length, game_results: results.length, chip_settlements: chips.length });
console.log('\n=== seasons ===');
seasons.forEach(s => console.log(` id=${s.id} ${s.name} created=${s.created_at}`));
console.log('\n=== players ===');
console.log(players.map(p => `${p.id}:${p.name}`).join(' , '));

// ───────── タスク1 ─────────
console.log('\n\n########## タスク1: 端数（一の位≠0） ##########');
const badTotal = results.filter(r => (r.total_pt || 0) % 10 !== 0);
console.log(`\n[A] game_results.total_pt %10!=0 : ${badTotal.length}件`);
badTotal.forEach(r => console.log(`  gr.id=${r.id} game=${r.game_id} ${pname(r.player_id)} score=${r.score_pt} bonus=${r.bonus_pt} total=${r.total_pt}`));

const badSum = results.filter(r => (r.total_pt || 0) !== (r.score_pt || 0) + (r.bonus_pt || 0));
console.log(`\n[B] total_pt != score_pt+bonus_pt : ${badSum.length}件`);
badSum.forEach(r => console.log(`  gr.id=${r.id} game=${r.game_id} ${pname(r.player_id)} score=${r.score_pt} bonus=${r.bonus_pt} total=${r.total_pt} (差${r.total_pt - (r.score_pt || 0) - (r.bonus_pt || 0)})`));

const badScore = results.filter(r => (r.score_pt || 0) % 10 !== 0);
const badBonus = results.filter(r => (r.bonus_pt || 0) % 10 !== 0);
console.log(`\n[B2] score_pt %10!=0 : ${badScore.length}件 / bonus_pt %10!=0 : ${badBonus.length}件`);
badScore.forEach(r => console.log(`  SCORE gr.id=${r.id} game=${r.game_id} ${pname(r.player_id)} score=${r.score_pt}`));
badBonus.forEach(r => console.log(`  BONUS gr.id=${r.id} game=${r.game_id} ${pname(r.player_id)} bonus=${r.bonus_pt}`));

const badChip = chips.filter(c => (c.chip_pt ?? 0) % 10 !== 0);
console.log(`\n[C] chip_settlements.chip_pt %10!=0 : ${badChip.length}件`);
badChip.forEach(c => console.log(`  cs.id=${c.id} ${pname(c.player_id)} count=${c.chip_count} pt=${c.chip_pt}`));

// 対局ごとの total_pt 合計
const perGame = new Map();
results.forEach(r => {
  if (!perGame.has(r.game_id)) perGame.set(r.game_id, []);
  perGame.get(r.game_id).push(r);
});
const nonZeroGames = [...perGame.entries()].filter(([, rs]) => rs.reduce((s, r) => s + (r.total_pt || 0), 0) !== 0);
console.log(`\n[D] total_pt 合計≠0 の対局 : ${nonZeroGames.length}件`);
nonZeroGames.forEach(([gid, rs]) => {
  const g = gameById.get(gid);
  const sum = rs.reduce((s, r) => s + (r.total_pt || 0), 0);
  console.log(`  game=${gid} date=${g?.date} season=${g?.season_id} pc=${g?.player_count} 合計=${sum}`);
  rs.forEach(r => console.log(`      gr.id=${r.id} ${pname(r.player_id)} rank=${r.rank} score=${r.score_pt} bonus=${r.bonus_pt} total=${r.total_pt}`));
});
const nonZeroScoreGames = [...perGame.entries()].filter(([, rs]) => rs.reduce((s, r) => s + (r.score_pt || 0), 0) !== 0);
console.log(`\n[D2] score_pt 合計≠0 の対局 : ${nonZeroScoreGames.length}件`);
nonZeroScoreGames.slice(0, 20).forEach(([gid, rs]) => {
  const g = gameById.get(gid);
  console.log(`  game=${gid} date=${g?.date} score合計=${rs.reduce((s, r) => s + (r.score_pt || 0), 0)}`);
});

// プレイヤー別通算の端数
console.log('\n[E] プレイヤー別 通算(全件・past.html相当)の端数');
const tot = {};
results.forEach(r => { tot[r.player_id] = (tot[r.player_id] || 0) + (r.total_pt || 0); });
chips.forEach(c => {
  const pt = c.chip_pt !== null ? (c.chip_pt || 0) : (c.chip_count || 0) * 300;
  tot[c.player_id] = (tot[c.player_id] || 0) + pt;
});
Object.entries(tot).forEach(([pid, v]) => {
  if (v % 10 !== 0) console.log(`  ${pname(Number(pid))}: ${yen(v)}  (一の位=${((v % 10) + 10) % 10})`);
});

// ───────── タスク2 ─────────
console.log('\n\n########## タスク2: プレイヤー「その他」 ##########');
const other = players.filter(p => p.name.includes('その他'));
if (!other.length) console.log('  該当プレイヤーなし');
other.forEach(p => {
  const gr = results.filter(r => r.player_id === p.id);
  const cs = chips.filter(c => c.player_id === p.id);
  console.log(`  id=${p.id} name=${p.name} : game_results ${gr.length}件 / chip_settlements ${cs.length}件`);
  gr.forEach(r => {
    const g = gameById.get(r.game_id);
    console.log(`     gr.id=${r.id} game=${r.game_id} date=${g?.date} season=${g?.season_id} pc=${g?.player_count} rank=${r.rank} score=${r.score_pt} bonus=${r.bonus_pt} total=${r.total_pt}`);
  });
  cs.forEach(c => console.log(`     cs.id=${c.id} date=${c.date} season=${c.season_id} count=${c.chip_count} pt=${c.chip_pt}`));
});

// ───────── タスク3 ─────────
console.log('\n\n########## タスク3: 通算 vs シーズン別 ##########');
console.log('\n[F] season_id が null / 存在しないシーズンを指す行');
const gNullSeason = games.filter(g => g.season_id === null);
const gOrphan = games.filter(g => g.season_id !== null && !seasonIds.has(g.season_id));
const cNullSeason = chips.filter(c => c.season_id === null);
const cOrphan = chips.filter(c => c.season_id !== null && !seasonIds.has(c.season_id));
console.log(`  games: season_id=null ${gNullSeason.length}件 / 孤児 ${gOrphan.length}件`);
gNullSeason.forEach(g => console.log(`     game=${g.id} date=${g.date} group=${g.group_name} pc=${g.player_count}`));
gOrphan.forEach(g => console.log(`     game=${g.id} date=${g.date} season_id=${g.season_id}`));
console.log(`  chip_settlements: season_id=null ${cNullSeason.length}件 / 孤児 ${cOrphan.length}件`);
cNullSeason.forEach(c => console.log(`     cs.id=${c.id} ${pname(c.player_id)} date=${c.date} group=${c.group_name} count=${c.chip_count} pt=${c.chip_pt}`));
cOrphan.forEach(c => console.log(`     cs.id=${c.id} ${pname(c.player_id)} season_id=${c.season_id} date=${c.date} count=${c.chip_count} pt=${c.chip_pt}`));

console.log('\n[G] chip_pt が null の行');
const chipNullPt = chips.filter(c => c.chip_pt === null);
console.log(`  ${chipNullPt.length}件`);
chipNullPt.forEach(c => console.log(`     cs.id=${c.id} ${pname(c.player_id)} season=${c.season_id} date=${c.date} count=${c.chip_count} → count*300=${(c.chip_count || 0) * 300}`));

console.log('\n[H] game_results で参照先の games が存在しない行（孤児）');
const grOrphan = results.filter(r => !gameById.has(r.game_id));
console.log(`  ${grOrphan.length}件`);
grOrphan.slice(0, 30).forEach(r => console.log(`     gr.id=${r.id} game_id=${r.game_id} ${pname(r.player_id)} total=${r.total_pt}`));

// index.html と同じルールでシーズン別集計
function seasonTotals(seasonId) {
  const ids = new Set(games.filter(g => String(g.season_id) === String(seasonId)).map(g => g.id));
  const m = {};
  results.filter(r => ids.has(r.game_id)).forEach(r => {
    m[r.player_id] = (m[r.player_id] || 0) + (r.total_pt || 0);
  });
  chips.filter(c => String(c.season_id) === String(seasonId)).forEach(c => {
    m[c.player_id] = (m[c.player_id] || 0) + (c.chip_pt || 0);
  });
  return m;
}

console.log('\n[I] シーズン別合計（index.html 総合タブ相当）');
const perSeason = {};
seasons.forEach(s => { perSeason[s.id] = seasonTotals(s.id); });
const allPids = [...new Set([...results.map(r => r.player_id), ...chips.map(c => c.player_id)])];
console.log(['プレイヤー', ...seasons.map(s => s.name), 'シーズン合計', 'past現状', '差'].join(' | '));
allPids.forEach(pid => {
  const vals = seasons.map(s => perSeason[s.id][pid] || 0);
  const sumS = vals.reduce((a, b) => a + b, 0);
  const past = tot[pid] || 0;
  console.log([pname(pid), ...vals.map(yen), yen(sumS), yen(past), yen(past - sumS)].join(' | '));
});

// ───────── 参考 ─────────
console.log('\n\n########## 参考: グループ / 日付 ##########');
const groups = [...new Set(games.filter(g => g.date !== CARRYOVER_DATE).map(g => `${g.season_id}|${g.date}|${g.group_name || ''}`))];
console.log(`  グループ数: ${groups.length}（末尾10件）`);
groups.sort().slice(-10).forEach(k => console.log('   ', k));
console.log(`\n  DATA_START(${DATA_START}) より前の games: ${games.filter(g => g.date < DATA_START && g.date !== CARRYOVER_DATE).length}件`);
console.log(`  引継ぎ(${CARRYOVER_DATE}) games: ${games.filter(g => g.date === CARRYOVER_DATE).length}件`);
console.log(`  games の season_id 分布: ${JSON.stringify(games.reduce((a, g) => { a[g.season_id] = (a[g.season_id] || 0) + 1; return a; }, {}))}`);
console.log(`  chips の season_id 分布: ${JSON.stringify(chips.reduce((a, c) => { a[c.season_id] = (a[c.season_id] || 0) + 1; return a; }, {}))}`);

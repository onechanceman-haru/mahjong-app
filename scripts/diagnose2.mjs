// Phase 1 追加調査（読み取りのみ）: 問題の対局を個別に精査
import { selAll } from './db.mjs';

const [players, seasons, games, results, chips] = await Promise.all([
  selAll('players'), selAll('seasons'), selAll('games'),
  selAll('game_results'), selAll('chip_settlements'),
]);
const pname = id => players.find(p => p.id === id)?.name ?? `ID:${id}`;
const gameById = new Map(games.map(g => [g.id, g]));
const yen = n => (n >= 0 ? '+' : '') + n.toLocaleString();

function dumpGame(gid) {
  const g = gameById.get(gid);
  console.log(`\n--- game ${gid} ---`);
  console.log(`  ${JSON.stringify(g)}`);
  const rs = results.filter(r => r.game_id === gid).sort((a, b) => a.rank - b.rank);
  rs.forEach(r => console.log(`   gr.id=${r.id} rank=${r.rank} ${pname(r.player_id).padEnd(4)} score=${String(r.score_pt).padStart(9)} bonus=${String(r.bonus_pt).padStart(7)} total=${String(r.total_pt).padStart(9)}`));
  console.log(`   合計: score=${rs.reduce((s, r) => s + r.score_pt, 0)} bonus=${rs.reduce((s, r) => s + r.bonus_pt, 0)} total=${rs.reduce((s, r) => s + r.total_pt, 0)}`);
}

console.log('########## タスク1: 端数のある対局 96 / 97 ##########');
[96, 97].forEach(dumpGame);

console.log('\n\n########## タスク1: 96/97 と同じグループの対局すべて ##########');
const g96 = gameById.get(96);
games.filter(g => g.date === g96.date && (g.group_name || '') === (g96.group_name || ''))
  .forEach(g => dumpGame(g.id));

console.log('\n\n########## タスク2: シーズン4(シーズン1)の全対局 ##########');
games.filter(g => g.season_id === 4).forEach(g => dumpGame(g.id));

console.log('\n\n########## タスク3: season_id=null の game 685 ##########');
dumpGame(685);
console.log('\n  同じ日付(2026-06-19)の他の対局:');
games.filter(g => g.date === '2026-06-19').forEach(g => console.log(`   game=${g.id} season_id=${g.season_id} group=${g.group_name} pc=${g.player_count} created=${g.created_at}`));
console.log('\n  2026-06-19 のチップ記録:');
chips.filter(c => c.date === '2026-06-19').forEach(c => console.log(`   cs.id=${c.id} season=${c.season_id} ${pname(c.player_id)} group=${c.group_name} count=${c.chip_count} pt=${c.chip_pt}`));

console.log('\n\n########## 各シーズンの日付範囲 ##########');
seasons.forEach(s => {
  const gs = games.filter(g => g.season_id === s.id).map(g => g.date).sort();
  const cs = chips.filter(c => c.season_id === s.id).map(c => c.date).sort();
  console.log(` season ${s.id} (${s.name}): games ${gs.length}件 ${gs[0]} 〜 ${gs[gs.length - 1]} / chips ${cs.length}件 ${cs[0]} 〜 ${cs[cs.length - 1]}`);
});

console.log('\n\n########## 同点(rank重複)のある対局と bonus_pt ##########');
const perGame = new Map();
results.forEach(r => {
  if (!perGame.has(r.game_id)) perGame.set(r.game_id, []);
  perGame.get(r.game_id).push(r);
});
let tieCount = 0;
for (const [gid, rs] of perGame) {
  const ranks = rs.map(r => r.rank);
  if (new Set(ranks).size !== ranks.length) {
    tieCount++;
    if (tieCount <= 10) {
      const g = gameById.get(gid);
      console.log(` game=${gid} date=${g?.date} season=${g?.season_id} bonus合計=${rs.reduce((s, r) => s + r.bonus_pt, 0)} ` +
        rs.map(r => `${pname(r.player_id)}:r${r.rank}/b${r.bonus_pt}`).join(' '));
    }
  }
}
console.log(` 同点を含む対局: ${tieCount}件`);

console.log('\n\n########## 「その他」のコード上の扱い ##########');
console.log('(grep は別途)');

console.log('\n\n########## 参考: 全体の total_pt + chip_pt 総和 ##########');
console.log(' game_results total_pt 総和 =', results.reduce((s, r) => s + (r.total_pt || 0), 0));
console.log(' chip_settlements chip_pt 総和 =', chips.reduce((s, c) => s + (c.chip_pt || 0), 0));
seasons.forEach(s => {
  const ids = new Set(games.filter(g => g.season_id === s.id).map(g => g.id));
  const t = results.filter(r => ids.has(r.game_id)).reduce((a, r) => a + r.total_pt, 0);
  const c = chips.filter(x => x.season_id === s.id).reduce((a, x) => a + (x.chip_pt || 0), 0);
  console.log(` season ${s.id}: results総和=${yen(t)} chips総和=${yen(c)} 合計=${yen(t + c)}`);
});

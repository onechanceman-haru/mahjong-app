// Phase 1 追加調査3（読み取りのみ）: game 685 が重複登録かどうかの確認
import { selAll } from './db.mjs';

const [players, games, results] = await Promise.all([
  selAll('players'), selAll('games'), selAll('game_results'),
]);
const pname = id => players.find(p => p.id === id)?.name ?? `ID:${id}`;
const byGame = new Map();
results.forEach(r => {
  if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
  byGame.get(r.game_id).push(r);
});
const sig = gid => (byGame.get(gid) || [])
  .map(r => `${r.player_id}:${r.score_pt}:${r.bonus_pt}`)
  .sort().join('|');

const target = sig(685);
console.log('game685 signature:', target);
console.log('\n同一シグネチャの対局:');
[...byGame.keys()].filter(gid => sig(gid) === target).forEach(gid => {
  const g = games.find(x => x.id === gid);
  console.log(`  game=${gid} date=${g.date} season=${g.season_id} group=${g.group_name} created=${g.created_at}`);
});

console.log('\n2026-06-15 〜 2026-06-26 の対局一覧:');
games.filter(g => g.date >= '2026-06-15' && g.date <= '2026-06-26')
  .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
  .forEach(g => {
    const rs = byGame.get(g.id) || [];
    console.log(`  game=${String(g.id).padStart(3)} date=${g.date} season=${g.season_id} group=${String(g.group_name).padEnd(12)} created=${g.created_at} :: ` +
      rs.sort((a, b) => a.rank - b.rank).map(r => `${pname(r.player_id)}${r.total_pt >= 0 ? '+' : ''}${r.total_pt}`).join(' '));
  });

// 同一メンバー・同一素点の組み合わせが他日に無いか（念のため素点集合だけで照合）
const scoreSig = gid => (byGame.get(gid) || []).map(r => `${r.player_id}:${r.score_pt}`).sort().join('|');
const t2 = scoreSig(685);
console.log('\n素点のみ一致する対局:');
[...byGame.keys()].filter(gid => scoreSig(gid) === t2).forEach(gid => {
  const g = games.find(x => x.id === gid);
  console.log(`  game=${gid} date=${g.date} season=${g.season_id} group=${g.group_name}`);
});

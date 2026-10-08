// Phase 1 調査: 素点入力へ切り替えたときの互換性リスクを事前確認（読み取りのみ）
import { selAll } from './db.mjs';

const [players, games, results] = await Promise.all([
  selAll('players'), selAll('games'), selAll('game_results'),
]);
const pname = id => players.find(p => p.id === id)?.name ?? `ID:${id}`;
const byGame = new Map();
results.forEach(r => { if (!byGame.has(r.game_id)) byGame.set(r.game_id, []); byGame.get(r.game_id).push(r); });

const CARRY = '1900-01-01';
const buckets = { rankMismatch: [], tie: [], bonusSumNonZero: [], countMismatch: [], rankZero: [], scoreSumNonZero: [], rawNot100: [] };

for (const g of games) {
  const rs = byGame.get(g.id) || [];
  if (!rs.length) continue;
  const n = rs.length;

  if (rs.some(r => r.rank === 0)) { buckets.rankZero.push(g.id); continue; }
  if (n !== g.player_count) buckets.countMismatch.push(`game=${g.id} 結果${n}件 / player_count=${g.player_count}`);

  // 素点を復元 → 期待される順位（同点は同じ順位）
  const rows = rs.map(r => ({ ...r, raw: 35000 + r.score_pt * 10 }));
  const sorted = [...rows].sort((a, b) => b.raw - a.raw);
  const expRank = {};
  sorted.forEach((r, i) => {
    expRank[r.id] = (i > 0 && r.raw === sorted[i - 1].raw) ? expRank[sorted[i - 1].id] : i + 1;
  });
  const mism = rows.filter(r => r.rank !== expRank[r.id]);
  if (mism.length) buckets.rankMismatch.push({ g, rows, expRank });

  if (new Set(rows.map(r => r.raw)).size !== n) buckets.tie.push({ g, rows });

  const bSum = rs.reduce((s, r) => s + (r.bonus_pt || 0), 0);
  if (bSum !== 0) buckets.bonusSumNonZero.push(`game=${g.id} date=${g.date} bonus合計=${bSum} ` + rs.map(r => `${pname(r.player_id)}:${r.bonus_pt}`).join(' '));

  const sSum = rs.reduce((s, r) => s + (r.score_pt || 0), 0);
  if (sSum !== 0) buckets.scoreSumNonZero.push(`game=${g.id} score合計=${sSum}`);

  // 復元した素点が100点単位か（入力欄が100点単位のため）
  if (rows.some(r => r.raw % 100 !== 0)) buckets.rawNot100.push(`game=${g.id} date=${g.date} ` + rows.filter(r => r.raw % 100 !== 0).map(r => `${pname(r.player_id)}:${r.raw}`).join(' '));
}

console.log(`対局総数: ${games.length}（結果あり: ${byGame.size}）\n`);

console.log(`① rank=0 の対局（引継ぎ等・照合対象外）: ${buckets.rankZero.length}件 ${buckets.rankZero.join(' ')}`);
console.log(`② 結果件数 ≠ player_count: ${buckets.countMismatch.length}件`);
buckets.countMismatch.slice(0, 20).forEach(x => console.log('   ' + x));
console.log(`③ score_pt 合計 ≠ 0: ${buckets.scoreSumNonZero.length}件`);
console.log(`④ bonus_pt 合計 ≠ 0: ${buckets.bonusSumNonZero.length}件`);
buckets.bonusSumNonZero.slice(0, 20).forEach(x => console.log('   ' + x));

console.log(`\n⑤ 保存済み rank が素点順と一致しない対局: ${buckets.rankMismatch.length}件`);
buckets.rankMismatch.slice(0, 20).forEach(({ g, rows, expRank }) => {
  console.log(`   game=${g.id} date=${g.date} season=${g.season_id} group=${g.group_name} pc=${g.player_count}`);
  [...rows].sort((a, b) => b.raw - a.raw).forEach(r =>
    console.log(`      ${pname(r.player_id).padEnd(4)} raw=${String(r.raw).padStart(7)} score=${String(r.score_pt).padStart(6)} bonus=${String(r.bonus_pt).padStart(6)} 保存rank=${r.rank} 期待rank=${expRank[r.id]}`));
});

console.log(`\n⑥ 同点を含む対局（順位点の一意復元が不可）: ${buckets.tie.length}件`);
buckets.tie.forEach(({ g, rows }) => {
  console.log(`   game=${g.id} date=${g.date} pc=${g.player_count}`);
  [...rows].sort((a, b) => b.raw - a.raw).forEach(r =>
    console.log(`      ${pname(r.player_id).padEnd(4)} raw=${String(r.raw).padStart(7)} rank=${r.rank} bonus=${r.bonus_pt}`));
});

console.log(`\n⑦ 復元した素点が100点単位でない対局: ${buckets.rawNot100.length}件`);
buckets.rawNot100.slice(0, 20).forEach(x => console.log('   ' + x));

// 素点の分布（入力欄の桁数確認用）
const allRaw = [...byGame.values()].flat().filter(r => r.rank !== 0).map(r => 35000 + r.score_pt * 10);
console.log(`\n素点の範囲: ${Math.min(...allRaw).toLocaleString()} 〜 ${Math.max(...allRaw).toLocaleString()}`);
console.log(`マイナス素点の件数: ${allRaw.filter(v => v < 0).length}件`);
console.log(`素点が100点単位でない行: ${allRaw.filter(v => v % 100 !== 0).length}件`);

// localStorage 互換: rankPoints の長さが人数と合わない可能性
console.log(`\nplayer_count の分布: ${JSON.stringify(games.reduce((a, g) => { a[g.player_count] = (a[g.player_count] || 0) + 1; return a; }, {}))}`);

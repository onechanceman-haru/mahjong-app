// 互換性テスト（読み取りのみ・DBへの書き込みは一切しない）
// 本番DBの全対局について次を確認する:
//   1. 保存済み score_pt から素点を復元（素点 = 35,000 + score_pt × 10）
//   2. 保存済み bonus_pt を rank 順に並べて順位点を復元
//   3. calcGameResult で再計算し、保存済み rank / bonus_pt / total_pt と全件照合
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selAll, ROOT } from './db.mjs';

const code = readFileSync(join(ROOT, 'scoring.js'), 'utf8');
const S = new Function(code + `
  return { MJ_BASE_SCORE, mjRequiredTotal, mjRawToScorePt, mjScorePtToRaw,
           calcGameResult, mjValidateRawScores, mjRecoverRankPoints, MJ_RANK_DEFAULTS };
`)();

const CARRYOVER_DATE = '1900-01-01';
const [players, games, results] = await Promise.all([
  selAll('players'), selAll('games'), selAll('game_results'),
]);
const pname = id => players.find(p => p.id === id)?.name ?? `ID:${id}`;
const byGame = new Map();
results.forEach(r => { if (!byGame.has(r.game_id)) byGame.set(r.game_id, []); byGame.get(r.game_id).push(r); });

const stats = {
  total: 0, skippedCarryover: 0, skippedRankZero: 0,
  checked: 0, allMatch: 0,
  rankOnly: [], bonusMismatch: [], totalMismatch: [], scoreMismatch: [],
  ambiguous: [], rawNot100: [], sumMismatch: [],
};

for (const g of games) {
  stats.total++;
  const rs = byGame.get(g.id) || [];
  if (!rs.length) continue;

  // 引継ぎ対局（rank=0 / 1900-01-01）は順位の概念がなく history でも編集できないため対象外
  if (g.date === CARRYOVER_DATE || rs.some(r => r.rank === 0)) {
    if (g.date === CARRYOVER_DATE) stats.skippedCarryover++; else stats.skippedRankZero++;
    continue;
  }
  stats.checked++;

  const stored = [...rs].sort((a, b) => a.rank - b.rank);
  const n = stored.length;

  // 1. 素点を復元
  const rawScores = stored.map(r => ({ player_id: r.player_id, raw: S.mjScorePtToRaw(r.score_pt) }));
  if (rawScores.some(r => r.raw % 100 !== 0)) {
    stats.rawNot100.push(`game=${g.id} date=${g.date} ` + rawScores.filter(r => r.raw % 100 !== 0).map(r => `${pname(r.player_id)}:${r.raw}`).join(' '));
  }
  // 素点合計が 人数 × 35,000 になるか
  const v = S.mjValidateRawScores(rawScores, n);
  if (!v.ok) stats.sumMismatch.push(`game=${g.id} date=${g.date} pc=${g.player_count} 素点合計=${v.sum} 目標=${v.required}`);

  // 2. 順位点を復元
  const rec = S.mjRecoverRankPoints(stored);
  if (rec.ambiguous) stats.ambiguous.push({ g, stored, rankPoints: rec.rankPoints });

  // 3. 再計算して照合
  const calc = S.calcGameResult(rawScores, rec.rankPoints);
  const diffs = { rank: [], bonus: [], total: [], score: [] };
  calc.forEach((c, i) => {
    const s = stored[i];
    if (c.rank !== s.rank)         diffs.rank.push(`${pname(s.player_id)} 保存${s.rank}→再計算${c.rank}`);
    if (c.bonus_pt !== s.bonus_pt) diffs.bonus.push(`${pname(s.player_id)} 保存${s.bonus_pt}→再計算${c.bonus_pt}`);
    if (c.total_pt !== s.total_pt) diffs.total.push(`${pname(s.player_id)} 保存${s.total_pt}→再計算${c.total_pt}`);
    if (c.score_pt !== s.score_pt) diffs.score.push(`${pname(s.player_id)} 保存${s.score_pt}→再計算${c.score_pt}`);
  });

  const any = Object.values(diffs).some(d => d.length);
  if (!any) { stats.allMatch++; continue; }

  const entry = { g, stored, diffs, rankPoints: rec.rankPoints, ambiguous: rec.ambiguous };
  if (diffs.score.length) stats.scoreMismatch.push(entry);
  else if (diffs.total.length) stats.totalMismatch.push(entry);
  else if (diffs.bonus.length) stats.bonusMismatch.push(entry);
  else stats.rankOnly.push(entry);
}

const dump = (title, list, guess) => {
  console.log(`\n### ${title}: ${list.length}件`);
  list.forEach(({ g, stored, diffs, rankPoints }) => {
    console.log(`  game=${g.id} date=${g.date} season=${g.season_id} group=${g.group_name} pc=${g.player_count}`);
    console.log(`    復元した順位点: [${rankPoints.join(', ')}]`);
    [...stored].sort((a, b) => a.rank - b.rank).forEach(r =>
      console.log(`      ${pname(r.player_id).padEnd(4)} 素点=${String(S.mjScorePtToRaw(r.score_pt)).padStart(8)} rank=${r.rank} score=${r.score_pt} bonus=${r.bonus_pt} total=${r.total_pt}`));
    Object.entries(diffs).filter(([, d]) => d.length).forEach(([k, d]) => console.log(`    差分[${k}]: ${d.join(' / ')}`));
    if (guess) console.log(`    推測される原因: ${guess}`);
  });
};

console.log('########## 互換性テスト（本番DB・読み取りのみ） ##########\n');
console.log(`対局総数              : ${stats.total}`);
console.log(`  引継ぎ対局（対象外）: ${stats.skippedCarryover}`);
console.log(`  rank=0（対象外）    : ${stats.skippedRankZero}`);
console.log(`照合した対局          : ${stats.checked}`);
console.log(`  完全一致            : ${stats.allMatch}`);
console.log(`  rank のみ不一致      : ${stats.rankOnly.length}`);
console.log(`  bonus_pt 不一致      : ${stats.bonusMismatch.length}`);
console.log(`  total_pt 不一致      : ${stats.totalMismatch.length}`);
console.log(`  score_pt 不一致      : ${stats.scoreMismatch.length}`);

console.log(`\n素点が100点単位でない対局 : ${stats.rawNot100.length}件`);
stats.rawNot100.slice(0, 10).forEach(x => console.log('   ' + x));
console.log(`素点合計が 人数×35,000 にならない対局 : ${stats.sumMismatch.length}件`);
stats.sumMismatch.slice(0, 10).forEach(x => console.log('   ' + x));

console.log(`\n順位点を一意に復元できない（同点を含む）対局 : ${stats.ambiguous.length}件`);
stats.ambiguous.forEach(({ g, stored }) => {
  console.log(`   game=${g.id} date=${g.date} pc=${g.player_count} ` +
    [...stored].sort((a, b) => a.rank - b.rank).map(r => `${pname(r.player_id)}:素点${S.mjScorePtToRaw(r.score_pt)}/rank${r.rank}/bonus${r.bonus_pt}`).join(' '));
});
console.log('   → history で編集するときは順位点の確認画面を出す（推測で保存しない）');

if (stats.scoreMismatch.length) dump('score_pt 不一致', stats.scoreMismatch, '素点の復元式が合っていない可能性。要調査');
if (stats.totalMismatch.length) dump('total_pt 不一致', stats.totalMismatch, 'total_pt ≠ score_pt + bonus_pt のデータ');
if (stats.bonusMismatch.length) dump('bonus_pt 不一致', stats.bonusMismatch, '同点の順位点配分ルールが旧アプリと違う可能性');
if (stats.rankOnly.length) dump('rank のみ不一致', stats.rankOnly,
  '同点なのに旧アプリ/移行では連番の rank（例 3位と4位）が入っている。収支（total_pt）は一致するため集計に影響なし');

console.log('\n\n########## 判定 ##########');
console.log('| 項目 | 結果 |');
console.log('|---|---|');
const row = (k, ok, d) => console.log(`| ${k} | ${ok ? '✅ OK' : '❌ NG'} ${d} |`);
row('score_pt が全件一致（素点復元が可逆）', stats.scoreMismatch.length === 0, `不一致 ${stats.scoreMismatch.length}件`);
row('total_pt が全件一致', stats.totalMismatch.length === 0, `不一致 ${stats.totalMismatch.length}件`);
row('bonus_pt が全件一致', stats.bonusMismatch.length === 0, `不一致 ${stats.bonusMismatch.length}件`);
row('素点が全件100点単位', stats.rawNot100.length === 0, `違反 ${stats.rawNot100.length}件`);
row('素点合計が全件 人数×35,000', stats.sumMismatch.length === 0, `違反 ${stats.sumMismatch.length}件`);
row('rank が一致（既知の旧形式2件を除く）', stats.rankOnly.length <= 2, `不一致 ${stats.rankOnly.length}件`);

const fatal = stats.scoreMismatch.length + stats.totalMismatch.length + stats.bonusMismatch.length
            + stats.rawNot100.length + stats.sumMismatch.length;
console.log(`\n${fatal === 0 ? '✅ 保存形式の互換性に問題なし（既存データの書き換えは不要）' : `❌ ${fatal}件の要調査あり`}`);

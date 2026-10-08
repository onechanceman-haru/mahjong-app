// 検証（読み取りのみ）: 履歴の日別表示・件数の取りこぼし解消・グループ集計の一致
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selAll, sel, ROOT } from './db.mjs';

// stats.js の共通集計を読み込む
const MJ = new Function(readFileSync(join(ROOT, 'stats.js'), 'utf8') + `
  return { mjComputeGroupTotals, mjIsCarryover, MJ_CARRYOVER_DATE };
`)();

const PASS = ok => (ok ? '✅ OK' : '❌ NG');
const verdicts = [];
const check = (label, ok, detail = '') => verdicts.push({ label, ok, detail });
const CARRY = MJ.MJ_CARRYOVER_DATE;

const [players, seasons, games, results, chips, groups] = await Promise.all([
  selAll('players'), selAll('seasons'), selAll('games'),
  selAll('game_results'), selAll('chip_settlements'), selAll('groups'),
]);
const pname = id => players.find(p => p.id === id)?.name ?? `ID:${id}`;

// ── ① 1000件超の取りこぼしが解消されているか（実リクエストで確認） ──────────
console.log('########## ① game_results の取得件数（全期間） ##########');

// 旧実装: .in('game_id', ids) を1回だけ（上限1000件）
async function oldFetch(ids) {
  const rows = await sel('game_results', `select=id&game_id=in.(${ids.join(',')})`);
  return rows.length;
}
// 新実装: 200件ずつに分割 ＋ Range でページング
async function newFetch(ids) {
  const CHUNK = 200, PAGE = 1000;
  let total = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const rows = await sel('game_results',
        `select=id&game_id=in.(${part.join(',')})&order=id.asc&offset=${from}&limit=${PAGE}`);
      total += rows.length;
      if (rows.length < PAGE) break;
    }
  }
  return total;
}

for (const s of seasons) {
  const gs = games.filter(g => String(g.season_id) === String(s.id));
  if (!gs.length) continue;
  const ids = gs.map(g => g.id);
  const truth = results.filter(r => ids.includes(r.game_id)).length;
  const oldN = await oldFetch(ids);
  const newN = await newFetch(ids);
  console.log(` season ${s.id} (${s.name}): games ${gs.length}件 / DBの game_results ${truth}件`);
  console.log(`    旧 .in() 1回        : ${oldN}件 ${oldN === truth ? '' : `← ${truth - oldN}件 取りこぼし`}`);
  console.log(`    新 分割＋ページング  : ${newN}件 ${newN === truth ? '✅ 一致' : '❌ 不一致'}`);
  check(`season ${s.id}: 全期間の game_results が全件取得できる（${truth}件）`, newN === truth, `新=${newN} / 旧=${oldN}`);
}

// ── ② 日 × group_name のまとめ（loadHistory と同じロジック） ────────────────
console.log('\n########## ② 日ごとのカードへのまとめ ##########');
function buildDays(gameList, chipList) {
  const map = new Map();
  const touch = (date, gname) => {
    const k = `${date}|${gname || ''}`;
    if (!map.has(k)) map.set(k, { key: k, date, groupName: gname || '', games: [], chips: [] });
    return map.get(k);
  };
  gameList.filter(g => !MJ.mjIsCarryover(g)).forEach(g => touch(g.date, g.group_name || '').games.push(g));
  chipList.forEach(c => touch(c.date, c.group_name || '').chips.push(c));
  const days = [...map.values()];
  days.forEach(d => {
    d.games.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id - b.id);
    d.games.forEach((g, i) => { g.__no = i + 1; });
    d.latest = d.games.length ? (d.games[d.games.length - 1].created_at || '') : '';
  });
  days.sort((a, b) => b.date.localeCompare(a.date) || String(b.latest).localeCompare(String(a.latest)));
  return days;
}

for (const s of seasons) {
  const gs = games.filter(g => String(g.season_id) === String(s.id));
  const cs = chips.filter(c => String(c.season_id) === String(s.id));
  const days = buildDays(gs, cs);
  const covered = days.reduce((a, d) => a + d.games.length, 0);
  const carry = gs.filter(MJ.mjIsCarryover).length;
  console.log(` season ${s.id}: 日カード ${days.length}枚 / 中の対局 ${covered}件 + 引継ぎ ${carry}件 = ${covered + carry}（DB ${gs.length}件）`);
  check(`season ${s.id}: 日カードの対局数 + 引継ぎ = DBの対局数`, covered + carry === gs.length,
    `${covered}+${carry} vs ${gs.length}`);
  const coveredChips = days.reduce((a, d) => a + d.chips.length, 0);
  check(`season ${s.id}: 日カードのチップ件数 = DBのチップ件数`, coveredChips === cs.length, `${coveredChips} vs ${cs.length}`);
}

// ── ③ 第◯局の採番と時刻 ───────────────────────────────────────────────────
console.log('\n########## ③ 第◯局の採番（created_at 昇順）と時刻 ##########');
const allDays = buildDays(games, chips);
const fmtTime = iso => {
  const d = new Date(iso); const p = n => String(n).padStart(2, '0');
  return isNaN(d.getTime()) ? '' : `${p(d.getHours())}:${p(d.getMinutes())}`;
};
const sample = allDays.find(d => d.games.length >= 5);
console.log(` 例: ${sample.date} "${sample.groupName}" ${sample.games.length}局（表示は新しい順）`);
[...sample.games].reverse().slice(0, 4).forEach(g =>
  console.log(`    第${g.__no}局　${fmtTime(g.created_at)} · ${g.player_count}人打ち`));
console.log(`    …`);
console.log(`    第${sample.games[0].__no}局　${fmtTime(sample.games[0].created_at)} · ${sample.games[0].player_count}人打ち`);

let numOk = true, timeOk = true;
allDays.forEach(d => {
  d.games.forEach((g, i) => { if (g.__no !== i + 1) numOk = false; });
  // 採番が created_at の昇順になっているか
  for (let i = 1; i < d.games.length; i++) {
    if ((d.games[i - 1].created_at || '') > (d.games[i].created_at || '')) numOk = false;
  }
  d.games.forEach(g => { if (!fmtTime(g.created_at)) timeOk = false; });
});
check('第◯局が全グループで created_at の古い順に 1..N で振られる', numOk);
check('全対局で時刻が表示できる（created_at が有効）', timeOk);

// 表示順が「チップ → 新しい対局 → 古い対局」になること
const withChip = allDays.find(d => d.chips.length && d.games.length >= 2);
if (withChip) {
  const order = ['🎯チップ', ...[...withChip.games].reverse().map(g => `第${g.__no}局`)];
  console.log(`\n ${withChip.date} "${withChip.groupName}" の表示順: ${order.slice(0, 5).join(' → ')} …`);
  check('チップが一番上、対局は新しい順に並ぶ', order[0] === '🎯チップ' && order[1] === `第${withChip.games.length}局`);
}

// ── ④ 同じ日に複数グループ ────────────────────────────────────────────────
console.log('\n########## ④ 同じ日に複数グループがある日 ##########');
const byDate = new Map();
allDays.forEach(d => {
  if (!byDate.has(d.date)) byDate.set(d.date, []);
  byDate.get(d.date).push(d);
});
const multi = [...byDate.entries()].filter(([, v]) => v.length > 1);
console.log(` ${multi.length}件 → それぞれ別カードになる`);
multi.forEach(([date, v]) => console.log(`   ${date}: ${v.map(d => `"${d.groupName}"(${d.games.length}局/チップ${d.chips.length})`).join(' , ')}`));
check('同じ日の複数グループが別々のカードに分かれる', multi.every(([, v]) => new Set(v.map(d => d.key)).size === v.length),
  `${multi.length}件`);

// ── ⑤ 日カードの参加者・集計がサマリーと一致 ───────────────────────────────
console.log('\n########## ⑤ 日カードの参加者 = グループ収支サマリーの対象者 ##########');
const data = { players, games, results, chips };
let memberNg = 0, sumNg = 0;
allDays.forEach(d => {
  const totals = MJ.mjComputeGroupTotals(data, d.date, d.groupName);
  // そのグループの対局＋チップに出てくるプレイヤー（独立に算出）
  const ids = new Set(d.games.map(g => g.id));
  const expect = new Set([
    ...results.filter(r => ids.has(r.game_id)).map(r => String(r.player_id)),
    ...d.chips.map(c => String(c.player_id)),
  ]);
  const got = new Set(totals.map(t => String(t.player_id)));
  if (expect.size !== got.size || [...expect].some(x => !got.has(x))) memberNg++;
  // 対局＋チップの収支は必ず総和0
  if (totals.reduce((a, t) => a + t.pt, 0) !== 0) sumNg++;
});
console.log(` 参加者が一致しないグループ: ${memberNg}件 / 合計が0でないグループ: ${sumNg}件（全 ${allDays.length}グループ）`);
check('全グループで日カードの参加者が対局＋チップの出場者と一致', memberNg === 0, `${memberNg}件`);
check('全グループで収支の総和が0（サマリーと同じ集計）', sumNg === 0, `${sumNg}件`);

console.log('\n 例（最新3グループ・参加者はプレイヤー名順で表示）:');
const order = new Map(players.slice().sort((a, b) => a.name.localeCompare(b.name, 'ja')).map((p, i) => [String(p.id), i]));
allDays.slice(0, 3).forEach(d => {
  const totals = MJ.mjComputeGroupTotals(data, d.date, d.groupName);
  const names = totals.slice().sort((a, b) => order.get(String(a.player_id)) - order.get(String(b.player_id))).map(t => t.name);
  const isDateFmt = /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(d.groupName);
  const [, m, dd] = d.date.split('-');
  console.log(`   ${parseInt(m)}/${parseInt(dd)}${isDateFmt || !d.groupName ? '' : ' · ' + d.groupName}`);
  console.log(`     ${names.join(' / ')}`);
});

// ── ⑥ 期間フィルタ ────────────────────────────────────────────────────────
console.log('\n########## ⑥ 期間フィルタ ##########');
const season1 = seasons.find(s => String(s.id) === '1');
const gs1 = games.filter(g => String(g.season_id) === String(season1.id));
[['2026-10-01', '2026-10-08'], ['2026-09-01', '2026-09-30'], ['2026-04-07', '2026-10-08']].forEach(([f, t]) => {
  const inRange = gs1.filter(g => g.date >= f && g.date <= t);
  const days = buildDays(inRange, chips.filter(c => String(c.season_id) === '1' && c.date >= f && c.date <= t));
  const covered = days.reduce((a, d) => a + d.games.length, 0);
  console.log(`  ${f} 〜 ${t}: 日カード ${days.length}枚 / 対局 ${covered}件（範囲内のDB件数 ${inRange.length}件）`);
  check(`期間フィルタ ${f}〜${t} で件数が一致`, covered === inRange.length, `${covered} vs ${inRange.length}`);
  if (days.length) {
    const outside = days.filter(d => d.date < f || d.date > t);
    check(`期間フィルタ ${f}〜${t} で範囲外の日が出ない`, outside.length === 0, `${outside.length}件`);
  }
});

// ── ⑦ 機能B: 移動先候補 / 機能C: ボタンの出る条件 ──────────────────────────
console.log('\n########## ⑦ 移動先候補と「同じ設定で結果入力」 ##########');
seasons.forEach(s => {
  const sg = groups.filter(g => String(g.season_id) === String(s.id));
  console.log(`  season ${s.id} (${s.name}): groups ${sg.length}行 → 移動先候補は最大 ${Math.max(0, sg.length - 1)}件`);
});
const gRow = (date, name, seasonId) => groups.find(g => g.date === date && (g.name || '') === (name || '') && String(g.season_id) === String(seasonId));
const btnShown = allDays.filter(d => {
  const sid = d.games[0]?.season_id ?? d.chips[0]?.season_id;
  return d.games.length && gRow(d.date, d.groupName, sid);
});
console.log(`  「同じ設定で結果入力」が出るグループ: ${btnShown.length} / ${allDays.length}`);
console.log(`     （groups行がある ${btnShown.length}件。最新: ${btnShown.map(d => d.date).sort().slice(-1)[0]}）`);
check('最新のグループで「同じ設定で結果入力」が出る', btnShown.some(d => d.date === allDays[0].date), `最新日=${allDays[0].date}`);

// 最新グループの受け渡しパラメータ
const latest = btnShown[0];
if (latest) {
  const sid = latest.games[0].season_id;
  const row = gRow(latest.date, latest.groupName, sid);
  const last = latest.games[latest.games.length - 1];
  const pids = results.filter(r => r.game_id === last.id).sort((a, b) => a.id - b.id).map(r => r.player_id);
  console.log(`  最新グループ ${latest.date} "${latest.groupName}" → input.html?season=${sid}&gid=${row.id}&pids=${pids.join(',')}&pc=${last.player_count}&focus=score`);
  console.log(`     最後の対局 = 第${last.__no}局（${fmtTime(last.created_at)}） メンバー: ${pids.map(pname).join(' / ')}`);
  check('最後の対局から人数と参加者が取り出せる', pids.length === last.player_count, `pids ${pids.length} / pc ${last.player_count}`);
}

// ── まとめ ────────────────────────────────────────────────────────────────
console.log('\n\n########## 検証サマリー（実データ・読み取りのみ） ##########');
console.log('| 項目 | 結果 | 詳細 |');
console.log('|---|---|---|');
verdicts.forEach(v => console.log(`| ${v.label} | ${PASS(v.ok)} | ${v.detail} |`));
const ng = verdicts.filter(v => !v.ok).length;
console.log(`\n${ng === 0 ? '✅ すべて合格' : `❌ ${ng}件 未達`}`);

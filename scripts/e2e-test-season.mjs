// 本番DBに「テスト用」シーズンを作って実際の読み書きを確認し、最後に全部消す。
//   node scripts/e2e-test-season.mjs            → プラン表示のみ（書き込みなし）
//   node scripts/e2e-test-season.mjs --run      → 作成 → 検証 → 削除まで一気に実行
//   node scripts/e2e-test-season.mjs --cleanup  → 前回の残骸（.e2e-state.json）を削除するだけ
//
// 実データの対局・チップには一切触らない。作成した行だけを id で記録して削除する。
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { sel, selAll, insert, patch, del, ROOT } from './db.mjs';

const SC = new Function(readFileSync(join(ROOT, 'scoring.js'), 'utf8') + `
  return { calcGameResult, mjScorePtToRaw, MJ_RANK_DEFAULTS };
`)();
const MJ = new Function(readFileSync(join(ROOT, 'stats.js'), 'utf8') + `
  return { mjComputeGroupTotals };
`)();

const RUN     = process.argv.includes('--run');
const CLEANUP = process.argv.includes('--cleanup');
const STATE   = join(ROOT, '.e2e-state.json');

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const SEASON_NAME = `【テスト】削除可 ${stamp}`;
// 実データと混ざらない日付（1970年）を使う
const D1 = '1970-01-02';
const D2 = '1970-01-03';
const iso = (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00+00:00`;

const verdicts = [];
const check = (label, ok, detail = '') => { verdicts.push({ label, ok, detail }); return ok; };
const PASS = ok => (ok ? '✅ OK' : '❌ NG');

// ── 後片付け ───────────────────────────────────────────────────────────────
async function cleanup(state) {
  if (!state) { console.log('削除対象の記録がありません'); return; }
  console.log('\n── 後片付け ──');
  if (state.resultIds?.length) {
    await del('game_results', `id=in.(${state.resultIds.join(',')})`);
    console.log(`  game_results ${state.resultIds.length}件 削除`);
  }
  if (state.chipIds?.length) {
    await del('chip_settlements', `id=in.(${state.chipIds.join(',')})`);
    console.log(`  chip_settlements ${state.chipIds.length}件 削除`);
  }
  if (state.gameIds?.length) {
    await del('games', `id=in.(${state.gameIds.join(',')})`);
    console.log(`  games ${state.gameIds.length}件 削除`);
  }
  if (state.groupIds?.length) {
    const left = await sel('groups', `select=id&id=in.(${state.groupIds.join(',')})`);
    if (left.length) await del('groups', `id=in.(${left.map(g => g.id).join(',')})`);
    console.log(`  groups ${left.length}件 削除`);
  }
  if (state.seasonId) {
    await del('seasons', `id=eq.${state.seasonId}`);
    console.log(`  seasons 1件 削除 (id=${state.seasonId})`);
  }
  // 残骸が無いことを確認
  const leftovers = {
    games: (await sel('games', `select=id&season_id=eq.${state.seasonId}`)).length,
    chips: (await sel('chip_settlements', `select=id&season_id=eq.${state.seasonId}`)).length,
    groups: (await sel('groups', `select=id&season_id=eq.${state.seasonId}`)).length,
    seasons: (await sel('seasons', `select=id&id=eq.${state.seasonId}`)).length,
  };
  const results = state.resultIds?.length
    ? (await sel('game_results', `select=id&id=in.(${state.resultIds.join(',')})`)).length : 0;
  console.log(`  残骸チェック: ${JSON.stringify({ ...leftovers, game_results: results })}`);
  check('テスト用データが1件も残っていない',
    Object.values(leftovers).every(v => v === 0) && results === 0, JSON.stringify({ ...leftovers, game_results: results }));
  if (existsSync(STATE)) unlinkSync(STATE);
}

if (CLEANUP) {
  await cleanup(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null);
  verdicts.forEach(v => console.log(`${PASS(v.ok)} ${v.label} ${v.detail}`));
  process.exit(0);
}

// ── 作成するデータのプラン ─────────────────────────────────────────────────
const players = await selAll('players');
const pick = names => names.map(n => {
  const p = players.find(x => x.name === n);
  if (!p) throw new Error(`プレイヤー「${n}」が見つかりません`);
  return p;
});
const [P1, P2, P3] = pick(['安部', '井上', '谷口']);
const pname = id => players.find(p => p.id === id)?.name ?? `ID:${id}`;

const GROUP_PLAN = [
  { key: 'A', date: D1, name: 'テストA卓' },
  { key: 'C', date: D1, name: 'テストC卓' }, // 同じ日に2グループ
  { key: 'B', date: D2, name: 'テストB卓' },
];
const GAME_PLAN = [
  { key: 'G1', group: 'A', at: iso(D1, 1, 0), raws: [[P1.id, 46800], [P2.id, 35000], [P3.id, 23200]] },
  { key: 'G2', group: 'A', at: iso(D1, 2, 0), raws: [[P2.id, 50000], [P3.id, 35000], [P1.id, 20000]] },
  { key: 'G3', group: 'C', at: iso(D1, 3, 0), raws: [[P3.id, 41000], [P1.id, 35000], [P2.id, 29000]] },
  { key: 'G4', group: 'B', at: iso(D2, 4, 0), raws: [[P1.id, 38000], [P2.id, 36000], [P3.id, 31000]] },
];
const CHIP_PLAN = [
  { group: 'A', player_id: P1.id, chip_count: 3,  chip_pt: 900 },
  { group: 'A', player_id: P2.id, chip_count: -3, chip_pt: -900 },
];

console.log('########## テスト用シーズンで確認するプラン ##########\n');
console.log(`作成するシーズン: 「${SEASON_NAME}」`);
console.log(`使う日付        : ${D1} / ${D2}（実データと混ざらない1970年）`);
console.log(`使うプレイヤー  : ${[P1, P2, P3].map(p => `${p.name}(id=${p.id})`).join(' / ')}  ※新規プレイヤーは作りません`);
console.log('\n作成する行:');
console.log(`  seasons           : 1件`);
console.log(`  groups            : ${GROUP_PLAN.length}件  ${GROUP_PLAN.map(g => `${g.date} "${g.name}"`).join(' / ')}`);
console.log(`  games             : ${GAME_PLAN.length}件  ${GAME_PLAN.map(g => `${g.key}(${g.group}卓 ${g.at.slice(11, 16)})`).join(' / ')}`);
console.log(`  game_results      : ${GAME_PLAN.length * 3}件（3人打ち × ${GAME_PLAN.length}局・順位点は既定値）`);
console.log(`  chip_settlements  : ${CHIP_PLAN.length}件（A卓 +3/−3枚）`);
console.log(`  合計              : ${1 + GROUP_PLAN.length + GAME_PLAN.length + GAME_PLAN.length * 3 + CHIP_PLAN.length}件`);
console.log('\n確認する内容:');
[
  '1日に複数グループ（D1 に A卓・C卓）が別カードになる',
  '第◯局の採番（created_at の古い順）と時刻表示',
  '日カードの集計がグループ収支サマリーと一致（総和0）',
  '移動: G3 を C卓 → B卓 に UPDATE（games の date/group_name/season_id のみ）',
  '移動後の第◯局の振り直しと、プレイヤー別合計が移動前後で不変',
  '移動で game_results（rank/score_pt/bonus_pt/total_pt）が変わらない',
  '空になった C卓 の groups 行を DELETE できる（anonキーの権限確認）',
  '期間フィルタ（date の範囲指定）で絞り込める',
  '後片付けでテスト用データが1件も残らない',
].forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
console.log('\n後片付け: 作成した行の id を .e2e-state.json に記録し、逆順に DELETE します。');
console.log('          途中で失敗しても `node scripts/e2e-test-season.mjs --cleanup` で削除できます。');

if (!RUN) {
  console.log('\n（プラン表示のみ。書き込みは行っていません）');
  console.log('実行するには --run を付けてください。');
  process.exit(0);
}

// ── 実行 ───────────────────────────────────────────────────────────────────
const state = { seasonId: null, groupIds: [], gameIds: [], resultIds: [], chipIds: [] };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2), 'utf8');

try {
  console.log('\n── 作成 ──');
  const season = (await insert('seasons', { name: SEASON_NAME }))[0];
  state.seasonId = season.id; save();
  console.log(`  seasons: id=${season.id}`);

  const groupIdByKey = {};
  for (const g of GROUP_PLAN) {
    const row = (await insert('groups', { date: g.date, name: g.name, season_id: season.id }))[0];
    groupIdByKey[g.key] = row.id; state.groupIds.push(row.id); save();
  }
  console.log(`  groups: ${JSON.stringify(groupIdByKey)}`);

  const gameIdByKey = {};
  for (const g of GAME_PLAN) {
    const grp = GROUP_PLAN.find(x => x.key === g.group);
    const row = (await insert('games', {
      date: grp.date, group_name: grp.name, player_count: 3, season_id: season.id, created_at: g.at,
    }))[0];
    gameIdByKey[g.key] = row.id; state.gameIds.push(row.id); save();

    const calc = SC.calcGameResult(g.raws.map(([pid, raw]) => ({ player_id: pid, raw })), SC.MJ_RANK_DEFAULTS[3]);
    const rows = await insert('game_results', calc.map(c => ({
      game_id: row.id, player_id: c.player_id, rank: c.rank,
      score_pt: c.score_pt, bonus_pt: c.bonus_pt, total_pt: c.total_pt,
    })));
    rows.forEach(r => state.resultIds.push(r.id)); save();
  }
  console.log(`  games: ${JSON.stringify(gameIdByKey)} / game_results ${state.resultIds.length}件`);

  for (const c of CHIP_PLAN) {
    const grp = GROUP_PLAN.find(x => x.key === c.group);
    const row = (await insert('chip_settlements', {
      date: grp.date, group_name: grp.name, player_id: c.player_id,
      chip_count: c.chip_count, chip_pt: c.chip_pt, season_id: season.id, created_at: iso(D1, 5, 0),
    }))[0];
    state.chipIds.push(row.id); save();
  }
  console.log(`  chip_settlements: ${state.chipIds.length}件`);

  // ── 検証 ──
  const load = async () => {
    const [games, chips] = await Promise.all([
      sel('games', `select=*&season_id=eq.${season.id}&order=id.asc`),
      sel('chip_settlements', `select=*&season_id=eq.${season.id}&order=id.asc`),
    ]);
    const results = games.length
      ? await sel('game_results', `select=*&game_id=in.(${games.map(g => g.id).join(',')})&order=id.asc`) : [];
    return { players, games, results, chips };
  };
  const buildDays = (data) => {
    const map = new Map();
    const touch = (date, gname) => {
      const k = `${date}|${gname || ''}`;
      if (!map.has(k)) map.set(k, { date, groupName: gname || '', games: [], chips: [] });
      return map.get(k);
    };
    data.games.forEach(g => touch(g.date, g.group_name).games.push(g));
    data.chips.forEach(c => touch(c.date, c.group_name).chips.push(c));
    const days = [...map.values()];
    days.forEach(d => {
      d.games.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id - b.id);
      d.games.forEach((g, i) => { g.__no = i + 1; });
    });
    days.sort((a, b) => b.date.localeCompare(a.date));
    return days;
  };
  const totalsByPlayer = (data) => {
    const m = {};
    data.results.forEach(r => { m[r.player_id] = (m[r.player_id] || 0) + r.total_pt; });
    data.chips.forEach(c => { m[c.player_id] = (m[c.player_id] || 0) + (c.chip_pt || 0); });
    return m;
  };

  console.log('\n── 検証 ──');
  let data = await load();
  let days = buildDays(data);
  console.log(`  日カード ${days.length}枚:`);
  days.forEach(d => {
    const t = MJ.mjComputeGroupTotals(data, d.date, d.groupName);
    console.log(`    ${d.date} "${d.groupName}" 参加者 ${t.map(x => x.name).join('/')} 総和 ${t.reduce((a, b) => a + b.pt, 0)}`);
    [...d.games].reverse().forEach(g => console.log(`        第${g.__no}局 ${g.created_at.slice(11, 16)}`));
    if (d.chips.length) console.log(`        🎯チップ ${d.chips.length}件`);
  });

  check('日カードが3枚（D1 A卓 / D1 C卓 / D2 B卓）', days.length === 3, `${days.length}枚`);
  check('同じ日(D1)に2グループが別カードになる', days.filter(d => d.date === D1).length === 2);
  const aDay = days.find(d => d.groupName === 'テストA卓');
  check('第◯局が created_at の古い順に採番される', aDay.games.map(g => g.__no).join(',') === '1,2'
    && aDay.games[0].created_at < aDay.games[1].created_at);
  check('時刻が取り出せる', aDay.games.every(g => /^\d{2}:\d{2}$/.test(g.created_at.slice(11, 16))));
  const aTotals = MJ.mjComputeGroupTotals(data, aDay.date, aDay.groupName);
  check('日カードの集計（サマリーと同じ関数）の総和が0', aTotals.reduce((a, b) => a + b.pt, 0) === 0,
    JSON.stringify(aTotals.map(t => `${t.name}:${t.pt}`)));
  check('チップがA卓の集計に入っている', aTotals.find(t => t.player_id === P1.id).pt
    === data.results.filter(r => aDay.games.some(g => g.id === r.game_id) && r.player_id === P1.id).reduce((a, r) => a + r.total_pt, 0) + 900);

  // 期間フィルタ
  const onlyD2 = await sel('games', `select=id&season_id=eq.${season.id}&date=gte.${D2}&date=lte.${D2}`);
  check('期間フィルタ（D2のみ）で1局に絞れる', onlyD2.length === 1, `${onlyD2.length}件`);

  // 移動
  const totalsBefore = totalsByPlayer(data);
  const g3 = data.games.find(g => g.id === gameIdByKey.G3);
  const resBefore = JSON.stringify(data.results.filter(r => r.game_id === g3.id)
    .map(r => [r.player_id, r.rank, r.score_pt, r.bonus_pt, r.total_pt]).sort());
  const bGroup = GROUP_PLAN.find(x => x.key === 'B');
  console.log(`\n  移動: G3(id=${g3.id}) ${g3.date} "${g3.group_name}" → ${bGroup.date} "${bGroup.name}"`);
  const upd = await patch('games', `id=eq.${g3.id}`,
    { date: bGroup.date, group_name: bGroup.name, season_id: season.id });
  check('games の UPDATE が1件成功する（移動）', upd.length === 1, `${upd.length}件`);

  data = await load();
  days = buildDays(data);
  const resAfter = JSON.stringify(data.results.filter(r => r.game_id === g3.id)
    .map(r => [r.player_id, r.rank, r.score_pt, r.bonus_pt, r.total_pt]).sort());
  check('移動で game_results（rank/score_pt/bonus_pt/total_pt）が変わらない', resBefore === resAfter);
  check('移動でプレイヤー別合計が変わらない',
    JSON.stringify(totalsByPlayer(data)) === JSON.stringify(totalsBefore),
    JSON.stringify(Object.entries(totalsByPlayer(data)).map(([k, v]) => `${pname(Number(k))}:${v}`)));

  const bDay = days.find(d => d.groupName === 'テストB卓');
  console.log(`    移動先 ${bDay.date} "${bDay.groupName}":`);
  [...bDay.games].reverse().forEach(g => console.log(`        第${g.__no}局 ${g.created_at.slice(11, 16)}`));
  check('移動先で created_at の順に第◯局が振り直される',
    bDay.games.map(g => `${g.__no}:${g.created_at.slice(11, 16)}`).join(' ') === '1:03:00 2:04:00',
    bDay.games.map(g => `${g.__no}:${g.created_at.slice(11, 16)}`).join(' '));
  check('移動元(C卓)の日カードが消える', !days.some(d => d.groupName === 'テストC卓'));

  // 空になったグループの削除
  const remainGames = await sel('games', `select=id&season_id=eq.${season.id}&date=eq.${D1}&group_name=eq.${encodeURIComponent('テストC卓')}`);
  const remainChips = await sel('chip_settlements', `select=id&season_id=eq.${season.id}&date=eq.${D1}&group_name=eq.${encodeURIComponent('テストC卓')}`);
  check('移動元に対局もチップも残っていない', remainGames.length === 0 && remainChips.length === 0,
    `games ${remainGames.length} / chips ${remainChips.length}`);
  const delGroup = await del('groups', `id=eq.${groupIdByKey.C}`);
  check('空になった groups 行を DELETE できる', delGroup.length === 1, `${delGroup.length}件`);
  state.groupIds = state.groupIds.filter(id => id !== groupIdByKey.C); save();

  // A卓にはチップが残るので空にならない
  const aRemainChips = await sel('chip_settlements', `select=id&season_id=eq.${season.id}&date=eq.${D1}&group_name=eq.${encodeURIComponent('テストA卓')}`);
  check('チップが残るグループは「空」と判定されない', aRemainChips.length > 0, `${aRemainChips.length}件`);

} catch (e) {
  console.error('\n❌ 途中で失敗しました:', e.message);
  check('テストの実行', false, e.message);
} finally {
  await cleanup(state);
}

console.log('\n\n########## 結果 ##########');
console.log('| 項目 | 結果 | 詳細 |');
console.log('|---|---|---|');
verdicts.forEach(v => console.log(`| ${v.label} | ${PASS(v.ok)} | ${v.detail} |`));
const ng = verdicts.filter(v => !v.ok).length;
console.log(`\n${ng === 0 ? '✅ すべて合格（テスト用データは削除済み）' : `❌ ${ng}件 未達`}`);

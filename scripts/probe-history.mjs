// Phase 1 調査（読み取りのみ）: 日別表示・移動・同じ設定で入力の前提確認
import { selAll } from './db.mjs';

const CARRY = '1900-01-01';
const [players, seasons, games, results, chips, groups] = await Promise.all([
  selAll('players'), selAll('seasons'), selAll('games'),
  selAll('game_results'), selAll('chip_settlements'), selAll('groups'),
]);
const pname = id => players.find(p => p.id === id)?.name ?? `ID:${id}`;
const key = (d, n, s) => `${s}|${d}|${n || ''}`;

console.log('=== 行数 ===');
console.log({ games: games.length, game_results: results.length, chips: chips.length, groups: groups.length });

// ── 日×グループの単位 ──────────────────────────────────────────────────────
const dayGroups = new Map();
games.filter(g => g.date !== CARRY).forEach(g => {
  const k = key(g.date, g.group_name, g.season_id);
  if (!dayGroups.has(k)) dayGroups.set(k, { season_id: g.season_id, date: g.date, name: g.group_name || '', games: [], chips: [] });
  dayGroups.get(k).games.push(g);
});
chips.forEach(c => {
  const k = key(c.date, c.group_name, c.season_id);
  if (!dayGroups.has(k)) dayGroups.set(k, { season_id: c.season_id, date: c.date, name: c.group_name || '', games: [], chips: [] });
  dayGroups.get(k).chips.push(c);
});
console.log(`\n=== 日×グループの単位（引継ぎ除く）: ${dayGroups.size}件 ===`);
seasons.forEach(s => {
  const list = [...dayGroups.values()].filter(x => String(x.season_id) === String(s.id));
  console.log(` season ${s.id} (${s.name}): ${list.length}グループ / 対局 ${list.reduce((a, x) => a + x.games.length, 0)}件 / チップ ${list.reduce((a, x) => a + x.chips.length, 0)}件`);
});

// 同じ日に複数グループがある日
const byDate = new Map();
[...dayGroups.values()].forEach(x => {
  const k = `${x.season_id}|${x.date}`;
  if (!byDate.has(k)) byDate.set(k, []);
  byDate.get(k).push(x);
});
const multi = [...byDate.entries()].filter(([, v]) => v.length > 1);
console.log(`\n=== 同じ日に複数グループがある日: ${multi.length}件 ===`);
multi.slice(0, 12).forEach(([k, v]) =>
  console.log(`  ${k} → ${v.map(x => `"${x.name}"(対局${x.games.length}/チップ${x.chips.length})`).join(' , ')}`));

// 1グループ内で player_count が混在する例
const mixed = [...dayGroups.values()].filter(x => new Set(x.games.map(g => g.player_count)).size > 1);
console.log(`\n=== 1グループ内で人数が混在: ${mixed.length}件（表示の「◯人打ち N局」が複数になる） ===`);
mixed.slice(0, 8).forEach(x => {
  const dist = x.games.reduce((a, g) => { a[g.player_count] = (a[g.player_count] || 0) + 1; return a; }, {});
  console.log(`  ${x.season_id}|${x.date}|"${x.name}" → ${JSON.stringify(dist)}`);
});

// チップのみのグループ（対局0件 → 「同じ設定で結果入力」ボタンは出さない対象）
const chipOnly = [...dayGroups.values()].filter(x => x.games.length === 0);
console.log(`\n=== 対局0件・チップのみのグループ: ${chipOnly.length}件 ===`);
chipOnly.slice(0, 10).forEach(x => console.log(`  ${x.season_id}|${x.date}|"${x.name}" チップ${x.chips.length}件`));

// ── groups テーブルとの突き合わせ（機能B/Cで gid が必要） ──────────────────
const groupKeys = new Set(groups.map(g => key(g.date, g.name, g.season_id)));
const withRow = [...dayGroups.values()].filter(x => groupKeys.has(key(x.date, x.name, x.season_id)));
const without = [...dayGroups.values()].filter(x => !groupKeys.has(key(x.date, x.name, x.season_id)));
console.log(`\n=== groups 行がある: ${withRow.length}件 / ない: ${without.length}件 ===`);
console.log(' groups 行がない日×グループ（移動先候補に出ない・「同じ設定で入力」ボタンも出ない）:');
without.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
  .forEach(x => console.log(`   ${x.season_id}|${x.date}|"${x.name}"`));
console.log(` groups 行がある日×グループの日付範囲: ${withRow.map(x => x.date).sort()[0]} 〜 ${withRow.map(x => x.date).sort().slice(-1)[0]}`);
const seasonGroups = {};
groups.forEach(g => { seasonGroups[g.season_id] = (seasonGroups[g.season_id] || 0) + 1; });
console.log(` groups の season_id 分布: ${JSON.stringify(seasonGroups)}`);

// ── created_at（第◯局の並び順）────────────────────────────────────────────
const noCreated = games.filter(g => !g.created_at);
console.log(`\n=== created_at が無い games: ${noCreated.length}件 ===`);
// 同一グループ内で created_at が重複している例（番号付けが不定になる）
let dupCreated = 0;
[...dayGroups.values()].forEach(x => {
  const ts = x.games.map(g => g.created_at);
  if (new Set(ts).size !== ts.length) dupCreated++;
});
console.log(`=== 同一グループ内で created_at が重複: ${dupCreated}件 ===`);

// 1グループあたりの対局数
const counts = [...dayGroups.values()].map(x => x.games.length).sort((a, b) => b - a);
console.log(`=== 1グループの対局数: 最大 ${counts[0]} / 中央 ${counts[Math.floor(counts.length / 2)]} ===`);

// ── 日ごとの合計pt（index.html のサマリーと同じ計算）の例 ────────────────
console.log('\n=== 日ごとの合計pt の例（最新5グループ・サマリーと同じ計算） ===');
const resByGame = new Map();
results.forEach(r => { if (!resByGame.has(r.game_id)) resByGame.set(r.game_id, []); resByGame.get(r.game_id).push(r); });
[...dayGroups.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).forEach(x => {
  const tot = {};
  x.games.forEach(g => (resByGame.get(g.id) || []).forEach(r => { tot[r.player_id] = (tot[r.player_id] || 0) + (r.total_pt || 0); }));
  x.chips.forEach(c => { tot[c.player_id] = (tot[c.player_id] || 0) + (c.chip_pt || 0); });
  const line = Object.entries(tot).sort((a, b) => b[1] - a[1])
    .map(([pid, v]) => `${pname(Number(pid))} ${v >= 0 ? '+' : ''}${v.toLocaleString()}`).join(' / ');
  const dist = x.games.reduce((a, g) => { a[g.player_count] = (a[g.player_count] || 0) + 1; return a; }, {});
  console.log(`  ${x.date} "${x.name}" ${Object.entries(dist).map(([k, v]) => `${k}人打ち ${v}局`).join(' / ')}${x.chips.length ? ' · チップ精算あり' : ''}`);
  console.log(`     ${line}`);
  console.log(`     合計 ${Object.values(tot).reduce((a, b) => a + b, 0)}（0なら整合）`);
});

// ── 期間フィルタ・件数の確認用 ─────────────────────────────────────────────
console.log('\n=== 件数（検証で突き合わせる基準） ===');
seasons.forEach(s => {
  const gs = games.filter(g => String(g.season_id) === String(s.id));
  console.log(` season ${s.id}: games ${gs.length}件（うち引継ぎ ${gs.filter(g => g.date === CARRY).length}件） / game_results ${results.filter(r => gs.some(g => g.id === r.game_id)).length}件`);
});

// ── 機能C: 最後の対局のメンバー ────────────────────────────────────────────
console.log('\n=== 機能C: 最新グループの「最後の対局」のメンバー ===');
[...dayGroups.values()].filter(x => x.games.length).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).forEach(x => {
  const last = [...x.games].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).slice(-1)[0];
  const pids = (resByGame.get(last.id) || []).map(r => r.player_id);
  const grow = groups.find(g => key(g.date, g.name, g.season_id) === key(x.date, x.name, x.season_id));
  console.log(`  ${x.date} "${x.name}" → gid=${grow ? grow.id : 'なし'} pc=${last.player_count} pids=${pids.join(',')} (${pids.map(pname).join('/')})`);
});

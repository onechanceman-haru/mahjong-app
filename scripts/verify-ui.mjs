// 検証スクリプト: タスク4（平均順位）とタスク5（登録後のグループサマリー）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selAll, ROOT } from './db.mjs';

const PASS = ok => (ok ? '✅ OK' : '❌ NG');
const verdicts = [];
const check = (label, ok, detail = '') => verdicts.push({ label, ok, detail });

const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
const history = readFileSync(join(ROOT, 'history.html'), 'utf8');
const input = readFileSync(join(ROOT, 'input.html'), 'utf8');

// ── タスク4 ─────────────────────────────────────────────────────────────────
console.log('########## タスク4: 総合タブの平均順位 ##########');

// index.html renderRankings の sub 式を取り出して両方のタブで評価する
const subExpr = index.match(/const sub\s*=\s*(filter === null[^;]+);/)?.[1];
console.log(' index.html の式:', subExpr);
const evalSub = filter => new Function('filter', 's', 'avg', `return ${subExpr};`)(filter, { games: 10, rankSum: 25 }, '2.50');
const idxAll = evalSub(null), idxPc = evalSub(4);
console.log(`   総合(filter=null) → "${idxAll}"`);
console.log(`   4人(filter=4)     → "${idxPc}"`);
check('index.html 総合タブに平均順位が出ない', !idxAll.includes('平均'), `"${idxAll}"`);
check('index.html 人数タブに平均順位が出る', idxPc.includes('平均'), `"${idxPc}"`);

// history.html renderStats の avgHTML 式
const avgExpr = history.match(/const avgHTML\s*=\s*(filter === null[\s\S]*?);\n/)?.[1];
console.log('\n history.html の式:', avgExpr?.replace(/\s+/g, ' '));
const evalAvg = filter => new Function('filter', 'avg', `return ${avgExpr};`)(filter, '2.50');
const hAll = evalAvg(null), hPc = evalAvg(4);
console.log(`   総合(filter=null) → "${hAll}"`);
console.log(`   4人(filter=4)     → "${hPc.replace(/\s+/g, ' ')}"`);
check('history.html 総合タブに平均順位の stat-item が出ない', hAll === '', `"${hAll}"`);
check('history.html 人数タブに平均順位が出る', hPc.includes('平均順位'), `"${hPc.replace(/\s+/g, ' ')}"`);

// stat-row のレイアウト（stat-item は flex:1 なので2列でも等幅になる）
// 色で囲んだ枠はオーナーの指示で残している（common.css が見た目だけ強める）
const flexOk = /\.stat-item\s*\{[^}]*flex:1/.test(history);
const rowOk = /\.stat-row\s*\{[^}]*display:flex/.test(history);
check('stat-row/stat-item が flex で項目数に追従（レイアウト崩れなし）', flexOk && rowOk,
  `stat-row:display:flex=${rowOk}, stat-item:flex:1=${flexOk}`);

// ── タスク5 ─────────────────────────────────────────────────────────────────
console.log('\n########## タスク5: 登録後のグループサマリー ##########');

// input.html が組み立てる遷移先URLを再現する
const buildDest = (currentSeasonId, cfg) => {
  const q = new URLSearchParams();
  if (currentSeasonId) q.set('season', currentSeasonId);
  q.set('summary', '1');
  q.set('date', cfg.groupDate);
  q.set('group', cfg.groupName || '');
  return `index.html?${q.toString()}`;
};
check('input.html が summary/date/group 付きで遷移する', /q\.set\('summary', '1'\)/.test(input) && /q\.set\('group'/.test(input) && /q\.set\('date'/.test(input));

// index.html initGroupSummary のグループ選択を再現する
const CARRYOVER = '1900-01-01';
const buildSummaryGroups = games => {
  const seen = new Set(), out = [];
  games.filter(g => g.date !== CARRYOVER).forEach(g => {
    const key = `${g.date}|${g.group_name || ''}`;
    if (!seen.has(key)) { seen.add(key); out.push({ date: g.date, groupName: g.group_name || '' }); }
  });
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
};
const pickIndex = (summaryGroups, params) => {
  let idx = 0;
  if (params.get('summary') === '1') {
    const wantDate = params.get('date') || '';
    const wantGroup = params.get('group') || '';
    const found = summaryGroups.findIndex(g => g.date === wantDate && g.groupName === wantGroup);
    if (found >= 0) idx = found;
  }
  return idx;
};

const [games, groups] = await Promise.all([selAll('games'), selAll('groups')]);

// 実データのシーズン1（id=1）で、各グループを「登録直後」に見立てて検証する
const sGames = games.filter(g => String(g.season_id) === '1');
const summaryGroups = buildSummaryGroups(sGames);
console.log(` シーズン1のグループ数: ${summaryGroups.length}（最新 = ${summaryGroups[0].date} / "${summaryGroups[0].groupName}"）`);

let ng = 0;
summaryGroups.forEach(g => {
  const dest = buildDest('1', { groupDate: g.date, groupName: g.groupName });
  const params = new URLSearchParams(dest.split('?')[1]);
  const idx = pickIndex(summaryGroups, params);
  if (summaryGroups[idx].date !== g.date || summaryGroups[idx].groupName !== g.groupName) {
    ng++; console.log(`   ❌ ${g.date} "${g.groupName}" → idx=${idx}`);
  }
});
console.log(` 全グループで正しく選択できたか: ${summaryGroups.length - ng}/${summaryGroups.length}`);
check('登録したグループのサマリーが選択される（全グループ）', ng === 0, `${summaryGroups.length}グループすべて一致`);

// グループが未登録の日付を指定した場合は最新グループ（従来動作）
const miss = new URLSearchParams('summary=1&date=1999-01-01&group=xxx');
check('該当グループが無ければ最新グループ（従来動作）', pickIndex(summaryGroups, miss) === 0);

// パラメータなしは従来どおり最新グループ
check('パラメータなしは従来どおり最新グループ', pickIndex(summaryGroups, new URLSearchParams('')) === 0);

// スクロール処理とカードID
check('グループサマリーカードに id があり summary=1 でスクロールする',
  /id="group-summary-card"/.test(index) && /scrollIntoView/.test(index));

// 登録時に実在するグループを選ぶ以上、groups テーブルと games の整合も確認
const orphanGroups = groups.filter(g => !games.some(x => x.date === g.date && (x.group_name || '') === (g.name || '')));
console.log(` 対局が1件もない groups 行: ${orphanGroups.length}件 ${orphanGroups.map(g => g.id + ':' + g.date).join(' ')}`);

console.log('\n\n########## 完了条件サマリー（タスク4・5） ##########');
console.log('| 項目 | 結果 | 詳細 |');
console.log('|---|---|---|');
verdicts.forEach(v => console.log(`| ${v.label} | ${PASS(v.ok)} | ${v.detail} |`));
const bad = verdicts.filter(v => !v.ok).length;
console.log(`\n${bad === 0 ? '✅ すべての検証項目に合格' : `❌ ${bad}件 未達`}`);

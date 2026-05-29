// ─── Supabase constants ──────────────────────────────────────────────────────
const NEW_URL = 'https://kqrevvjhfkxfuitngyoc.supabase.co';
const NEW_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxcmV2dmpoZmt4ZnVpdG5neW9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MzUzMDIsImV4cCI6MjA5NTAxMTMwMn0.bRFBt3KQ3R8IhZRjjVs6DWtWvFFJyt45pYTTxXDGevs';
const OLD_URL = 'https://mikcjkqvdjkqkcgsufkh.supabase.co';
const OLD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pa2Nqa3F2ZGprcWtjZ3N1ZmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4NTU5ODIsImV4cCI6MjA3OTQzMTk4Mn0.O4gR7N9279zAsgunCDZre4FJAM2gHT4uwUlFkjEhm-k';

// ─── REST API helpers ─────────────────────────────────────────────────────────
function hdr(key, extra = {}) {
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

async function dbSelect(base, key, table, qs = '') {
  const r = await fetch(`${base}/rest/v1/${table}?${qs}`, { headers: hdr(key) });
  const d = await r.json();
  if (!r.ok) throw new Error(`SELECT ${table}: ${JSON.stringify(d)}`);
  return d;
}

async function dbInsertOne(base, key, table, row) {
  const r = await fetch(`${base}/rest/v1/${table}`, {
    method: 'POST',
    headers: hdr(key, { 'Prefer': 'return=representation' }),
    body: JSON.stringify(row)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`INSERT ${table}: ${JSON.stringify(d)}`);
  return Array.isArray(d) ? d[0] : d;
}

async function dbInsertMany(base, key, table, rows) {
  if (!rows.length) return [];
  const r = await fetch(`${base}/rest/v1/${table}`, {
    method: 'POST',
    headers: hdr(key, { 'Prefer': 'return=representation' }),
    body: JSON.stringify(rows)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`INSERT ${table}: ${JSON.stringify(d)}`);
  return d;
}

async function dbDelete(base, key, table, qs) {
  const r = await fetch(`${base}/rest/v1/${table}?${qs}`, {
    method: 'DELETE',
    headers: hdr(key, { 'Prefer': 'return=representation' })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`DELETE ${table}: ${JSON.stringify(d)}`);
  return d;
}

async function dbCount(base, key, table, qs = '') {
  const r = await fetch(`${base}/rest/v1/${table}?${qs}&select=id`, {
    headers: hdr(key, { 'Prefer': 'count=exact', 'Range': '0-0' })
  });
  const cr = r.headers.get('content-range') || '';
  const m = cr.match(/\/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

// ─── App helpers ─────────────────────────────────────────────────────────────
function log(msg)  { console.log(msg); }
function ok(msg)   { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function err(msg)  { console.log(`  ❌ ${msg}`); }
function sep()     { console.log('─'.repeat(60)); }

async function getSeasonIds() {
  const seasons = await dbSelect(NEW_URL, NEW_KEY, 'seasons', 'select=id,name');
  const find = prefix => seasons.find(s => s.name.startsWith(prefix))?.id ?? null;
  return { s1: find('シーズン1'), s2: find('シーズン2'), s3: find('シーズン3') };
}

async function getPlayerMap() {
  const players = await dbSelect(NEW_URL, NEW_KEY, 'players', 'select=id,name');
  const map = {};
  players.forEach(p => { map[p.name] = p.id; });
  return map;
}

async function fetchOldData(key) {
  const rows = await dbSelect(OLD_URL, OLD_KEY, 'app_data', `key=eq.${encodeURIComponent(key)}&select=*`);
  if (!rows.length) throw new Error(`旧DB: key="${key}" が見つかりません`);
  const row = rows[0];
  const raw = row.value ?? row.data ?? row.json ?? row.content ?? row.body;
  if (raw == null) throw new Error(`旧DB: value カラムが null`);
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// ─── Step 0: Check ───────────────────────────────────────────────────────────
async function checkStatus(ids) {
  log('\n📊 現在の件数:');
  for (const [label, sid] of [['シーズン1', ids.s1], ['シーズン2', ids.s2], ['シーズン3', ids.s3]]) {
    if (!sid) { log(`  ${label}: IDなし`); continue; }
    const g = await dbCount(NEW_URL, NEW_KEY, 'games', `season_id=eq.${sid}`);
    const c = await dbCount(NEW_URL, NEW_KEY, 'chip_settlements', `season_id=eq.${sid}`);
    log(`  ${label} (id=${sid}): 対局 ${g}件 / チップ ${c}件`);
  }
}

// ─── Step 1: Delete Season3 ───────────────────────────────────────────────────
async function deleteSeasonThree(s3Id) {
  sep();
  log('🗑  STEP 1: シーズン3のテストデータを削除');
  if (!s3Id) { warn('シーズン3がDBに存在しません。スキップ'); return; }

  const games = await dbSelect(NEW_URL, NEW_KEY, 'games', `season_id=eq.${s3Id}&select=id`);
  const gameIds = games.map(g => g.id);

  if (gameIds.length > 0) {
    const grDel = await dbDelete(NEW_URL, NEW_KEY, 'game_results', `game_id=in.(${gameIds.join(',')})`);
    ok(`game_results 削除: ${grDel.length}件`);
    const gDel = await dbDelete(NEW_URL, NEW_KEY, 'games', `season_id=eq.${s3Id}`);
    ok(`games 削除: ${gDel.length}件`);
  } else {
    ok('games: 削除対象なし');
  }

  const cDel = await dbDelete(NEW_URL, NEW_KEY, 'chip_settlements', `season_id=eq.${s3Id}`);
  ok(`chip_settlements 削除: ${cDel.length}件`);
}

// ─── Step 2: Migrate Season 1 (旧_s3 → 新S1, normal only) ───────────────────
async function migrateSeason1(s1Id, playerMap) {
  sep();
  log('📥 STEP 2: シーズン1移行 (旧_s3 → 新S1)');
  if (!s1Id) { err('新DBにシーズン1が存在しません。中止'); return; }

  const raw = await fetchOldData('mahjong_variable_score_history_int_s3');
  const records = (Array.isArray(raw) ? raw : Object.values(raw)).filter(r => r.gameType === 'normal');
  log(`  対象: ${records.length}件`);

  let okCnt = 0, skipCnt = 0, errCnt = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const date = (rec.date || '').substring(0, 10);
    const groupName = rec.group || null;
    const playerCount = rec.playerCount || Object.keys(rec.payouts || {}).length;
    const payoutEntries = Object.entries(rec.payouts || {});

    const missing = payoutEntries.filter(([n]) => !playerMap[n]).map(([n]) => n);
    if (missing.length) {
      warn(`スキップ [${date} ${groupName}]: 未登録プレイヤー → ${missing.join(', ')}`);
      skipCnt++; continue;
    }

    try {
      const game = await dbInsertOne(NEW_URL, NEW_KEY, 'games', {
        date, group_name: groupName, player_count: playerCount, season_id: s1Id
      });

      const results = payoutEntries.map(([name, p]) => ({
        game_id: game.id, player_id: playerMap[name],
        rank: p.rank || 0, score_pt: p.scorePt || 0,
        bonus_pt: p.bonusPt || 0, total_pt: p.total || 0
      }));
      await dbInsertMany(NEW_URL, NEW_KEY, 'game_results', results);

      process.stdout.write(`\r  進捗: ${i + 1}/${records.length} (✅${okCnt} ⚠️${skipCnt} ❌${errCnt})`);
      okCnt++;
    } catch (e) {
      err(`[${date} ${groupName}]: ${e.message}`);
      errCnt++;
    }
  }

  console.log('');
  ok(`完了 — 成功: ${okCnt} / スキップ: ${skipCnt} / エラー: ${errCnt}`);
}

// ─── Step 3: Migrate Season 2 (旧 → 新S2, normal + chips) ───────────────────
async function migrateSeason2(s2Id, playerMap) {
  sep();
  log('📥 STEP 3: シーズン2移行 (旧 → 新S2)');
  if (!s2Id) { err('新DBにシーズン2が存在しません。中止'); return; }

  const raw = await fetchOldData('mahjong_variable_score_history_int');
  const all = Array.isArray(raw) ? raw : Object.values(raw);
  const normals = all.filter(r => r.gameType === 'normal');
  const chips   = all.filter(r => r.gameType === 'chips');
  log(`  対局: ${normals.length}件 / チップ: ${chips.length}件`);

  let okCnt = 0, skipCnt = 0, errCnt = 0;

  // 対局
  log('  [対局] 移行中...');
  for (let i = 0; i < normals.length; i++) {
    const rec = normals[i];
    const date = (rec.date || '').substring(0, 10);
    const groupName = rec.group || null;
    const playerCount = rec.playerCount || Object.keys(rec.payouts || {}).length;
    const payoutEntries = Object.entries(rec.payouts || {});

    const missing = payoutEntries.filter(([n]) => !playerMap[n]).map(([n]) => n);
    if (missing.length) {
      warn(`スキップ [${date} ${groupName}]: 未登録 → ${missing.join(', ')}`);
      skipCnt++; continue;
    }

    try {
      const game = await dbInsertOne(NEW_URL, NEW_KEY, 'games', {
        date, group_name: groupName, player_count: playerCount, season_id: s2Id
      });
      const results = payoutEntries.map(([name, p]) => ({
        game_id: game.id, player_id: playerMap[name],
        rank: p.rank || 0, score_pt: p.scorePt || 0,
        bonus_pt: p.bonusPt || 0, total_pt: p.total || 0
      }));
      await dbInsertMany(NEW_URL, NEW_KEY, 'game_results', results);
      process.stdout.write(`\r  対局 ${i + 1}/${normals.length} (✅${okCnt} ⚠️${skipCnt} ❌${errCnt})`);
      okCnt++;
    } catch (e) {
      err(`[対局 ${date} ${groupName}]: ${e.message}`);
      errCnt++;
    }
  }
  console.log('');

  // チップ
  log('  [チップ] 移行中...');
  let chipOk = 0, chipSkip = 0, chipErr = 0;
  for (let i = 0; i < chips.length; i++) {
    const rec = chips[i];
    const date = (rec.date || '').substring(0, 10);
    const groupName = rec.group || null;
    const payoutEntries = Object.entries(rec.payouts || {});

    const missing = payoutEntries.filter(([n]) => !playerMap[n]).map(([n]) => n);
    if (missing.length) {
      warn(`スキップ [チップ ${date} ${groupName}]: 未登録 → ${missing.join(', ')}`);
      chipSkip++; continue;
    }

    try {
      const rows = payoutEntries.map(([name, p]) => ({
        date, group_name: groupName, player_id: playerMap[name],
        chip_count: p.chipCount || 0, chip_pt: (p.chipCount || 0) * 300, season_id: s2Id
      }));
      await dbInsertMany(NEW_URL, NEW_KEY, 'chip_settlements', rows);
      process.stdout.write(`\r  チップ ${i + 1}/${chips.length} (✅${chipOk} ⚠️${chipSkip} ❌${chipErr})`);
      chipOk++;
    } catch (e) {
      err(`[チップ ${date} ${groupName}]: ${e.message}`);
      chipErr++;
    }
  }
  console.log('');

  ok(`対局完了 — 成功: ${okCnt} / スキップ: ${skipCnt} / エラー: ${errCnt}`);
  ok(`チップ完了 — 成功: ${chipOk} / スキップ: ${chipSkip} / エラー: ${chipErr}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    log('='.repeat(60));
    log('  公大中麻雀倶楽部 データ移行スクリプト');
    log('='.repeat(60));

    log('\n🔍 シーズンIDを取得中...');
    const ids = await getSeasonIds();
    log(`  シーズン1: id=${ids.s1}, シーズン2: id=${ids.s2}, シーズン3: id=${ids.s3}`);

    log('\n🔍 プレイヤーマップを取得中...');
    const playerMap = await getPlayerMap();
    log(`  登録プレイヤー: ${Object.keys(playerMap).join(', ')}`);

    await checkStatus(ids);

    await deleteSeasonThree(ids.s3);
    await migrateSeason1(ids.s1, playerMap);
    await migrateSeason2(ids.s2, playerMap);

    sep();
    log('\n📊 移行後の件数:');
    const ids2 = await getSeasonIds();
    await checkStatus(ids2);

    log('\n✅ 全工程完了\n');
  } catch (e) {
    console.error('\n❌ 致命的エラー:', e.message);
    process.exit(1);
  }
})();

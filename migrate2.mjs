// 標準対局のみを移行する修正版スクリプト
// チップはmigrate.mjsで移行済みのため対象外

const NEW_URL = 'https://kqrevvjhfkxfuitngyoc.supabase.co';
const NEW_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxcmV2dmpoZmt4ZnVpdG5neW9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MzUzMDIsImV4cCI6MjA5NTAxMTMwMn0.bRFBt3KQ3R8IhZRjjVs6DWtWvFFJyt45pYTTxXDGevs';
const OLD_URL = 'https://mikcjkqvdjkqkcgsufkh.supabase.co';
const OLD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pa2Nqa3F2ZGprcWtjZ3N1ZmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4NTU5ODIsImV4cCI6MjA3OTQzMTk4Mn0.O4gR7N9279zAsgunCDZre4FJAM2gHT4uwUlFkjEhm-k';

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

// 'YYYY/MM/DD HH:MM' → 'YYYY-MM-DD'
function parseDate(d) {
  return (d || '').substring(0, 10).replace(/\//g, '-');
}

function log(msg)  { console.log(msg); }
function ok(msg)   { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
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
  const rows = await dbSelect(OLD_URL, OLD_KEY, 'app_data', `key=eq.${encodeURIComponent(key)}&select=value`);
  if (!rows.length) throw new Error(`旧DB: key="${key}" が見つかりません`);
  const raw = rows[0].value;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function migrateGames(label, oldKey, seasonId, playerMap, skipTypes = ['chips', 'carryover']) {
  sep();
  log(`📥 ${label}`);

  const raw = await fetchOldData(oldKey);
  const all = Array.isArray(raw) ? raw : Object.values(raw);
  const targets = all.filter(r => !skipTypes.includes(r.gameType));
  const typeStats = {};
  all.forEach(r => { typeStats[r.gameType] = (typeStats[r.gameType] || 0) + 1; });
  log(`  全レコード: ${all.length}件 (内訳: ${JSON.stringify(typeStats)})`);
  log(`  移行対象 (standard): ${targets.length}件`);

  let okCnt = 0, skipCnt = 0, errCnt = 0;

  for (let i = 0; i < targets.length; i++) {
    const rec = targets[i];
    const date = parseDate(rec.date);
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
        date, group_name: groupName, player_count: playerCount, season_id: seasonId
      });

      const results = payoutEntries.map(([name, p]) => ({
        game_id:  game.id,
        player_id: playerMap[name],
        rank:     p.rank     || 0,
        score_pt: p.scorePt  || 0,
        bonus_pt: p.bonusPt  || 0,
        total_pt: p.total    || 0
      }));
      await dbInsertMany(NEW_URL, NEW_KEY, 'game_results', results);

      process.stdout.write(`\r  進捗: ${i + 1}/${targets.length} (✅${okCnt} ⚠️${skipCnt} ❌${errCnt})`);
      okCnt++;
    } catch (e) {
      process.stdout.write('\n');
      warn(`エラー [${date} ${groupName}]: ${e.message}`);
      errCnt++;
    }
  }

  console.log('');
  ok(`完了 — 成功: ${okCnt} / スキップ: ${skipCnt} / エラー: ${errCnt}`);
  return { okCnt, skipCnt, errCnt };
}

async function checkStatus(ids) {
  log('\n📊 件数確認:');
  for (const [label, sid] of [['シーズン1', ids.s1], ['シーズン2', ids.s2], ['シーズン3', ids.s3]]) {
    if (!sid) { log(`  ${label}: IDなし`); continue; }
    const games = await dbSelect(NEW_URL, NEW_KEY, 'games', `season_id=eq.${sid}&select=id`);
    const chips = await dbSelect(NEW_URL, NEW_KEY, 'chip_settlements', `season_id=eq.${sid}&select=id`);
    log(`  ${label} (id=${sid}): 対局 ${games.length}件 / チップ ${chips.length}件`);
  }
}

(async () => {
  try {
    log('='.repeat(60));
    log('  対局データ移行スクリプト（修正版）');
    log('='.repeat(60));

    const ids = await getSeasonIds();
    log(`\nシーズンID: S1=${ids.s1}, S2=${ids.s2}, S3=${ids.s3}`);

    const playerMap = await getPlayerMap();
    log(`プレイヤー: ${Object.keys(playerMap).join(', ')}`);

    await checkStatus(ids);

    // シーズン1: 旧_s3 → 新S1
    await migrateGames(
      'シーズン1移行 (旧_s3 → 新S1)',
      'mahjong_variable_score_history_int_s3',
      ids.s1,
      playerMap
    );

    // シーズン2: 旧_int (no suffix) → 新S2 (standard のみ, chips/carryover はスキップ)
    await migrateGames(
      'シーズン2移行 (旧_int → 新S2)',
      'mahjong_variable_score_history_int',
      ids.s2,
      playerMap
    );

    sep();
    log('\n移行後の件数:');
    await checkStatus(ids);
    log('\n✅ 完了\n');
  } catch (e) {
    console.error('\n❌ 致命的エラー:', e.message);
    process.exit(1);
  }
})();

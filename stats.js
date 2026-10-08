// 成績集計の共通ロジック
// index.html / history.html / past.html から読み込む。
// 収支の計算ルールはこのファイルに1本化し、シーズン別と全シーズン通算で同じ計算になるようにする。

// 引継ぎ（旧シーズンからの持ち込み）対局の日付
const MJ_CARRYOVER_DATE = '1900-01-01';

// 全シーズン通算ランキングから除外するプレイヤー（シーズン内の成績表示では除外しない）
const MJ_TOTAL_EXCLUDED_PLAYERS = ['その他'];

function mjIsCarryover(g) { return !!g && g.date === MJ_CARRYOVER_DATE; }

// Supabaseは1リクエスト最大1000件までしか返さないため、.range()で全件をページング取得する。
// build() には .order('id') を含めたクエリを渡すこと（並び順が不定だと行の重複・漏れが起きる）。
async function mjFetchAllRows(build) {
  const PAGE = 1000;
  let from = 0, all = [];
  for (;;) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) { console.error('mjFetchAllRows error:', error); throw error; }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// 現存するシーズンに属するデータだけを残す。
// season_id が null の行や、削除済みシーズンを指す行（孤児）を集計対象から外す。
function mjScopeToSeasons(data, seasonIds) {
  const ids = new Set((seasonIds || []).map(String));
  const games = (data.games || []).filter(g => ids.has(String(g.season_id)));
  const gameIds = new Set(games.map(g => g.id));
  return {
    players: data.players || [],
    games,
    results: (data.results || []).filter(r => gameIds.has(r.game_id)),
    chips:   (data.chips   || []).filter(c => ids.has(String(c.season_id)))
  };
}

// 収支集計の共通ルール
//   data     : { players, games, results, chips }
//   pcFilter : null = 総合（引継ぎ対局を含み、チップptを加算）
//              3/4/5 = その人数の通常対局のみ（チップptは加算しない）
// 戻り値: [{ id, name, games, totalPt, rankSum, r1..r5 }] を totalPt の降順で返す
function mjComputeStats(data, pcFilter = null) {
  const isAll = (pcFilter === null);
  const games = data.games || [];
  const gameById = new Map(games.map(g => [g.id, g]));
  const gameSet = new Set(games.filter(g => {
    if (mjIsCarryover(g)) return isAll; // 引継ぎは総合タブのみ
    return isAll || g.player_count === pcFilter;
  }).map(g => g.id));

  const map = {};
  (data.players || []).forEach(p => {
    map[p.id] = { id:p.id, name:p.name, games:0, totalPt:0, rankSum:0, r1:0, r2:0, r3:0, r4:0, r5:0 };
  });

  (data.results || []).filter(r => gameSet.has(r.game_id)).forEach(r => {
    const s = map[r.player_id]; if (!s) return;
    s.totalPt += (r.total_pt || 0);
    if (mjIsCarryover(gameById.get(r.game_id))) return; // 引継ぎは対局数・順位に含めない
    s.games++;
    s.rankSum += (r.rank || 0);
    if (r.rank >= 1 && r.rank <= 5) s['r' + r.rank]++;
  });

  // チップptは総合タブのみ加算（人数別タブは対局収支のみ）
  if (isAll) {
    (data.chips || []).forEach(c => {
      const s = map[c.player_id]; if (!s) return;
      s.totalPt += (c.chip_pt || 0);
    });
  }

  return Object.values(map)
    .filter(s => s.games > 0 || (isAll && s.totalPt !== 0))
    .sort((a, b) => b.totalPt - a.totalPt);
}

// チップ枚数の集計
function mjComputeChipCounts(data) {
  const map = {};
  (data.players || []).forEach(p => { map[p.id] = { id:p.id, name:p.name, chips:0 }; });
  (data.chips || []).forEach(c => { const s = map[c.player_id]; if (s) s.chips += (c.chip_count || 0); });
  return Object.values(map).filter(t => t.chips !== 0).sort((a, b) => b.chips - a.chips);
}

// 全シーズン通算ランキング用にプレイヤーを除外する
function mjExcludeFromTotal(rows) {
  return rows.filter(r => !MJ_TOTAL_EXCLUDED_PLAYERS.includes(r.name));
}

// 対局結果の計算ロジック（DOMに触らない純粋関数）
// input.html / history.html から読み込む。
// DBの保存形式は変えない：score_pt / bonus_pt / total_pt / rank の意味と単位は従来どおり。

// 持ち点・返し点は人数に関係なく 35,000点
const MJ_BASE_SCORE = 35000;
// 1pt = 10点
const MJ_PT_PER_POINT = 10;

// 順位点の既定値（pt単位）。値は従来の RANK_DEFAULTS と同じ
const MJ_RANK_DEFAULTS = {
  3: [2000, 0, -2000],
  4: [2000, 1000, -1000, -2000],
  5: [3000, 1500, 0, -1500, -3000]
};

// 素点合計の目標値（3人=105,000 / 4人=140,000 / 5人=175,000）
function mjRequiredTotal(playerCount) { return playerCount * MJ_BASE_SCORE; }

// 素点 → score_pt
function mjRawToScorePt(raw) { return Math.round((Number(raw) - MJ_BASE_SCORE) / MJ_PT_PER_POINT); }

// score_pt → 素点
function mjScorePtToRaw(scorePt) { return MJ_BASE_SCORE + (Number(scorePt) || 0) * MJ_PT_PER_POINT; }

// 同じ順位の人数で順位点を分け合う。
// 端数が出ないよう10pt単位で配り、合計は total のまま保つ（対局全体の収支を0に保つため）。
function mjSplitRankPoints(total, n) {
  const base = Math.floor(total / n / 10) * 10; // base * n <= total
  const shares = Array(n).fill(base);
  let rest = total - base * n;
  for (let i = 0; rest >= 10; i++, rest -= 10) shares[i % n] += 10;
  if (rest !== 0) shares[0] += rest; // 順位点自体が10の倍数でない場合のみ
  return shares;
}

// 素点から保存用の値を計算する
//   rawScores  : [{ player_id, raw }]  raw = 終局時の素点（点）
//   rankPoints : 順位点の配列（pt単位・1位から順）
// 戻り値: [{ player_id, rank, score_pt, bonus_pt, total_pt }]（rawScores と同じ順）
function calcGameResult(rawScores, rankPoints) {
  const rows = rawScores.map((r, i) => ({
    key: i,
    player_id: r.player_id,
    raw: Number(r.raw),
    score_pt: mjRawToScorePt(r.raw)
  }));

  // 素点の高い順に順位をつける（同点は同じ順位）
  const sorted = [...rows].sort((a, b) => b.raw - a.raw);
  const rankOf = new Map();
  sorted.forEach((r, i) => {
    rankOf.set(r.key, (i > 0 && r.raw === sorted[i - 1].raw) ? rankOf.get(sorted[i - 1].key) : i + 1);
  });

  // 同点は該当する順位の順位点を分け合う（余りの配り先は rawScores の順に合わせる）
  const bonusOf = new Map();
  [...new Set(sorted.map(r => rankOf.get(r.key)))].sort((a, b) => a - b).forEach(rk => {
    const tied = rows.filter(r => rankOf.get(r.key) === rk);
    const total = tied.reduce((s, _, j) => s + (Number(rankPoints[rk - 1 + j]) || 0), 0);
    mjSplitRankPoints(total, tied.length).forEach((v, i) => bonusOf.set(tied[i].key, v));
  });

  return rows.map(r => {
    const bonus_pt = bonusOf.get(r.key) || 0;
    return {
      player_id: r.player_id,
      rank: rankOf.get(r.key),
      score_pt: r.score_pt,
      bonus_pt,
      total_pt: r.score_pt + bonus_pt
    };
  });
}

// 入力された素点の検証（raw が null / '' は未入力扱い）
function mjValidateRawScores(rawScores, playerCount) {
  const filled = rawScores.filter(r => r.raw !== null && r.raw !== undefined && r.raw !== '');
  const sum = filled.reduce((s, r) => s + Number(r.raw), 0);
  const required = mjRequiredTotal(playerCount);
  return {
    filled: filled.length,
    missing: playerCount - filled.length,
    sum,
    required,
    diff: required - sum,            // あと何点必要か
    complete: filled.length === playerCount,
    ok: filled.length === playerCount && sum === required
  };
}

// 保存済みの結果から順位点を復元する（rank順に bonus_pt を並べる）。
// 同点を含む対局は分け合った後の値しか残っていないため、元の順位点を一意に決められない
// → ambiguous=true を返す（呼び出し側で確認画面を出す。推測で保存しない）
function mjRecoverRankPoints(results) {
  const rows = [...results].sort((a, b) => a.rank - b.rank);
  const raws = rows.map(r => mjScorePtToRaw(r.score_pt));
  const ambiguous = new Set(raws).size !== raws.length
                 || new Set(rows.map(r => r.rank)).size !== rows.length;
  return { rankPoints: rows.map(r => r.bonus_pt || 0), ambiguous };
}

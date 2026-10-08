// scoring.js の単体テスト（DBアクセスなし）
//   node scripts/test-scoring.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(ROOT, 'scoring.js'), 'utf8');
const S = new Function(code + `
  return { MJ_BASE_SCORE, MJ_PT_PER_POINT, MJ_RANK_DEFAULTS, mjRequiredTotal, mjRawToScorePt,
           mjScorePtToRaw, mjSplitRankPoints, calcGameResult, mjValidateRawScores, mjRecoverRankPoints };
`)();

let pass = 0, fail = 0;
const results = [];
function t(name, fn) {
  try { fn(); pass++; results.push({ name, ok: true, msg: '' }); }
  catch (e) { fail++; results.push({ name, ok: false, msg: e.message }); }
}
function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}\n      期待: ${b}\n      実際: ${a}`);
}
// 結果を比較しやすい形に（player_id順）
const shape = rs => [...rs].sort((a, b) => String(a.player_id).localeCompare(String(b.player_id)))
  .map(r => `${r.player_id}:rank${r.rank}:s${r.score_pt}:b${r.bonus_pt}:t${r.total_pt}`);

const R3 = S.MJ_RANK_DEFAULTS[3]; // [2000, 0, -2000]
const R4 = S.MJ_RANK_DEFAULTS[4]; // [2000, 1000, -1000, -2000]
const R5 = S.MJ_RANK_DEFAULTS[5]; // [3000, 1500, 0, -1500, -3000]

// ── 基本の換算 ────────────────────────────────────────────────────────────
t('単位換算: 42,300点 → score_pt +730', () => {
  eq(S.mjRawToScorePt(42300), 730);
  eq(S.mjScorePtToRaw(730), 42300);
});
t('単位換算: 35,000点 → 0 / 往復変換', () => {
  eq(S.mjRawToScorePt(35000), 0);
  eq(S.mjScorePtToRaw(0), 35000);
  [-2538000, -800, 0, 29100, 35000, 1681000].forEach(raw =>
    eq(S.mjScorePtToRaw(S.mjRawToScorePt(raw)), raw, `往復変換 raw=${raw}`));
});
t('合計チェックの目標値: 3人=105,000 / 4人=140,000 / 5人=175,000', () => {
  eq([3, 4, 5].map(S.mjRequiredTotal), [105000, 140000, 175000]);
});

// ── 3人打ち ──────────────────────────────────────────────────────────────
t('3人打ち: 合計105,000・順位点どおり', () => {
  const out = S.calcGameResult([
    { player_id: 'A', raw: 46800 },
    { player_id: 'B', raw: 35000 },
    { player_id: 'C', raw: 23200 },
  ], R3);
  eq(shape(out), ['A:rank1:s1180:b2000:t3180', 'B:rank2:s0:b0:t0', 'C:rank3:s-1180:b-2000:t-3180']);
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
});

// ── 4人打ち ──────────────────────────────────────────────────────────────
t('4人打ち: 合計140,000・入力順と順位がばらばらでも正しい', () => {
  const out = S.calcGameResult([
    { player_id: 'C', raw: 26000 },
    { player_id: 'A', raw: 42300 },
    { player_id: 'D', raw: 1200 },
    { player_id: 'B', raw: 70500 },
  ], R4);
  eq(shape(out), [
    'A:rank2:s730:b1000:t1730',
    'B:rank1:s3550:b2000:t5550',
    'C:rank3:s-900:b-1000:t-1900',
    'D:rank4:s-3380:b-2000:t-5380',
  ]);
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
  eq(out.map(r => r.player_id), ['C', 'A', 'D', 'B'], '戻り値は入力順');
});

// ── 5人打ち ──────────────────────────────────────────────────────────────
t('5人打ち: 合計175,000', () => {
  const out = S.calcGameResult([
    { player_id: 'A', raw: 62000 },
    { player_id: 'B', raw: 43800 },
    { player_id: 'C', raw: 35000 },
    { player_id: 'D', raw: 34000 },
    { player_id: 'E', raw: 200 },
  ], R5);
  eq(shape(out), [
    'A:rank1:s2700:b3000:t5700',
    'B:rank2:s880:b1500:t2380',
    'C:rank3:s0:b0:t0',
    'D:rank4:s-100:b-1500:t-1600',
    'E:rank5:s-3480:b-3000:t-6480',
  ]);
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
});

// ── 2人同点 ──────────────────────────────────────────────────────────────
t('2人同点(2-3位): 同じ順位になり順位点を分け合う', () => {
  const out = S.calcGameResult([
    { player_id: 'A', raw: 46800 },
    { player_id: 'B', raw: 29100 },
    { player_id: 'C', raw: 29100 },
  ], R3);
  // 2位+3位の順位点 0 + (-2000) = -2000 を2人で → -1000 ずつ
  eq(shape(out), ['A:rank1:s1180:b2000:t3180', 'B:rank2:s-590:b-1000:t-1590', 'C:rank2:s-590:b-1000:t-1590']);
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
  out.forEach(r => eq(r.bonus_pt % 10, 0, '順位点が10の倍数'));
});
t('2人同点(1-2位・4人打ち): 2000+1000=3000 を 1500 ずつ', () => {
  const out = S.calcGameResult([
    { player_id: 'A', raw: 50000 },
    { player_id: 'B', raw: 50000 },
    { player_id: 'C', raw: 30000 },
    { player_id: 'D', raw: 10000 },
  ], R4);
  eq(shape(out), [
    'A:rank1:s1500:b1500:t3000',
    'B:rank1:s1500:b1500:t3000',
    'C:rank3:s-500:b-1000:t-1500',
    'D:rank4:s-2500:b-2000:t-4500',
  ]);
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
});
t('2人同点(3-4位・4人打ち): -1000+-2000=-3000 を -1500 ずつ', () => {
  const out = S.calcGameResult([
    { player_id: 'A', raw: 60000 },
    { player_id: 'B', raw: 50000 },
    { player_id: 'C', raw: 15000 },
    { player_id: 'D', raw: 15000 },
  ], R4);
  eq(shape(out), [
    'A:rank1:s2500:b2000:t4500',
    'B:rank2:s1500:b1000:t2500',
    'C:rank3:s-2000:b-1500:t-3500',
    'D:rank3:s-2000:b-1500:t-3500',
  ]);
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
});

// ── 3人同点 ──────────────────────────────────────────────────────────────
t('3人同点(1-3位・4人打ち): 2000+1000-1000=2000 を10pt単位で配分し合計保持', () => {
  const out = S.calcGameResult([
    { player_id: 'A', raw: 40000 },
    { player_id: 'B', raw: 40000 },
    { player_id: 'C', raw: 40000 },
    { player_id: 'D', raw: 20000 },
  ], R4);
  const bonuses = out.map(r => r.bonus_pt);
  eq(bonuses.slice(0, 3).reduce((a, b) => a + b, 0), 2000, '同点3人の順位点合計が元のまま');
  out.forEach(r => eq(r.bonus_pt % 10, 0, `順位点が10の倍数 (${r.player_id}:${r.bonus_pt})`));
  eq(out.filter(r => r.rank === 1).length, 3, '3人が1位');
  eq(out.find(r => r.player_id === 'D').rank, 4, '残りは4位');
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
  eq(shape(out), [
    'A:rank1:s500:b670:t1170',
    'B:rank1:s500:b670:t1170',
    'C:rank1:s500:b660:t1160',
    'D:rank4:s-1500:b-2000:t-3500',
  ]);
});
t('3人同点(3-5位・5人打ち): 0-1500-3000=-4500 → -1500 ずつ', () => {
  const out = S.calcGameResult([
    { player_id: 'A', raw: 70000 },
    { player_id: 'B', raw: 45000 },
    { player_id: 'C', raw: 20000 },
    { player_id: 'D', raw: 20000 },
    { player_id: 'E', raw: 20000 },
  ], R5);
  eq(shape(out).slice(2), ['C:rank3:s-1500:b-1500:t-3000', 'D:rank3:s-1500:b-1500:t-3000', 'E:rank3:s-1500:b-1500:t-3000']);
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
});

// ── 全員35,000点（全員同点） ──────────────────────────────────────────────
t('全員35,000点(4人): 全員1位・順位点は合計0を保って配分', () => {
  const out = S.calcGameResult(
    ['A', 'B', 'C', 'D'].map(id => ({ player_id: id, raw: 35000 })), R4);
  out.forEach(r => { eq(r.rank, 1, '全員1位'); eq(r.score_pt, 0, 'score_pt=0'); });
  eq(out.reduce((s, r) => s + r.bonus_pt, 0), 0, '順位点合計0');
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
  out.forEach(r => eq(r.bonus_pt % 10, 0, '10の倍数'));
});
t('全員35,000点(3人)', () => {
  const out = S.calcGameResult(['A', 'B', 'C'].map(id => ({ player_id: id, raw: 35000 })), R3);
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0);
  eq(out.every(r => r.rank === 1 && r.score_pt === 0), true);
});

// ── マイナスの素点（飛び） ────────────────────────────────────────────────
t('マイナスの素点（飛び）: -3,100点 → score_pt -3810', () => {
  const out = S.calcGameResult([
    { player_id: 'A', raw: 73100 },
    { player_id: 'B', raw: 35000 },
    { player_id: 'C', raw: 35000 },
    { player_id: 'D', raw: -3100 },
  ], R4);
  eq(shape(out), [
    'A:rank1:s3810:b2000:t5810',
    'B:rank2:s0:b0:t0',
    'C:rank2:s0:b0:t0',
    'D:rank4:s-3810:b-2000:t-5810',
  ]);
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
});
t('マイナスの素点: 大きな飛び -36,200点', () => {
  const out = S.calcGameResult([
    { player_id: 'A', raw: 100000 },
    { player_id: 'B', raw: 40000 },
    { player_id: 'C', raw: 36200 },
    { player_id: 'D', raw: -36200 },
  ], R4);
  eq(out.find(r => r.player_id === 'D').score_pt, -7120);
  eq(out.find(r => r.player_id === 'D').rank, 4);
  eq(out.reduce((s, r) => s + r.total_pt, 0), 0, '対局合計が0');
});

// ── 合計不一致 ────────────────────────────────────────────────────────────
t('合計不一致: mjValidateRawScores が検出する', () => {
  const rs = [{ player_id: 'A', raw: 42300 }, { player_id: 'B', raw: 35100 }, { player_id: 'C', raw: 26000 }, { player_id: 'D', raw: 35200 }];
  const v = S.mjValidateRawScores(rs, 4);
  eq([v.ok, v.complete, v.sum, v.required, v.diff], [false, true, 138600, 140000, 1400]);
});
t('合計一致: ok=true / diff=0', () => {
  const rs = [{ player_id: 'A', raw: 42300 }, { player_id: 'B', raw: 35100 }, { player_id: 'C', raw: 26000 }, { player_id: 'D', raw: 36600 }];
  const v = S.mjValidateRawScores(rs, 4);
  eq([v.ok, v.sum, v.diff], [true, 140000, 0]);
});
t('未入力あり: complete=false / missing を返す', () => {
  const rs = [{ player_id: 'A', raw: 42300 }, { player_id: 'B', raw: null }, { player_id: 'C', raw: '' }, { player_id: 'D', raw: 36600 }];
  const v = S.mjValidateRawScores(rs, 4);
  eq([v.ok, v.complete, v.filled, v.missing, v.diff], [false, false, 2, 2, 61100]);
});
t('合計不一致でも対局の total_pt 合計は0にならない（UIで登録を止める根拠）', () => {
  const out = S.calcGameResult([
    { player_id: 'A', raw: 42300 }, { player_id: 'B', raw: 35100 },
    { player_id: 'C', raw: 26000 }, { player_id: 'D', raw: 35200 },
  ], R4);
  eq(out.reduce((s, r) => s + r.total_pt, 0) !== 0, true, '合計≠0になる');
});

// ── 順位点の配分（10で割り切れない場合） ──────────────────────────────────
t('順位点配分: 10pt単位・合計保持（割り切れない場合）', () => {
  eq(S.mjSplitRankPoints(10000, 3), [3340, 3330, 3330]);
  eq(S.mjSplitRankPoints(10000, 3).reduce((a, b) => a + b, 0), 10000);
  eq(S.mjSplitRankPoints(-2000, 3), [-660, -670, -670]);
  eq(S.mjSplitRankPoints(-2000, 3).reduce((a, b) => a + b, 0), -2000);
  eq(S.mjSplitRankPoints(3000, 2), [1500, 1500]);
  eq(S.mjSplitRankPoints(0, 4), [0, 0, 0, 0]);
  eq(S.mjSplitRankPoints(-1500, 2), [-750, -750]);
});
t('順位点配分: 10の倍数でない順位点でも合計を保つ', () => {
  const sh = S.mjSplitRankPoints(1005, 2);
  eq(sh.reduce((a, b) => a + b, 0), 1005, '合計保持');
});

// ── 順位点の復元 ──────────────────────────────────────────────────────────
t('順位点復元: 同点なしは一意に復元できる', () => {
  const stored = [
    { rank: 1, score_pt: 730, bonus_pt: 1000 },
    { rank: 2, score_pt: 3550, bonus_pt: 2000 },
  ].sort(() => 0);
  const rec = S.mjRecoverRankPoints([
    { rank: 2, score_pt: 730, bonus_pt: 1000 },
    { rank: 1, score_pt: 3550, bonus_pt: 2000 },
  ]);
  eq([rec.rankPoints, rec.ambiguous], [[2000, 1000], false]);
  void stored;
});
t('順位点復元: 素点が同じ（同点）なら ambiguous=true', () => {
  const rec = S.mjRecoverRankPoints([
    { rank: 1, score_pt: 3810, bonus_pt: 2000 },
    { rank: 2, score_pt: 0, bonus_pt: 0 },
    { rank: 2, score_pt: 0, bonus_pt: 0 },
    { rank: 4, score_pt: -3810, bonus_pt: -2000 },
  ]);
  eq(rec.ambiguous, true);
});
t('順位点復元: rank が重複（旧形式 3,4）でも ambiguous=true', () => {
  // game 89 相当: 同点なのに rank が 3 と 4
  const rec = S.mjRecoverRankPoints([
    { rank: 1, score_pt: 2700, bonus_pt: 3000 },
    { rank: 2, score_pt: 880, bonus_pt: 1500 },
    { rank: 3, score_pt: 0, bonus_pt: -750 },
    { rank: 4, score_pt: 0, bonus_pt: -750 },
    { rank: 5, score_pt: -3580, bonus_pt: -3000 },
  ]);
  eq(rec.ambiguous, true);
});
t('順位点復元 → 再計算で bonus_pt が一致（同点なし）', () => {
  const stored = [
    { player_id: 'A', rank: 1, score_pt: 1180, bonus_pt: 2000, total_pt: 3180 },
    { player_id: 'B', rank: 2, score_pt: 0, bonus_pt: 0, total_pt: 0 },
    { player_id: 'C', rank: 3, score_pt: -1180, bonus_pt: -2000, total_pt: -3180 },
  ];
  const { rankPoints } = S.mjRecoverRankPoints(stored);
  const out = S.calcGameResult(stored.map(r => ({ player_id: r.player_id, raw: S.mjScorePtToRaw(r.score_pt) })), rankPoints);
  eq(shape(out), shape(stored));
});

// ── 既定値は変更していないこと ────────────────────────────────────────────
t('RANK_DEFAULTS の値が従来どおり', () => {
  eq(S.MJ_RANK_DEFAULTS, { 3: [2000, 0, -2000], 4: [2000, 1000, -1000, -2000], 5: [3000, 1500, 0, -1500, -3000] });
});

// ── 結果表示 ──────────────────────────────────────────────────────────────
console.log('########## scoring.js 単体テスト ##########\n');
results.forEach(r => {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}`);
  if (!r.ok) console.log(`    ${r.msg}`);
});
console.log(`\n合格 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);

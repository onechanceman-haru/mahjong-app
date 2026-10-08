// バックアップから元に戻す
//   確認(dry-run): node scripts/rollback.mjs <YYYYMMDD-HHMM>
//   実行         : node scripts/rollback.mjs <YYYYMMDD-HHMM> --execute
// バックアップ時点の状態に合わせて、足りない行はINSERT・値が違う行はPATCH・余分な行はDELETEする
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { selAll, insert, patch, del, ROOT } from './db.mjs';

// 子→親の順に復元（INSERT時の外部キー制約を避けるため逆順に処理する）
const TABLES = ['players', 'seasons', 'groups', 'games', 'game_results', 'chip_settlements'];

const stamp = process.argv[2];
const EXECUTE = process.argv.includes('--execute');
if (!stamp) {
  console.error('使い方: node scripts/rollback.mjs <YYYYMMDD-HHMM> [--execute]');
  process.exit(1);
}
const dir = join(ROOT, 'backups', stamp);
if (!existsSync(dir)) { console.error(`バックアップが見つかりません: backups/${stamp}`); process.exit(1); }

const plan = [];

for (const t of TABLES) {
  const file = join(dir, `${t}.json`);
  if (!existsSync(file)) { console.log(`  ${t}: バックアップなし → スキップ`); continue; }
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  const current = await selAll(t);
  const curById = new Map(current.map(r => [r.id, r]));
  const bakById = new Map(backup.map(r => [r.id, r]));

  const toInsert = backup.filter(r => !curById.has(r.id));
  const toDelete = current.filter(r => !bakById.has(r.id));
  const toPatch = backup.filter(r => {
    const c = curById.get(r.id);
    return c && Object.keys(r).some(k => JSON.stringify(r[k]) !== JSON.stringify(c[k]));
  });

  console.log(`  ${t}: INSERT ${toInsert.length} / UPDATE ${toPatch.length} / DELETE ${toDelete.length}`);
  toPatch.forEach(r => {
    const c = curById.get(r.id);
    const diff = Object.keys(r).filter(k => JSON.stringify(r[k]) !== JSON.stringify(c[k]))
      .map(k => `${k}: ${JSON.stringify(c[k])} → ${JSON.stringify(r[k])}`).join(', ');
    console.log(`     id=${r.id} ${diff}`);
  });
  toInsert.forEach(r => console.log(`     INSERT id=${r.id}`));
  toDelete.forEach(r => console.log(`     DELETE id=${r.id}`));

  plan.push({ t, toInsert, toPatch, toDelete });
}

if (!EXECUTE) {
  console.log('\n(dry-run) 実行するには --execute を付けてください');
  process.exit(0);
}

// INSERT/UPDATE は親→子、DELETE は子→親の順で実行
for (const { t, toInsert, toPatch } of plan) {
  if (toInsert.length) { await insert(t, toInsert); console.log(`  ${t}: ${toInsert.length}件 INSERT`); }
  for (const r of toPatch) {
    const { id, ...rest } = r;
    await patch(t, `id=eq.${id}`, rest);
  }
  if (toPatch.length) console.log(`  ${t}: ${toPatch.length}件 UPDATE`);
}
for (const { t, toDelete } of [...plan].reverse()) {
  for (const r of toDelete) await del(t, `id=eq.${r.id}`);
  if (toDelete.length) console.log(`  ${t}: ${toDelete.length}件 DELETE`);
}
console.log('\n✅ ロールバック完了');

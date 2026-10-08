// DB書き込み前のバックアップ: 全行を backups/YYYYMMDD-HHMM/<table>.json に保存する
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { selAll, ROOT } from './db.mjs';

const TABLES = ['players', 'seasons', 'games', 'game_results', 'chip_settlements', 'groups'];

const d = new Date();
const p = n => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
const dir = join(ROOT, 'backups', stamp);
mkdirSync(dir, { recursive: true });

for (const t of TABLES) {
  const rows = await selAll(t);
  writeFileSync(join(dir, `${t}.json`), JSON.stringify(rows, null, 2), 'utf8');
  console.log(`  ${t}: ${rows.length}件 → backups/${stamp}/${t}.json`);
}
console.log(`\n✅ バックアップ完了: backups/${stamp}`);
console.log(`   復元するには: node scripts/rollback.mjs ${stamp} --execute`);

// Supabase REST ヘルパー。認証情報は index.html から読み込む（新規ファイルにベタ書きしない）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readCreds() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const url = html.match(/const SUPABASE_URL\s*=\s*'([^']+)'/)?.[1];
  const key = html.match(/const SUPABASE_KEY\s*=\s*'([^']+)'/)?.[1];
  if (!url || !key) throw new Error('index.html から SUPABASE_URL / SUPABASE_KEY を読み取れませんでした');
  return { url, key };
}

export const { url: BASE, key: KEY } = readCreds();
export { ROOT };

function hdr(extra = {}) {
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...extra };
}

export async function sel(table, qs = '') {
  const r = await fetch(`${BASE}/rest/v1/${table}?${qs}`, { headers: hdr() });
  const d = await r.json();
  if (!r.ok) throw new Error(`SELECT ${table}: ${JSON.stringify(d)}`);
  return d;
}

// 1000件制限を回避して全件取得（order=id.asc 固定でページング）
export async function selAll(table, select = '*', qs = '') {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${BASE}/rest/v1/${table}?select=${select}&order=id.asc${qs ? '&' + qs : ''}`, {
      headers: hdr({ Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`SELECT ${table}: ${JSON.stringify(d)}`);
    if (!d.length) break;
    all.push(...d);
    if (d.length < PAGE) break;
  }
  return all;
}

export async function patch(table, qs, body) {
  const r = await fetch(`${BASE}/rest/v1/${table}?${qs}`, {
    method: 'PATCH', headers: hdr({ Prefer: 'return=representation' }), body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`PATCH ${table}: ${JSON.stringify(d)}`);
  return d;
}

export async function del(table, qs) {
  const r = await fetch(`${BASE}/rest/v1/${table}?${qs}`, {
    method: 'DELETE', headers: hdr({ Prefer: 'return=representation' })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`DELETE ${table}: ${JSON.stringify(d)}`);
  return d;
}

export async function insert(table, rows) {
  const r = await fetch(`${BASE}/rest/v1/${table}`, {
    method: 'POST', headers: hdr({ Prefer: 'return=representation' }), body: JSON.stringify(rows)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`INSERT ${table}: ${JSON.stringify(d)}`);
  return d;
}

// bank.js — 题库加载。
// 正常部署：先读 data/sets.json（清单），再逐个读 data/sets/<id>.json。
// 单文件构建：题库被内联到 window.__TOEIC_BANK__。
async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`题库加载失败：${url.pathname.split('/').pop()} HTTP ${res.status}`);
  return res.json();
}

export async function loadBank() {
  if (globalThis.__TOEIC_BANK__) return globalThis.__TOEIC_BANK__;
  const base = new URL('../data/', import.meta.url);
  const manifest = await getJSON(new URL('sets.json', base));
  if (!Array.isArray(manifest.sets)) throw new Error('data/sets.json 里没有 sets 数组');
  const sets = await Promise.all(manifest.sets.map((id) => getJSON(new URL(`sets/${id}.json`, base))));
  return { schema_version: manifest.schema_version || 1, note: manifest.note || '', sets };
}

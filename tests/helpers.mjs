import { readFileSync } from 'node:fs';

/** 在 Node 里加载题库（和 bank.js 的浏览器逻辑等价）。 */
export function loadBankNode() {
  const root = new URL('../data/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('sets.json', root), 'utf8'));
  return {
    schema_version: manifest.schema_version || 1,
    note: manifest.note || '',
    sets: manifest.sets.map((id) => JSON.parse(readFileSync(new URL(`sets/${id}.json`, root), 'utf8'))),
  };
}

/** 假 localStorage（Map 实现），给 store.js 测试用。 */
export class FakeStorage {
  constructor() { this.map = new Map(); this.failNext = false; }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    if (this.failNext) { this.failNext = false; throw new Error('QuotaExceededError'); }
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

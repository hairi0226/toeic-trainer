// 把题库里所有题目 id 追加进 tests/qids.frozen.txt（只增不减）。
// 新增套题后跑一次：node tools/freeze_qids.mjs
// 测试会断言快照里的每个 id 仍然存在于题库里——这样 qid 被删/重编号时测试会挂。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('data/sets.json', root), 'utf8'));
const ids = [];
for (const id of manifest.sets) {
  const set = JSON.parse(readFileSync(new URL(`data/sets/${id}.json`, root), 'utf8'));
  for (const g of set.groups) for (const q of g.questions) ids.push(q.id);
}
const file = new URL('tests/qids.frozen.txt', root);
const existing = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
const all = [...new Set([...existing, ...ids])];
writeFileSync(file, all.join('\n') + '\n');
console.log(`frozen qids: ${existing.length} → ${all.length}`);

// 校验单个套题 JSON 是否合规：node tools/validate_set.mjs <file.json>
// 通过打印 OK 与题数统计；不通过打印错误列表并以非零退出。
import { readFileSync } from 'node:fs';
import { validateBank } from '../js/core.js';

const file = process.argv[2];
if (!file) { console.error('用法：node tools/validate_set.mjs <file.json>'); process.exit(2); }
let set;
try {
  set = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error('JSON 解析失败：' + e.message);
  process.exit(1);
}
const errors = validateBank({ sets: [set] });
const extra = [];
const qs = set.groups ? set.groups.flatMap((g) => g.questions || []) : [];
qs.forEach((q, i) => {
  if (q.n !== i + 1) extra.push(`${q.id}: n 应为 ${i + 1}（全套从 1 连续编号）`);
  if (!q.explain) extra.push(`${q.id}: 缺 explain`);
  if (!q.zh || !q.zh.stem || !q.zh.options || !q.zh.vocab) extra.push(`${q.id}: 缺 zh.stem / zh.options / zh.vocab`);
  else for (const k of 'ABCD') if (!q.zh.options[k]) extra.push(`${q.id}: zh.options 缺 ${k}`);
  if (!q.type) extra.push(`${q.id}: 缺 type 标签`);
  if (q.part === 5 && !/_{3}/.test(q.stem)) extra.push(`${q.id}: Part 5 题干要用 ___ 表示空格`);
});
for (const g of set.groups || []) for (const p of g.passages || []) if (!p.zh) extra.push(`${g.id}: passage "${p.title}" 缺 zh 译文`);
if (set.style !== 'official-structure') extra.push('set.style 应为 official-structure');
if (set.origin !== 'generated') extra.push('set.origin 应为 generated');
if (!Array.isArray(set.phrases) || set.phrases.length !== 5) extra.push('phrases 应为 5 个搭配');

const all = [...errors, ...extra];
if (all.length) {
  console.log('FAIL', all.length, '处问题：');
  for (const e of all) console.log(' -', e);
  process.exit(1);
}
const byPart = {};
for (const q of qs) byPart[q.part] = (byPart[q.part] || 0) + 1;
const byType = {};
for (const q of qs) byType[q.type] = (byType[q.type] || 0) + 1;
console.log('OK', set.id, `${qs.length} 题`, JSON.stringify(byPart), JSON.stringify(byType));

// 把一个校验通过的套题 JSON 加进题库：node tools/add_set.mjs <file.json>
// 做的事：validate → 复制到 data/sets/<id>.json → 清单追加 id → 冻结 qid。之后请跑 npm test。
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const file = process.argv[2];
if (!file) { console.error('用法：node tools/add_set.mjs <file.json>'); process.exit(2); }

execFileSync(process.execPath, [fileURLToPath(new URL('validate_set.mjs', import.meta.url)), file], { stdio: 'inherit' });

const set = JSON.parse(readFileSync(file, 'utf8'));
const target = new URL(`data/sets/${set.id}.json`, root);
if (existsSync(target) && !process.argv.includes('--force')) {
  console.error(`data/sets/${set.id}.json 已存在；确认要覆盖请加 --force（注意：改了答案/选项的题要 rev+1）`);
  process.exit(1);
}
copyFileSync(file, target);

const manifestUrl = new URL('data/sets.json', root);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
if (!manifest.sets.includes(set.id)) {
  manifest.sets.push(set.id);
  writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`清单已追加 ${set.id}`);
}
execFileSync(process.execPath, [fileURLToPath(new URL('freeze_qids.mjs', import.meta.url))], { stdio: 'inherit' });
console.log(`已加入 data/sets/${set.id}.json，接下来跑 npm test`);

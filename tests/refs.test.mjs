// 冒烟测试：index.html / js 里引用的文件必须存在，import 路径必须能解析。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const exists = (rel) => existsSync(new URL(rel, root));

test('index.html 引用的本地文件都存在', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 4);
  for (const r of refs) assert.ok(exists(r), `index.html 引用了不存在的文件：${r}`);
});

test('manifest 里的图标都存在', () => {
  const m = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  for (const icon of m.icons) assert.ok(exists(icon.src.replace(/^\.\//, '')), icon.src);
});

test('js/*.js 的相对 import 都能解析', () => {
  for (const f of readdirSync(new URL('js/', root))) {
    const src = readFileSync(new URL('js/' + f, root), 'utf8');
    for (const m of src.matchAll(/from\s+'(\.\/[^']+)'/g)) {
      assert.ok(exists('js/' + m[1].slice(2)), `${f} import 了不存在的 ${m[1]}`);
    }
  }
});

test('题库清单里的每套文件都存在', () => {
  const m = JSON.parse(readFileSync(new URL('data/sets.json', root), 'utf8'));
  for (const id of m.sets) assert.ok(exists(`data/sets/${id}.json`), id);
});

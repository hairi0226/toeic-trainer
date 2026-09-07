import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from './helpers.mjs';
import { emptyProgress, recordAttempt, countProgress } from '../js/core.js';
import { loadLocal, saveLocal, loadBackup, wipeLocal, loadTrash, getMeta, setMeta, STORAGE_KEY } from '../js/store.js';

const T0 = 1757200000000;
let fake;
beforeEach(() => {
  fake = new FakeStorage();
  globalThis.localStorage = fake;
  wipeLocal();
  fake.clear();
});

test('空存储 → 空进度，无警告', () => {
  const { progress, warning } = loadLocal();
  assert.deepEqual(progress, emptyProgress());
  assert.equal(warning, null);
});

test('保存后能读回', () => {
  const p = emptyProgress();
  recordAttempt(p, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  const r = saveLocal(p);
  assert.equal(r.ok, true);
  assert.equal(r.merged, false);
  assert.equal(countProgress(loadLocal().progress).attempts, 1);
});

test('坏 JSON → 另存 corrupt 副本，退回备份', () => {
  const p = emptyProgress();
  recordAttempt(p, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  saveLocal(p);
  // 造一个备份（模拟隔天）
  fake.setItem('tt.progress.backup', fake.getItem(STORAGE_KEY));
  fake.setItem('tt.progress.backup.ts', String(Date.now()));
  fake.setItem(STORAGE_KEY, '{not json');
  const { progress, warning } = loadLocal();
  assert.equal(countProgress(progress).attempts, 1);
  assert.match(warning, /损坏/);
  assert.ok([...fake.map.keys()].some((k) => k.startsWith('tt.progress.corrupt.')));
});

test('别的标签页写过 → 并集后再写，不丢对方数据', () => {
  const mine = emptyProgress();
  recordAttempt(mine, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  saveLocal(mine);
  // 模拟另一个标签页写入了一条别的记录
  const other = emptyProgress();
  recordAttempt(other, { qid: 'day1-q2', choice: 'B', correct: false, ts: T0 + 1 });
  fake.setItem(STORAGE_KEY, JSON.stringify(other));
  // 本标签页继续写自己的
  recordAttempt(mine, { qid: 'day1-q3', choice: 'C', correct: true, ts: T0 + 2 });
  const r = saveLocal(mine);
  assert.equal(r.ok, true);
  assert.equal(r.merged, true);
  assert.equal(countProgress(r.progress).attempts, 3);
  assert.equal(countProgress(loadLocal().progress).attempts, 3);
});

test('缩水保护：内存里比磁盘少 → 并集而不是覆盖', () => {
  const full = emptyProgress();
  recordAttempt(full, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  recordAttempt(full, { qid: 'day1-q2', choice: 'A', correct: true, ts: T0 + 1 });
  saveLocal(full);
  const r = saveLocal(emptyProgress()); // 某个 bug 把空进度传进来
  assert.equal(r.merged, true);
  assert.equal(countProgress(loadLocal().progress).attempts, 2);
  const r2 = saveLocal(emptyProgress(), { allowShrink: true });
  assert.equal(r2.merged, false);
  assert.equal(countProgress(loadLocal().progress).attempts, 0);
});

test('写入失败会报错而不是静默', () => {
  fake.failNext = true;
  const r = saveLocal(emptyProgress());
  assert.equal(r.ok, false);
  assert.match(r.error, /Quota/);
});

test('每天首次保存前把上一版放进备份', () => {
  const p = emptyProgress();
  recordAttempt(p, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  saveLocal(p);
  fake.setItem('tt.progress.backup.ts', '0'); // 让“上次备份”看起来是很久以前
  recordAttempt(p, { qid: 'day1-q2', choice: 'A', correct: true, ts: T0 + 1 });
  saveLocal(p);
  assert.equal(countProgress(loadBackup()).attempts, 1, '备份应是写入前的那一版');
  assert.equal(countProgress(loadLocal().progress).attempts, 2);
});

test('清空本机 → 内容进回收站，可恢复', () => {
  const p = emptyProgress();
  recordAttempt(p, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  saveLocal(p);
  wipeLocal();
  assert.deepEqual(loadLocal().progress, emptyProgress());
  assert.equal(countProgress(loadTrash()).attempts, 1);
});

test('meta 读写与删除键', () => {
  setMeta({ a: 1, gist: { token: 'x' } });
  assert.equal(getMeta().a, 1);
  setMeta({ a: undefined });
  assert.equal(getMeta().a, undefined);
  assert.equal(getMeta().gist.token, 'x');
});

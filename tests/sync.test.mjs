import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncManager } from '../js/sync.js';
import { emptyProgress, recordAttempt, countProgress, normalize } from '../js/core.js';

const T0 = 1757200000000;

/** 内存里的假云端。 */
class FakeAdapter {
  constructor(remote = null) {
    this.name = 'fake'; this.label = '假云端'; this.remote = remote;
    this.pulls = 0; this.pushes = 0; this.failPull = null; this.failPush = null; this.pushDelay = 0;
  }
  configured() { return true; }
  async pull() { this.pulls += 1; if (this.failPull) throw this.failPull; return this.remote ? normalize(JSON.parse(JSON.stringify(this.remote))) : null; }
  async push(p) {
    this.pushes += 1;
    if (this.failPush) throw this.failPush;
    const snapshot = JSON.stringify(p); // 和真实适配器一样：发送时就定格内容
    if (this.pushDelay) await new Promise((r) => setTimeout(r, this.pushDelay));
    this.remote = JSON.parse(snapshot);
    return { verified: true };
  }
}

function harness(adapter, local) {
  const state = { local, sets: 0, statuses: [] };
  const meta = { data: {}, get() { return this.data; }, set(patch) { Object.assign(this.data, patch); } };
  const sync = new SyncManager({
    adapter,
    getLocal: () => state.local,
    setLocal: (p) => { state.local = p; state.sets += 1; },
    onStatus: (s) => state.statuses.push(s.state),
    meta,
  });
  return { sync, state, meta };
}

test('云端有、本地无 → 写回本地，不推送', async () => {
  const remote = emptyProgress();
  recordAttempt(remote, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  const adapter = new FakeAdapter(remote);
  const { sync, state } = harness(adapter, emptyProgress());
  assert.equal(await sync.syncNow(), true);
  assert.equal(state.sets, 1);
  assert.equal(countProgress(state.local).attempts, 1);
  assert.equal(adapter.pushes, 0);
  assert.equal(sync.state, 'ok');
});

test('本地有、云端无 → 推送并集，dirty 归零', async () => {
  const local = emptyProgress();
  recordAttempt(local, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  const adapter = new FakeAdapter(null);
  const { sync, state, meta } = harness(adapter, local);
  sync.markDirty();
  assert.equal(sync.dirty, 1);
  await sync.syncNow();
  assert.equal(adapter.pushes, 1);
  assert.equal(countProgress(adapter.remote).attempts, 1);
  assert.equal(state.sets, 0, '本地没变就不重写');
  assert.equal(sync.dirty, 0);
  assert.equal(meta.data.dirty, 0);
  assert.ok(meta.data.lastSyncOk > 0);
});

test('两边各有 → 合并后两边一致', async () => {
  const local = emptyProgress();
  recordAttempt(local, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  const remote = emptyProgress();
  recordAttempt(remote, { qid: 'day1-q2', choice: 'B', correct: false, ts: T0 + 1 });
  const adapter = new FakeAdapter(remote);
  const { sync, state } = harness(adapter, local);
  await sync.syncNow();
  assert.equal(countProgress(state.local).attempts, 2);
  assert.equal(countProgress(adapter.remote).attempts, 2);
});

test('pull 失败 → 本地不动、状态 error；网络错误 → offline', async () => {
  const local = emptyProgress();
  recordAttempt(local, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  const adapter = new FakeAdapter(null);
  adapter.failPull = Object.assign(new Error('boom'), { code: 'server' });
  const { sync, state } = harness(adapter, local);
  assert.equal(await sync.syncNow(), false);
  assert.equal(sync.state, 'error');
  assert.equal(state.sets, 0);
  assert.equal(adapter.pushes, 0);
  adapter.failPull = Object.assign(new Error('net'), { code: 'network' });
  await sync.syncNow();
  assert.equal(sync.state, 'offline');
});

test('push 失败 → 本地已合并、dirty 不清、下次再推', async () => {
  const local = emptyProgress();
  recordAttempt(local, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  const remote = emptyProgress();
  recordAttempt(remote, { qid: 'day1-q2', choice: 'B', correct: false, ts: T0 + 1 });
  const adapter = new FakeAdapter(remote);
  adapter.failPush = Object.assign(new Error('write failed'), { code: 'server' });
  const { sync, state } = harness(adapter, local);
  sync.markDirty();
  await sync.syncNow();
  assert.equal(countProgress(state.local).attempts, 2);
  assert.equal(sync.dirty, 1);
  assert.equal(sync.state, 'error');
  adapter.failPush = null;
  await sync.syncNow();
  assert.equal(sync.dirty, 0);
  assert.equal(countProgress(adapter.remote).attempts, 2);
});

test('云端写入未确认 → 视为失败', async () => {
  const adapter = new FakeAdapter(null);
  adapter.push = async () => ({ verified: false });
  const local = emptyProgress();
  recordAttempt(local, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  const { sync } = harness(adapter, local);
  assert.equal(await sync.syncNow(), false);
  assert.equal(sync.state, 'error');
});

test('并发 syncNow 三次 → 只跑两轮（进行中 + 补一轮）', async () => {
  const adapter = new FakeAdapter(null);
  adapter.pushDelay = 20;
  const local = emptyProgress();
  recordAttempt(local, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  const { sync } = harness(adapter, local);
  const runs = [sync.syncNow(), sync.syncNow(), sync.syncNow()];
  await Promise.all(runs);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(adapter.pulls, 2);
});

test('同步期间新写入不会被误清 dirty', async () => {
  const adapter = new FakeAdapter(null);
  adapter.pushDelay = 30;
  const local = emptyProgress();
  recordAttempt(local, { qid: 'day1-q1', choice: 'A', correct: true, ts: T0 });
  const { sync, state } = harness(adapter, local);
  sync.markDirty();
  const run = sync.syncNow();
  await new Promise((r) => setTimeout(r, 5));
  recordAttempt(state.local, { qid: 'day1-q2', choice: 'A', correct: true, ts: T0 + 1 });
  sync.markDirty(); // push 期间的新写入
  await run;
  assert.equal(sync.dirty, 1, '新写入仍应算未上传');
  await new Promise((r) => setTimeout(r, 80)); // pending 那轮跑完
  assert.equal(sync.dirty, 0);
  assert.equal(countProgress(adapter.remote).attempts, 2);
});

test('没有适配器 → off，不做任何事', async () => {
  const { sync } = harness(null, emptyProgress());
  assert.equal(await sync.syncNow(), false);
  assert.equal(sync.state, 'off');
  assert.equal(sync.enabled(), false);
});

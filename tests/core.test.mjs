import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyProgress, normalize, mergeProgress, sameProgress, genId, indexBank, validateBank,
  startDraft, recordAttempt, finishSession, abandonDraft, addPaperSession, setTag, tagOf,
  deleteAttempt, deleteSession, liveAttempts,
  latestAttempts, setSummary, partAccuracy, wrongQuestions, causeHistogram,
  studyStreak, pickRandom, exportPayload, importPayload, countProgress, stableStringify,
} from '../js/core.js';
import { loadBankNode } from './helpers.mjs';

const bank = loadBankNode();
const index = indexBank(bank);
const day1 = index.sets.get('day1');
const T0 = 1757200000000; // 固定时间戳，避免测试依赖真实时间

test('题库通过结构校验，且题号在套内连续', () => {
  assert.deepEqual(validateBank(bank), []);
  for (const set of index.sets.values()) {
    const ns = set._qids.map((q) => index.questions.get(q).q.n);
    assert.deepEqual(ns, ns.map((_, i) => i + 1), set.id);
  }
});

test('validateBank 能抓住常见错误', () => {
  const bad = JSON.parse(JSON.stringify(bank));
  const q = bad.sets[0].groups[0].questions[0];
  q.answer = 'E';
  bad.sets[0].groups[0].questions[1].id = 'wrong-prefix';
  bad.sets[0].groups[1].questions[0].kind = 'oops';
  const errs = validateBank(bad);
  assert.ok(errs.some((e) => e.includes('answer 不在选项里')));
  assert.ok(errs.some((e) => e.includes('必须以 "day1-" 开头')));
  assert.ok(errs.some((e) => e.includes('kind')));
  assert.deepEqual(validateBank(null), ['bank.sets 不是数组']);
});

test('冻结的 qid 快照里每个 id 仍在题库里（qid 永不删除/重编号）', () => {
  const frozen = readFileSync(new URL('./qids.frozen.txt', import.meta.url), 'utf8').split(/\r?\n/).filter(Boolean);
  assert.ok(frozen.length >= 144);
  for (const id of frozen) assert.ok(index.questions.has(id), `qid 消失了：${id}`);
});

test('genId 唯一', () => {
  const ids = new Set();
  for (let i = 0; i < 5000; i++) ids.add(genId(T0));
  assert.equal(ids.size, 5000);
});

test('normalize 丢弃损坏记录、保留未知字段、不抛异常', () => {
  const report = {};
  const p = normalize({
    v: 1,
    attempts: { a: { q: 'day1-q1', ts: T0, ok: true, futureField: 42 }, bad: { ts: 'x' }, bad2: 5 },
    sessions: { s: { start: T0, end: T0 + 1000, extra: { deep: true } }, bad: {} },
    drafts: { d: { qids: ['day1-q1'], start: T0 }, bad: { qids: 'no' } },
    tags: { 'day1-q1': { cause: 'vocab', ts: T0 }, 'day1-q2': { cause: 'nope', ts: T0 }, 'day1-q3': { cause: null, ts: T0 } },
  }, report);
  assert.deepEqual(countProgress(p), { attempts: 1, sessions: 1, drafts: 1, tags: 2 });
  assert.equal(report.dropped, 5);
  assert.equal(p.attempts.a.futureField, 42, '未知字段要保留');
  assert.deepEqual(p.sessions.s.extra, { deep: true });
  assert.equal(p.attempts.a.qrev, 0);
  assert.equal(p.attempts.a.del, false);
  assert.deepEqual(normalize(null), emptyProgress());
  assert.deepEqual(normalize('garbage'), emptyProgress());
  assert.deepEqual(normalize([1, 2]), emptyProgress());
  // 更新版本号只升不降
  assert.equal(normalize({ v: 7 }).v, 7);
});

test('merge：并集、同 id 取新、幂等、可交换、未知字段存活', () => {
  const a = emptyProgress();
  const b = emptyProgress();
  const x = recordAttempt(a, { qid: 'day1-q1', choice: 'B', correct: true, ts: T0 });
  x.futureField = 'keep';
  recordAttempt(b, { qid: 'day1-q2', choice: 'A', correct: false, ts: T0 + 1 });
  a.sessions.s1 = { id: 's1', start: T0, end: T0 + 10, upd: T0 + 10, score: 1, total: 2 };
  b.sessions.s1 = { id: 's1', start: T0, end: T0 + 20, upd: T0 + 20, score: 2, total: 2 };
  setTag(a, 'day1-q3', 'vocab', T0);
  setTag(b, 'day1-q3', 'time', T0 + 5);

  const ab = mergeProgress(a, b);
  const ba = mergeProgress(b, a);
  assert.equal(Object.keys(ab.attempts).length, 2);
  assert.equal(ab.attempts[x.id].futureField, 'keep');
  assert.equal(ab.sessions.s1.score, 2);
  assert.equal(ab.tags['day1-q3'].cause, 'time');
  assert.ok(sameProgress(ab, ba), '合并应可交换');
  assert.ok(sameProgress(mergeProgress(ab, ab), ab), '合并应幂等');
  assert.ok(sameProgress(mergeProgress(ab, a), ab), '再并入子集不变');
});

test('墓碑：删除能通过合并传播，不会从旧副本复活', () => {
  const a = emptyProgress();
  const att = recordAttempt(a, { qid: 'day1-q1', choice: 'A', correct: false, ts: T0 });
  setTag(a, 'day1-q1', 'vocab', T0);
  const cloud = JSON.parse(JSON.stringify(a)); // 云端还是旧版

  deleteAttempt(a, att.id, T0 + 100);
  setTag(a, 'day1-q1', null, T0 + 100);
  const merged = mergeProgress(cloud, a);
  assert.equal(merged.attempts[att.id].del, true);
  assert.equal(merged.tags['day1-q1'].cause, null);
  assert.equal(tagOf(merged, 'day1-q1'), null);
  assert.equal(liveAttempts(merged).length, 0);
  assert.deepEqual(wrongQuestions(merged, index), []);
  assert.equal(countProgress(merged).attempts, 1, '物理记录还在，只是被标记');
});

test('删除会话后其作答不再计入统计；放弃的 draft 不复活', () => {
  const p = emptyProgress();
  const s = addPaperSession(p, { set: index.sets.get('day3'), wrongNumbers: [2, 6], minutes: 20, dateTs: T0, ts: T0 });
  assert.deepEqual(wrongQuestions(p, index), ['day3-q2', 'day3-q6']);
  deleteSession(p, s.id, T0 + 1000);
  assert.deepEqual(wrongQuestions(p, index), []);
  assert.equal(setSummary(p, index.sets.get('day3'), index).last, null);

  const d = startDraft(p, { sid: 'x1', setId: 'day1', mode: 'practice', qids: day1._qids, ts: T0 });
  const cloud = JSON.parse(JSON.stringify(p));
  abandonDraft(p, d.sid, T0 + 5);
  const merged = mergeProgress(cloud, p);
  assert.equal(merged.drafts.x1, undefined, '被放弃的 draft 合并后不该复活');
  assert.equal(setSummary(merged, day1, index).draft, null);
  assert.equal(setSummary(merged, day1, index).sessions.length, 0, '放弃的会话不算历史');
});

test('题目修订号：rev 提升后旧作答不再计入，但历史记录不丢', () => {
  const p = emptyProgress();
  recordAttempt(p, { qid: 'day1-q1', choice: 'A', correct: false, ts: T0, qrev: 0 });
  assert.deepEqual(wrongQuestions(p, index), ['day1-q1']);
  const bank2 = JSON.parse(JSON.stringify(bank));
  bank2.sets[0].groups[0].questions[0].rev = 1;
  const index2 = indexBank(bank2);
  assert.deepEqual(wrongQuestions(p, index2), []);
  assert.equal(countProgress(p).attempts, 1);
  recordAttempt(p, { qid: 'day1-q1', choice: 'A', correct: false, ts: T0 + 1, qrev: 1 });
  assert.deepEqual(wrongQuestions(p, index2), ['day1-q1']);
});

test('一次完整练习：draft → attempts → finishSession', () => {
  const p = emptyProgress();
  startDraft(p, { sid: 'sess1', setId: 'day1', mode: 'practice', qids: day1._qids, ts: T0 });
  let t = T0;
  for (const qid of day1._qids) {
    const q = index.questions.get(qid).q;
    const choice = q.n % 4 === 0 ? (q.answer === 'A' ? 'B' : 'A') : q.answer; // 每 4 题错一道
    t += 5000;
    recordAttempt(p, { qid, setId: 'day1', choice, correct: choice === q.answer, ms: 5000, mode: 'practice', sid: 'sess1', ts: t });
  }
  const s = finishSession(p, { sid: 'sess1', setId: 'day1', mode: 'practice', total: 24, start: T0, ts: t });
  assert.equal(s.score, 18);
  assert.equal(s.answered, 24);
  assert.equal(s.wrong.length, 6);
  assert.equal(p.drafts.sess1, undefined);

  const sum = setSummary(p, day1, index);
  assert.equal(sum.answered, 24);
  assert.equal(sum.correctNow, 18);
  assert.equal(sum.best.score, 18);
  assert.equal(sum.draft, null);

  const acc = partAccuracy(p, index);
  assert.equal(acc[5].total, 12);
  assert.equal(acc[6].total, 5);
  assert.equal(acc[7].total, 7);
  assert.equal(acc[5].right + acc[6].right + acc[7].right, 18);
  assert.deepEqual(wrongQuestions(p, index), ['day1-q4', 'day1-q8', 'day1-q12', 'day1-q16', 'day1-q20', 'day1-q24']);
});

test('纸面成绩录入：错题进错题本、分数正确、之后做对即移出', () => {
  const p = emptyProgress();
  const s = addPaperSession(p, { set: index.sets.get('day3'), wrongNumbers: [2, 6, 13, 21, 24], minutes: 22, dateTs: T0 - 86400000, ts: T0 });
  assert.equal(s.score, 19);
  assert.equal(s.total, 24);
  assert.equal(s.src, 'paper');
  assert.equal(s.ms, 22 * 60000);
  assert.equal(s.start, T0 - 86400000, '练习日期用于显示');
  assert.equal(Object.keys(p.attempts).length, 24);
  for (const [k, a] of Object.entries(p.attempts)) assert.equal(a.id, k);
  assert.deepEqual(wrongQuestions(p, index), ['day3-q2', 'day3-q6', 'day3-q13', 'day3-q21', 'day3-q24']);
  recordAttempt(p, { qid: 'day3-q2', choice: 'D', correct: true, ts: T0 + 99999 });
  assert.deepEqual(wrongQuestions(p, index), ['day3-q6', 'day3-q13', 'day3-q21', 'day3-q24']);
  assert.equal(latestAttempts(p, index).get('day3-q2').ok, true);
});

test('错因标签直方图只统计当前错题', () => {
  const p = emptyProgress();
  recordAttempt(p, { qid: 'day1-q1', choice: 'A', correct: false, ts: T0 });
  recordAttempt(p, { qid: 'day1-q2', choice: 'A', correct: false, ts: T0 });
  setTag(p, 'day1-q1', 'grammar', T0);
  setTag(p, 'day1-q2', 'grammar', T0);
  recordAttempt(p, { qid: 'day1-q2', choice: 'C', correct: true, ts: T0 + 1 });
  assert.deepEqual(causeHistogram(p, index), { vocab: 0, grammar: 1, locate: 0, time: 0 });
  setTag(p, 'day1-q1', null);
  assert.equal(tagOf(p, 'day1-q1'), null);
  assert.throws(() => setTag(p, 'day1-q1', 'bogus'));
});

test('连续学习天数', () => {
  const p = emptyProgress();
  const day = 86400000;
  const now = new Date(2026, 8, 7, 12, 0, 0).getTime();
  recordAttempt(p, { qid: 'day1-q1', choice: 'A', correct: true, ts: now - 2 * day });
  recordAttempt(p, { qid: 'day1-q1', choice: 'A', correct: true, ts: now - day });
  let s = studyStreak(p, now, index);
  assert.equal(s.days, 2);
  assert.equal(s.streak, 2, '今天还没学不打断连续');
  assert.equal(s.today, false);
  recordAttempt(p, { qid: 'day1-q1', choice: 'A', correct: true, ts: now });
  s = studyStreak(p, now, index);
  assert.equal(s.streak, 3);
  assert.equal(s.today, true);
});

test('随机抽题：只抽 Part 5、可排除、不重复、跳过下架题', () => {
  const picked = pickRandom(index, { part: 5, count: 10, exclude: new Set(['day1-q1']) });
  assert.equal(picked.length, 10);
  assert.equal(new Set(picked).size, 10);
  for (const qid of picked) {
    assert.equal(index.questions.get(qid).q.part, 5);
    assert.notEqual(qid, 'day1-q1');
  }
  assert.equal(pickRandom(index, { part: 6, count: 100 }).length, 30);
  const bank2 = JSON.parse(JSON.stringify(bank));
  for (const s of bank2.sets) for (const g of s.groups) for (const q of g.questions) if (q.part === 6) q.retired = true;
  assert.equal(pickRandom(indexBank(bank2), { part: 6, count: 100 }).length, 0);
});

test('导出/导入：导入是合并而不是覆盖', () => {
  const a = emptyProgress();
  recordAttempt(a, { qid: 'day1-q1', choice: 'B', correct: true, ts: T0 });
  const payload = exportPayload(a, T0, '2026.09.07');
  assert.equal(payload.app, 'toeic-trainer');
  assert.equal(payload.app_version, '2026.09.07');
  assert.equal(payload.counts.attempts, 1);
  const b = emptyProgress();
  recordAttempt(b, { qid: 'day1-q2', choice: 'C', correct: true, ts: T0 + 1 });
  const merged = importPayload(b, JSON.parse(JSON.stringify(payload)));
  assert.equal(countProgress(merged).attempts, 2);
  const merged2 = importPayload(b, a);
  assert.equal(countProgress(merged2).attempts, 2);
  const merged3 = importPayload(b, 'nonsense');
  assert.ok(sameProgress(merged3, b));
});

test('stableStringify 键序无关', () => {
  assert.equal(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] }), stableStringify({ a: [{ c: 2, d: 1 }], b: 1 }));
});

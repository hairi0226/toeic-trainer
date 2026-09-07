// core.js — 纯逻辑层（无 DOM、无网络），浏览器与 Node 测试共用。
// 负责：进度数据模型、跨设备合并、会话/作答记录、统计、题库校验。
//
// 数据不变量（改代码前先读）：
// - 记录只增不删。“删除”= 写墓碑（attempt.del / session.deleted / tag.cause=null）并更新时间戳，
//   这样两台设备合并时删除也能传播，不会从云端复活。
// - 合并 = 按 id 并集，同 id 取时间戳大的。可交换、幂等。
// - normalize 保留未知字段（只校正已知字段），旧版本客户端不会擦掉新版本写入的数据。
// - 题目 id（qid）永不重编号；改答案/选项要把题目的 rev +1，旧作答自动视为“修订前”。

export const SCHEMA_VERSION = 1;

export const CAUSES = {
  vocab: '词汇',
  grammar: '语法/搭配',
  locate: '原文定位',
  time: '时间不足',
};

export const MODE_LABELS = {
  practice: '练习',
  exam: '模考',
  quick: '快练',
  review: '错题重做',
  paper: '纸面',
};

export const MAX_ATTEMPT_MS = 10 * 60 * 1000; // 单题用时上限：手机锁屏后回来不算超长

// ---------- 基础 ----------

export function emptyProgress() {
  return { v: SCHEMA_VERSION, attempts: {}, sessions: {}, drafts: {}, tags: {} };
}

let idCounter = 0;
/** 生成全局唯一 id：时间戳(36进制) + 进程内计数 + 随机串。同毫秒内不保证有序，排序请用 ts。 */
export function genId(now = Date.now()) {
  idCounter = (idCounter + 1) % 1296;
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return now.toString(36) + '-' + idCounter.toString(36).padStart(2, '0') + rand;
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const str = (x, d = null) => (typeof x === 'string' ? x : d);

/**
 * 把任意输入（旧版本、损坏、手动导入的 JSON）规整成合法的进度对象。
 * 丢掉缺关键字段的记录，绝不抛异常。未知字段原样保留。
 * @param {object} [report] 可选，写入 report.dropped = 丢弃的记录数
 */
export function normalize(input, report = null) {
  const p = emptyProgress();
  let dropped = 0;
  if (!isObj(input)) {
    if (report) report.dropped = 0;
    return p;
  }
  p.v = Math.max(SCHEMA_VERSION, num(input.v, SCHEMA_VERSION));

  for (const [id, a] of Object.entries(isObj(input.attempts) ? input.attempts : {})) {
    if (!isObj(a) || typeof a.q !== 'string' || !num(a.ts)) { dropped += 1; continue; }
    p.attempts[id] = {
      ...a,
      id,
      q: a.q,
      s: str(a.s),
      c: str(a.c),
      ok: !!a.ok,
      ms: num(a.ms, 0),
      ts: a.ts,
      m: str(a.m, 'practice'),
      sid: str(a.sid),
      qrev: num(a.qrev, 0),
      del: !!a.del,
    };
  }
  for (const [id, s] of Object.entries(isObj(input.sessions) ? input.sessions : {})) {
    if (!isObj(s) || !num(s.start)) { dropped += 1; continue; }
    p.sessions[id] = {
      ...s,
      id,
      s: str(s.s),
      m: str(s.m, 'practice'),
      src: s.src === 'paper' ? 'paper' : 'online',
      start: s.start,
      end: num(s.end, null),
      ms: num(s.ms, 0),
      score: num(s.score, 0),
      total: num(s.total, 0),
      answered: num(s.answered, 0),
      upd: num(s.upd, s.end || s.start),
      label: str(s.label, ''),
      wrong: Array.isArray(s.wrong) ? s.wrong.filter((x) => typeof x === 'string') : [],
      note: str(s.note, ''),
      deleted: !!s.deleted,
    };
  }
  for (const [sid, d] of Object.entries(isObj(input.drafts) ? input.drafts : {})) {
    if (!isObj(d) || !Array.isArray(d.qids) || !num(d.start)) { dropped += 1; continue; }
    p.drafts[sid] = {
      ...d,
      sid,
      s: str(d.s),
      m: str(d.m, 'practice'),
      qids: d.qids.filter((x) => typeof x === 'string'),
      idx: num(d.idx, 0),
      answers: isObj(d.answers) ? { ...d.answers } : {},
      locked: Array.isArray(d.locked) ? d.locked.filter((x) => typeof x === 'string') : [],
      spent: isObj(d.spent) ? { ...d.spent } : {},
      start: d.start,
      upd: num(d.upd, d.start),
      label: str(d.label, ''),
    };
  }
  for (const [qid, t] of Object.entries(isObj(input.tags) ? input.tags : {})) {
    if (!isObj(t) || !num(t.ts) || !(t.cause === null || t.cause in CAUSES)) { dropped += 1; continue; }
    p.tags[qid] = { ...t, cause: t.cause, ts: t.ts };
  }
  if (report) report.dropped = dropped;
  return p;
}

/**
 * 合并两份进度（可交换、可结合、幂等）：
 * - attempts：按 id 取并集；同 id 取 ts 大的（墓碑 del 也走这条）
 * - sessions / drafts：按 id 取并集；同 id 取 upd 大的
 * - 已在 sessions 里结束（含被放弃/删除）的会话，其 draft 一律丢弃
 * - tags：每题取 ts 大的（cause=null 是删除墓碑）
 */
export function mergeProgress(a, b) {
  const A = normalize(a);
  const B = normalize(b);
  const out = emptyProgress();
  out.v = Math.max(A.v, B.v);

  const pick = (x, y, key) => {
    if (!x) return y;
    if (!y) return x;
    return num(y[key]) > num(x[key]) ? y : x;
  };

  for (const id of new Set([...Object.keys(A.attempts), ...Object.keys(B.attempts)])) {
    out.attempts[id] = pick(A.attempts[id], B.attempts[id], 'ts');
  }
  for (const id of new Set([...Object.keys(A.sessions), ...Object.keys(B.sessions)])) {
    out.sessions[id] = pick(A.sessions[id], B.sessions[id], 'upd');
  }
  for (const sid of new Set([...Object.keys(A.drafts), ...Object.keys(B.drafts)])) {
    const ended = out.sessions[sid] && out.sessions[sid].end;
    if (ended) continue;
    out.drafts[sid] = pick(A.drafts[sid], B.drafts[sid], 'upd');
  }
  for (const qid of new Set([...Object.keys(A.tags), ...Object.keys(B.tags)])) {
    out.tags[qid] = pick(A.tags[qid], B.tags[qid], 'ts');
  }
  return out;
}

/** 稳定序列化（键排序），用于比较两份进度是否相同。 */
export function stableStringify(x) {
  if (Array.isArray(x)) return '[' + x.map(stableStringify).join(',') + ']';
  if (isObj(x)) {
    return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(x[k])).join(',') + '}';
  }
  return JSON.stringify(x);
}

export function sameProgress(a, b) {
  return stableStringify(normalize(a)) === stableStringify(normalize(b));
}

export function countProgress(p) {
  return {
    attempts: Object.keys(p.attempts).length,
    sessions: Object.keys(p.sessions).length,
    drafts: Object.keys(p.drafts).length,
    tags: Object.keys(p.tags).length,
  };
}

// ---------- 题库索引与校验 ----------

/**
 * 给题库建索引：qid → {q, set, group}，以及每套题的题目顺序。
 */
export function indexBank(bank) {
  const sets = new Map();
  const questions = new Map();
  const setOrder = [];
  for (const set of bank.sets) {
    sets.set(set.id, set);
    setOrder.push(set.id);
    const qids = [];
    for (const group of set.groups) {
      for (const q of group.questions) {
        questions.set(q.id, { q, set, group });
        qids.push(q.id);
      }
    }
    set._qids = qids;
  }
  return { bank, sets, questions, setOrder };
}

/**
 * 题库结构校验，返回错误列表（空 = 合格）。app 启动和测试都会跑。
 * 只强制必需字段；focus/listening/phrases/reviews 等都是可选的。
 */
export function validateBank(bank) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!bank || !Array.isArray(bank.sets)) return ['bank.sets 不是数组'];
  const seenSet = new Set();
  const seenQ = new Set();
  for (const set of bank.sets) {
    if (!set || typeof set.id !== 'string' || !set.id) { err('有 set 缺 id'); continue; }
    if (seenSet.has(set.id)) err(`set id 重复：${set.id}`);
    seenSet.add(set.id);
    if (typeof set.title !== 'string' || !set.title) err(`${set.id}: 缺 title`);
    if (!Array.isArray(set.groups) || !set.groups.length) { err(`${set.id}: 缺 groups`); continue; }
    const nums = new Set();
    for (const g of set.groups) {
      if (!g || typeof g.id !== 'string') { err(`${set.id}: 有 group 缺 id`); continue; }
      if (![5, 6, 7].includes(g.part)) err(`${g.id}: part 必须是 5/6/7`);
      if (!Array.isArray(g.passages)) err(`${g.id}: passages 必须是数组`);
      else for (const ps of g.passages) if (!ps || typeof ps.title !== 'string' || typeof ps.text !== 'string') err(`${g.id}: passage 缺 title/text`);
      if (!Array.isArray(g.questions) || !g.questions.length) { err(`${g.id}: 缺 questions`); continue; }
      for (const q of g.questions) {
        if (!q || typeof q.id !== 'string') { err(`${g.id}: 有题缺 id`); continue; }
        if (!q.id.startsWith(set.id + '-')) err(`${q.id}: id 必须以 "${set.id}-" 开头`);
        if (seenQ.has(q.id)) err(`题 id 重复：${q.id}`);
        seenQ.add(q.id);
        if (!Number.isInteger(q.n)) err(`${q.id}: n 必须是整数`);
        if (nums.has(q.n)) err(`${q.id}: 题号 ${q.n} 在本套重复`);
        nums.add(q.n);
        if (q.part !== g.part) err(`${q.id}: part 与所在 group 不一致`);
        if (typeof q.stem !== 'string') err(`${q.id}: stem 必须是字符串（可为空）`);
        const keys = Array.isArray(q.options) ? q.options.map((o) => o && o.key) : [];
        if (keys.join('') !== 'ABCD') err(`${q.id}: options 必须恰好是 A/B/C/D`);
        else if (q.options.some((o) => typeof o.text !== 'string' || !o.text)) err(`${q.id}: 有选项没有文字`);
        if (!keys.includes(q.answer)) err(`${q.id}: answer 不在选项里`);
        if (q.part === 6 && !['blank', 'sentence'].includes(q.kind)) err(`${q.id}: Part 6 的 kind 必须是 blank 或 sentence`);
        if (q.part === 6 && g.passages[0] && !g.passages[0].text.includes(`[${q.n}]`)) err(`${q.id}: 文章里找不到空格 [${q.n}]`);
        if (q.rev != null && !Number.isInteger(q.rev)) err(`${q.id}: rev 必须是整数`);
      }
    }
  }
  return errors;
}

const qrevOf = (index, qid) => {
  const info = index && index.questions.get(qid);
  return info ? (info.q.rev || 0) : 0;
};

// ---------- 写操作（都返回同一个对象，方便链式；调用方负责保存） ----------

export function startDraft(p, { sid = genId(), setId = null, mode, qids, ts = Date.now(), label = '' }) {
  p.drafts[sid] = {
    sid, s: setId, m: mode, qids: [...qids], idx: 0, answers: {}, locked: [], spent: {},
    start: ts, upd: ts, label,
  };
  return p.drafts[sid];
}

export function touchDraft(p, draft, ts = Date.now()) {
  draft.upd = ts;
  p.drafts[draft.sid] = draft;
  return draft;
}

export function recordAttempt(p, { qid, setId = null, choice, correct, ms = 0, mode = 'practice', sid = null, ts = Date.now(), qrev = 0 }) {
  const id = genId(ts);
  p.attempts[id] = {
    id, q: qid, s: setId, c: choice, ok: !!correct, ms: Math.min(MAX_ATTEMPT_MS, Math.max(0, Math.round(ms))),
    ts, m: mode, sid, qrev, del: false,
  };
  return p.attempts[id];
}

/** 撤销一条作答（写墓碑，不物理删除，删除才能同步到别的设备）。 */
export function deleteAttempt(p, id, ts = Date.now()) {
  const a = p.attempts[id];
  if (!a) return null;
  a.del = true;
  a.ts = Math.max(ts, a.ts + 1);
  return a;
}

/**
 * 结束一次会话：根据该 sid 下的作答记录算分，写入 sessions，删除 draft。
 */
export function finishSession(p, { sid, setId = null, mode, total, start, ts = Date.now(), label = '', src = 'online', ms = null }) {
  const mine = Object.values(p.attempts).filter((a) => a.sid === sid && !a.del);
  const score = mine.filter((a) => a.ok).length;
  const wrong = mine.filter((a) => !a.ok).map((a) => a.q);
  p.sessions[sid] = {
    id: sid, s: setId, m: mode, src, start, end: ts,
    ms: ms == null ? Math.max(0, ts - start) : ms,
    score, total, answered: mine.length, upd: ts, label, wrong, note: '', deleted: false,
  };
  delete p.drafts[sid];
  return p.sessions[sid];
}

/** 放弃一次未完成的练习：写一条已删除的会话作为墓碑，draft 在所有设备上都会被丢弃。 */
export function abandonDraft(p, sid, ts = Date.now()) {
  const d = p.drafts[sid];
  if (!d) return null;
  p.sessions[sid] = {
    id: sid, s: d.s, m: d.m, src: 'online', start: d.start, end: ts, ms: 0,
    score: 0, total: d.qids.length, answered: 0, upd: ts, label: d.label, wrong: [], note: '', deleted: true,
  };
  delete p.drafts[sid];
  return p.sessions[sid];
}

/** 删除一次会话（墓碑）。它名下的作答在统计里一并忽略。 */
export function deleteSession(p, sid, ts = Date.now()) {
  const s = p.sessions[sid];
  if (!s) return null;
  s.deleted = true;
  s.upd = Math.max(ts, s.upd + 1);
  return s;
}

/**
 * 录入纸面成绩：错题号列表 + 用时。
 * 会为每一题生成一条作答记录（选项未知记 null），这样错题本里能看到纸面错题。
 * ts：作答记录的时间戳（通常取录入时刻）；dateTs：练习日期，用于显示。
 */
export function addPaperSession(p, { set, wrongNumbers, minutes, dateTs, ts = Date.now(), note = '', index = null }) {
  const sid = genId(ts);
  const wrongSet = new Set(wrongNumbers.map(Number));
  const qids = set._qids || set.groups.flatMap((g) => g.questions.map((q) => q.id));
  const byId = new Map(set.groups.flatMap((g) => g.questions.map((q) => [q.id, q])));
  qids.forEach((qid, i) => {
    const q = byId.get(qid);
    const wrong = wrongSet.has(q.n);
    recordAttempt(p, {
      qid, setId: set.id, choice: wrong ? null : q.answer, correct: !wrong, ms: 0,
      mode: 'paper', sid, ts: ts + i, qrev: q.rev || 0,
    });
  });
  const ms = Math.max(0, Math.round(minutes * 60000));
  p.sessions[sid] = {
    id: sid, s: set.id, m: 'paper', src: 'paper', start: dateTs, end: dateTs + ms, ms,
    score: qids.length - [...wrongSet].filter((n) => [...byId.values()].some((q) => q.n === n)).length,
    total: qids.length, answered: qids.length,
    upd: ts + qids.length, label: '纸面练习', wrong: qids.filter((qid) => wrongSet.has(byId.get(qid).n)), note, deleted: false,
  };
  void index;
  return p.sessions[sid];
}

/** 打/改/删错因标签。cause=null 表示删除（写墓碑）。 */
export function setTag(p, qid, cause, ts = Date.now()) {
  if (cause !== null && !(cause in CAUSES)) throw new Error('unknown cause: ' + cause);
  const prev = p.tags[qid];
  p.tags[qid] = { cause, ts: prev ? Math.max(ts, prev.ts + 1) : ts };
  return p.tags[qid];
}

export function tagOf(p, qid) {
  const t = p.tags[qid];
  return t && t.cause ? t.cause : null;
}

// ---------- 统计 ----------

/**
 * 有效作答：没被撤销、所属会话没被删除、题目修订号匹配（题库改过答案的旧作答不算）。
 * index 为空时不做修订号/存在性检查。
 */
export function liveAttempts(p, index = null) {
  const deletedSids = new Set(Object.values(p.sessions).filter((s) => s.deleted).map((s) => s.id));
  const out = [];
  for (const a of Object.values(p.attempts)) {
    if (a.del) continue;
    if (a.sid && deletedSids.has(a.sid)) continue;
    if (index) {
      if (!index.questions.has(a.q)) continue;
      if ((a.qrev || 0) !== qrevOf(index, a.q)) continue;
    }
    out.push(a);
  }
  return out;
}

export function liveSessions(p) {
  return Object.values(p.sessions).filter((s) => !s.deleted && s.end);
}

/** 每题最近一次有效作答。 */
export function latestAttempts(p, index = null) {
  const out = new Map();
  for (const a of liveAttempts(p, index)) {
    const cur = out.get(a.q);
    if (!cur || a.ts > cur.ts) out.set(a.q, a);
  }
  return out;
}

/** 每题作答次数与答对次数。 */
export function attemptStats(p, index = null) {
  const out = new Map();
  for (const a of liveAttempts(p, index)) {
    const cur = out.get(a.q) || { n: 0, ok: 0, ms: 0, msN: 0 };
    cur.n += 1;
    if (a.ok) cur.ok += 1;
    if (a.ms > 0) { cur.ms += a.ms; cur.msN += 1; }
    out.set(a.q, cur);
  }
  return out;
}

export function setSummary(p, set, index = null) {
  const latest = latestAttempts(p, index);
  const qids = set._qids;
  const answered = qids.filter((q) => latest.has(q)).length;
  const correctNow = qids.filter((q) => latest.get(q)?.ok).length;
  const sessions = liveSessions(p)
    .filter((s) => s.s === set.id)
    .sort((a, b) => b.end - a.end);
  const full = sessions.filter((s) => s.answered >= s.total);
  const best = full.reduce((b, s) => (!b || s.score > b.score ? s : b), null);
  const draft = Object.values(p.drafts).find((d) => d.s === set.id && (d.m === 'practice' || d.m === 'exam')) || null;
  return { answered, correctNow, total: qids.length, sessions, last: sessions[0] || null, best, draft };
}

/** 按 Part 的正确率（以每题最近一次作答为准）。 */
export function partAccuracy(p, index) {
  const latest = latestAttempts(p, index);
  const out = { 5: { right: 0, total: 0 }, 6: { right: 0, total: 0 }, 7: { right: 0, total: 0 } };
  for (const [qid, a] of latest) {
    const info = index.questions.get(qid);
    if (!info) continue;
    const bucket = out[info.q.part];
    bucket.total += 1;
    if (a.ok) bucket.right += 1;
  }
  return out;
}

/** 平均每题用时（毫秒），按 Part；只统计有计时且 ≤ 上限的在线作答。 */
export function avgMsByPart(p, index) {
  const acc = { 5: [0, 0], 6: [0, 0], 7: [0, 0] };
  for (const a of liveAttempts(p, index)) {
    if (!(a.ms > 0) || a.ms > MAX_ATTEMPT_MS) continue;
    const info = index.questions.get(a.q);
    acc[info.q.part][0] += a.ms;
    acc[info.q.part][1] += 1;
  }
  const out = {};
  for (const k of Object.keys(acc)) out[k] = acc[k][1] ? Math.round(acc[k][0] / acc[k][1]) : null;
  return out;
}

/** 当前错题：最近一次有效作答是错的题（含纸面），按题库顺序。 */
export function wrongQuestions(p, index) {
  const latest = latestAttempts(p, index);
  const out = [];
  for (const [qid, a] of latest) {
    if (!a.ok) out.push(qid);
  }
  const order = new Map();
  let i = 0;
  for (const setId of index.setOrder) for (const qid of index.sets.get(setId)._qids) order.set(qid, i++);
  out.sort((x, y) => (order.get(x) ?? 1e9) - (order.get(y) ?? 1e9));
  return out;
}

/** 错因分布（只统计当前仍是错题的标签）。 */
export function causeHistogram(p, index) {
  const wrong = new Set(wrongQuestions(p, index));
  const out = {};
  for (const k of Object.keys(CAUSES)) out[k] = 0;
  for (const [qid, t] of Object.entries(p.tags)) if (t.cause && wrong.has(qid)) out[t.cause] += 1;
  return out;
}

const dayKey = (ts) => {
  const d = new Date(ts);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};
const dayMs = 86400000;

/** 学习天数与连续天数（按本地日期）。 */
export function studyStreak(p, now = Date.now(), index = null) {
  const days = new Set(liveAttempts(p, index).map((a) => dayKey(a.ts)));
  let streak = 0;
  let cursor = now;
  // 今天没学不打断连续（允许当天还没开始）
  if (!days.has(dayKey(cursor))) cursor -= dayMs;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor -= dayMs;
  }
  return { days: days.size, streak, today: days.has(dayKey(now)) };
}

/** 一个会话里的有效作答（用于结果页）。 */
export function sessionAttempts(p, sid) {
  return Object.values(p.attempts).filter((a) => a.sid === sid && !a.del).sort((a, b) => a.ts - b.ts);
}

/** 随机抽题（Fisher-Yates），可指定 Part、排除列表；跳过已下架（retired）的题。 */
export function pickRandom(index, { part = null, count = 10, exclude = new Set(), rng = Math.random } = {}) {
  const pool = [];
  for (const [qid, info] of index.questions) {
    if (part && info.q.part !== part) continue;
    if (exclude.has(qid) || info.q.retired) continue;
    pool.push(qid);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** 导出用：附带时间戳与计数。 */
export function exportPayload(p, now = Date.now(), appVersion = '') {
  return { app: 'toeic-trainer', app_version: appVersion, exported_at: new Date(now).toISOString(), counts: countProgress(p), progress: normalize(p) };
}

/** 导入：接受导出文件或裸进度对象。返回合并后的新对象。 */
export function importPayload(p, payload) {
  const raw = isObj(payload) && isObj(payload.progress) ? payload.progress : payload;
  return mergeProgress(p, raw);
}

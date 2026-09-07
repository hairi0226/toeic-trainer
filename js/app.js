// app.js — 界面层：hash 路由 + 各页面渲染 + 事件。逻辑都在 core.js，这里只管画和调。
import { VERSION } from './version.js';
import {
  CAUSES, MODE_LABELS, indexBank, validateBank, startDraft, touchDraft, recordAttempt, finishSession,
  abandonDraft, deleteAttempt, deleteSession, addPaperSession, setTag, tagOf, latestAttempts, setSummary,
  partAccuracy, avgMsByPart, wrongQuestions, causeHistogram, studyStreak, sessionAttempts, pickRandom,
  exportPayload, importPayload, countProgress, mergeProgress, sameProgress, emptyProgress, liveSessions,
} from './core.js';
import {
  loadLocal, saveLocal, peekLocal, getMeta, setMeta, requestPersist, storageAvailable,
  backupInfo, loadBackup, trashInfo, loadTrash, wipeLocal, STORAGE_KEY,
} from './store.js';
import { loadBank } from './bank.js';
import { GistSync, TOKEN_URL, TOKEN_URL_CLASSIC } from './sync-gist.js';
import { ArtifactSync } from './sync-artifact.js';
import { SyncManager } from './sync.js';

const OFFICIAL_LC_URL = 'https://exam.toeic.co.kr/content/common/realQuestion.php';
const MAX_Q_MS = 10 * 60 * 1000; // 单题计时上限：手机锁屏后回来不算超长
const PART_LIMIT_MS = { 5: 25000, 6: 45000, 7: 60000 }; // 自定义题单的模考限时（每题）
const UNDO_MS = 8000; // 练习模式误触撤销窗口
const STALE_MS = 24 * 3600 * 1000;

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const $syncDot = document.getElementById('sync-dot');

const state = {
  bank: null,
  index: null,
  progress: emptyProgress(),
  sync: null,
  runner: null, // { draft, shownAt, mountedAt, passageOpen:{}, gridOpen, undo:{id,qid,until} }
  warnings: [],
  timer: null,
  paper: { setId: null, wrong: new Set(), minutes: '', date: '', note: '', saving: false },
  settingsMsg: null,
  isArtifact: false,
};

// ---------- 小工具 ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (ts) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const fmtDay = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const fmtMMSS = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
};
const fmtDur = (ms) => {
  if (!ms) return '—';
  const m = Math.round(ms / 60000);
  if (m >= 1) return `${m} 分钟`;
  return `${Math.round(ms / 1000)} 秒`;
};
const fmtAgo = (ts) => {
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return `${Math.round(d / 60000)} 分钟前`;
  if (d < 86400000) return `${Math.round(d / 3600000)} 小时前`;
  return `${Math.round(d / 86400000)} 天前`;
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const todayStr = () => fmtDay(Date.now());

let toastTimer = null;
function toast(msg, ms = 2600) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.hidden = true; }, ms);
}

function go(hash, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, '', hash);
    route();
  } else if (location.hash === hash) {
    route();
  } else {
    location.hash = hash;
  }
}

/** 采用一份新的进度对象（来自合并），并把做题页里的引用重新绑定。 */
function adopt(progress) {
  state.progress = progress;
  if (state.runner) {
    const d = progress.drafts[state.runner.draft.sid];
    if (d) state.runner.draft = d;
  }
}

/** 保存到本地并安排云同步。失败会大声提示。 */
function save() {
  const r = saveLocal(state.progress);
  if (!r.ok) toast('⚠️ 本地保存失败：' + r.error + '。请尽快到设置页导出进度！', 6000);
  if (r.merged) adopt(r.progress);
  if (state.sync) {
    state.sync.markDirty();
    state.sync.schedule();
  }
}

/** 云端 / 别的标签页合并回来的新进度：替换本地并刷新界面。 */
function applyMerged(merged) {
  if (sameProgress(merged, state.progress)) return;
  const runnerSid = state.runner && state.runner.draft.sid;
  adopt(merged);
  const r = saveLocal(merged);
  if (r.merged) adopt(r.progress);
  if (runnerSid && !state.progress.drafts[runnerSid]) {
    state.runner = null;
    if (state.progress.sessions[runnerSid] && !state.progress.sessions[runnerSid].deleted) {
      toast('这次练习已在另一台设备上完成，显示结果');
      go('#/result/' + runnerSid, { replace: true });
    } else {
      toast('这次练习已在另一台设备上放弃');
      go('#/', { replace: true });
    }
    return;
  }
  route();
}

// ---------- 主题 / 字号 ----------

function applyPrefs() {
  const meta = getMeta();
  const root = document.documentElement;
  if (meta.theme === 'light' || meta.theme === 'dark') { root.dataset.theme = meta.theme; root.dataset.themeBy = 'app'; }
  else if (root.dataset.themeBy === 'app') { delete root.dataset.theme; delete root.dataset.themeBy; }
  root.dataset.fs = meta.fontSize || 'm';
}

// ---------- 同步状态显示 ----------

function renderSyncStatus(st) {
  $syncDot.className = 'sync-dot ' + st.state;
  const txt = $syncDot.querySelector('.sync-text');
  const dirtyTxt = st.dirty ? `（${st.dirty} 条未上传）` : '';
  if (st.state === 'ok') txt.textContent = '已同步' + (st.lastSync ? ' ' + fmtDate(st.lastSync).split(' ')[1] : '');
  else if (st.state === 'syncing') txt.textContent = '同步中…';
  else if (st.state === 'error') txt.textContent = '同步失败' + dirtyTxt;
  else if (st.state === 'offline') txt.textContent = '离线' + dirtyTxt;
  else if (st.state === 'off') txt.textContent = '未同步';
  else txt.textContent = (st.adapter || '未同步') + dirtyTxt;
  $syncDot.title = st.error ? '同步失败：' + st.error : (st.adapter ? '同步方式：' + st.adapter : '未设置云同步，点击去设置');
  if (location.hash.startsWith('#/settings')) renderSettingsStatus();
}

/** 首页顶部的同步警示（比右上角小圆点醒目）。 */
function syncBannerHtml() {
  const s = state.sync ? state.sync.status() : null;
  if (!s || !s.enabled) return '';
  const stale = s.dirty > 0 && (!s.lastSync || Date.now() - s.lastSync > STALE_MS);
  if (s.state === 'error' && /token/i.test(s.error || '')) {
    return `<div class="notice bad" style="margin-bottom:10px">云同步失败：${esc(s.error)}。<a href="#/settings">去设置页重新粘贴 token</a>${s.dirty ? `（本机有 ${s.dirty} 条作答还没上传）` : ''}</div>`;
  }
  if (stale) {
    return `<div class="notice" style="margin-bottom:10px">已 ${s.lastSync ? fmtAgo(s.lastSync) : '从未'} 成功同步，本机有 ${s.dirty} 条作答只存在这台设备上。<button class="btn small" data-act="sync-now">立即同步</button>${s.error ? ` <span class="small">原因：${esc(s.error)}</span>` : ''}</div>`;
  }
  return '';
}

// ---------- 路由 ----------

function route() {
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  const page = parts[0] || 'home';
  clearInterval(state.timer);
  state.timer = null;
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('active', a.dataset.nav === page || (page === 'home' && a.dataset.nav === 'home'));
  if (page !== 'run') state.runner = null;
  switch (page) {
    case 'home': return renderHome();
    case 'run': return renderRunner(parts[1]);
    case 'result': return renderResult(parts[1]);
    case 'review': return renderReview();
    case 'paper': return renderPaper();
    case 'settings': return renderSettings();
    case 'set': return renderSet(parts[1]);
    case 'key': return go('#/set/' + parts[1], { replace: true });
    case 'start': return handleStart(parts[1], parts[2], parts[3]);
    default: return go('#/', { replace: true });
  }
}

// ---------- 首页 ----------

function renderHome() {
  const P = state.progress;
  const idx = state.index;
  const streak = studyStreak(P, Date.now(), idx);
  const acc = partAccuracy(P, idx);
  const avg = avgMsByPart(P, idx);
  const wrong = wrongQuestions(P, idx);
  const counts = countProgress(P);
  const drafts = Object.values(P.drafts).sort((a, b) => b.upd - a.upd);
  const meta = getMeta();
  const syncOn = state.sync && state.sync.enabled();

  let html = '';
  for (const w of state.warnings) html += `<div class="notice bad" style="margin-bottom:10px">${esc(w)}</div>`;
  html += syncBannerHtml();
  if (!syncOn && counts.attempts === 0 && !state.isArtifact) {
    html += `<div class="card" style="margin-bottom:12px"><h3>这台设备上还没有进度</h3>
      <p class="small" style="margin:0 0 8px">如果你之前在别的设备（或 Safari / 主屏幕图标另一边）用过：去 <a href="#/settings">设置</a> 粘贴 GitHub token，进度会从云端拉回来；或者导入之前导出的 JSON。全新开始的话直接选一套开练即可。</p></div>`;
  } else if (!syncOn && !meta.hideSyncHint && !state.isArtifact) {
    html += `<div class="notice" style="margin-bottom:10px">进度目前只存在这台设备的浏览器里。去 <a href="#/settings">设置</a> 连接云同步，手机和电脑就能互通；或定期导出备份。 <button class="btn small ghost" data-act="hide-sync-hint">知道了</button></div>`;
  }
  if (drafts.length) {
    html += `<div class="card" style="margin-bottom:12px"><h3>继续上次</h3><div class="btn-row">`;
    for (const d of drafts) {
      const done = d.m === 'exam' ? Object.keys(d.answers).length : d.locked.length;
      const name = d.label || (d.s ? idx.sets.get(d.s)?.title : '练习');
      html += `<a class="btn primary" href="#/run/${esc(d.sid)}">▶ ${esc(name)} · ${MODE_LABELS[d.m]} ${done}/${d.qids.length}</a>`;
    }
    html += `</div></div>`;
  }

  html += `<div class="stats" style="margin-bottom:12px">
    <div class="stat"><b>${streak.days}</b><span>学习天数${streak.today ? ' · 今天已打卡' : ''}</span></div>
    <div class="stat"><b>${streak.streak}</b><span>连续天数</span></div>
    <div class="stat"><b>${counts.attempts}</b><span>累计作答</span></div>
    <div class="stat"><b>${wrong.length}</b><span>当前错题</span></div>
  </div>`;

  html += `<div class="grid" style="margin-bottom:12px">`;
  html += `<div class="card"><h3>各 Part 正确率 <span class="focus">按每题最近一次作答</span></h3><div class="kv">`;
  for (const p of [5, 6, 7]) {
    const a = acc[p];
    html += `<span>Part ${p}</span><div class="bar acc"><i style="width:${pct(a.right, a.total)}%"></i></div><span class="small">${a.total ? `${a.right}/${a.total} · ${pct(a.right, a.total)}%` : '未做'}${avg[p] ? ` · 均 ${Math.round(avg[p] / 1000)}s/题` : ''}</span>`;
  }
  html += `</div><p class="small muted" style="margin:10px 0 0">目标节奏：Part 5 约 25 秒/题，Part 6 约 45 秒/题，Part 7 约 60 秒/题。</p></div>`;

  html += `<div class="card"><h3>快练 <span class="focus">手机上随时来几题</span></h3><div class="btn-row">
    <a class="btn primary" href="#/start/quick5">随机 Part 5 × 10</a>
    <a class="btn" href="#/start/quick6">随机一篇 Part 6</a>
    <a class="btn" href="#/start/quick7">随机一篇 Part 7</a>
    <a class="btn ${wrong.length ? 'primary' : ''}" href="#/review">错题本 (${wrong.length})</a>
    <a class="btn" href="#/paper">录入纸面成绩</a>
  </div></div></div>`;

  html += `<div class="page-title">练习套题 <small>每套 24 题：Part 5 ×12 · Part 6 ×5（含 1 题加练）· Part 7 ×7</small></div><div class="grid">`;
  for (const setId of idx.setOrder) {
    const set = idx.sets.get(setId);
    const s = setSummary(P, set, idx);
    const last = s.last;
    html += `<div class="card"><h3><a href="#/set/${set.id}" style="color:inherit">${esc(set.title)}</a>${set.focus ? `<span class="focus">${esc(set.focus)}</span>` : ''}</h3>
      <div class="bar"><i style="width:${pct(s.answered, s.total)}%"></i></div>
      <div class="small muted">已做 ${s.answered}/${s.total} 题 · 当前答对 ${s.correctNow}${s.best ? ` · 最佳 ${s.best.score}/${s.best.total}` : ''}</div>
      ${last ? `<div class="small" style="margin-top:4px">最近：<b>${last.score}/${last.total}</b> · ${fmtDur(last.ms)} · ${fmtDate(last.end)} <span class="tag ${last.src === 'paper' ? 'paper' : last.m === 'exam' ? 'exam' : ''}">${last.src === 'paper' ? '纸面' : MODE_LABELS[last.m]}</span></div>` : ''}
      <div class="btn-row">
        ${s.draft ? `<a class="btn primary" href="#/run/${esc(s.draft.sid)}">继续 ${MODE_LABELS[s.draft.m]}</a>` : `<a class="btn primary" href="#/start/practice/${set.id}">练习</a><a class="btn" href="#/start/exam/${set.id}">模考</a>`}
        <a class="btn ghost small" href="#/set/${set.id}">详情/解析</a>
      </div></div>`;
  }
  html += `</div><p class="small muted" style="margin-top:16px">所有题目均为原创 TOEIC-style 仿真题，不是 ETS 官方真题。练习模式：选完立刻看解析；模考模式：计时、交卷后统一看答案。</p>`;
  $app.innerHTML = html;
}

// ---------- 套题详情（开始选项 + 答案与解析） ----------

function renderSet(setId) {
  const idx = state.index;
  const set = idx.sets.get(setId);
  if (!set) return go('#/', { replace: true });
  const latest = latestAttempts(state.progress, idx);
  const sum = setSummary(state.progress, set, idx);
  let html = `<div class="page-title">${esc(set.title)} ${set.focus ? `<small>${esc(set.focus)}</small>` : ''}</div>`;
  html += `<div class="card" style="margin-bottom:12px"><h3>开始</h3>
    <div class="btn-row">
      ${sum.draft ? `<a class="btn primary" href="#/run/${esc(sum.draft.sid)}">继续未完成的${MODE_LABELS[sum.draft.m]}</a>` : `
      <a class="btn primary" href="#/start/practice/${set.id}">练习整套（24 题）</a>
      <a class="btn" href="#/start/practice/${set.id}/p5">只练 Part 5（12 题）</a>
      <a class="btn" href="#/start/practice/${set.id}/p67">只练 Part 6+7（12 题）</a>
      <a class="btn" href="#/start/exam/${set.id}">模考整套（限时 ${set.recommended_minutes || 27} 分钟）</a>
      <a class="btn" href="#/start/exam/${set.id}/p5">模考 Part 5（10 分钟）</a>`}
    </div>
    <p class="small muted" style="margin:10px 0 0">手机上适合 Part 5，电脑上做 Part 6/7 更舒服；进度会同步，可以换设备接着做。</p>
    ${sum.sessions.length ? `<h3 style="margin-top:14px">历史</h3><ul class="history">${sum.sessions.slice(0, 8).map((s) => `<li><span class="tag ${s.src === 'paper' ? 'paper' : s.m === 'exam' ? 'exam' : ''}">${s.src === 'paper' ? '纸面' : MODE_LABELS[s.m]}</span><b>${s.score}/${s.total}</b> · ${fmtDur(s.ms)}${s.answered < s.total ? ` · 做了 ${s.answered} 题` : ''}<a class="small" href="#/result/${esc(s.id)}">回顾</a><span class="when">${fmtDate(s.end)}</span></li>`).join('')}</ul>` : ''}
  </div>`;
  html += `<div class="card" style="margin-bottom:12px"><h3>答案</h3><div class="row">${set.groups.flatMap((g) => g.questions).map((q) => `<span class="tag">${q.n} ${q.answer}</span>`).join('')}</div>
    ${set.phrases?.length ? `<p style="margin:10px 0 0"><b>只记 5 个搭配：</b>${set.phrases.map(esc).join(' | ')}</p>` : ''}
    ${set.listening ? `<p class="small" style="margin:8px 0 0"><b>听力配套：</b>${esc(set.listening)} <a href="${OFFICIAL_LC_URL}" target="_blank" rel="noopener">官方公开题 ↗</a></p>` : ''}
    ${set.source_pdf ? `<p class="small muted" style="margin:8px 0 0">对应打印版：${esc(set.source_pdf)}</p>` : ''}</div>`;
  for (const g of set.groups) {
    html += `<div class="card" style="margin-bottom:12px"><h3>${esc(g.title)}</h3>`;
    for (const p of g.passages) html += `<details class="passage" open><summary>${esc(p.title)}</summary><div class="text">${esc(p.text).replace(/\[(\d+)\]/g, '<span class="blank">[$1]</span>')}</div>${passageZhHtml(p)}</details>`;
    html += `<ul class="qlist">`;
    for (const q of g.questions) html += questionRowHtml({ q, set, group: g }, latest.get(q.id), false);
    html += `</ul></div>`;
  }
  if (set.reviews?.length) html += `<div class="card"><h3>本套关键解析（纸质版原文）</h3><ul class="small" style="padding-left:18px">${set.reviews.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
  $app.innerHTML = html;
  window.scrollTo({ top: 0 });
}

// ---------- 开始一次练习 ----------

function handleStart(kind, setId, scope) {
  const idx = state.index;
  const P = state.progress;
  let qids = [];
  let label = '';
  let mode = 'practice';
  const filterScope = (set) => {
    if (scope === 'p5') return set._qids.filter((q) => idx.questions.get(q).q.part === 5);
    if (scope === 'p67') return set._qids.filter((q) => idx.questions.get(q).q.part !== 5);
    return set._qids;
  };
  if (kind === 'practice' || kind === 'exam') {
    const set = idx.sets.get(setId);
    if (!set) return go('#/', { replace: true });
    const existing = Object.values(P.drafts).find((d) => d.s === set.id && (d.m === 'practice' || d.m === 'exam'));
    if (existing) return go('#/run/' + existing.sid, { replace: true });
    qids = filterScope(set);
    mode = kind;
    label = set.title + (scope === 'p5' ? ' · Part 5' : scope === 'p67' ? ' · Part 6+7' : '');
  } else if (kind === 'quick5') {
    qids = pickRandom(idx, { part: 5, count: 10 });
    label = '随机 Part 5';
    mode = 'quick';
  } else if (kind === 'quick6' || kind === 'quick7') {
    const part = kind === 'quick6' ? 6 : 7;
    const groups = [];
    for (const s of idx.sets.values()) for (const g of s.groups) if (g.part === part && g.questions.some((q) => !q.retired)) groups.push(g);
    const g = groups[Math.floor(Math.random() * groups.length)];
    qids = g.questions.filter((q) => !q.retired).map((q) => q.id);
    label = `随机 Part ${part}`;
    mode = 'quick';
  } else if (kind === 'review') {
    qids = wrongQuestions(P, idx);
    if (setId && setId.startsWith('p')) qids = qids.filter((q) => idx.questions.get(q).q.part === Number(setId.slice(1)));
    if (!qids.length) { toast('当前没有错题'); return go('#/', { replace: true }); }
    label = '错题重做';
    mode = 'review';
  } else if (kind === 'redo') {
    const sess = P.sessions[setId];
    if (!sess) return go('#/', { replace: true });
    qids = sess.wrong.filter((q) => idx.questions.has(q));
    if (!qids.length) { toast('这次没有错题'); return go('#/', { replace: true }); }
    label = '重做错题';
    mode = 'review';
  } else {
    return go('#/', { replace: true });
  }
  if (!qids.length) { toast('没有可做的题'); return go('#/', { replace: true }); }
  const draft = startDraft(P, { setId: mode === 'practice' || mode === 'exam' ? setId : null, mode, qids, label });
  state.runner = { draft, shownAt: Date.now(), mountedAt: Date.now(), passageOpen: {}, gridOpen: false, undo: null };
  save();
  requestPersist();
  go('#/run/' + draft.sid, { replace: true });
}

// ---------- 做题器 ----------

function runnerSpentTotal(d) {
  return Object.values(d.spent).reduce((a, b) => a + (b || 0), 0);
}

function runnerLimitMs(d) {
  const groups = new Set();
  let ms = 0;
  for (const qid of d.qids) {
    const info = state.index.questions.get(qid);
    if (!info) continue;
    if (d.s && info.group.minutes) {
      if (!groups.has(info.group.id)) { groups.add(info.group.id); ms += info.group.minutes * 60000; }
    } else {
      ms += PART_LIMIT_MS[info.q.part] || 45000;
    }
  }
  return ms || 27 * 60000;
}

/** 把当前题目已经看了多久累计进 draft.spent。 */
function accumulateSpent(r) {
  const d = r.draft;
  const qid = d.qids[d.idx];
  const dt = Math.min(Math.max(0, Date.now() - r.shownAt), MAX_Q_MS);
  d.spent[qid] = (d.spent[qid] || 0) + dt;
  r.shownAt = Date.now();
}

/** Part 6 文章里的空格：当前题高亮；已作答的把选的词填进去。 */
function passageHtml(p, q, r, groupId, fills) {
  const open = r.passageOpen[groupId] !== false;
  const body = esc(p.text).replace(/\[(\d+)\]/g, (m, n) => {
    const num = Number(n);
    const fill = fills.get(num);
    return `<span class="blank ${num === q.n ? 'cur' : ''}">[${n}]${fill ? ' ' + esc(fill) : ''}</span>`;
  });
  return `<details class="passage" ${open ? 'open' : ''} data-passage="${esc(groupId)}"><summary>${esc(p.title)}</summary><div class="text">${body}</div>${passageZhHtml(p)}</details>`;
}

function stemHtml(q) {
  if (q.part === 6 && !q.stem) return `第 <span class="blank">[${q.n}]</span> 空：选最合适的词`;
  let s = esc(q.stem);
  if (q.bonus) s = s.replace(/^BONUS:\s*/, '');
  return s.replace(/_{3,}/g, '<span class="blank">___</span>');
}

function optionHtml(o, q, chosen, locked, isExam) {
  let cls = 'option';
  if (isExam) {
    if (chosen === o.key) cls += ' selected';
  } else if (locked) {
    if (o.key === q.answer) cls += ' correct';
    else if (o.key === chosen) cls += ' wrong';
    else cls += ' dim';
  }
  return `<button class="${cls}" data-act="choose" data-key="${o.key}" ${(!isExam && locked) ? 'disabled' : ''} aria-pressed="${chosen === o.key}"><span class="key">${o.key}</span><span>${esc(o.text)}</span></button>`;
}

function explainHtml(q, set) {
  if (q.explain) return `<div class="explain"><span class="lbl">解析</span>${esc(q.explain)}</div>`;
  const lines = (set.reviews || []).filter((l) => new RegExp(`(^|[；;\\s])${q.n}(\\s|-)`).test(l));
  if (lines.length) return `<div class="explain"><span class="lbl">本套解析</span>${lines.map(esc).join('<br>')}</div>`;
  return `<div class="explain small muted">本题暂无单独解析，可在套题详情页看本套关键解析。</div>`;
}

/** 翻译与生词（题库里有 zh 字段才显示）。 */
function zhHtml(q, { open = false } = {}) {
  const z = q.zh;
  if (!z) return '';
  let body = '';
  if (z.stem) body += `<p class="zh-stem">${esc(z.stem)}</p>`;
  if (z.options) body += `<ul class="zh-opts">${q.options.map((o) => `<li><b>${o.key}</b> ${esc(o.text)}<span class="zh-sep">—</span>${esc(z.options[o.key] || '')}</li>`).join('')}</ul>`;
  if (z.vocab && z.vocab.length) body += `<div class="zh-vocab">${z.vocab.map((v) => `<span class="tag">${esc(v.word)}：${esc(v.zh)}</span>`).join(' ')}</div>`;
  if (!body) return '';
  return `<details class="zh" ${open ? 'open' : ''}><summary>翻译与生词</summary>${body}</details>`;
}

function passageZhHtml(p) {
  if (!p.zh) return '';
  return `<div class="zh-text" hidden>${esc(p.zh)}</div><button class="btn small ghost zh-btn" data-act="toggle-zh">显示中文</button>`;
}

function causesHtml(qid) {
  const cur = tagOf(state.progress, qid);
  return `<div class="causes"><span class="small muted" style="align-self:center">错因：</span>${Object.entries(CAUSES).map(([k, v]) => `<button class="cause ${cur === k ? 'on' : ''}" data-act="tag" data-qid="${esc(qid)}" data-cause="${k}">${v}</button>`).join('')}</div>`;
}

function feedbackHtml(q, chosen, info, r) {
  const ok = chosen === q.answer;
  const undo = r.undo && r.undo.qid === q.id && r.undo.until > Date.now();
  return `<div class="feedback ${ok ? 'good' : 'bad'}"><div class="row spread"><span>${ok ? '✓ 答对了' : `✗ 答错了，正确答案是 ${q.answer}`}</span>${undo ? `<button class="btn small ghost" data-act="undo">误触？撤销</button>` : ''}</div>${explainHtml(q, info.set)}${zhHtml(q, { open: !ok })}${ok ? '' : causesHtml(q.id)}</div>`;
}

function renderRunner(sid) {
  let r = state.runner;
  if (!r || r.draft.sid !== sid) {
    const d = state.progress.drafts[sid];
    if (!d) return go(state.progress.sessions[sid] && !state.progress.sessions[sid].deleted ? '#/result/' + sid : '#/', { replace: true });
    r = state.runner = { draft: d, shownAt: Date.now(), mountedAt: Date.now(), passageOpen: {}, gridOpen: false, undo: null };
  }
  const d = r.draft;
  const idx = state.index;
  if (d.idx < 0 || d.idx >= d.qids.length) d.idx = 0;
  const qid = d.qids[d.idx];
  const info = idx.questions.get(qid);
  if (!info) { toast('题目不存在，可能题库已更新'); abandonDraft(state.progress, sid); save(); return go('#/', { replace: true }); }
  const q = info.q;
  const set = d.s ? idx.sets.get(d.s) : null;
  const isExam = d.m === 'exam';
  const locked = !isExam && d.locked.includes(qid);
  const chosen = d.answers[qid] || null;
  const passages = info.group.passages;
  const total = d.qids.length;
  const answered = isExam ? Object.keys(d.answers).length : d.locked.length;

  // Part 6 空格填充：练习模式已锁定的题显示正确答案，模考显示自己选的
  const fills = new Map();
  if (q.part === 6) {
    for (const gq of info.group.questions) {
      if (gq.kind !== 'blank') continue;
      const c = d.answers[gq.id];
      if (!c) continue;
      const showKey = isExam ? c : (d.locked.includes(gq.id) ? gq.answer : null);
      if (showKey) fills.set(gq.n, gq.options.find((o) => o.key === showKey)?.text || '');
    }
  }

  const gridBtns = d.qids.map((id, i) => {
    const qq = idx.questions.get(id)?.q;
    let cls = i === d.idx ? 'cur' : '';
    if (isExam) { if (d.answers[id]) cls += ' done'; } else if (d.locked.includes(id)) { cls += d.answers[id] === qq?.answer ? ' ok' : ' bad'; }
    return `<button class="${cls}" data-act="goto" data-i="${i}">${qq ? qq.n : i + 1}</button>`;
  }).join('');

  $app.innerHTML = `
  <div class="runner-top">
    <span class="title">${esc(d.label || set?.title || '练习')}</span>
    <span class="tag ${isExam ? 'exam' : ''}">${MODE_LABELS[d.m]}</span>
    <span class="counter">${d.idx + 1}/${total} · 已答 ${answered}</span>
    <span class="timer" id="timer"></span>
  </div>
  <div class="runner ${passages.length ? 'two-col' : ''}">
    ${passages.length ? `<div class="passage-col">${passages.map((p) => passageHtml(p, q, r, info.group.id, fills)).join('')}</div>` : ''}
    <div class="question-col">
      <div class="question">
        <div class="qhead"><b>${q.n}.</b><span>Part ${q.part}${q.bonus ? ' · BONUS 加练' : ''}${d.s ? '' : ' · ' + esc(info.set.title)}${q.kind === 'sentence' ? ' · 选句子' : ''}</span></div>
        <p class="stem">${stemHtml(q)}</p>
        <div class="options ${q.options.every((o) => o.text.length <= 14) ? 'compact' : ''}">${q.options.map((o) => optionHtml(o, q, chosen, locked, isExam)).join('')}</div>
        ${locked ? feedbackHtml(q, chosen, info, r) : ''}
      </div>
      <div class="actions">
        <button class="btn ghost" data-act="prev" ${d.idx === 0 ? 'disabled' : ''}>上一题</button>
        ${d.idx < total - 1
          ? `<button class="btn primary" data-act="next">下一题</button>`
          : `<button class="btn primary" data-act="finish">${isExam ? '交卷' : '完成，看结果'}</button>`}
      </div>
      <details class="card" ${r.gridOpen ? 'open' : ''} data-grid>
        <summary class="small muted" style="cursor:pointer">题目导航 · ${isExam ? '交卷' : '提前结束'} · 退出</summary>
        <div class="navgrid">${gridBtns}</div>
        <div class="btn-row">
          <button class="btn small" data-act="finish">${isExam ? '交卷' : '结束并计分'}</button>
          <button class="btn small ghost" data-act="exit">退出（保留进度，下次继续）</button>
          <button class="btn small danger" data-act="abandon">放弃这次（不计分）</button>
        </div>
      </details>
    </div>
  </div>`;

  const $timer = document.getElementById('timer');
  const $top = $app.querySelector('.runner-top');
  const measureTop = () => {
    // 做题顶栏可能换行，吸顶的文章区要跟着让位
    const h = $top ? $top.offsetHeight : 46;
    if (h && h !== r.topH) { r.topH = h; document.documentElement.style.setProperty('--runner-top-h', h + 'px'); }
  };
  measureTop();
  const tick = () => {
    measureTop();
    const live = Math.min(Math.max(0, Date.now() - r.shownAt), MAX_Q_MS);
    const used = runnerSpentTotal(d) + live;
    if (isExam) {
      const left = runnerLimitMs(d) - used;
      $timer.textContent = left >= 0 ? '剩余 ' + fmtMMSS(left) : '超时 ' + fmtMMSS(-left);
      $timer.classList.toggle('over', left < 0);
      $timer.classList.toggle('warn', left >= 0 && left < 120000);
    } else {
      $timer.textContent = '已用 ' + fmtMMSS(used);
    }
    if (r.undo && r.undo.until <= Date.now()) {
      r.undo = null;
      const b = $app.querySelector('[data-act="undo"]');
      if (b) b.remove();
    }
  };
  tick();
  state.timer = setInterval(tick, 1000);
  r.mountedAt = Date.now();
  const cur = $app.querySelector('.passage .blank.cur');
  if (cur && window.innerWidth < 900) cur.scrollIntoView({ block: 'center' });
  else window.scrollTo({ top: 0 });
}

function runnerChoose(key) {
  const r = state.runner;
  if (!r) return;
  if (Date.now() - r.mountedAt < 250) return; // 刚换题就点到，多半是误触
  const d = r.draft;
  const qid = d.qids[d.idx];
  const info = state.index.questions.get(qid);
  const q = info.q;
  if (d.m === 'exam') {
    d.answers[qid] = key;
    touchDraft(state.progress, d);
    save();
    renderRunner(d.sid);
    return;
  }
  if (d.locked.includes(qid)) return;
  accumulateSpent(r);
  d.answers[qid] = key;
  d.locked.push(qid);
  const a = recordAttempt(state.progress, {
    qid, setId: info.set.id, choice: key, correct: key === q.answer,
    ms: d.spent[qid] || 0, mode: d.m, sid: d.sid, qrev: q.rev || 0,
  });
  r.undo = { id: a.id, qid, until: Date.now() + UNDO_MS };
  touchDraft(state.progress, d);
  save();
  renderRunner(d.sid);
}

function runnerUndo() {
  const r = state.runner;
  if (!r || !r.undo) return;
  const d = r.draft;
  const { id, qid } = r.undo;
  deleteAttempt(state.progress, id);
  d.locked = d.locked.filter((x) => x !== qid);
  delete d.answers[qid];
  r.undo = null;
  touchDraft(state.progress, d);
  save();
  toast('已撤销，重新作答');
  renderRunner(d.sid);
}

function runnerGoto(i) {
  const r = state.runner;
  if (!r) return;
  const d = r.draft;
  if (i < 0 || i >= d.qids.length) return;
  accumulateSpent(r);
  d.idx = i;
  r.undo = null;
  touchDraft(state.progress, d);
  save();
  renderRunner(d.sid);
}

function runnerFinish() {
  const r = state.runner;
  if (!r) return;
  const d = r.draft;
  const idx = state.index;
  accumulateSpent(r);
  const P = state.progress;
  if (d.m === 'exam') {
    const unanswered = d.qids.filter((q) => !d.answers[q]).length;
    if (unanswered && !confirm(`还有 ${unanswered} 题没答，未答按错误计。确定交卷？`)) return;
    const now = Date.now();
    d.qids.forEach((qid, i) => {
      const q = idx.questions.get(qid).q;
      const c = d.answers[qid] || null;
      recordAttempt(P, { qid, setId: idx.questions.get(qid).set.id, choice: c, correct: c === q.answer, ms: d.spent[qid] || 0, mode: 'exam', sid: d.sid, ts: now + i, qrev: q.rev || 0 });
    });
  } else {
    const answered = d.locked.length;
    if (answered === 0) { toast('还没做题，可以选“放弃这次”'); return; }
    if (answered < d.qids.length && !confirm(`还有 ${d.qids.length - answered} 题没做，现在结束只按已做的计分。确定？`)) return;
  }
  finishSession(P, { sid: d.sid, setId: d.s, mode: d.m, total: d.qids.length, start: d.start, label: d.label, ms: runnerSpentTotal(d) });
  state.runner = null;
  save();
  if (state.sync) state.sync.flush();
  go('#/result/' + d.sid, { replace: true });
}

function runnerExit() {
  const r = state.runner;
  if (!r) return;
  accumulateSpent(r);
  touchDraft(state.progress, r.draft);
  state.runner = null;
  save();
  go('#/');
}

function runnerAbandon() {
  const r = state.runner;
  if (!r) return;
  if (!confirm('放弃这次练习？已作答的题仍会保留在记录里，但这次不算一次完整练习。')) return;
  abandonDraft(state.progress, r.draft.sid);
  state.runner = null;
  save();
  go('#/', { replace: true });
}

// ---------- 结果页 ----------

function partBreakdown(qids, byQ) {
  const out = { 5: [0, 0], 6: [0, 0], 7: [0, 0] };
  for (const qid of qids) {
    const info = state.index.questions.get(qid);
    if (!info) continue;
    out[info.q.part][1] += 1;
    if (byQ.get(qid)?.ok) out[info.q.part][0] += 1;
  }
  return out;
}

function questionRowHtml(info, a, showCauses) {
  const q = info.q;
  const ok = a ? a.ok : null;
  const mine = a ? (a.c || '未答') : '—';
  const stem = q.part === 6 && !q.stem ? `第 [${q.n}] 空` : q.stem.replace(/^BONUS:\s*/, '');
  return `<li>
    <div class="row spread"><span><b>${q.n}.</b> <span class="small muted">${esc(info.set.title)} · Part ${q.part}</span></span><span class="small" style="color:${ok === null ? '' : ok ? 'var(--ok)' : 'var(--bad)'}">${ok === null ? '' : ok ? '✓ 对' : '✗ 错'}</span></div>
    <div class="stem">${esc(stem)}</div>
    <div class="ans">${ok === false ? `你选 <s>${esc(mine)}</s> · ` : ''}答案 <b>${q.answer}</b>：${esc(q.options.find((o) => o.key === q.answer)?.text || '')}</div>
    ${explainHtml(q, info.set)}
    ${zhHtml(q, { open: false })}
    ${showCauses && ok === false ? causesHtml(q.id) : ''}
  </li>`;
}

function renderResult(sid) {
  const P = state.progress;
  const idx = state.index;
  const s = P.sessions[sid];
  if (!s || s.deleted) return go('#/', { replace: true });
  const atts = sessionAttempts(P, sid);
  const byQ = new Map(atts.map((a) => [a.q, a]));
  const set = s.s ? idx.sets.get(s.s) : null;
  const qids = set ? set._qids.filter((q) => byQ.has(q) || s.answered >= s.total) : atts.map((a) => a.q);
  const parts = partBreakdown(qids, byQ);
  const wrongCount = qids.filter((q) => byQ.get(q) && !byQ.get(q).ok).length;

  let html = `<div class="card" style="margin-bottom:12px">
    <div class="row spread"><div><div class="page-title" style="margin:0">${esc(s.label || set?.title || '练习')} <small>${s.src === 'paper' ? '纸面' : MODE_LABELS[s.m]} · ${fmtDate(s.end || s.start)}</small></div></div>
    <div class="score">${s.score}<small> / ${s.total}</small></div></div>
    <div class="kv" style="margin-top:8px">`;
  for (const p of [5, 6, 7]) {
    const [r, t] = parts[p];
    if (!t) continue;
    html += `<span>Part ${p}</span><div class="bar acc"><i style="width:${pct(r, t)}%"></i></div><span class="small">${r}/${t}</span>`;
  }
  html += `</div><p class="small muted" style="margin:10px 0 0">用时 ${fmtDur(s.ms)}${set && s.answered >= s.total ? ` · 建议 ${set.recommended_minutes} 分钟` : ''}${s.answered < s.total ? ` · 只做了 ${s.answered} 题` : ''}</p>
    <div class="btn-row">
      ${wrongCount ? `<a class="btn primary" href="#/start/redo/${esc(sid)}">重做这次的错题 (${wrongCount})</a>` : ''}
      ${set ? `<a class="btn" href="#/set/${set.id}">套题详情</a>` : ''}
      <a class="btn ghost" href="#/">回首页</a>
    </div></div>`;

  if (set && (set.phrases?.length || set.listening)) {
    html += `<div class="card" style="margin-bottom:12px"><h3>${esc(set.title)} 只记 5 个搭配</h3><div class="row">${(set.phrases || []).map((p) => `<span class="tag">${esc(p)}</span>`).join('')}</div>
      ${set.listening ? `<p class="small" style="margin:10px 0 0"><b>听力配套：</b>${esc(set.listening)} <a href="${OFFICIAL_LC_URL}" target="_blank" rel="noopener">打开韩国 TOEIC 官方公开题 ↗</a></p>` : ''}</div>`;
  }

  html += `<div class="card"><h3>逐题回顾 <span class="focus">错题可以标错因，方便复盘</span></h3><ul class="qlist">`;
  for (const qid of qids) {
    const info = idx.questions.get(qid);
    if (!info) continue;
    html += questionRowHtml(info, byQ.get(qid), true);
  }
  html += `</ul></div>`;
  $app.innerHTML = html;
  window.scrollTo({ top: 0 });
}

// ---------- 错题本 ----------

function renderReview() {
  const P = state.progress;
  const idx = state.index;
  const wrong = wrongQuestions(P, idx);
  const latest = latestAttempts(P, idx);
  const hist = causeHistogram(P, idx);
  const byPart = { 5: 0, 6: 0, 7: 0 };
  for (const q of wrong) byPart[idx.questions.get(q).q.part] += 1;

  let html = `<div class="page-title">错题本 <small>以每题最近一次作答为准；做对一次就移出</small></div>`;
  html += `<div class="card" style="margin-bottom:12px">
    <div class="stats"><div class="stat"><b>${wrong.length}</b><span>当前错题</span></div>${[5, 6, 7].map((p) => `<div class="stat"><b>${byPart[p]}</b><span>Part ${p}</span></div>`).join('')}</div>
    <div class="row" style="margin-top:10px">${Object.entries(CAUSES).map(([k, v]) => `<span class="tag">${v} ${hist[k]}</span>`).join('')}<span class="small muted">（已标错因的）</span></div>
    <div class="btn-row">
      ${wrong.length ? `<a class="btn primary" href="#/start/review">重做全部错题 (${wrong.length})</a>` : ''}
      ${[5, 6, 7].map((p) => byPart[p] ? `<a class="btn" href="#/start/review/p${p}">只重做 Part ${p} (${byPart[p]})</a>` : '').join('')}
    </div></div>`;

  if (!wrong.length) {
    html += `<div class="card"><p class="muted">目前没有错题。做几套题、或到“录纸面”把纸上做错的题号录进来，这里就会出现。</p></div>`;
  } else {
    let curSet = null;
    html += `<div class="card"><ul class="qlist">`;
    for (const qid of wrong) {
      const info = idx.questions.get(qid);
      if (info.set.id !== curSet) {
        curSet = info.set.id;
        html += `<li style="border-top:0"><b style="color:var(--teal)">${esc(info.set.title)}</b>${info.set.focus ? ` <span class="small muted">${esc(info.set.focus)}</span>` : ''}</li>`;
      }
      html += questionRowHtml(info, latest.get(qid), true);
    }
    html += `</ul></div>`;
  }
  $app.innerHTML = html;
}

// ---------- 录入纸面成绩 ----------

function renderPaper() {
  const idx = state.index;
  const ps = state.paper;
  if (!ps.setId || !idx.sets.has(ps.setId)) ps.setId = idx.setOrder[0];
  if (!ps.date) ps.date = todayStr();
  const set = idx.sets.get(ps.setId);
  const n = set._qids.length;
  const paperSessions = liveSessions(state.progress).filter((s) => s.src === 'paper').sort((a, b) => b.upd - a.upd);

  let html = `<div class="page-title">录入纸面成绩 <small>把打印版做完的结果记进来，错题会进错题本</small></div>
  <div class="card" style="margin-bottom:12px">
    <div class="row">
      <label class="field" style="flex:1;min-width:140px">套题<select data-paper="setId">${idx.setOrder.map((id) => `<option value="${id}" ${id === ps.setId ? 'selected' : ''}>${esc(idx.sets.get(id).title)}${idx.sets.get(id).focus ? ' · ' + esc(idx.sets.get(id).focus) : ''}</option>`).join('')}</select></label>
      <label class="field" style="flex:1;min-width:140px">日期<input type="date" data-paper="date" value="${esc(ps.date)}"></label>
      <label class="field" style="flex:1;min-width:120px">用时（分钟）<input type="number" inputmode="numeric" min="1" max="300" data-paper="minutes" value="${esc(ps.minutes)}" placeholder="如 22"></label>
    </div>
    <p class="small muted" style="margin:4px 0 8px">点选<b>做错的题号</b>（再点一次取消）：</p>
    <div class="pick-grid">${set._qids.map((qid) => idx.questions.get(qid).q.n).map((k) => `<button class="${ps.wrong.has(k) ? 'on' : ''}" data-act="paper-toggle" data-n="${k}">${k}</button>`).join('')}</div>
    <p style="margin:12px 0 4px">得分 <b style="font-size:20px;color:var(--teal)">${n - ps.wrong.size}</b> / ${n} ${ps.wrong.size ? `· 错 ${[...ps.wrong].sort((a, b) => a - b).join('、')}` : ''}</p>
    <label class="field">备注（可选）<input type="text" data-paper="note" value="${esc(ps.note)}" placeholder="例如：Part 7 最后两题没做完"></label>
    <div class="btn-row"><button class="btn primary" data-act="paper-save" ${ps.saving ? 'disabled' : ''}>保存这次成绩</button><button class="btn ghost" data-act="paper-clear">清空选择</button></div>
    <p class="small muted" style="margin:10px 0 0">${set.source_pdf ? `对应文件：${esc(set.source_pdf)}` : ''}</p>
  </div>`;

  html += `<div class="card"><h3>已录入的纸面成绩</h3>`;
  if (!paperSessions.length) html += `<p class="muted small">还没有记录。</p>`;
  else {
    html += `<ul class="history">`;
    for (const s of paperSessions) {
      html += `<li><span class="tag paper">纸面</span><b>${esc(idx.sets.get(s.s)?.title || s.s)}</b> ${s.score}/${s.total} · ${fmtDur(s.ms)}${s.wrong.length ? ` · 错 ${s.wrong.map((q) => idx.questions.get(q)?.q.n).filter(Boolean).join('、')}` : ''}${s.note ? ` · ${esc(s.note)}` : ''}<span class="when">${fmtDay(s.start)}</span><button class="btn small ghost" data-act="paper-delete" data-sid="${esc(s.id)}" title="录错了？删除这条">删除</button></li>`;
    }
    html += `</ul>`;
  }
  html += `</div>`;
  $app.innerHTML = html;
}

function paperSave() {
  const ps = state.paper;
  if (ps.saving) return;
  const set = state.index.sets.get(ps.setId);
  const minutes = Number(ps.minutes);
  if (!(minutes > 0)) { toast('请填写用时（分钟）'); return; }
  const dateTs = ps.date ? new Date(ps.date + 'T12:00:00').getTime() : Date.now();
  if (!Number.isFinite(dateTs)) { toast('日期格式不对'); return; }
  if (!confirm(`记录 ${set.title}：${set._qids.length - ps.wrong.size}/${set._qids.length}${ps.wrong.size ? '，错 ' + [...ps.wrong].sort((a, b) => a - b).join('、') : '，全对'}。确定？`)) return;
  ps.saving = true;
  // 作答时间戳：当天录入就用现在，补录旧日期用那天中午
  const ts = ps.date === todayStr() ? Date.now() : dateTs;
  const s = addPaperSession(state.progress, { set, wrongNumbers: [...ps.wrong], minutes, dateTs, ts, note: ps.note });
  save();
  toast(`已记录 ${set.title}：${s.score}/${s.total}`);
  state.paper = { setId: ps.setId, wrong: new Set(), minutes: '', date: todayStr(), note: '', saving: false };
  renderPaper();
}

// ---------- 设置 ----------

function renderSettingsStatus() {
  const el = document.getElementById('sync-status');
  if (!el || !state.sync) return;
  const s = state.sync.status();
  const cls = s.state === 'ok' ? 'ok' : s.state === 'error' ? 'bad' : 'info';
  const dirty = s.dirty ? ` · ${s.dirty} 条未上传` : '';
  const text = s.state === 'ok' ? `已同步（${s.lastSync ? fmtDate(s.lastSync) : ''}）${dirty}`
    : s.state === 'syncing' ? '同步中…'
      : s.state === 'error' ? `同步失败：${s.error}${dirty}`
        : s.state === 'offline' ? `离线，已本地保存${dirty}`
          : s.enabled ? `已连接，等待同步${dirty}` : '未连接云同步';
  el.className = 'notice ' + cls;
  el.textContent = text;
}

function renderSettings() {
  const meta = getMeta();
  const P = state.progress;
  const counts = countProgress(P);
  const sync = state.sync;
  const adapter = sync?.adapter;
  const isArtifact = adapter?.name === 'artifact';
  const gistCfg = meta.gist || {};
  const bk = backupInfo();
  const tr = trashInfo();

  let html = `<div class="page-title">设置</div>`;
  if (state.settingsMsg) { html += `<div class="notice ${state.settingsMsg.cls}" style="margin-bottom:12px">${esc(state.settingsMsg.text)}</div>`; }

  html += `<div class="card" style="margin-bottom:12px"><h3>云同步 <span class="focus">让手机和电脑共用一份进度</span></h3><div id="sync-status" class="notice info">…</div>`;
  if (isArtifact) {
    html += `<p class="small" style="margin:10px 0">当前页面运行在 Claude 里，进度自动存到 Claude 的云端存储，登录同一个 Claude 账号的任何设备打开这个页面都能看到。</p>
      <div class="btn-row"><button class="btn primary" data-act="sync-now">立即同步</button></div>`;
  } else {
    html += `<p class="small" style="margin:10px 0">用你 GitHub 账号里的一个私密 Gist（小文本文件）当云盘，免费、不用服务器。只需要一个<b>只有 Gists 权限</b>的 token：</p>
      <ol class="steps">
        <li>点这个预填好的链接：<a href="${TOKEN_URL}" target="_blank" rel="noopener">github.com 生成 token ↗</a>（权限只有 Gists 读写，不过期）。登录后直接点页面底部的 <b>Generate token</b>。</li>
        <li>复制生成的 <code>github_pat_…</code> 字符串，粘贴到下面，点连接。每台设备做一次即可；token 请存进备忘录/密码管理器，别发到聊天里。</li>
        <li>连接成功后右上角圆点变绿。之后每次作答几秒内自动上传，另一台设备打开时自动拉取。</li>
      </ol>
      <p class="small muted">打不开上面的链接？用 <a href="${TOKEN_URL_CLASSIC}" target="_blank" rel="noopener">classic token ↗</a>：Expiration 选 No expiration，只勾 <code>gist</code>。</p>
      <label class="field">GitHub token<input type="password" id="gist-token" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_… 或 ghp_…" value="${esc(gistCfg.token || '')}"></label>
      <div class="btn-row">
        <button class="btn primary" data-act="gist-connect">${gistCfg.token ? '重新连接并同步' : '连接并同步'}</button>
        ${gistCfg.token ? `<button class="btn" data-act="sync-now">立即同步</button><button class="btn danger" data-act="gist-disconnect">断开</button>` : ''}
      </div>
      ${gistCfg.gistId ? `<p class="small muted" style="margin:8px 0 0">进度文件：<a href="https://gist.github.com/${esc(gistCfg.gistId)}" target="_blank" rel="noopener">gist ${esc(gistCfg.gistId.slice(0, 8))}… ↗</a>${gistCfg.login ? ` · 账号 ${esc(gistCfg.login)}` : ''}。两台设备看到同一个 gist 编号才是在互通。</p>` : ''}
      <p class="small muted" style="margin:8px 0 0">隐私说明：secret gist 不会被搜到，但知道链接的人能看。里面只有题号、选项和用时，没有个人信息。</p>`;
  }
  html += `</div>`;

  html += `<div class="card" style="margin-bottom:12px"><h3>备份与恢复 <span class="focus">本机 ${counts.attempts} 条作答 · ${counts.sessions} 次会话 · ${counts.tags} 个错因标签</span></h3>
    <div class="btn-row">${state.isArtifact ? '' : '<button class="btn" data-act="export-file">下载进度文件</button>'}<button class="btn" data-act="export-copy">复制到剪贴板</button></div>
    ${state.isArtifact ? '<p class="small muted">在 Claude 里运行时浏览器不允许直接下载，请用“复制到剪贴板”再粘贴到备忘录保存。</p>' : ''}
    <label class="field" style="margin-top:12px">导入（粘贴进度 JSON，或选择文件）。导入是<b>合并</b>，不会覆盖已有记录。<textarea id="import-text" placeholder='{"app":"toeic-trainer", ...}'></textarea></label>
    <div class="btn-row"><button class="btn primary" data-act="import-text">合并导入</button><label class="btn">选择文件<input type="file" accept="application/json,.json" data-act="import-file" hidden></label></div>
    ${bk ? `<p class="small muted" style="margin:12px 0 0">本机还有一份每日自动备份（${fmtDate(bk.ts)}）。<button class="btn small ghost" data-act="restore-backup">合并恢复</button></p>` : ''}
    ${tr ? `<p class="small muted" style="margin:8px 0 0">回收站里有一份清空前的进度（${fmtDate(tr.ts)}）。<button class="btn small ghost" data-act="restore-trash">合并恢复</button></p>` : ''}
  </div>`;

  html += `<div class="card" style="margin-bottom:12px"><h3>外观</h3><div class="row">
    <label class="field" style="flex:1;min-width:140px">主题<select data-pref="theme"><option value="system" ${!meta.theme || meta.theme === 'system' ? 'selected' : ''}>跟随系统</option><option value="light" ${meta.theme === 'light' ? 'selected' : ''}>浅色</option><option value="dark" ${meta.theme === 'dark' ? 'selected' : ''}>深色</option></select></label>
    <label class="field" style="flex:1;min-width:140px">字号<select data-pref="fontSize"><option value="s" ${meta.fontSize === 's' ? 'selected' : ''}>小</option><option value="m" ${!meta.fontSize || meta.fontSize === 'm' ? 'selected' : ''}>中</option><option value="l" ${meta.fontSize === 'l' ? 'selected' : ''}>大</option></select></label>
  </div></div>`;

  html += `<div class="card" style="margin-bottom:12px"><h3>危险操作</h3><p class="small muted">清空本机进度不会删除云端里的数据，下次同步会再拉回来（清空前会自动放进回收站）。</p>
    <div class="btn-row"><button class="btn danger" data-act="wipe">清空本机进度</button></div></div>`;

  html += `<div class="card"><h3>关于</h3><p class="small muted">TOEIC 720 刷题 v${VERSION} · 题库 ${state.bank.sets.length} 套 ${state.index.questions.size} 题（原创 TOEIC-style 仿真题，非 ETS 官方真题）· 本地存储：${storageAvailable() ? '可用' : '不可用'}${meta.persisted ? ' · 已申请持久化' : ''}</p>
    <p class="small muted">加到手机主屏幕：iPhone 用 Safari 打开 → 分享 → 添加到主屏幕；Android 用 Chrome 打开 → 菜单 → 安装应用。<b>注意</b>：iPhone 上主屏幕图标和 Safari 标签页是两份独立的本地存储，加到主屏幕后请在里面重新粘贴一次 token，进度会从云端拉回来。</p>
    <div class="btn-row"><button class="btn small" data-act="check-update">检查更新并刷新</button></div></div>`;
  $app.innerHTML = html;
  renderSettingsStatus();
  state.settingsMsg = null;
}

async function gistConnect() {
  const token = (document.getElementById('gist-token')?.value || '').trim();
  if (!token) { toast('请先粘贴 token'); return; }
  const meta = getMeta();
  setMeta({ gist: { ...(meta.gist || {}), token } });
  const adapter = makeGistAdapter();
  state.sync.setAdapter(adapter);
  toast('正在验证 token…');
  try {
    const login = await adapter.whoami();
    setMeta({ gist: { ...getMeta().gist, login } });
    const ok = await state.sync.syncNow('connect');
    state.settingsMsg = ok ? { cls: 'ok', text: `已连接 GitHub 账号 ${login}，进度已同步。` } : { cls: 'bad', text: '连接成功但同步失败：' + state.sync.error };
  } catch (e) {
    state.settingsMsg = { cls: 'bad', text: '连接失败：' + (e.message || e) };
  }
  renderSettings();
}

function makeGistAdapter() {
  return new GistSync(
    () => getMeta().gist || {},
    (patch) => setMeta({ gist: { ...(getMeta().gist || {}), ...patch } }),
  );
}

function exportText() {
  return JSON.stringify(exportPayload(state.progress, Date.now(), VERSION), null, 2);
}

function downloadExport() {
  const blob = new Blob([exportText()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `toeic-progress-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function importFromText(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    state.settingsMsg = { cls: 'bad', text: '导入失败：不是合法的 JSON' };
    return renderSettings();
  }
  const before = countProgress(state.progress);
  adopt(importPayload(state.progress, payload));
  const after = countProgress(state.progress);
  save();
  state.settingsMsg = { cls: 'ok', text: `导入完成：新增 ${after.attempts - before.attempts} 条作答、${after.sessions - before.sessions} 次会话、${after.tags - before.tags} 个标签。` };
  renderSettings();
}

// ---------- 事件 ----------

$app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  const act = el.dataset.act;
  switch (act) {
    case 'choose': return runnerChoose(el.dataset.key);
    case 'undo': return runnerUndo();
    case 'toggle-zh': {
      const box = el.closest('.passage');
      const zh = box && box.querySelector('.zh-text');
      if (!zh) return;
      zh.hidden = !zh.hidden;
      el.textContent = zh.hidden ? '显示中文' : '隐藏中文';
      return;
    }
    case 'next': return runnerGoto(state.runner.draft.idx + 1);
    case 'prev': return runnerGoto(state.runner.draft.idx - 1);
    case 'goto': return runnerGoto(Number(el.dataset.i));
    case 'finish': return runnerFinish();
    case 'exit': return runnerExit();
    case 'abandon': return runnerAbandon();
    case 'tag': {
      const qid = el.dataset.qid;
      const cause = el.dataset.cause;
      const cur = tagOf(state.progress, qid);
      setTag(state.progress, qid, cur === cause ? null : cause);
      save();
      for (const b of el.parentElement.querySelectorAll('.cause')) b.classList.toggle('on', b.dataset.cause === cause && cur !== cause);
      return;
    }
    case 'hide-sync-hint': setMeta({ hideSyncHint: true }); return renderHome();
    case 'paper-toggle': {
      const n = Number(el.dataset.n);
      if (state.paper.wrong.has(n)) state.paper.wrong.delete(n); else state.paper.wrong.add(n);
      return renderPaper();
    }
    case 'paper-clear': state.paper.wrong = new Set(); return renderPaper();
    case 'paper-save': return paperSave();
    case 'paper-delete': {
      const s = state.progress.sessions[el.dataset.sid];
      if (!s || !confirm(`删除这条纸面记录（${state.index.sets.get(s.s)?.title || ''} ${s.score}/${s.total}）？`)) return;
      deleteSession(state.progress, s.id);
      save();
      toast('已删除');
      return renderPaper();
    }
    case 'sync-now': {
      if (!state.sync.enabled()) { toast('还没有连接云同步'); return; }
      const ok = await state.sync.syncNow('manual');
      toast(ok ? '同步完成' : (state.sync.state === 'offline' ? '离线，已本地保存' : '同步失败：' + state.sync.error), 4000);
      if (location.hash === '#/' || location.hash === '') renderHome();
      return;
    }
    case 'gist-connect': return gistConnect();
    case 'gist-disconnect': {
      if (!confirm('断开后本机不再同步（云端数据保留）。确定？')) return;
      setMeta({ gist: undefined });
      state.sync.setAdapter(null);
      state.settingsMsg = { cls: 'info', text: '已断开云同步。' };
      return renderSettings();
    }
    case 'export-file': return downloadExport();
    case 'export-copy': {
      try {
        await navigator.clipboard.writeText(exportText());
        toast('已复制到剪贴板');
      } catch {
        state.settingsMsg = { cls: 'bad', text: '浏览器不允许自动复制，请用“下载进度文件”。' };
        renderSettings();
      }
      return;
    }
    case 'import-text': {
      const t = document.getElementById('import-text')?.value.trim();
      if (!t) { toast('先粘贴内容'); return; }
      return importFromText(t);
    }
    case 'restore-backup':
    case 'restore-trash': {
      const b = act === 'restore-backup' ? loadBackup() : loadTrash();
      if (!b) { toast('没有可恢复的内容'); return; }
      adopt(mergeProgress(state.progress, b));
      save();
      state.settingsMsg = { cls: 'ok', text: '已合并恢复。' };
      return renderSettings();
    }
    case 'wipe': {
      if (!confirm('确定清空本机进度？（云端不受影响；清空前会放进回收站）')) return;
      if (!confirm('再确认一次：本机所有作答记录将被清空。建议先导出。')) return;
      wipeLocal();
      state.progress = emptyProgress();
      saveLocal(state.progress, { allowShrink: true });
      state.settingsMsg = { cls: 'info', text: '本机进度已清空。' };
      return renderSettings();
    }
    case 'check-update': {
      toast('正在检查更新…');
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.update();
      } catch { /* ignore */ }
      location.reload();
      return;
    }
    default:
  }
});

$app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.paper) {
    state.paper[el.dataset.paper] = el.value;
    if (el.dataset.paper === 'setId') { state.paper.wrong = new Set(); renderPaper(); }
    return;
  }
  if (el.dataset.pref) {
    setMeta({ [el.dataset.pref]: el.value });
    applyPrefs();
    return;
  }
  if (el.dataset.act === 'import-file' && el.files && el.files[0]) {
    el.files[0].text().then(importFromText);
  }
});

$app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.paper) state.paper[el.dataset.paper] = el.value;
});

$app.addEventListener('toggle', (e) => {
  const el = e.target;
  if (!state.runner) return;
  if (el.dataset.passage) state.runner.passageOpen[el.dataset.passage] = el.open;
  if (el.hasAttribute('data-grid')) state.runner.gridOpen = el.open;
}, true);

document.addEventListener('keydown', (e) => {
  if (!state.runner || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const k = e.key.toUpperCase();
  if (k.length === 1 && 'ABCD'.includes(k)) { runnerChoose(k); e.preventDefault(); }
  else if (k.length === 1 && '1234'.includes(k)) { runnerChoose('ABCD'[Number(k) - 1]); e.preventDefault(); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { runnerGoto(state.runner.draft.idx + 1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { runnerGoto(state.runner.draft.idx - 1); e.preventDefault(); }
  else if (e.key === 'Escape') { runnerExit(); }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (state.runner) { accumulateSpent(state.runner); touchDraft(state.progress, state.runner.draft); saveLocal(state.progress); }
    if (state.sync) state.sync.flush();
  } else {
    if (state.runner) state.runner.shownAt = Date.now();
    if (state.sync && state.sync.enabled()) state.sync.schedule(1500);
  }
});
window.addEventListener('pagehide', () => {
  if (state.runner) { accumulateSpent(state.runner); touchDraft(state.progress, state.runner.draft); saveLocal(state.progress); }
});
window.addEventListener('hashchange', route);
window.addEventListener('online', () => state.sync && state.sync.schedule(1000));
// 别的标签页写了进度：并进来
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  const disk = peekLocal();
  if (!disk || sameProgress(disk, state.progress)) return;
  applyMerged(mergeProgress(state.progress, disk));
});

// ---------- 启动 ----------

async function boot() {
  applyPrefs();
  try {
    state.bank = await loadBank();
  } catch (e) {
    $app.innerHTML = `<div class="notice bad">${esc(e.message || e)}</div>`;
    return;
  }
  const errors = validateBank(state.bank);
  if (errors.length) {
    $app.innerHTML = `<div class="notice bad"><b>题库文件有问题，请把下面内容发给 Claude 修：</b><ul>${errors.slice(0, 50).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    return;
  }
  state.index = indexBank(state.bank);
  const { progress, warning } = loadLocal();
  state.progress = progress;
  if (warning) state.warnings.push(warning);

  state.sync = new SyncManager({
    getLocal: () => state.progress,
    setLocal: applyMerged,
    onStatus: renderSyncStatus,
    meta: { get: getMeta, set: setMeta },
  });
  route();

  // 云同步：优先 Claude Artifact 的 db，其次 Gist
  const artifact = await ArtifactSync.detect();
  if (artifact) { state.isArtifact = true; state.sync.setAdapter(artifact); }
  else if (getMeta().gist?.token) state.sync.setAdapter(makeGistAdapter());
  else state.sync.setAdapter(null);
  if (state.sync.enabled()) state.sync.syncNow('boot');

  requestPersist().then((ok) => { if (ok) setMeta({ persisted: true }); });

  if ('serviceWorker' in navigator && !globalThis.__TOEIC_SINGLE__ && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();

// store.js — 设备本地持久层（localStorage）。
// 保险：读-合并-写（多标签页不互相覆盖）+ 缩水保护 + 每日“上一版”备份 + 坏数据另存 + 重置前留回收站。
import { normalize, emptyProgress, mergeProgress, countProgress } from './core.js';

const KEY = 'tt.progress.v1';
const BACKUP_KEY = 'tt.progress.backup';
const BACKUP_TS_KEY = 'tt.progress.backup.ts';
const TRASH_KEY = 'tt.progress.trash';
const TRASH_TS_KEY = 'tt.progress.trash.ts';
const CORRUPT_PREFIX = 'tt.progress.corrupt.';
const META_KEY = 'tt.meta.v1';
const DAY = 86400000;

let lastWritten = null; // 本标签页最后一次写入主键的原文，用来判断别的标签页有没有写过

export const STORAGE_KEY = KEY;

function ls() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function storageAvailable() {
  const s = ls();
  if (!s) return false;
  try {
    s.setItem('tt.__probe', '1');
    s.removeItem('tt.__probe');
    return true;
  } catch {
    return false;
  }
}

function stashCorrupt(s, raw) {
  try {
    const keys = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(CORRUPT_PREFIX)) keys.push(k);
    }
    keys.sort();
    while (keys.length >= 3) s.removeItem(keys.shift());
    s.setItem(CORRUPT_PREFIX + Date.now(), raw);
  } catch { /* ignore */ }
}

/** 读取本地进度。返回 {progress, warning}；warning 非空时 UI 要提示用户。 */
export function loadLocal() {
  const s = ls();
  if (!s) return { progress: emptyProgress(), warning: '浏览器不允许本地存储，进度只能靠云同步或导出保存' };
  let raw = null;
  try {
    raw = s.getItem(KEY);
  } catch {
    return { progress: emptyProgress(), warning: '读取本地存储失败' };
  }
  if (!raw) return { progress: emptyProgress(), warning: null };
  try {
    const report = {};
    const progress = normalize(JSON.parse(raw), report);
    lastWritten = raw;
    if (report.dropped > 0) {
      stashCorrupt(s, raw);
      return { progress, warning: `本地进度里有 ${report.dropped} 条记录无法识别，已跳过（原文已另存，可让 Claude 排查）` };
    }
    return { progress, warning: null };
  } catch {
    stashCorrupt(s, raw);
    const backup = loadBackup();
    if (backup) return { progress: backup, warning: '本地进度文件损坏，已改用备份' };
    return { progress: emptyProgress(), warning: '本地进度文件损坏且没有备份，已保留原始内容供排查' };
  }
}

/**
 * 写入本地进度。
 * - 如果别的标签页写过（磁盘内容 ≠ 本标签页上次写的），先把磁盘内容并进来再写（并集，绝不丢）
 * - 缩水保护：内存里的记录数不能比磁盘少（并集/导入都不可能变少），少了就并集
 * - 每天首次保存前，把磁盘上的“上一版”存进备份
 * 返回 {ok, error, progress, merged}；merged=true 表示返回的 progress 比传入的多了东西，调用方要采用它。
 */
export function saveLocal(progress, { allowShrink = false } = {}) {
  const s = ls();
  if (!s) return { ok: false, error: '无本地存储', progress, merged: false };
  let diskRaw = null;
  try {
    diskRaw = s.getItem(KEY);
  } catch { /* ignore */ }

  let toWrite = progress;
  if (diskRaw && !allowShrink) {
    try {
      const disk = JSON.parse(diskRaw);
      if (diskRaw !== lastWritten) {
        toWrite = mergeProgress(disk, progress);
      } else {
        const cd = countProgress(normalize(disk));
        const cn = countProgress(progress);
        if (cn.attempts < cd.attempts || cn.sessions < cd.sessions || cn.tags < cd.tags) {
          toWrite = mergeProgress(disk, progress);
        }
      }
    } catch { /* 磁盘内容坏了，就以内存为准 */ }
  }

  const text = JSON.stringify(toWrite);
  try {
    const last = Number(s.getItem(BACKUP_TS_KEY) || 0);
    if (diskRaw && Date.now() - last > DAY) {
      s.setItem(BACKUP_KEY, diskRaw);
      s.setItem(BACKUP_TS_KEY, String(Date.now()));
    }
  } catch { /* 备份失败不影响主流程 */ }
  try {
    s.setItem(KEY, text);
    lastWritten = text;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), progress: toWrite, merged: toWrite !== progress };
  }
  return { ok: true, error: null, progress: toWrite, merged: toWrite !== progress };
}

/** 磁盘上的主键内容是否已经不是本标签页写的（别的标签页动过）。 */
export function diskChangedByOthers() {
  const s = ls();
  if (!s) return false;
  try {
    const raw = s.getItem(KEY);
    return !!raw && raw !== lastWritten;
  } catch {
    return false;
  }
}

/** 直接读磁盘（不改 lastWritten），用于 storage 事件后合并。 */
export function peekLocal() {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function loadBackup() {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(BACKUP_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function backupInfo() {
  const s = ls();
  if (!s) return null;
  try {
    const ts = Number(s.getItem(BACKUP_TS_KEY) || 0);
    return ts && s.getItem(BACKUP_KEY) ? { ts } : null;
  } catch {
    return null;
  }
}

export function trashInfo() {
  const s = ls();
  if (!s) return null;
  try {
    const ts = Number(s.getItem(TRASH_TS_KEY) || 0);
    return ts && s.getItem(TRASH_KEY) ? { ts } : null;
  } catch {
    return null;
  }
}

export function loadTrash() {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(TRASH_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** 设备本地设置（同步凭据、界面偏好、未上传计数）。不参与云同步、不进导出文件。 */
export function getMeta() {
  const s = ls();
  if (!s) return {};
  try {
    return JSON.parse(s.getItem(META_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function setMeta(patch) {
  const s = ls();
  if (!s) return {};
  const next = { ...getMeta(), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  try {
    s.setItem(META_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}

/** 请求浏览器把本站数据标记为“持久”，减少被自动清理的概率（Chrome/Firefox 有效；Safari 只当加分项）。 */
export async function requestPersist() {
  try {
    const nav = globalThis.navigator;
    if (nav && nav.storage && nav.storage.persist) {
      const already = nav.storage.persisted ? await nav.storage.persisted() : false;
      if (already) return true;
      return await nav.storage.persist();
    }
  } catch { /* ignore */ }
  return false;
}

/** 清空本机进度：主键内容先放进回收站（可撤销），再删主键与备份。 */
export function wipeLocal() {
  const s = ls();
  if (!s) return;
  try {
    const raw = s.getItem(KEY);
    if (raw) {
      s.setItem(TRASH_KEY, raw);
      s.setItem(TRASH_TS_KEY, String(Date.now()));
    }
  } catch { /* ignore */ }
  for (const k of [KEY, BACKUP_KEY, BACKUP_TS_KEY]) {
    try { s.removeItem(k); } catch { /* ignore */ }
  }
  lastWritten = null;
}

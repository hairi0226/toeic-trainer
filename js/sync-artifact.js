// sync-artifact.js — 当页面作为 Claude Artifact 发布并声明了 db 能力时，
// 用 Artifact 自带的服务端文档库存进度。
// 分片：作答按月份一个文档（attempts-YYYY-MM），sessions / drafts / tags 各一个文档，
// 每个文档都远小于 256 KiB 上限。
import { emptyProgress, mergeProgress, stableStringify } from './core.js';

const COLLECTION = 'progress';

export class ArtifactSync {
  constructor(db) {
    this.name = 'artifact';
    this.label = 'Claude 云端存储';
    this.db = db;
    this.lastPushed = new Map(); // docId → stableStringify(slice)，避免重复写
  }

  /** 页面在 Claude Artifact 里运行且拿到了 db 才返回实例，否则 null。 */
  static async detect() {
    try {
      const c = globalThis.claude;
      if (!c || typeof c.use !== 'function') return null;
      const db = await c.use('db');
      return db ? new ArtifactSync(db) : null;
    } catch {
      return null;
    }
  }

  configured() {
    return true;
  }

  async pull() {
    const snap = await this.db.collection(COLLECTION).get();
    let merged = emptyProgress();
    let any = false;
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!data) continue;
      any = true;
      this.lastPushed.set(doc.id, stableStringify(slice(data)));
      merged = mergeProgress(merged, data);
    }
    return any ? merged : null;
  }

  async push(progress) {
    const slices = splitProgress(progress);
    const writes = [];
    for (const [docId, data] of slices) {
      const key = stableStringify(data);
      if (this.lastPushed.get(docId) === key) continue;
      writes.push(
        this.db.doc(`${COLLECTION}/${docId}`).set(data).then(() => this.lastPushed.set(docId, key)),
      );
    }
    await Promise.all(writes);
    return { verified: true, written: writes.length };
  }
}

function slice(data) {
  return {
    attempts: data.attempts || {},
    sessions: data.sessions || {},
    drafts: data.drafts || {},
    tags: data.tags || {},
  };
}

const two = (n) => String(n).padStart(2, "0");

/** 按月份分片作答记录；其余各自一片。 */
export function splitProgress(progress) {
  const out = new Map();
  const bucket = (id) => {
    if (!out.has(id)) out.set(id, { attempts: {}, sessions: {}, drafts: {}, tags: {} });
    return out.get(id);
  };
  for (const [id, a] of Object.entries(progress.attempts)) {
    const d = new Date(a.ts);
    bucket(`attempts-${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}`).attempts[id] = a;
  }
  if (Object.keys(progress.sessions).length) bucket('sessions').sessions = { ...progress.sessions };
  if (Object.keys(progress.drafts).length) bucket('drafts').drafts = { ...progress.drafts };
  if (Object.keys(progress.tags).length) bucket('tags').tags = { ...progress.tags };
  return out;
}

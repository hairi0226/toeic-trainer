// sync.js — 同步调度：本地 ↔ 云端的 pull → merge → push，带防抖、互斥、离线静默、未上传计数。
import { mergeProgress, sameProgress } from './core.js';

export class SyncManager {
  /**
   * @param {object} o
   * @param {object|null} o.adapter  实现 {name,label,configured(),pull(),push(p)→{verified}}
   * @param {() => object} o.getLocal
   * @param {(p: object) => void} o.setLocal  合并后写回本地（并刷新界面）
   * @param {(status: object) => void} o.onStatus
   * @param {{get:()=>object,set:(patch:object)=>void}|null} o.meta  持久化 dirty/lastSyncOk
   */
  constructor({ adapter = null, getLocal, setLocal, onStatus = () => {}, meta = null }) {
    this.adapter = adapter;
    this.getLocal = getLocal;
    this.setLocal = setLocal;
    this.onStatus = onStatus;
    this.meta = meta;
    const m = meta ? meta.get() : {};
    this.dirty = Number(m.dirty || 0); // 本地写入次数（自上次确认上传以来）
    this.lastSync = Number(m.lastSyncOk || 0) || null;
    this.state = 'idle'; // idle | syncing | ok | error | offline | off
    this.error = null;
    this.timer = null;
    this.running = null;
    this.pending = false;
  }

  setAdapter(adapter) {
    this.adapter = adapter;
    this.emit(adapter && adapter.configured() ? 'idle' : 'off');
  }

  enabled() {
    return !!(this.adapter && this.adapter.configured());
  }

  status() {
    return {
      state: this.state, error: this.error, lastSync: this.lastSync, dirty: this.dirty,
      adapter: this.adapter ? this.adapter.label : null, enabled: this.enabled(),
    };
  }

  emit(state, error = null) {
    this.state = state;
    this.error = error;
    this.onStatus(this.status());
  }

  persistMeta() {
    if (this.meta) this.meta.set({ dirty: this.dirty, lastSyncOk: this.lastSync || undefined });
  }

  /** 本地有新写入：计数 +1（界面能显示“N 条未上传”）。 */
  markDirty() {
    this.dirty += 1;
    this.persistMeta();
    if (this.running) this.pending = true; // 正在同步时的新写入，结束后补推一轮
    if (this.state === 'ok') this.emit('idle');
    else this.onStatus(this.status());
  }

  /** 作答后调用：几秒后合并推送（多次调用只推一次）。 */
  schedule(delay = 5000) {
    if (!this.enabled()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncNow('auto'), delay);
  }

  /** 页面切后台前调用：立刻推。 */
  flush() {
    if (!this.enabled()) return Promise.resolve(false);
    clearTimeout(this.timer);
    return this.syncNow('flush');
  }

  /** 完整一轮：拉 → 合并 → 需要时推。互斥：进行中则标记 pending，结束后再跑一轮。 */
  async syncNow(reason = 'manual') {
    if (!this.enabled()) {
      this.emit('off');
      return false;
    }
    if (this.running) {
      this.pending = true;
      return this.running;
    }
    this.running = this._run(reason).finally(() => {
      this.running = null;
      if (this.pending) {
        this.pending = false;
        this.syncNow('pending');
      }
    });
    return this.running;
  }

  async _run() {
    this.emit('syncing');
    try {
      const remote = await this.adapter.pull();
      const local = this.getLocal();
      const dirtyBefore = this.dirty;
      const merged = remote ? mergeProgress(local, remote) : local;
      if (!sameProgress(merged, local)) this.setLocal(merged);
      const needPush = !remote || !sameProgress(merged, remote);
      if (needPush) {
        const res = await this.adapter.push(merged);
        if (res && res.verified === false) throw Object.assign(new Error('云端写入未能确认，稍后会重试'), { code: 'verify' });
      }
      this.dirty = Math.max(0, this.dirty - dirtyBefore);
      this.lastSync = Date.now();
      this.persistMeta();
      this.emit('ok');
      return true;
    } catch (e) {
      const offline = (e && e.code === 'network') || (typeof navigator !== 'undefined' && navigator.onLine === false);
      this.emit(offline ? 'offline' : 'error', e && e.message ? e.message : String(e));
      return false;
    }
  }
}

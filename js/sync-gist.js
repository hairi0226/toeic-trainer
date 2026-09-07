// sync-gist.js — 用 GitHub Gist 当个人云盘：一个 secret gist 里放 progress.json。
// 需要一个只带 gist 权限的 Personal Access Token（在设置页粘贴一次）。
// 注意：secret gist 不是私密的——知道 URL 的人都能看，但 URL 不会被列出或搜索到。
import { normalize, mergeProgress } from './core.js';

const API = 'https://api.github.com';
export const GIST_DESC = 'toeic-trainer-progress';
const FILE = 'progress.json';

/** 给用户的一键创建 token 链接：fine-grained，只有 Gists 写权限，不过期。 */
export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=toeic-trainer&description=TOEIC+trainer+progress+sync+(gists+only)&expires_in=none&gists=write';
/** 备用：classic token，只勾 gist。 */
export const TOKEN_URL_CLASSIC = 'https://github.com/settings/tokens/new?scopes=gist&description=toeic-trainer';

export class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // auth | notfound | rate | network | server | parse | verify
  }
}

export class GistSync {
  /**
   * @param {() => {token?: string, gistId?: string}} getConfig
   * @param {(patch: object) => void} setConfig
   */
  constructor(getConfig, setConfig) {
    this.name = 'gist';
    this.label = 'GitHub Gist';
    this.getConfig = getConfig;
    this.setConfig = setConfig;
    this.duplicates = []; // 同名 gist（两台设备同时首次设置产生的）
  }

  configured() {
    return !!(this.getConfig().token);
  }

  async request(method, path, body) {
    const token = (this.getConfig().token || '').trim();
    if (!token) throw new SyncError('auth', '还没有设置 GitHub token');
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new SyncError('network', '网络不通：' + (e && e.message || e));
    }
    if (res.status === 401) throw new SyncError('auth', 'GitHub token 无效或已失效，请到设置页重新生成并粘贴');
    if (res.status === 404) throw new SyncError('notfound', '找不到 gist（可能被删除了）');
    if (res.status === 403 || res.status === 429) {
      const remain = res.headers.get('x-ratelimit-remaining');
      throw new SyncError('rate', remain === '0' ? 'GitHub API 次数用完，稍后再试' : 'GitHub 拒绝了请求（token 权限不够？需要 Gists 写权限）');
    }
    if (!res.ok) throw new SyncError('server', 'GitHub 返回 ' + res.status);
    if (res.status === 204) return null;
    return res.json();
  }

  async whoami() {
    const me = await this.request('GET', '/user');
    return me && me.login;
  }

  /** 在自己的 gist 列表里找 description 匹配的；多个时取 id 字典序最小的做主，其余记为重复。 */
  async findGist() {
    const hits = [];
    for (let page = 1; page <= 5; page++) {
      const list = await this.request('GET', `/gists?per_page=100&page=${page}`);
      if (!Array.isArray(list) || list.length === 0) break;
      for (const g of list) if (g.description === GIST_DESC && g.files && g.files[FILE]) hits.push(g.id);
      if (list.length < 100) break;
    }
    if (!hits.length) return null;
    hits.sort();
    this.setConfig({ gistId: hits[0] });
    this.duplicates = hits.slice(1);
    return hits[0];
  }

  async ensureGistId() {
    const { gistId } = this.getConfig();
    if (gistId) return gistId;
    return this.findGist();
  }

  async readGist(gistId) {
    const gist = await this.request('GET', `/gists/${gistId}`);
    const file = gist.files && gist.files[FILE];
    if (!file) return null;
    let text = file.content;
    if (file.truncated && file.raw_url) {
      let r;
      try {
        r = await fetch(file.raw_url);
      } catch (e) {
        throw new SyncError('network', '下载 gist 原文失败：' + (e && e.message || e));
      }
      if (!r.ok) throw new SyncError('server', '下载 gist 原文失败');
      text = await r.text();
    }
    try {
      return normalize(JSON.parse(text));
    } catch {
      throw new SyncError('parse', '云端进度文件不是合法 JSON');
    }
  }

  /** 拉取云端进度；没有 gist 时返回 null。同名重复 gist 的内容也一并合并进来。 */
  async pull() {
    const gistId = await this.ensureGistId();
    if (!gistId) return null;
    let result;
    try {
      result = await this.readGist(gistId);
    } catch (e) {
      if (e.code === 'notfound') {
        this.setConfig({ gistId: undefined });
        return null;
      }
      throw e;
    }
    for (const dup of this.duplicates) {
      try {
        const extra = await this.readGist(dup);
        if (extra) result = result ? mergeProgress(result, extra) : extra;
        // 合并后把重复的改名，下次不再被找到
        await this.request('PATCH', `/gists/${dup}`, { description: GIST_DESC + '-duplicate' });
      } catch { /* 重复 gist 读不了就算了，不影响主流程 */ }
    }
    this.duplicates = [];
    return result;
  }

  /** 推送进度：有 gist 就 PATCH，没有就新建一个 secret gist。用响应内容验证写入。 */
  async push(progress) {
    const content = JSON.stringify(progress);
    const files = { [FILE]: { content } };
    let gistId = await this.ensureGistId();
    let res = null;
    if (gistId) {
      try {
        res = await this.request('PATCH', `/gists/${gistId}`, { files });
      } catch (e) {
        if (e.code !== 'notfound') throw e;
        this.setConfig({ gistId: undefined });
        gistId = null;
      }
    }
    if (!gistId) {
      res = await this.request('POST', '/gists', { description: GIST_DESC, public: false, files });
      gistId = res.id;
      this.setConfig({ gistId });
    }
    const back = res && res.files && res.files[FILE];
    const verified = !!back && (back.truncated ? Number(back.size) === new TextEncoder().encode(content).length : back.content === content);
    return { gistId, verified };
  }

  gistUrl() {
    const { gistId } = this.getConfig();
    return gistId ? `https://gist.github.com/${gistId}` : null;
  }
}

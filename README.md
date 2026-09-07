# TOEIC 720 刷题

给「TOEIC 720 稳过计划」配套的个人在线题库：手机上刷 Part 5 选择题，电脑上做 Part 6/7 阅读题，进度本地保存并通过云端在设备间同步。纸面练习的成绩也能录进来，错题统一进错题本。

- 网址：`https://hairi0226.github.io/toeic-trainer/`（部署后生效，见下文「部署」）
- 题库：6 套 × 24 题（Day 1–6，对应打印版 PDF），全部是原创 TOEIC-style 仿真题，**不是 ETS 官方真题**
- 零依赖：纯 HTML/CSS/JS，没有构建步骤，改完文件推上去就是新版本

## 手机上怎么用

1. 用手机浏览器打开网址。
2. 加到主屏幕（iPhone：Safari → 分享 → 添加到主屏幕；Android：Chrome → 菜单 → 安装应用），之后像 app 一样打开，断网也能做题。
3. 首次打开先去「设置」连接云同步（见下一节），否则进度只在这台设备上。

> iPhone 注意：主屏幕图标和 Safari 标签页是两份独立的本地存储。加到主屏幕后，在图标里再粘贴一次 token，进度会从云端拉回来。

## 云同步：一次性配置

进度存在你自己 GitHub 账号里的一个私密 Gist（一个小文本文件），免费、不用服务器、不用绑卡。

1. 打开设置页里的「生成 token」链接（已预填：权限只有 Gists 读写、不过期），登录后点页面底部 **Generate token**。
2. 复制 `github_pat_…` 开头的字符串，粘贴到设置页的输入框，点「连接并同步」。
3. 右上角圆点变绿就成功了。每台设备做一次即可。

token 只贴进这个 app，不要发到聊天里、不要写进任何文件。它只能读写你的 Gist，碰不到仓库。

日常状态灯：绿 = 已同步；黄 = 有改动还没传（几秒后自动传）；灰 = 离线，已本地保存；红 = 失败，点开看原因（最常见是 token 失效，重新生成一个粘贴即可）。

## 每天怎么用

- **练习模式**：选完立刻显示对错和解析，误触可在几秒内撤销；错题可以标错因（词汇 / 语法搭配 / 原文定位 / 时间不足）。
- **模考模式**：整套限时 27 分钟（或只考 Part 5 限时 10 分钟），交卷后统一看答案。只计前台时间，切走接电话不扣时。
- **快练**：随机 10 道 Part 5、随机一篇 Part 6 或 Part 7，适合手机上零碎时间。
- **错题本**：以每题最近一次作答为准，做对一次就移出；可以只重做某个 Part。
- **录纸面**：打印版做完后，选套题、点做错的题号、填用时，错题会进错题本，正确率也会算进去。录错了可以删除。
- 做到一半退出没关系：首页「继续上次」一键回来，换设备也能接着做。

## 备份

- 云同步本身就是备份（Gist 还带修订历史）。
- 设置页可以随时「下载进度文件」，是一个 JSON；导入是合并，不会覆盖。
- 本机还有每日自动备份和清空前的回收站，都在设置页。

## 部署（GitHub Pages）

仓库必须是公开的（GitHub 免费账号只有公开仓库能开 Pages；题目是原创内容，进度不在仓库里，公开无妨）。

```bash
gh repo create toeic-trainer --public --source=. --push
gh api -X POST repos/hairi0226/toeic-trainer/pages -f build_type=legacy -f source[branch]=main -f source[path]=/
```

之后每次更新：改文件 → `git commit` → `git push`，一两分钟后网址上就是新版本。仓库页面的 Deployments 能看到绿勾/红叉。

## 本地运行 / 开发

```bash
npm test          # 跑全部测试（node 内置 test runner，无依赖）
npm run serve     # 本地起 http://localhost:8080/
npm run build     # 打包成 dist/single.html（单文件，可发布成 Claude Artifact 或双击离线打开）
```

## 加新题

1. 新建 `data/sets/<id>.json`（照着 `data/sets/day1.json` 的结构），题目 id 必须以 `<id>-` 开头。
2. 在 `data/sets.json` 的 `sets` 数组里追加 `<id>`。
3. `node tools/freeze_qids.mjs` 把新 id 冻结进快照，然后 `npm test`。

规则（详见 `CLAUDE.md`）：题目 id 永不改、永不复用；改了答案或选项要把该题 `rev` +1；下架题目用 `"retired": true` 而不是删除。

## 目录

```
index.html            页面骨架
css/app.css           样式（手机优先，≥900px 阅读题双栏）
js/core.js            纯逻辑：进度模型、合并、统计、题库校验（有测试）
js/store.js           本地存储：读-合并-写、备份、回收站
js/sync.js            同步调度；sync-gist.js = GitHub Gist 适配器；sync-artifact.js = Claude Artifact 适配器
js/app.js             界面与路由
data/sets.json        题库清单；data/sets/*.json 每套一个文件
tests/                node --test；qids.frozen.txt 是题目 id 快照
tools/                转换/打包/本地服务器脚本；source_generators/ 是打印版 PDF 的原始出题脚本
docs/                 进度数据格式说明
```

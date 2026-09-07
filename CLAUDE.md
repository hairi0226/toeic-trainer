# toeic-trainer — 给 Claude 的仓库规则

用户是非程序员（生物医学研究者），这个 app 由 Claude 长期代为维护。改动前先读本文件。

## 不能破的不变量

1. **题目 id 永不改、永不复用、永不删。** `qid = <setId>-q<n>`。要下架一题写 `"retired": true`。`tests/qids.frozen.txt` 是快照，测试会断言每个 id 仍在题库里；新增题后跑 `node tools/freeze_qids.mjs`。
2. **改答案或选项 → 该题 `rev` +1。** 旧作答的 `qrev` 对不上就自动视为"修订前"，不再计入错题本/正确率，但历史记录不删。只改错字、补 `explain`、改文章措辞不动 `rev`。
3. **进度记录只增不删。** 删除 = 墓碑（`attempt.del`、`session.deleted`、`tag.cause=null`）+ 更新时间戳。`mergeProgress` 是按 id 并集、同 id 取时间戳大的；这是跨设备不丢数据的根基，不要改成"以某一边为准"。
4. **进度 schema 只加字段不改字段名。** `normalize()` 保留未知字段。必须改名时同时读旧名和新名。
5. **运行时零依赖。** `index.html` 加载的一切不许引入 `<script src=外部>` 或 npm dependencies。图表用 CSS 条，不用图表库。开发工具可用 `npx 包@具体版本`。
6. **所有塞进 `innerHTML` 的动态文本都过 `esc()`。** 题干、文章、用户备注都是自由文本。

## 题库

- 真源：`data/sets.json`（清单，顺序 = 首页顺序）+ `data/sets/<id>.json`（每套一个文件）。
- `tools/convert_questions.py` 只是从打印版 PDF 的出题脚本一次性迁移 Day 1–6 用的，默认不覆盖已存在的文件。**不要为了加新题去跑它。**
- 新增一套：新建 `data/sets/<id>.json` + 清单加一行 + `node tools/freeze_qids.mjs` + `npm test`。
- 必需字段见 `core.js` 的 `validateBank()`；`focus / listening / phrases / reviews / source_pdf / recommended_minutes` 都可选。Part 6 的题 `kind` 必须是 `blank` 或 `sentence`，文章里必须有 `[n]` 空格标记。
- 最小可用的 set 模板：

```json
{
  "id": "p5-extra1", "title": "Part 5 专项 1", "focus": "介词与连词",
  "groups": [
    { "id": "p5-extra1-p5", "part": 5, "title": "Part 5 | Incomplete Sentences 句子填空", "minutes": 10, "passages": [],
      "questions": [
        { "id": "p5-extra1-q1", "n": 1, "part": 5, "kind": "question", "bonus": false, "rev": 0,
          "stem": "The report is due ___ Friday.", "options": [{"key":"A","text":"by"},{"key":"B","text":"until"},{"key":"C","text":"among"},{"key":"D","text":"during"}],
          "answer": "A", "explain": "by + 时间点 = 最迟不晚于。" }
      ] },
    { "id": "p5-extra1-p6", "part": 6, "title": "Part 6 | Text Completion 短文填空", "minutes": 7,
      "passages": [{ "title": "Notice", "text": "Please submit forms [2] Friday." }],
      "questions": [
        { "id": "p5-extra1-q2", "n": 2, "part": 6, "kind": "blank", "bonus": false, "rev": 0, "stem": "",
          "options": [{"key":"A","text":"by"},{"key":"B","text":"until"},{"key":"C","text":"among"},{"key":"D","text":"during"}], "answer": "A", "explain": "" }
      ] }
  ]
}
```

## 发布流程

1. `npm test` 全绿。
2. 改 `js/version.js` 的日期（设置页会显示）。
3. `git commit` → `git push`，GitHub Pages 自动部署。Service worker 是网络优先 + `cache:'no-cache'`，用户刷新即拿到新版本；设置页有「检查更新并刷新」。
4. 单文件版：`npm run build` → `dist/single.html`（不进 git）。

## 文件职责

- `js/core.js` 纯逻辑，任何新统计/写操作先加在这里并补测试；UI 层不要自己算。
- `js/store.js` 本地层：`saveLocal` 会读-合并-写（多标签页安全）并有缩水保护，返回值 `merged=true` 时调用方要采用返回的对象（`adopt()`）。
- `js/sync.js` 调度；适配器接口 `{name,label,configured(),pull()→progress|null,push(p)→{verified}}`。
- `js/app.js` 路由 `#/`、`#/run/:sid`、`#/result/:sid`、`#/review`、`#/paper`、`#/settings`、`#/set/:id`、`#/start/<kind>/<setId>/<scope>`。事件用 `data-act` 委托。

## 已知取舍

- GitHub Pages 是主部署路径；Claude Artifact（`dist/single.html` + db 能力）是备用/试用入口，两边进度不互通（一个用 Gist、一个用 Artifact db），不要同时宣传。
- secret gist 不是私密的（知道 URL 的人能看），设置页已说明；进度里没有个人信息。
- 43 题（见 `tools/convert_questions.py` 输出）原打印版没有单题解析，app 回退显示本套关键解析；补解析属文本修订，不动 `rev`。

## 用户偏好

- 中文交流，术语第一次出现用大白话解释，句尾加「喵」。
- 明确区分原创仿真题与 ETS 官方真题。
- 沟通里不要出现 token 值。

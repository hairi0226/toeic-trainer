// 把整个 app 打成一个 dist/single.html（题库、样式、脚本全部内联）。
// 用途：发布成 Claude Artifact，或直接双击离线打开（file:// 下无云同步）。
// 用法：node tools/build_single.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// 模块顺序：被依赖的在前。打包时去掉 import/export，拼进一个 <script type="module">。
const MODULES = ['js/version.js', 'js/core.js', 'js/store.js', 'js/bank.js', 'js/sync-gist.js', 'js/sync-artifact.js', 'js/sync.js', 'js/app.js'];

function stripModuleSyntax(src, name) {
  return src
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(const|let|var|function|class|async function)\s/gm, '$1 ')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, '')
    + `\n/* end of ${name} */\n`;
}

function topLevelNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^(?:export\s+)?(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

const html = await read('index.html');
const css = await read('css/app.css');
const manifest = JSON.parse(await read('data/sets.json'));
const sets = [];
for (const id of manifest.sets) sets.push(JSON.parse(await read(`data/sets/${id}.json`)));
const bank = JSON.stringify({ schema_version: manifest.schema_version || 1, note: manifest.note || '', sets });

const seen = new Map();
let js = '';
for (const m of MODULES) {
  const src = await read(m);
  for (const n of topLevelNames(src)) {
    if (seen.has(n)) throw new Error(`顶层名字冲突：${n} 同时在 ${seen.get(n)} 和 ${m}`);
    seen.set(n, m);
  }
  js += stripModuleSyntax(src, m);
}
if (/^\s*import\s/m.test(js)) throw new Error('还有没剥掉的 import');
if (/^\s*export\s/m.test(js)) throw new Error('还有没剥掉的 export');

let out = html
  .replace(/<link rel="manifest"[^>]*>\s*/g, '')
  .replace(/<link rel="stylesheet" href="\.\/css\/app\.css">/, `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="\.\/js\/app\.js"><\/script>/,
    `<script>window.__TOEIC_SINGLE__=true;window.__TOEIC_BANK__=${bank};</script>\n<script type="module">\n${js}\n</script>`);

// 图标改成内联 data URI，避免相对路径失效
for (const icon of ['icons/icon-192.png', 'icons/apple-touch-icon.png']) {
  const b64 = (await readFile(new URL(icon, root))).toString('base64');
  out = out.replace(`./${icon}`, `data:image/png;base64,${b64}`);
}

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/single.html', root), out);
console.log(`wrote dist/single.html (${(out.length / 1024).toFixed(0)} KB, ${sets.length} sets)`);

// Claude Artifact 版：发布时会被套上 html/head/body 外壳，所以只留 title + style + body 内容
const title = out.match(/<title>[\s\S]*?<\/title>/)[0];
const style = out.match(/<style>[\s\S]*?<\/style>/)[0];
const bodyInner = out.match(/<body>([\s\S]*)<\/body>/)[1].trim();
const artifact = `${title}
${style}
${bodyInner}
`;
await writeFile(new URL('dist/artifact.html', root), artifact);
console.log(`wrote dist/artifact.html (${(artifact.length / 1024).toFixed(0)} KB)`);

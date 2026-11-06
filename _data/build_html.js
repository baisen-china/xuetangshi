const fs = require("fs");
const HTML = "C:/c/inventory/christmas_tree_fixed.html";
const BOOK = "C:/c/inventory/唐诗.txt";
const D = "C:/c/inventory/_data/";

// --rebuild：从原始备份重新注入全部片段（改过 new_*.* 后用这个）
// 默认：已改造时只刷新内嵌诗库数据
const REBUILD = process.argv.indexOf("--rebuild") >= 0;
const BAK = D + "christmas_tree_fixed.bak.html";
let html = REBUILD && fs.existsSync(BAK)
  ? fs.readFileSync(BAK, "utf8")
  : fs.readFileSync(HTML, "utf8");
const bookText = fs.readFileSync(BOOK, "utf8");

if (/<\/script/i.test(bookText)) {
  throw new Error("诗库文本含 </script>，无法安全内联");
}

function replaceRange(src, startMark, endMark, replacement, label) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error("未找到起始标记: " + label);
  const b = src.indexOf(endMark, a + startMark.length);
  if (b < 0) throw new Error("未找到结束标记: " + label);
  return src.slice(0, a) + replacement + src.slice(b);
}

// 幂等：已改造过则只刷新内嵌诗库数据，方便以后改 唐诗.txt 后重跑
if (!REBUILD && html.indexOf('id="poem-stage"') >= 0) {
  const re = /(<script id="poem-data" type="text\/plain">)[\s\S]*?(<\/script>)/;
  if (!re.test(html)) throw new Error("未找到内嵌诗库节点");
  html = html.replace(re, (m, a, b) => a + "\n" + bookText + "    " + b);
  fs.writeFileSync(HTML, html, "utf8");
  console.log("已刷新内嵌诗库数据，共", (bookText.match(/^=====/gm) || []).length, "首");
  process.exit(0);
}

const newStyle = fs.readFileSync(D + "new_style.css", "utf8");
const pinyinLib = fs.readFileSync(D + "pinyin-pro.js", "utf8");
const pinyinFixes = fs.readFileSync(D + "pinyin_fixes_final.json", "utf8");
if (/<\/script|<!--/i.test(pinyinLib)) throw new Error("拼音库含脚本闭合标记，无法安全内联");
if (/<\/script|<!--/i.test(pinyinFixes)) throw new Error("补丁数据含脚本闭合标记，无法安全内联");
const newDom = fs.readFileSync(D + "new_dom.html", "utf8")
  .replace("__PINYIN_LIB__", pinyinLib)
  .replace("__PINYIN_FIXES__", pinyinFixes)
  .replace("__POEM_DATA__", bookText);
const newScript = fs.readFileSync(D + "new_script.js", "utf8");

// 1) 样式：替换旧的飘落动画 + 旧载入控件样式
html = replaceRange(
  html,
  "      /* 一句一句从屏幕最顶端飘落至三分之一高度，并淡化消失 */",
  "    </style>",
  newStyle,
  "CSS"
);

// 2) DOM：整首卡片 + 控制面板 + 内嵌诗库
html = replaceRange(
  html,
  '    <div id="labels"></div>',
  '    <script id="rendered-js">',
  newDom,
  "DOM"
);

// 3) 主逻辑：替换旧的逐句飘落逻辑
html = replaceRange(
  html,
  "      /* ===== 飘落文字：诗句来自同目录「唐诗.txt」，一行一句 =====",
  "      /* ===== 离线增强：程序化贴图 + 模拟频谱（不依赖任何外链资源）===== */",
  newScript,
  "SCRIPT"
);

// 4) 启动：init() 之后启动诵读器（自动 fetch 已并入 initPoemReciter）
html = replaceRange(
  html,
  "      // 自动读取同目录的 唐诗.txt",
  "      function init() {",
  "      initPoemReciter();\n\n",
  "BOOT"
);

// 5) 移除 init() 内残留的逐句定时器
const oldInterval = /        showNextLabel\(\);\r?\n        \/\/ 一句飘落消失后，稍作停顿再放下一句\r?\n        setInterval\(showNextLabel, LABEL_MS \+ 500\);\r?\n/;
if (!oldInterval.test(html)) throw new Error("未找到 init 内残留的飘落定时器");
html = html.replace(oldInterval, "");

// 残留检查
["my_labels", "showNextLabel", "setPoemLines", "LABEL_MS", "poem-loader", "falling"].forEach((k) => {
  if (html.indexOf(k) >= 0) console.log("注意：仍存在旧标识符 ->", k);
});

fs.writeFileSync(HTML, html, "utf8");
console.log("改造完成，HTML 字节:", Buffer.byteLength(html, "utf8"));
console.log("内嵌诗库首数:", (bookText.match(/^=====/gm) || []).length);

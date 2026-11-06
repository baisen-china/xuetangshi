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

// 打赏二维码：优先读本地 jpg → base64 内嵌，页面不再引用外部图片文件。
// 仓库里不含原图；若他人 clone 后本地没有 jpg，就从已改造页面里取回内嵌数据，
// 保证重新构建时不会把打赏码弄丢。
const QR_FILE = "C:/c/inventory/打赏码1.jpg";
let qrB64;
if (fs.existsSync(QR_FILE)) {
  const buf = fs.readFileSync(QR_FILE);
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("打赏码不是 JPEG");
  qrB64 = buf.toString("base64");
} else {
  const m = html.match(/<script id="tip-qr-data" type="text\/plain">([\s\S]*?)<\/script>/);
  if (!m || !m[1].trim()) throw new Error("找不到 打赏码1.jpg，也无法从现有页面提取内嵌二维码");
  qrB64 = m[1].trim();
}
if (/<\/script|<!--/i.test(qrB64)) throw new Error("二维码数据含脚本闭合标记");
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const qrHash = fnv1a(qrB64);

const newDom = fs.readFileSync(D + "new_dom.html", "utf8")
  .replace("__PINYIN_LIB__", () => pinyinLib)
  .replace("__PINYIN_FIXES__", () => pinyinFixes)
  .replace("__TIP_QR_B64__", () => qrB64)
  .replace("__TIP_QR_HASH__", () => qrHash)
  .replace("__POEM_DATA__", () => bookText);
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

// 6) 给 3D 圣诞树的点精灵注入共享亮度 uniform，供「树灯亮/熄」开关使用
if (html.indexOf("uniform float uTreeLight;") < 0) {
  const t0 = html.indexOf("function addTree(scene, uniforms, totalPoints, treePosition)");
  const t1 = html.indexOf("function addSnow(scene, uniforms)", t0 + 1);
  if (t0 < 0 || t1 < 0) throw new Error("未找到 addTree 区段");
  let seg = html.slice(t0, t1);
  const fragRe = /(uniform sampler2D pointTexture;)(\s*void main\(\)\s*\{\s*gl_FragColor = vec4\( vColor, opacity \);)/;
  if (!fragRe.test(seg)) throw new Error("未找到 addTree 片元着色器");
  seg = seg.replace(fragRe, function (m, a, b) {
    return a + "\n      uniform float uTreeLight;" +
      b.replace("vec4( vColor, opacity )", "vec4( vColor * uTreeLight, opacity )");
  });
  const uniRe = /(uniforms: \{\s*\.\.\.uniforms,)/;
  if (!uniRe.test(seg)) throw new Error("未找到 addTree uniforms");
  seg = seg.replace(uniRe,
    '$1\n            uTreeLight: window.__treeLight || (window.__treeLight = { type: "f", value: 1.0 }),');
  html = html.slice(0, t0) + seg + html.slice(t1);
}

// 残留检查
["my_labels", "showNextLabel", "setPoemLines", "LABEL_MS", "poem-loader", "falling"].forEach((k) => {
  if (html.indexOf(k) >= 0) console.log("注意：仍存在旧标识符 ->", k);
});

fs.writeFileSync(HTML, html, "utf8");
console.log("改造完成，HTML 字节:", Buffer.byteLength(html, "utf8"));
console.log("内嵌诗库首数:", (bookText.match(/^=====/gm) || []).length);
console.log("内嵌打赏码: base64", qrB64.length, "字符 | 指纹", qrHash);

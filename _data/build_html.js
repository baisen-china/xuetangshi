const fs = require("fs");
const HTML = "C:/c/inventory/christmas_tree_fixed.html";
const D = "C:/c/inventory/_data/";

// 五个离线诗库（双击打开 / 离线运行都可用，全部内联，不依赖任何外部文件）
const BOOK_FILES = [
  { id: "tang",     name: "唐诗",       file: "唐诗.txt" },
  { id: "song",     name: "宋词",       file: "宋词.txt" },
  { id: "mingqing", name: "元明清诗词", file: "元明清诗词.txt" },
  { id: "jindai",   name: "近代诗词",   file: "近代诗词.txt" },
  { id: "mao",      name: "毛主席诗词", file: "毛主席诗词.txt" },
];
function readBook(file) {
  const t = fs.readFileSync("C:/c/inventory/" + file, "utf8");
  if (/<\/script/i.test(t)) throw new Error(file + " 含 </script>，无法安全内联");
  return t;
}
// 用分类标记把五库拼成一个 bundle，内联到单个 #poem-data 文本节点
const bookBundle = BOOK_FILES.map(function (b) {
  return "##### 分类：" + b.name + " #####\n" + readBook(b.file);
}).join("\n");

// --rebuild：从原始备份重新注入全部片段（改过 new_*.* 后用这个）
// 默认：已改造时只刷新内嵌诗库数据
const REBUILD = process.argv.indexOf("--rebuild") >= 0;
const BAK = D + "christmas_tree_fixed.bak.html";
let html = REBUILD && fs.existsSync(BAK)
  ? fs.readFileSync(BAK, "utf8")
  : fs.readFileSync(HTML, "utf8");

if (/<\/script/i.test(bookBundle)) {
  throw new Error("诗库 bundle 含 </script>，无法安全内联");
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
  html = html.replace(re, (m, a, b) => a + "\n" + bookBundle + "    " + b);
  fs.writeFileSync(HTML, html, "utf8");
  console.log("已刷新内嵌诗库数据，共", (bookBundle.match(/^=====/gm) || []).length, "首");
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
  .replace("__POEM_DATA__", () => bookBundle);
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

// 6) 只让「一闪一闪的红灯」受开关控制，固定彩灯恒亮
//    树点颜色是一条 HSL 彩虹带（色相从 1.0 递减到 0.0），色环首尾 h≈1/0 就是红点，
//    这些红点随音频脉动忽大忽小，视觉上就是一闪一闪的红灯；其余青/绿/黄等是常亮彩灯。
//    做法：给每个点加 isRed 属性（红灯=1，彩灯=0），片元着色器用
//    mix( 1.0, uTreeLight, vIsRed ) —— 彩灯永远乘 1.0，只有红点乘开关亮度。
//    关灯时红点变黑（加色混合下等于熄灭），彩灯完全不变；也不再联动压暗背景。
if (html.indexOf("attribute float isRed;") < 0) {
  const t0 = html.indexOf("function addTree(scene, uniforms, totalPoints, treePosition)");
  const t1 = html.indexOf("function addSnow(scene, uniforms)", t0 + 1);
  if (t0 < 0 || t1 < 0) throw new Error("未找到 addTree 区段");
  let seg = html.slice(t0, t1);

  // (a) 顶点着色器：声明 isRed 属性，把标记传给片元着色器
  const vsDecl = /(attribute float mIndex;)(\s*)(varying vec3 vColor;\s*varying float opacity;)/;
  if (!vsDecl.test(seg)) throw new Error("未找到 addTree 顶点着色器声明");
  seg = seg.replace(vsDecl, (m, a, ws, b) =>
    a + ws + "attribute float isRed;" + ws + b + ws + "varying float vIsRed;");
  const vsMain = /(void main\(\)\s*\{\s*)(vColor = color;)/;
  if (!vsMain.test(seg)) throw new Error("未找到 addTree 顶点 main");
  seg = seg.replace(vsMain, "$1vIsRed = isRed;\n       $2");

  // (b) 片元着色器：彩灯恒亮，只有红点受开关控制
  const fragRe = /(uniform sampler2D pointTexture;)(\s*void main\(\)\s*\{\s*)gl_FragColor = vec4\( vColor, opacity \);/;
  if (!fragRe.test(seg)) throw new Error("未找到 addTree 片元着色器");
  seg = seg.replace(fragRe, (m, a, b) =>
    a + "\n      uniform float uTreeLight;\n      varying float vIsRed;" + b +
    "gl_FragColor = vec4( vColor * mix( 1.0, uTreeLight, vIsRed ), opacity );");
  const uniRe = /(uniforms: \{\s*\.\.\.uniforms,)/;
  if (!uniRe.test(seg)) throw new Error("未找到 addTree uniforms");
  seg = seg.replace(uniRe,
    '$1\n            uTreeLight: window.__treeLight || (window.__treeLight = { type: "f", value: 1.0 }),');

  // (c) 生成点数据：按色相标记红点（色环首尾各 10%）
  const arrRe = /(const mIndexs = \[\];)/;
  if (!arrRe.test(seg)) throw new Error("未找到 addTree 数组声明");
  seg = seg.replace(arrRe, "$1\n        const isReds = [];");
  const hslRe = /color\.setHSL\(map\(i, 0, totalPoints, 1\.0, 0\.0\), 1\.0, 0\.5\);/;
  if (!hslRe.test(seg)) throw new Error("未找到 addTree 色相赋值");
  seg = seg.replace(hslRe,
    "const hue = map(i, 0, totalPoints, 1.0, 0.0);\n" +
    "          color.setHSL(hue, 1.0, 0.5);\n" +
    "          isReds.push(hue >= 0.90 || hue <= 0.10 ? 1.0 : 0.0);");

  // (d) 把 isRed 写进几何体属性
  const attrRe = /(geometry\.setAttribute\(\s*"color",\s*new THREE\.Float32BufferAttribute\(colors, 3\)\s*\);)/;
  if (!attrRe.test(seg)) throw new Error("未找到 addTree color 属性");
  seg = seg.replace(attrRe,
    '$1\n        geometry.setAttribute(\n          "isRed",\n          new THREE.Float32BufferAttribute(isReds, 1)\n        );');

  html = html.slice(0, t0) + seg + html.slice(t1);
}

// 残留检查
["my_labels", "showNextLabel", "setPoemLines", "LABEL_MS", "poem-loader", "falling"].forEach((k) => {
  if (html.indexOf(k) >= 0) console.log("注意：仍存在旧标识符 ->", k);
});

fs.writeFileSync(HTML, html, "utf8");
console.log("改造完成，HTML 字节:", Buffer.byteLength(html, "utf8"));
console.log("内嵌诗库首数:", (bookBundle.match(/^=====/gm) || []).length);
console.log("内嵌打赏码: base64", qrB64.length, "字符 | 指纹", qrHash);

/* 交付前静态复验：内联内容完整性、脚本语法、控件与样式齐备、无残留占位符 */
const fs = require("fs");
const vm = require("vm");
const D = "C:/c/inventory/_data/";
const HTML = "C:/c/inventory/christmas_tree_fixed.html";
const h = fs.readFileSync(HTML, "utf8");
const lib = fs.readFileSync(D + "pinyin-pro.js", "utf8");
const fixes = fs.readFileSync(D + "pinyin_fixes_final.json", "utf8");
const book = fs.readFileSync("C:/c/inventory/唐诗.txt", "utf8");
const script = fs.readFileSync(D + "new_script.js", "utf8");
const css = fs.readFileSync(D + "new_style.css", "utf8");

let bad = 0;
const chk = (name, ok, extra) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (extra !== undefined ? "  " + extra : ""));
  if (!ok) bad++;
};

const grab = (re) => { const m = h.match(re); return m ? m[1] : null; };
const F = grab(/<script id="poem-pinyin-fixes" type="application\/json">([\s\S]*?)<\/script>/);
// 从补丁节点往前找最近的裸 <script>，避免误抓文档里更早的脚本
const fixPos = h.indexOf('<script id="poem-pinyin-fixes"');
const libStart = h.lastIndexOf("<script>", fixPos) + "<script>".length;
const libEnd = h.indexOf("</script>", libStart);
const L = h.slice(libStart, libEnd);
const P = grab(/<script id="poem-data" type="text\/plain">([\s\S]*?)<\/script>/);
const M = grab(/<script id="rendered-js">([\s\S]*?)<\/script>/);
const C = grab(/      \/\* ===== 唐诗整首展示 ===== \*\/([\s\S]*?)<\/style>/);

console.log("=== 内联内容完整性 ===");
chk("拼音引擎内联且逐字未被替换符破坏", L === lib, L ? L.length + " 字符" : "缺失");
chk("古音补丁数据完整", F === fixes, F ? JSON.parse(F).length + " 条" : "缺失");
chk("诗库数据完整", P === "\n" + book + "    ", P ? (P.match(/^=====/gm) || []).length + " 首" : "缺失");
chk("主脚本注入完整", M !== null && M.indexOf(script) >= 0, M ? M.length + " 字符" : "缺失");
chk("样式注入完整", C !== null && h.indexOf(css) >= 0);

console.log("\n=== 语法 ===");
try { new vm.Script(M); chk("主脚本语法通过", true); } catch (e) { chk("主脚本语法通过", false, e.message); }
try { new vm.Script(L); chk("拼音引擎语法通过", true); } catch (e) { chk("拼音引擎语法通过", false, e.message); }
try { const f = JSON.parse(F); chk("补丁 JSON 可解析且结构正确", f.every(r => typeof r[0] === "string" && typeof r[1] === "number" && typeof r[2] === "string"), f.length + " 条"); }
catch (e) { chk("补丁 JSON 可解析", false, e.message); }

console.log("\n=== 拼音引擎在浏览器全局下可用 ===");
try {
  const ctx = vm.createContext({});          // globalThis 指向该上下文，等价浏览器 window
  vm.runInContext(lib, ctx);
  const pp = vm.runInContext("globalThis.pinyinPro", ctx);
  chk("pinyinPro 挂载到全局", !!(pp && typeof pp.pinyin === "function"));
  chk("逐字注音可用", pp && pp.pinyin("床前明月光", { type: "array", toneType: "symbol" }).join(" ") === "chuáng qián míng yuè guāng");
} catch (e) { chk("pinyinPro 挂载到全局", false, e.message); }

console.log("\n=== DOM / 控件 / 样式 ===");
const ids = ["poem-stage", "poem-card", "poem-title", "poem-meta", "poem-body", "poem-count",
  "poem-panel", "poem-play", "poem-prev", "poem-next", "poem-repeat", "poem-pinyin",
  "poem-resume", "poem-voice", "poem-pick", "poem-file", "poem-status",
  "poem-pinyin-fixes", "poem-data"];
ids.forEach((id) => chk('id="' + id + '" 唯一', (h.match(new RegExp('id="' + id + '"', "g")) || []).length === 1));
chk("重复次数默认选中 1 遍", /<option value="1" selected>/.test(h));
chk("拼音开关默认勾选", /id="poem-pinyin" checked/.test(h));
chk("拼音伪元素样式存在", /\.py\[data-py\]::before/.test(h));
chk("无未替换占位符", !/__PINYIN_LIB__|__PINYIN_FIXES__|__POEM_DATA__/.test(h));
chk("无旧飘落逻辑残留", !/my_labels|showNextLabel|LABEL_MS|setPoemLines/.test(h));
chk("硬编码 2 遍已移除", !/round >= 2|\/2 遍/.test(M));

console.log("\n=== 结论 ===");
console.log(bad === 0 ? "全部通过" : bad + " 项失败");
process.exitCode = bad === 0 ? 0 : 1;

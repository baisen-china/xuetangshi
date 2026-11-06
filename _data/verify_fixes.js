/* 校验点补丁表：下标字符是否匹配、拼音是否合法、在诗库中命中次数、是否真的改变了默认读音 */
const fs = require("fs");
const pp = require("./pinyin-pro.js");
const rules = require("./pinyin_fixes.js");
const D = "C:/c/inventory/_data/";

const book = fs.readFileSync("C:/c/inventory/唐诗.txt", "utf8");
const corpus = book.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join("\n");
const arr = (s) => pp.pinyin(s, { type: "array", toneType: "symbol" });
const PY_RE = /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹ]+$/i;

const errors = [], stats = { inBook: 0, changes: 0, noop: 0, extra: 0 };
const details = [];
for (const [phrase, idx, ch, py] of rules) {
  const cs = Array.from(phrase);
  if (cs[idx] !== ch) { errors.push(phrase + ": 下标 " + idx + " 是「" + cs[idx] + "」，不是「" + ch + "」"); continue; }
  if (!PY_RE.test(py)) { errors.push(phrase + ": 非法拼音 " + py); continue; }
  const hits = corpus.split(phrase).length - 1;
  if (hits > 0) stats.inBook++; else stats.extra++;
  const before = arr(phrase)[idx];
  if (before !== py) { stats.changes++; details.push(phrase + "  「" + ch + "」" + before + " → " + py + (hits ? "  [命中" + hits + "次]" : "  [备用]")); }
  else stats.noop++;
}

console.log("=== 多音字点补丁校验 ===");
console.log("规则总数:", rules.length, "| 格式错误:", errors.length);
errors.forEach((e) => console.log("  ✗", e));
console.log("诗库中命中:", stats.inBook, "| 备用(供外部 txt):", stats.extra);
console.log("实际改变默认读音:", stats.changes, "| 默认已正确(保留以稳定上下文):", stats.noop);
console.log("\n=== 生效补丁 ===");
details.forEach((d) => console.log("  " + d));

const compact = rules.map(([phrase, idx, ch, py]) => [phrase, idx, py]);
fs.writeFileSync(D + "pinyin_fixes_final.json", JSON.stringify(compact), "utf8");
console.log("\n已写出 pinyin_fixes_final.json (", compact.length, "条,", fs.statSync(D + "pinyin_fixes_final.json").size, "字节 )");
if (errors.length) process.exitCode = 1;

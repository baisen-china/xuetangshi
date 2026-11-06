const fs = require("fs");
const D = "C:/c/inventory/_data/";
const OUT = "C:/c/inventory/唐诗.txt";
const load = (f) => JSON.parse(fs.readFileSync(D + f, "utf8"));

function flatLines(p) {
  const x = p.content || p.contents;
  const arr = Array.isArray(x) ? x : String(x || "").split(/\r?\n/);
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

const sources = [
  ["唐诗三百首", "base300.json"],
  ["名篇选本", "yonggie_data1.json"],
  ["三百首别本", "yonggie_data2.json"],
];

const seenBody = new Set();
const poems = [];
const stats = [];

for (const [name, file] of sources) {
  let add = 0;
  let drop = 0;
  let dup = 0;
  for (const p of load(file)) {
    const title = String(p.title || "").replace(/\s+/g, " ").trim();
    const author = String(p.author || "").replace(/\s+/g, " ").trim();
    const lines = flatLines(p);
    const text = lines.join("");
    if (!title || !author || lines.length < 2) { drop++; continue; }
    if (/[□■\uFFFD]/.test(text)) { drop++; continue; }
    if (lines.some((l) => l.length > 30)) { drop++; continue; }
    // 按正文（仅保留汉字）去重，消除同诗异名 / 版本重复
    const key = text.replace(/[^\u4e00-\u9fa5]/g, "");
    if (key.length < 8) { drop++; continue; }
    if (seenBody.has(key)) { dup++; continue; }
    seenBody.add(key);
    poems.push({ title: title, dynasty: "唐", author: author, lines: lines, src: name });
    add++;
  }
  stats.push(`${name}: 新增 ${add}，同诗重复 ${dup}，无效剔除 ${drop}`);
}

// 用户要求 300-500 首：按来源优先级（三百首 > 名篇选本 > 别本）保留 480 首
const LIMIT = 480;
const kept = poems.slice(0, LIMIT);

const header = [
  "# 唐诗诵读库 —— 整首显示，诵读两遍后切换下一首，全库循环播放",
  `# 共 ${kept.length} 首；来源：《唐诗三百首》及公开简体唐诗选本（已去重、剔除缺字）`,
  "#",
  "# 格式：每首诗以 ===== 开头，字段为 诗名 / 朝代 / 作者 / 正文",
  "# 正文一行一句；空行和 # 开头的注释行会被忽略；改完保存即可生效",
  "#",
  "",
];

const blocks = kept.map((p, i) => [
  `===== ${i + 1} =====`,
  `诗名：${p.title}`,
  `朝代：${p.dynasty}`,
  `作者：${p.author}`,
  "正文：",
  ...p.lines,
  "",
].join("\n"));

fs.writeFileSync(OUT, header.concat(blocks).join("\n"), "utf8");

console.log(stats.join("\n"));
console.log("最终首数:", kept.length);
console.log("文件字节:", fs.statSync(OUT).size);
const bySrc = {};
kept.forEach((p) => { bySrc[p.src] = (bySrc[p.src] || 0) + 1; });
console.log("来源分布:", JSON.stringify(bySrc));
console.log("含繁体特征字样本:", kept.filter((p) => /[詩宮歸雲風萬與]/.test(p.lines.join(""))).length);
console.log("首首示例:\n" + blocks[0].slice(0, 260));
console.log("末首示例:\n" + blocks[blocks.length - 1].slice(0, 260));
fs.writeFileSync(D + "poems_final.json", JSON.stringify(kept, null, 1), "utf8");

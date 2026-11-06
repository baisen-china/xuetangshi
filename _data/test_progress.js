/* 逐字诵读进度专项测试：可控时钟 + 虚拟 DOM + 模拟语音 */
const fs = require("fs");
const vm = require("vm");
const D = "C:/c/inventory/_data/";
const code = fs.readFileSync(D + "new_script.js", "utf8");
const BOOK_FILES = ["唐诗.txt", "宋词.txt", "元明清诗词.txt", "近代诗词.txt", "毛主席诗词.txt"];
const CAT_NAMES = ["唐诗", "宋词", "元明清诗词", "近代诗词", "毛主席诗词"];
const bundle = BOOK_FILES.map(function (f, i) {
  return "##### 分类：" + CAT_NAMES[i] + " #####\n" + fs.readFileSync("C:/c/inventory/" + f, "utf8");
}).join("\n");
const fixesText = fs.readFileSync(D + "pinyin_fixes_final.json", "utf8");
const pinyinPro = require(D + "pinyin-pro.js");

function makeEl(id) {
  const el = {
    id: id, style: {}, offsetWidth: 1, checked: false, value: "", files: [],
    scrollTop: 0, children: [], attrs: {}, _ev: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(t, fn) { this._ev[t] = fn; },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); el._addText(c.textContent || ""); },
    querySelectorAll() { return []; },
    click() {},
  };
  let text = "";
  Object.defineProperty(el, "textContent", {
    get() { return text; },
    set(v) { text = String(v); el.children.length = 0; },
  });
  el._addText = (s) => { text += s; };
  return el;
}

function scene(opts) {
  const els = {};
  const get = (id) => els[id] || (els[id] = makeEl(id));
  get("poem-data").textContent = bundle;
  get("poem-pinyin-fixes").textContent = fixesText;

  let fakeNow = 10000;
  const intervals = [];
  const timeouts = [];
  let lastU = null;
  const synth = {
    speaking: false, pending: false, onvoiceschanged: null,
    getVoices() { return [{ lang: "zh-CN", name: "MockVoice" }]; },
    speak(u) { lastU = u; },              // 不自动 onend，由测试手动触发
    cancel() {}, pause() {}, resume() {},
  };
  class SpeechSynthesisUtterance { constructor(text) { this.text = text; } }
  const store = Object.assign({}, opts.store);
  const sandbox = {
    console,
    document: { getElementById: get, createElement: (t) => makeEl(t) },
    window: { speechSynthesis: synth, pinyinPro: pinyinPro },
    localStorage: {
      getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
      setItem: (k, v) => { store[k] = String(v); },
    },
    fetch: () => Promise.reject(new Error("file:// blocked")),
    SpeechSynthesisUtterance, TextDecoder,
    Date: { now: () => fakeNow },
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout: () => {},
    setInterval: (fn) => { const id = intervals.length + 1000; intervals.push({ id, fn, kind: fn.name, cleared: false }); return id; },
    clearInterval: (id) => { const t = intervals.find((x) => x.id === id); if (t) t.cleared = true; },
  };
  vm.runInNewContext(code + "\n;globalThis.__T = { initPoemReciter, setPlaying, rec, nextRound, startProgress, stepProgress, finishProgress, setProgressIndex, onSpeechBoundary, speechText, getPoems: () => poems };", sandbox);
  const T = sandbox.__T;
  T.initPoemReciter();

  return {
    T, get, els, store, synth,
    get lastU() { return lastU; },
    now: (v) => { fakeNow = v; },
    tick: () => { const t = intervals.filter((x) => !x.cleared && x.kind === "stepProgress").slice(-1)[0]; if (t) t.fn(); },
    progressTimers: () => intervals.filter((x) => !x.cleared && x.kind === "stepProgress").length,
  };
}

const has = (el, c) => el.classList.contains(c);
const reads = (T) => T.rec.chars.filter((s) => has(s, "read")).length;
const curs = (T) => T.rec.chars.filter((s) => has(s, "cur")).length;
const checks = [];
const chk = (name, ok, extra) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (extra !== undefined ? "  " + extra : ""));
  checks.push(ok);
};

console.log("=== A 语音模式：时间推进 + boundary 校正 + 收尾 ===");
const a = scene({ store: {} });
a.T.rec.repeat = 2;
const p0 = a.T.getPoems()[0];
const text0 = a.T.speechText(p0);
const expectChars = Array.from(p0.title).length +
  Array.from((p0.dynasty ? p0.dynasty + "代" : "") + (p0.author ? " · " + p0.author : "")).length +
  p0.lines.reduce((n, l) => n + Array.from(l).length, 0);

a.T.setPlaying(true);
const card = a.get("poem-card");
const chars = a.T.rec.chars;
const dur = a.T.rec.prog.duration;
console.log("  首首诗:", p0.title, "| 逐字节点:", chars.length, "| 估算时长:", dur, "ms");
chk("逐字节点数 = 诗名+作者+正文全部字符", chars.length === expectChars, chars.length + "/" + expectChars);
chk("诵读中同时挂上 reading / progress-on", has(card, "reading") && has(card, "progress-on"));
chk("起始：首字为当前字、无已读字", curs(a.T) === 1 && reads(a.T) === 0 && has(chars[0], "cur"));

a.now(10000 + dur * 0.25); a.tick();
const r25 = reads(a.T);
chk("25%：已读字随进度增加、当前字唯一", r25 > 0 && r25 < chars.length * 0.35 && curs(a.T) === 1, "已读 " + r25 + "/" + chars.length);

a.now(10000 + dur * 0.5); a.tick();
const r50 = reads(a.T);
chk("50%：已读字继续增加且位置单调前移", r50 > r25 && curs(a.T) === 1, "已读 " + r50);
chk("已读字全部是前面的连续区间", chars.slice(0, r50).every((s) => has(s, "read")) && chars[r50 + 1] && !has(chars[r50 + 1], "read"));

a.now(10000 + dur * 0.3);                                   // 时钟回退，模拟 boundary 领先于估算
a.T.onSpeechBoundary({ charIndex: Math.floor(text0.length * 0.8) }, text0.length);
const r80 = reads(a.T);
chk("onboundary 校正：进度拉齐到实测 80%", r80 > r50 && r80 >= chars.length * 0.75, "已读 " + r80 + "/" + chars.length);

a.lastU.onend();                                            // 模拟语音结束
chk("读完整首：全部转为已读、无当前字", reads(a.T) === chars.length && curs(a.T) === 0);
chk("读完后进度定时器已停止", a.T.rec.prog.timer === null && a.progressTimers() === 0);

console.log("\n=== B 第二遍 / 暂停 / 开关 ===");
a.T.nextRound();
chk("下一遍从首字重新开始（高亮已重置）", reads(a.T) === 0 && curs(a.T) === 1 && has(chars[0], "cur"));

const progressBox = a.get("poem-progress");
progressBox.checked = false; progressBox._ev.change();
chk("关闭开关：移除 progress-on 并写入 localStorage", !has(card, "progress-on") && a.store["tangpoem.progress"] === "0");
chk("关闭开关不影响诵读流程", a.T.rec.playing === true && a.T.rec.round === 2);

a.T.setPlaying(false);
chk("暂停：移除 reading 且清除全部高亮", !has(card, "reading") && reads(a.T) === 0 && curs(a.T) === 0);

console.log("\n=== C 静音轮播 / 关闭拼音 ===");
const c = scene({ store: { "tangpoem.pinyin": "0" } });
c.T.rec.voiceOn = false;
c.T.setPlaying(true);
chk("静音轮播同样启动逐字进度", has(c.get("poem-card"), "reading") && c.progressTimers() >= 1);
chk("关闭拼音时仍生成逐字节点（只是没有 data-py）", c.T.rec.chars.length > 0 &&
  c.T.rec.chars.every((s) => !s.attrs["data-py"]), c.T.rec.chars.length + " 字");
c.now(10000 + c.T.rec.prog.duration * 0.4); c.tick();
chk("静音模式进度随时间推进", reads(c.T) > 0 && curs(c.T) === 1, "已读 " + reads(c.T));

console.log("\n=== 结论 ===");
const ok = checks.every(Boolean);
console.log(ok ? checks.length + " 项断言全部通过" : "存在失败项");
process.exitCode = ok ? 0 : 1;

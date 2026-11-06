/* 回归测试：复现「暂停 → 开始播放 → 点下一首」后朗读与显示不同步
   真实浏览器里 synth.cancel() 会异步触发旧 utterance 的 onend，
   若旧回调仍被当作「本首读完」处理，就会额外推进一首，
   出现「语音读第 N+1 首、屏幕显示第 N+2 首」。 */
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
    id, style: {}, offsetWidth: 1, checked: false, value: "", files: [],
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
    click() { if (this._ev.click) this._ev.click(); },
  };
  let text = "";
  Object.defineProperty(el, "textContent", {
    get() { return text; },
    set(v) { text = String(v); el.children.length = 0; },
  });
  el._addText = (s) => { text += s; };
  return el;
}

function scene() {
  const els = {};
  const get = (id) => els[id] || (els[id] = makeEl(id));
  get("poem-data").textContent = bundle;
  get("poem-pinyin-fixes").textContent = fixesText;

  const timers = [];
  let seq = 0;
  const setTimeoutMock = (fn, ms) => { timers.push({ id: ++seq, fn, ms, done: false }); return seq; };
  const clearTimeoutMock = (id) => { const t = timers.find((x) => x.id === id); if (t) t.done = true; };

  const spoken = [];
  let lastU = null;
  const synth = {
    speaking: false, pending: false, onvoiceschanged: null,
    getVoices() { return [{ lang: "zh-CN", name: "MockVoice" }]; },
    speak(u) { lastU = u; u.__ended = false; spoken.push(u.text); this.speaking = true; },
    // 浏览器 cancel() 的真实行为：异步触发被中断 utterance 的 onend
    cancel() {
      const u = lastU;
      this.speaking = false;
      if (u && !u.__ended) {
        u.__ended = true;
        setTimeoutMock(() => { if (u.onend) u.onend(); }, 0);
      }
    },
    pause() {}, resume() {},
  };
  class SpeechSynthesisUtterance { constructor(text) { this.text = text; } }
  const store = {};
  const sandbox = {
    console,
    document: { getElementById: get, createElement: (t) => makeEl(t) },
    window: { speechSynthesis: synth, pinyinPro },
    localStorage: {
      getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
      setItem: (k, v) => { store[k] = String(v); },
    },
    fetch: () => Promise.reject(new Error("file:// blocked")),
    SpeechSynthesisUtterance, TextDecoder,
    setTimeout: setTimeoutMock, clearTimeout: clearTimeoutMock,
    setInterval: () => 888888, clearInterval: () => {},
  };
  vm.runInNewContext(code + "\n;globalThis.__T = { initPoemReciter, setPlaying, rec, getPoems: () => poems, speechText };", sandbox);
  const T = sandbox.__T;
  T.initPoemReciter();

  const displayLog = [];
  const snap = () => {
    const c = get("poem-count").textContent;
    if (displayLog[displayLog.length - 1] !== c) displayLog.push(c);
  };
  const drain = (limit) => {
    for (let i = 0; i < limit; i++) {
      const t = timers.find((x) => !x.done);
      if (!t) break;
      t.done = true;
      t.fn();
      snap();
    }
  };
  return { T, get, spoken, displayLog, snap, drain, synth };
}

const checks = [];
const chk = (name, ok, extra) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (extra !== undefined ? "  " + extra : ""));
  checks.push(ok);
};

console.log("=== 用户路径：暂停 → 开始播放 → 点下一首 ===");
const s = scene();
s.snap();                                   // 第 1 首
s.T.setPlaying(true);                        // 读第 1 首
s.T.setPlaying(false);                       // 暂停：cancel 产生一个异步 onend
s.drain(4);                                  // 旧的 onend 在此期间落地
s.T.setPlaying(true);                        // 再开始：读第 1 首
const spokenBefore = s.spoken.length;
s.get("poem-next")._ev.click();              // 点下一首
const spokenAfterClick = s.spoken.slice();
const displayAfterClick = s.get("poem-count").textContent;
s.drain(6);                                  // 让 cancel 带来的幽灵回调全部落地

const title = s.get("poem-title").textContent;
const lastSpoken = s.spoken[s.spoken.length - 1] || "";
const poems = s.T.getPoems();
const shownIdx = parseInt((s.get("poem-count").textContent.match(/第 (\d+) \//) || [])[1], 10) - 1;
const spokenIdx = poems.findIndex((p) => s.T.speechText(p) === lastSpoken);

console.log("  点击后立刻显示:", displayAfterClick);
console.log("  幽灵回调落地后显示:", s.get("poem-count").textContent, "| 标题:", title);
console.log("  诵读队列:", s.spoken.map((t) => t.slice(0, 6)).join(" / "));
console.log("  显示序列:", s.displayLog.join(" → "));
console.log("  屏幕第", shownIdx + 1, "首 | 最后朗读第", spokenIdx + 1, "首");

chk("点击下一首只前进一首（显示第 2 首）", /第 2 \//.test(s.get("poem-count").textContent), s.get("poem-count").textContent);
chk("幽灵回调没有把显示推到第 3 首", !s.displayLog.some((c) => /第 3 \//.test(c)));
chk("诵读队列没有多读出第 3 首", s.spoken.length - spokenBefore === 1, "新增 " + (s.spoken.length - spokenBefore) + " 条");
chk("屏幕显示与最后朗读的是同一首", shownIdx === spokenIdx, shownIdx + 1 + " / " + (spokenIdx + 1));
chk("朗读文本以屏幕诗名开头", lastSpoken.indexOf(title + "。") === 0, lastSpoken.slice(0, 12));

console.log("\n=== 附加：连续点下一首、上一首也应保持同步 ===");
const t = scene();
t.T.setPlaying(true);
t.get("poem-next")._ev.click();
t.drain(4);
t.get("poem-next")._ev.click();
t.drain(4);
t.get("poem-prev")._ev.click();
t.drain(6);
const tTitle = t.get("poem-title").textContent;
const tLast = t.spoken[t.spoken.length - 1] || "";
const tIdx = parseInt((t.get("poem-count").textContent.match(/第 (\d+) \//) || [])[1], 10) - 1;
const tSpokenIdx = t.T.getPoems().findIndex((p) => t.T.speechText(p) === tLast);
console.log("  最终显示:", t.get("poem-count").textContent, "| 最后朗读:", tLast.slice(0, 8));
chk("连续切换后仍同步", tIdx === tSpokenIdx && tLast.indexOf(tTitle + "。") === 0);

console.log("\n=== 结论 ===");
const ok = checks.every(Boolean);
console.log(ok ? checks.length + " 项断言全部通过" : "存在失败项（bug 复现）");
process.exitCode = ok ? 0 : 1;

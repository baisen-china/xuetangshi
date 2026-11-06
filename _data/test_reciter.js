/* 用虚拟 DOM + 模拟语音跑诵读状态机，并校验逐字拼音渲染 */
const fs = require("fs");
const vm = require("vm");
const D = "C:/c/inventory/_data/";
const code = fs.readFileSync(D + "new_script.js", "utf8");
const bookText = fs.readFileSync("C:/c/inventory/唐诗.txt", "utf8");
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
  // 追加子节点时只累加文本，不能走 setter（setter 会清空 children）
  el._addText = (s) => { text += s; };
  return el;
}

function runScene(name, opts) {
  const els = {};
  const get = (id) => els[id] || (els[id] = makeEl(id));
  get("poem-data").textContent = bookText;
  get("poem-pinyin-fixes").textContent = fixesText;

  const document = {
    getElementById: get,
    createElement(tag) { return makeEl(tag); },
  };
  let seq = 0;
  const tasks = [];
  const setTimeoutMock = (fn, ms) => { tasks.push({ id: ++seq, fn, ms, done: false }); return seq; };
  const clearTimeoutMock = (id) => { const t = tasks.find((x) => x.id === id); if (t) t.done = true; };
  const spoken = [];
  const synth = {
    speaking: false, pending: false, onvoiceschanged: null,
    getVoices() { return [{ lang: "zh-CN", name: "MockVoice" }]; },
    speak(u) { spoken.push(u.text); setTimeoutMock(() => { if (u.onend) u.onend(); }, 0); },
    cancel() {}, pause() {}, resume() {},
  };
  class SpeechSynthesisUtterance { constructor(text) { this.text = text; } }

  const store = Object.assign({}, opts.store);
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
  };
  const win = { speechSynthesis: synth, pinyinPro: pinyinPro };
  const sandbox = {
    console, document, window: win, localStorage,
    fetch: () => Promise.reject(new Error("file:// blocked")),
    SpeechSynthesisUtterance, TextDecoder,
    setTimeout: setTimeoutMock, clearTimeout: clearTimeoutMock,
    setInterval: () => 888888, clearInterval: () => {},
  };
  vm.runInNewContext(code + "\n;globalThis.__T = { initPoemReciter, setPlaying, rec, pinyinFor, getPoems: () => poems };", sandbox);

  const T = sandbox.__T;
  T.initPoemReciter();
  const firstTitle = get("poem-title").textContent;
  const startIdx = T.rec.current;
  const repeat = T.rec.repeat;

  // 拼音渲染检查：textContent 保持纯汉字、data-py 只挂在汉字上
  const firstLineDiv = get("poem-body").children[0];
  const spans = firstLineDiv ? firstLineDiv.children : [];
  const pyOnSpans = spans.filter((s) => s.attrs["data-py"]);
  const pyOnPunct = spans.filter((s) => s.attrs["data-py"] && /[，。？！、；：「」·\s]/.test(s.textContent));
  const rawFirstLine = T.getPoems()[startIdx].lines[0];
  const pinyinOk = opts.pinyinOn
    ? firstLineDiv && firstLineDiv.textContent === rawFirstLine && pyOnSpans.length > 0 && pyOnPunct.length === 0
    : firstLineDiv && firstLineDiv.textContent === rawFirstLine && pyOnSpans.length === 0;

  T.setPlaying(true);
  const counts = [get("poem-count").textContent];
  for (let i = 0; i < 9000; i++) {
    const t = tasks.find((x) => !x.done);
    if (!t) break;
    t.done = true;
    t.fn();
    const c = get("poem-count").textContent;
    if (c !== counts[counts.length - 1]) counts.push(c);
    if (counts.length > 481) break;              // 跑满一轮 + 回环即止
  }

  console.log("=== " + name + " ===");
  console.log("诗库:", T.getPoems().length, "首 | 起始索引:", startIdx, "| 每首遍数:", repeat);
  console.log("拼音渲染:", pinyinOk ? "通过" : "失败",
              "| 首行字数:", spans.length, "| 带拼音字:", pyOnSpans.length,
              "| textContent 保真:", firstLineDiv && firstLineDiv.textContent === rawFirstLine);
  console.log("显示过的诗数:", counts.length, "| 诵读总遍次:", spoken.length);
  console.log("首 3 次诵读:", spoken.slice(0, 3).map((s) => s.slice(0, 8)).join(" / "));
  const loopOk = counts.length > 480 && counts[480] === counts[0] && /全库循环/.test(counts[0]);
  console.log("全库循环回环:", loopOk, "| 进度回环:", counts[480]);
  return { counts, spoken, startIdx, loopOk, pinyinOk, repeat, store, T, get };
}

const a = runScene("A 默认：每首 1 遍 + 拼音 + 全库循环", { store: {}, pinyinOn: true });
const b = runScene("B 每首 2 遍（记忆值）", { store: { "tangpoem.repeat": "2" }, pinyinOn: true });
const c = runScene("C 每首 3 遍 + 续读上次第 8 首", {
  store: { "tangpoem.repeat": "3", "tangpoem.resume": "1", "tangpoem.index": "7" }, pinyinOn: true,
});
const d = runScene("D 关闭续读 + 关闭拼音", {
  store: { "tangpoem.resume": "0", "tangpoem.index": "7", "tangpoem.pinyin": "0" }, pinyinOn: false,
});

// 控件交互：改遍数、关拼音都要即时生效并写入 localStorage
const rep = a.get("poem-repeat");
rep.value = "5";
rep._ev.change();
const repeatChanged = a.T.rec.repeat === 5 && a.store["tangpoem.repeat"] === "5";
const pyBox = a.get("poem-pinyin");
pyBox.checked = false;
pyBox._ev.change();
const pinyinToggled = a.T.rec.pinyinOn === false && a.store["tangpoem.pinyin"] === "0" &&
  a.get("poem-body").children[0].children.every((s) => !s.attrs["data-py"]);
console.log("\n控件：改遍数 ->", a.T.rec.repeat, "遍 | 关拼音 ->", !a.T.rec.pinyinOn);

const checks = {
  "默认每首 1 遍": a.repeat === 1,
  "默认 1 遍时相邻诵读换诗": a.spoken[0] !== a.spoken[1],
  "每首 2 遍时连读两遍": b.repeat === 2 && b.spoken[0] === b.spoken[1] && b.spoken[2] !== b.spoken[0],
  "每首 3 遍": c.repeat === 3 && c.spoken[0] === c.spoken[1] && c.spoken[1] === c.spoken[2] && c.spoken[3] !== c.spoken[0],
  "全库循环": a.loopOk,
  "续读从第 8 首": c.startIdx === 7,
  "不续读从第 1 首": d.startIdx === 0,
  "拼音开（A/B/C）": a.pinyinOk && b.pinyinOk && c.pinyinOk,
  "拼音关（D）": d.pinyinOk,
  "下拉改遍数即时生效并记忆": repeatChanged,
  "拼音开关即时生效并记忆": pinyinToggled,
};
console.log("\n=== 断言 ===");
Object.entries(checks).forEach(([k, v]) => console.log((v ? "  ✓ " : "  ✗ ") + k));
const ok = Object.values(checks).every(Boolean);
console.log("\n>>> 状态机 + 拼音验证:", ok ? "全部通过" : "存在失败项");
process.exitCode = ok ? 0 : 1;

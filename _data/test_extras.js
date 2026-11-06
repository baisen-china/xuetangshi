/* 新增功能专项测试：树灯开关、打赏二维码校验、自适应字号、弹层交互 */
const fs = require("fs");
const vm = require("vm");
const D = "C:/c/inventory/_data/";
const code = fs.readFileSync(D + "new_script.js", "utf8");
const bookText = fs.readFileSync("C:/c/inventory/唐诗.txt", "utf8");
const fixesText = fs.readFileSync(D + "pinyin_fixes_final.json", "utf8");
const pinyinPro = require(D + "pinyin-pro.js");
const qrB64 = fs.readFileSync("C:/c/inventory/打赏码1.jpg").toString("base64");
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}
const qrHash = fnv1a(qrB64);

function makeEl(id) {
  const el = {
    id, style: {}, offsetWidth: 1, checked: false, value: "", files: [], src: "",
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
    click() { if (this._ev.click) this._ev.click({ target: this }); },
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
  opts = opts || {};
  const els = {};
  const get = (id) => els[id] || (els[id] = makeEl(id));
  get("poem-data").textContent = bookText;
  get("poem-pinyin-fixes").textContent = fixesText;
  get("tip-qr-data").textContent = opts.qrData !== undefined ? opts.qrData : qrB64;
  get("tip-qr-hash").textContent = opts.qrHash !== undefined ? opts.qrHash : qrHash;
  get("tip-modal").classList.add("hidden");

  const store = Object.assign({}, opts.store);
  const synth = {
    speaking: false, pending: false, onvoiceschanged: null,
    getVoices() { return []; }, speak() {}, cancel() {}, pause() {}, resume() {},
  };
  class SpeechSynthesisUtterance { constructor(text) { this.text = text; } }
  const win = {
    speechSynthesis: synth, pinyinPro,
    __treeLight: { type: "f", value: 1.0 },
  };
  const sandbox = {
    console,
    document: { getElementById: get, createElement: (t) => makeEl(t) },
    window: win,
    localStorage: {
      getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
      setItem: (k, v) => { store[k] = String(v); },
    },
    fetch: () => Promise.reject(new Error("file:// blocked")),
    SpeechSynthesisUtterance, TextDecoder,
    setTimeout: () => 1, clearTimeout: () => {},
    setInterval: () => 2, clearInterval: () => {},
  };
  vm.runInNewContext(code + "\n;globalThis.__T = { initPoemReciter, rec, fitPoemFont, renderPoem, tipHash, getPoems: () => poems };", sandbox);
  const T = sandbox.__T;
  T.initPoemReciter();
  return { T, get, store, win };
}

const checks = [];
const chk = (name, ok, extra) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (extra !== undefined ? "  " + extra : ""));
  checks.push(ok);
};

console.log("=== A 树灯亮 / 熄开关 ===");
const a = scene({});
chk("默认亮灯：uniform = 1、遮罩无 tree-off", a.win.__treeLight.value === 1 &&
  !a.get("bg-dimmer").classList.contains("tree-off"));
chk("复选框默认勾选", a.get("poem-treelight").checked === true && a.T.rec.treeLightOn === true);
const lightBox = a.get("poem-treelight");
lightBox.checked = false;
lightBox._ev.change();
chk("熄灯：uniform 降到 0.08、遮罩加 tree-off", a.win.__treeLight.value === 0.08 &&
  a.get("bg-dimmer").classList.contains("tree-off"));
chk("熄灯状态写入 localStorage", a.store["tangpoem.treelight"] === "0");
lightBox.checked = true;
lightBox._ev.change();
chk("再点亮：uniform 回到 1", a.win.__treeLight.value === 1 && a.store["tangpoem.treelight"] === "1");
const b = scene({ store: { "tangpoem.treelight": "0" } });
chk("重开页面记得上次熄灯", b.win.__treeLight.value === 0.08 && b.get("poem-treelight").checked === false);

console.log("\n=== B 打赏按钮与二维码数据校验 ===");
chk("指纹算法与构建脚本一致", a.T.tipHash(qrB64) === qrHash, qrHash);
chk("校验通过时二维码设为 data URI（无外部文件）",
  /^data:image\/jpeg;base64,/.test(a.get("tip-qr").src) && a.get("tip-qr").src.length > 120000);
chk("弹层默认隐藏", a.get("tip-modal").classList.contains("hidden"));
a.get("tip-open")._ev.click();
chk("点打赏按钮打开弹层", !a.get("tip-modal").classList.contains("hidden"));
a.get("tip-close")._ev.click();
chk("点关闭按钮收起弹层", a.get("tip-modal").classList.contains("hidden"));
a.get("tip-open")._ev.click();
a.get("tip-modal")._ev.click({ target: a.get("tip-modal") });
chk("点遮罩空白处也能关闭", a.get("tip-modal").classList.contains("hidden"));

const tampered = scene({ qrHash: "deadbeef" });
chk("内嵌数据被改动时拒绝显示二维码",
  tampered.get("tip-qr").style.display === "none" &&
  !/^data:image/.test(tampered.get("tip-qr").src));
chk("被改动时给出提示", /校验失败/.test(tampered.get("tip-note").textContent));
const missing = scene({ qrData: "" });
chk("二维码数据缺失时同样拒绝显示", missing.get("tip-qr").style.display === "none");

console.log("\n=== C 自适应字号（按句长 / 行数） ===");
const ps = a.T.getPoems();
const fontOf = (idx) => {
  a.T.renderPoem(ps[idx]);
  return parseFloat(a.get("poem-body").style.fontSize);
};
const short = fontOf(0);        // 5 行、最长 12 字
const longPoem = fontOf(68);    // 60 行《长恨歌》
const longLine = fontOf(434);   // 最长句 26 字
console.log("  短诗", short, "px | 60 行长诗", longPoem, "px | 26 字长句", longLine, "px");
chk("常见短诗字号明显大于原 27px（接近翻倍）", short >= 44 && short <= 52, short + "px");
chk("长诗自动缩小且不低于 32px", longPoem < short && longPoem >= 32, longPoem + "px");
chk("超长句自动缩小且不低于 22px", longLine < short && longLine >= 22, longLine + "px");
chk("行高随拼音/行数设置", !!a.get("poem-body").style.lineHeight);

console.log("\n=== 结论 ===");
const ok = checks.every(Boolean);
console.log(ok ? checks.length + " 项断言全部通过" : "存在失败项");
process.exitCode = ok ? 0 : 1;

      /* ===== 唐诗整首诵读 =====
         · 数据：内联的 poem-data 文本节点中存有全量诗库（双击打开即可用）；
           通过本地服务器打开时会自动 fetch 同目录「唐诗.txt」覆盖；
           file:// 下也可点右下角「载入 唐诗.txt」手动选择
         · 流程：整首显示（逐字拼音 + 逐字进度变色）→ 诵读 N 遍（默认 1 遍）→ 停顿 → 下一首 → 全库循环
         · 开关：每首诵读遍数、逐字拼音、朗读进度变色、「接着上次继续」，均用 localStorage 记住 */

      const POEM_INDEX_KEY = "tangpoem.index";
      const POEM_RESUME_KEY = "tangpoem.resume";
      const POEM_REPEAT_KEY = "tangpoem.repeat";
      const POEM_PINYIN_KEY = "tangpoem.pinyin";
      const POEM_PROGRESS_KEY = "tangpoem.progress";
      const POEM_LIGHT_KEY = "tangpoem.treelight";
      const POEM_DIMMER_KEY = "tangpoem.dimmer";
      const POEM_TIPSHOWN_KEY = "tangpoem.tipshown";

      let poems = [];
      const rec = {
        current: 0,
        round: 0,
        repeat: 1,                 // 每首诵读遍数，默认 1
        pinyinOn: true,
        progressOn: true,          // 诵读时逐字变色显示进度
        treeLightOn: true,
        dimmerOn: false,           // 默认不压暗，保持原版圣诞夜背景
        playing: false,
        gen: 0,                    // 诵读代次：切诗/暂停/中断时自增，作废所有旧异步回调
        timer: null,
        keepTimer: null,
        voiceOn: true,
        resumeMode: false,
        synth: window.speechSynthesis || null,
        chars: [],                 // 当前诗所有逐字 span，按阅读顺序
        prog: { timer: null, start: 0, duration: 1, idx: -1, boundary: 0 },
      };

      /* 浏览器在 synth.cancel() 后会异步触发被中断 utterance 的 onend/onerror，
         若不甄别，旧回调会被当作「本首读完」再推进一首，造成朗读与显示错开一首。
         每次切诗 / 暂停 / 换设置都会 bumpGen，旧代次的回调一律丢弃。 */
      function bumpGen() { return ++rec.gen; }
      function schedule(fn, ms) {
        const g = rec.gen;
        rec.timer = setTimeout(function () {
          if (g !== rec.gen || !rec.playing) return;
          fn();
        }, ms);
      }

      /* ===== 拼音引擎 =====
         内联 pinyin-pro（window.pinyinPro）负责整句注音，能正确处理多音字与「一/不」变调；
         poem-pinyin-fixes 里的点补丁表再把诗中特定字的古音/破读音改掉。 */
      let PY_ENGINE = null;
      let PY_FIXES = [];
      const HAN_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;

      function initPinyin() {
        try {
          const el = document.getElementById("poem-pinyin-fixes");
          if (el && el.textContent) {
            const v = JSON.parse(el.textContent);
            if (Array.isArray(v)) PY_FIXES = v;
          }
        } catch (e) { PY_FIXES = []; }
        const P = window.pinyinPro;
        if (P && typeof P.pinyin === "function") PY_ENGINE = P;
      }

      function pinyinFor(text) {
        const chars = Array.from(text);
        let out = null;
        if (PY_ENGINE) {
          try {
            const a = PY_ENGINE.pinyin(text, { type: "array", toneType: "symbol" });
            if (Array.isArray(a) && a.length === chars.length) out = a.slice();
          } catch (e) {}
        }
        if (!out) return null;
        // 词组级点补丁：只改指定字，保留其余读音（含变调）
        for (let k = 0; k < PY_FIXES.length; k++) {
          const rule = PY_FIXES[k];
          if (!rule || rule.length < 3) continue;
          const phrase = rule[0], offset = rule[1], py = rule[2];
          let from = 0, at;
          while ((at = text.indexOf(phrase, from)) !== -1) {
            // 用码点下标定位，兼容用户自载入 txt 中的增补平面汉字
            const pos = Array.from(text.slice(0, at)).length + offset;
            if (pos >= 0 && pos < out.length) out[pos] = py;
            from = at + 1;
          }
        }
        return out;
      }

      /* 把一行文字拆成逐字 span；拼音放在 data-py 里由 CSS 伪元素显示。
         不管拼音开关与否都拆字，这样朗读进度才能精确到「字」；
         element.textContent 仍是纯汉字，不影响复制与状态判断。
         所有字节点按阅读顺序收进 rec.chars，供进度高亮使用。 */
      function fillText(el, text) {
        const chars = Array.from(text);
        const py = (rec.pinyinOn && PY_ENGINE) ? pinyinFor(text) : null;
        el.textContent = "";
        for (let i = 0; i < chars.length; i++) {
          const c = chars[i];
          const s = document.createElement("span");
          s.className = "py";
          s.textContent = c;
          const p = py && py[i];
          if (py && HAN_RE.test(c) && typeof p === "string" && /[a-zA-Zü]/.test(p)) {
            s.setAttribute("data-py", p);
          }
          el.appendChild(s);
          rec.chars.push(s);
        }
      }

      function decodeBuffer(buf) {
        let text = new TextDecoder("utf-8").decode(buf);
        // UTF-8 解出乱码时回退 GBK（Windows 记事本 ANSI 保存的情况）
        if (text.indexOf("\uFFFD") !== -1) {
          try { text = new TextDecoder("gbk").decode(buf); } catch (e) {}
        }
        return text;
      }

      /* 解析 唐诗.txt：===== 分块，诗名 / 朝代 / 作者 / 正文 四个字段 */
      function parsePoemBook(text) {
        const out = [];
        if (!text) return out;
        let cur = null;
        let inBody = false;
        const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.indexOf("=====") === 0) {
            if (cur && cur.lines.length) out.push(cur);
            cur = { title: "", dynasty: "", author: "", lines: [] };
            inBody = false;
            continue;
          }
          if (!cur) continue;                        // 文件头注释
          if (!line || line.charAt(0) === "#") continue;
          let m;
          if ((m = line.match(/^诗名[：:]\s*(.*)$/))) { cur.title = m[1].trim(); continue; }
          if ((m = line.match(/^朝代[：:]\s*(.*)$/))) { cur.dynasty = m[1].trim(); continue; }
          if ((m = line.match(/^作者[：:]\s*(.*)$/))) { cur.author = m[1].trim(); continue; }
          if (/^正文[：:]/.test(line)) { inBody = true; continue; }
          if (inBody) cur.lines.push(line);
        }
        if (cur && cur.lines.length) out.push(cur);
        return out.filter(function (p) { return p.title && p.lines.length; });
      }

      function builtinPoemText() {
        const el = document.getElementById("poem-data");
        return el ? el.textContent : "";
      }

      function storeGet(key, dflt) {
        try { const v = localStorage.getItem(key); return v === null ? dflt : v; }
        catch (e) { return dflt; }
      }
      function storeSet(key, val) {
        try { localStorage.setItem(key, String(val)); } catch (e) {}
      }
      function clampRepeat(v) {
        const n = parseInt(v, 10);
        return isFinite(n) && n >= 1 && n <= 10 ? n : 1;
      }

      function startIndex() {
        if (!poems.length) return 0;
        const n = parseInt(storeGet(POEM_INDEX_KEY, "0"), 10);
        if (!rec.resumeMode || !isFinite(n)) return 0;
        return ((n % poems.length) + poems.length) % poems.length;
      }

      function speechText(p) {
        const meta = (p.dynasty ? p.dynasty + "代，" : "") + (p.author ? p.author + "。" : "");
        return p.title + "。" + meta + p.lines.join("");
      }

      function pickVoice() {
        if (!rec.synth) return null;
        const vs = rec.synth.getVoices() || [];
        return vs.find(function (v) { return /zh[-_]?CN/i.test(v.lang); }) ||
               vs.find(function (v) { return /^zh/i.test(v.lang); }) || null;
      }

      /* ===== 幼儿向自适应字号 =====
         实测：带拼音时每字约占 1.12~1.32em（拼音越长越宽），
         卡片可用文本宽约 1034px（1400×900 窗口）。所以：
         · 常见 4~8 行绝句/律诗可放大到 42~50px（原 27px 的 1.6~1.9 倍）
         · 26 字长句、60 行长诗会自动收小，绝不横向溢出
         先用 Range 实测最长行再按可用宽收紧，比按字数估算更准。 */
      function fitPoemFont(p) {
        const body = document.getElementById("poem-body");
        const n = p.lines.length;
        const maxLen = p.lines.reduce(function (m, l) {
          return Math.max(m, Array.from(l).length);
        }, 0);
        const rawW = window.innerWidth, rawH = window.innerHeight;
        const vw = (typeof rawW === "number" && rawW > 0) ? rawW : 1400;
        const vh = (typeof rawH === "number" && rawH > 0) ? rawH : 900;
        const availW = (typeof body.clientWidth === "number" && body.clientWidth > 0)
          ? body.clientWidth : Math.min(vw * 0.94, 1180) - 92;
        const target = Math.max(30, Math.min(50, vw * 0.036));
        let fs = target;
        body.style.fontSize = fs + "px";

        let widest = 0;
        if (typeof document.createRange === "function") {
          const lines = body.children || [];
          for (let i = 0; i < lines.length; i++) {
            const r = document.createRange();
            if (!r.selectNodeContents || !r.getBoundingClientRect) continue;
            r.selectNodeContents(lines[i]);
            const w = r.getBoundingClientRect().width || 0;
            if (w > widest) widest = w;
          }
        }
        if (widest > availW) {
          fs = Math.max(22, fs * availW / widest * 0.985);
        } else if (!widest) {
          // 单元测试环境没有 Range：用保守的每字宽度估算
          const per = rec.pinyinOn ? 1.38 : 1.10;
          fs = Math.min(fs, Math.max(22, availW / (maxLen * per)));
        }

        const lh = rec.pinyinOn ? (n > 16 ? 1.78 : n > 10 ? 1.9 : 2.05)
                               : (n > 16 ? 1.55 : 1.9);
        const availH = Math.max(240, vh * 0.92 - 230);   // 扣掉标题/作者/计数/内边距
        const byH = availH / (n * lh);
        if (byH < fs) fs = Math.max(32, byH);             // 超长诗保底 32px，允许卡片内滚动

        body.style.fontSize = fs.toFixed(1) + "px";
        // 短诗再按卡片实际高度校正一次：尽量让整首一屏可见，幼儿不必滚动
        const card = document.getElementById("poem-card");
        if (n <= 12 && card && typeof card.scrollHeight === "number" &&
            typeof card.clientHeight === "number") {
          for (let k = 0; k < 3; k++) {
            const sh = card.scrollHeight, ch = card.clientHeight;
            if (!(ch > 0) || sh <= ch + 2) break;
            const next = Math.max(32, fs * (ch - 6) / sh);
            if (next >= fs - 0.3) break;
            fs = next;
            body.style.fontSize = fs.toFixed(1) + "px";
          }
        }
        body.style.lineHeight = String(lh);
      }

      function renderPoem(p) {
        const card = document.getElementById("poem-card");
        stopProgress(false);
        rec.chars = [];
        fillText(document.getElementById("poem-title"), p.title);
        fillText(document.getElementById("poem-meta"),
          (p.dynasty ? p.dynasty + "代" : "") + (p.author ? " · " + p.author : ""));
        const body = document.getElementById("poem-body");
        body.textContent = "";
        p.lines.forEach(function (s) {
          const d = document.createElement("div");
          fillText(d, s);
          body.appendChild(d);
        });
        fitPoemFont(p);
        if (rec.pinyinOn) card.classList.add("pinyin-on");
        else card.classList.remove("pinyin-on");
        if (rec.progressOn) card.classList.add("progress-on");
        else card.classList.remove("progress-on");
        card.classList.remove("reading");
        card.scrollTop = 0;
        document.getElementById("poem-count").textContent =
          "第 " + (rec.current + 1) + " / " + poems.length + " 首 · 全库循环";
        card.classList.remove("show");
        void card.offsetWidth;                     // 强制重排以重放淡入动画
        card.classList.add("show");
      }

      function updateStatus(extra) {
        let s = poems.length
          ? "第 " + (rec.current + 1) + " / " + poems.length + " 首"
          : "诗库为空";
        if (rec.playing) {
          s += " · 诵读 " + Math.min(rec.round, rec.repeat) + "/" + rec.repeat + " 遍";
          if (!rec.voiceOn || !rec.synth) s += "（静音）";
        } else {
          s += " · 未开始";
        }
        if (extra) s += " · " + extra;
        document.getElementById("poem-status").textContent = s;
      }

      /* ===== 诵读进度：逐字变色 =====
         主进度按时间线性推进（任何浏览器都能用）；若语音引擎支持
         onboundary，再用实测 charIndex 校正：把进度往前拉齐，并反推
         整首实际时长，避免 TTS 比估算快或慢时声画脱节。 */
      function stopProgress(clearDom) {
        if (rec.prog.timer) { clearInterval(rec.prog.timer); rec.prog.timer = null; }
        rec.prog.idx = -1;
        rec.prog.boundary = 0;
        if (clearDom) clearCharMarks();
      }

      function clearCharMarks() {
        for (let i = 0; i < rec.chars.length; i++) {
          rec.chars[i].classList.remove("read");
          rec.chars[i].classList.remove("cur");
        }
      }

      function setProgressIndex(k) {
        let prev = rec.prog.idx;
        if (k === prev) return;
        const chars = rec.chars;
        if (k < prev) { clearCharMarks(); prev = -1; }
        // 只改动「上一帧 → 这一帧」之间的字，60 行长诗也不会每帧全量重绘
        for (let i = Math.max(0, prev); i < k && i < chars.length; i++) {
          chars[i].classList.remove("cur");
          chars[i].classList.add("read");
        }
        if (k >= 0 && k < chars.length) {
          chars[k].classList.remove("read");
          chars[k].classList.add("cur");
        }
        rec.prog.idx = k;
        // 长诗自动滚到正在读的字（只滚卡片内部，不带动整页）
        const cur = chars[k];
        const card = document.getElementById("poem-card");
        if (cur && card && typeof card.clientHeight === "number" && card.clientHeight > 0) {
          const top = (cur.offsetTop || 0) - (card.offsetTop || 0);
          if (top < card.scrollTop + 24 || top > card.scrollTop + card.clientHeight - 56) {
            card.scrollTop = Math.max(0, top - card.clientHeight * 0.42);
          }
        }
      }

      function stepProgress() {
        if (!rec.playing || !rec.chars.length) return;
        const elapsed = Date.now() - rec.prog.start;
        let ratio = elapsed / rec.prog.duration;
        if (rec.prog.boundary > ratio) ratio = rec.prog.boundary;
        ratio = Math.max(0, Math.min(1, ratio));
        setProgressIndex(Math.min(rec.chars.length - 1, Math.floor(ratio * rec.chars.length)));
      }

      function startProgress(durationMs) {
        stopProgress(false);
        if (!rec.chars.length) return;
        clearCharMarks();
        const card = document.getElementById("poem-card");
        if (card) card.classList.add("reading");
        rec.prog.start = Date.now();
        rec.prog.duration = Math.max(600, durationMs);
        rec.prog.idx = -1;
        rec.prog.boundary = 0;
        rec.prog.timer = setInterval(stepProgress, 70);
        stepProgress();
      }

      function finishProgress() {
        stopProgress(false);
        clearCharMarks();
        for (let i = 0; i < rec.chars.length; i++) rec.chars[i].classList.add("read");
        rec.prog.idx = rec.chars.length;
      }

      function onSpeechBoundary(e, textLen) {
        const ci = e && typeof e.charIndex === "number" ? e.charIndex : 0;
        if (!rec.playing || ci <= 0 || !textLen) return;
        const frac = Math.min(1, ci / textLen);
        const elapsed = Date.now() - rec.prog.start;
        if (elapsed > 250 && frac > 0.02 && frac < 0.95) {
          const est = elapsed / frac;            // 实测反推整首时长，平滑修正估算
          rec.prog.duration = rec.prog.duration * 0.55 + est * 0.45;
        }
        if (frac > rec.prog.boundary) rec.prog.boundary = frac;
        stepProgress();
      }

      function clearTimers() {
        if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
        if (rec.keepTimer) { clearInterval(rec.keepTimer); rec.keepTimer = null; }
        if (rec.prog.timer) { clearInterval(rec.prog.timer); rec.prog.timer = null; }
      }

      function stopSpeech() {
        bumpGen();                         // 先作废旧回调，再 cancel（cancel 会异步触发 onend）
        if (rec.synth && (rec.synth.speaking || rec.synth.pending)) rec.synth.cancel();
      }

      function keepAlive() {
        if (rec.keepTimer) clearInterval(rec.keepTimer);
        // Chrome 约 15 秒后会自动暂停长语音，定时 pause/resume 保活
        rec.keepTimer = setInterval(function () {
          if (!rec.playing || !rec.synth || !rec.synth.speaking) {
            clearInterval(rec.keepTimer); rec.keepTimer = null; return;
          }
          rec.synth.pause();
          rec.synth.resume();
        }, 9000);
      }

      function nextRound() {
        if (!rec.playing || !poems.length) return;
        if (rec.round >= rec.repeat) {
          updateStatus("准备下一首");
          // 设定遍数读完，稍作停顿后自动切下一首（末尾回到第 1 首，实现循环）
          schedule(function () { showPoem(rec.current + 1); }, 1400);
          return;
        }
        rec.round++;
        updateStatus();
        const p = poems[rec.current];
        const text = speechText(p);
        const silentMs = Math.max(3500, text.length * 330);
        const g = rec.gen;
        let done = false;                  // cancel 可能同时触发 onend 与 onerror
        const onDone = function () {
          if (done || g !== rec.gen || !rec.playing) return;
          done = true;
          finishProgress();                // 读完整首全部转为暖金，稍停再进下一遍 / 下一首
          schedule(nextRound, 650);
        };
        // 静音轮播：按字数估算时长，逐字变色与语音模式完全一致
        if (!rec.voiceOn || !rec.synth || typeof SpeechSynthesisUtterance === "undefined") {
          startProgress(silentMs);
          schedule(onDone, silentMs);
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "zh-CN";
        u.rate = 0.82;
        u.pitch = 1;
        u.volume = 1;
        const v = pickVoice();
        if (v) u.voice = v;
        u.onboundary = function (e) {
          if (g === rec.gen) onSpeechBoundary(e, text.length);
        };
        u.onend = onDone;
        u.onerror = onDone;
        startProgress(silentMs);
        try {
          rec.synth.speak(u);
          keepAlive();
        } catch (e) {
          schedule(onDone, silentMs);
        }
      }

      function startRounds() {
        bumpGen();
        clearTimers();
        rec.round = 0;
        nextRound();
      }

      function showPoem(i) {
        if (!poems.length) return;
        bumpGen();
        clearTimers();
        rec.current = ((i % poems.length) + poems.length) % poems.length;
        storeSet(POEM_INDEX_KEY, rec.current);   // 始终记录位置，供「续读」模式使用
        rec.round = 0;
        renderPoem(poems[rec.current]);
        document.getElementById("poem-card").classList.remove("reading");
        updateStatus();
        if (rec.playing) startRounds();
      }

      function setPlaying(on) {
        rec.playing = on;
        if (on) {
          startRounds();                         // 从当前诗第 1 遍开始
        } else {
          bumpGen();
          clearTimers();
          stopSpeech();
          stopProgress(true);                // 暂停时清掉逐字高亮，恢复原本清晰配色
          document.getElementById("poem-card").classList.remove("reading");
        }
        document.getElementById("poem-play").textContent = on ? "⏸ 暂停" : "▶ 开始诵读";
        updateStatus();
      }

      function loadBook(text, source) {
        const list = parsePoemBook(text);
        if (!list.length) return false;
        bumpGen();
        stopSpeech();
        clearTimers();
        poems = list;
        rec.current = startIndex();
        renderPoem(poems[rec.current]);
        rec.round = 0;
        storeSet(POEM_INDEX_KEY, rec.current);
        updateStatus("已载入 " + source + " · " + poems.length + " 首");
        if (rec.playing) startRounds();
        return true;
      }

      /* ===== 圣诞树闪烁红灯（亮 / 熄） =====
         3D 圣诞树是一条 HSL 彩虹点带：色环首尾的红点随音频忽大忽小，
         就是「一闪一闪的红灯」；其余青 / 绿 / 黄等点是固定常亮的彩灯。
         构建脚本给每个点打了 isRed 标记，片元着色器用
         mix( 1.0, uTreeLight, vIsRed ) —— 彩灯永远乘 1.0，只有红点乘开关亮度。
         所以关灯只让红灯熄灭，彩灯一个都不变，也不动背景（不再压暗）。
         注意：绝不对 3D 画面用 backdrop-filter / transform / 缩放。 */
      function applyTreeLight(on) {
        const u = window.__treeLight;
        if (u) u.value = on ? 1 : 0;   // 1 = 红灯亮，0 = 红灯熄（彩灯不受影响）
      }
      function applyDimmer() {
        const dim = document.getElementById("bg-dimmer");
        if (!dim || !dim.classList) return;
        if (rec.dimmerOn) dim.classList.add("on");
        else dim.classList.remove("on");
      }

      /* ===== 打赏二维码 =====
         图片以 base64 直接内嵌在 tip-qr-data 节点里，页面不引用任何外部 jpg，
         替换同目录下的图片文件不会影响本页。显示前再校验一次数据指纹，
         指纹不符（例如有人改动了内嵌数据）就不显示，避免扫到被换掉的码。 */
      function tipHash(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16);
      }

      function initTipQr() {
        const modal = document.getElementById("tip-modal");
        const img = document.getElementById("tip-qr");
        const note = document.getElementById("tip-note");
        const dataEl = document.getElementById("tip-qr-data");
        const hashEl = document.getElementById("tip-qr-hash");
        const close = function () { modal.classList.add("hidden"); };
        document.getElementById("tip-open").addEventListener("click", function () {
          modal.classList.remove("hidden");
        });
        document.getElementById("tip-close").addEventListener("click", close);
        modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
        if (document.addEventListener) {
          document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") close();
          });
        }
        const b64 = ((dataEl && dataEl.textContent) || "").replace(/\s/g, "");
        const want = ((hashEl && hashEl.textContent) || "").trim();
        if (b64 && want && tipHash(b64) === want) {
          img.src = "data:image/jpeg;base64," + b64;
        } else {
          if (img) img.style.display = "none";
          if (note) note.textContent = "二维码数据校验失败，请联系作者获取原版页面";
        }
      }

      function initPoemReciter() {
        initPinyin();
        rec.resumeMode = storeGet(POEM_RESUME_KEY, "0") === "1";
        rec.repeat = clampRepeat(storeGet(POEM_REPEAT_KEY, "1"));
        rec.pinyinOn = storeGet(POEM_PINYIN_KEY, "1") === "1";
        rec.progressOn = storeGet(POEM_PROGRESS_KEY, "1") === "1";
        rec.treeLightOn = storeGet(POEM_LIGHT_KEY, "1") === "1";
        rec.dimmerOn = storeGet(POEM_DIMMER_KEY, "0") === "1";

        const resumeBox = document.getElementById("poem-resume");
        const voiceBox = document.getElementById("poem-voice");
        const pinyinBox = document.getElementById("poem-pinyin");
        const progressBox = document.getElementById("poem-progress");
        const treeLightBox = document.getElementById("poem-treelight");
        const dimmerBox = document.getElementById("poem-dimmer");
        const repeatSel = document.getElementById("poem-repeat");
        resumeBox.checked = rec.resumeMode;
        voiceBox.checked = rec.voiceOn;
        pinyinBox.checked = rec.pinyinOn;
        progressBox.checked = rec.progressOn;
        treeLightBox.checked = rec.treeLightOn;
        dimmerBox.checked = rec.dimmerOn;
        repeatSel.value = String(rec.repeat);
        applyTreeLight(rec.treeLightOn);
        applyDimmer();
        initTipQr();

        poems = parsePoemBook(builtinPoemText());
        rec.current = startIndex();
        renderPoem(poems[rec.current] || { title: "诗库为空", dynasty: "", author: "", lines: [] });
        updateStatus("点「开始诵读」进入自动循环");

        document.getElementById("poem-play").addEventListener("click", function () {
          setPlaying(!rec.playing);
        });
        document.getElementById("poem-next").addEventListener("click", function () {
          stopSpeech(); clearTimers(); showPoem(rec.current + 1);
        });
        document.getElementById("poem-prev").addEventListener("click", function () {
          stopSpeech(); clearTimers(); showPoem(rec.current - 1);
        });
        repeatSel.addEventListener("change", function () {
          rec.repeat = clampRepeat(repeatSel.value);
          storeSet(POEM_REPEAT_KEY, rec.repeat);
          stopSpeech();
          if (rec.playing) startRounds();        // 按新遍数从本首第 1 遍重来
          updateStatus("每首 " + rec.repeat + " 遍");
        });
        pinyinBox.addEventListener("change", function () {
          rec.pinyinOn = pinyinBox.checked;
          storeSet(POEM_PINYIN_KEY, rec.pinyinOn ? "1" : "0");
          if (rec.playing) stopSpeech();
          if (poems.length) renderPoem(poems[rec.current]);   // 逐字节点重建
          if (rec.playing) startRounds();                     // 从本首第 1 遍重来，进度状态保持一致
          updateStatus();
        });
        progressBox.addEventListener("change", function () {
          rec.progressOn = progressBox.checked;
          storeSet(POEM_PROGRESS_KEY, rec.progressOn ? "1" : "0");
          const card = document.getElementById("poem-card");
          if (rec.progressOn) card.classList.add("progress-on");
          else card.classList.remove("progress-on");
          updateStatus();
        });
        treeLightBox.addEventListener("change", function () {
          rec.treeLightOn = treeLightBox.checked;
          storeSet(POEM_LIGHT_KEY, rec.treeLightOn ? "1" : "0");
          applyTreeLight(rec.treeLightOn);
          updateStatus(rec.treeLightOn ? "红灯已亮" : "红灯已熄（彩灯不变）");
        });
        dimmerBox.addEventListener("change", function () {
          rec.dimmerOn = dimmerBox.checked;
          storeSet(POEM_DIMMER_KEY, rec.dimmerOn ? "1" : "0");
          applyDimmer();
          updateStatus(rec.dimmerOn ? "背景已压暗" : "已恢复原版背景");
        });
        resumeBox.addEventListener("change", function () {
          rec.resumeMode = resumeBox.checked;
          storeSet(POEM_RESUME_KEY, rec.resumeMode ? "1" : "0");
          updateStatus(rec.resumeMode ? "下次打开接着这里" : "下次打开从第一首");
        });
        voiceBox.addEventListener("change", function () {
          rec.voiceOn = voiceBox.checked;
          stopSpeech();
          if (rec.playing) startRounds();
          updateStatus();
        });

        // 手动选择本地 唐诗.txt（file:// 双击打开时使用）
        const fileInput = document.getElementById("poem-file");
        document.getElementById("poem-pick").addEventListener("click", function () {
          fileInput.click();
        });
        fileInput.addEventListener("change", function (e) {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function () {
            if (!loadBook(decodeBuffer(reader.result), file.name)) {
              document.getElementById("poem-status").textContent = "没有解析到诗，请检查「===== / 诗名：/ 正文：」格式";
            }
          };
          reader.readAsArrayBuffer(file);
        });

        // 中文语音列表常为异步加载
        if (rec.synth) rec.synth.onvoiceschanged = function () { pickVoice(); };

        // 窗口尺寸变化后重新计算自适应字号，保证任何屏幕都不横向溢出
        if (window.addEventListener) {
          window.addEventListener("resize", function () {
            if (poems.length) fitPoemFont(poems[rec.current]);
          });
        }

        // 通过本地服务器打开时，自动读取同目录 唐诗.txt 覆盖内置诗库
        fetch("唐诗.txt", { cache: "no-store" })
          .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.arrayBuffer();
          })
          .then(function (buf) { loadBook(decodeBuffer(buf), "唐诗.txt"); })
          .catch(function () {
            updateStatus("内置诗库 " + poems.length + " 首 · 可点按钮载入 唐诗.txt");
          });
      }


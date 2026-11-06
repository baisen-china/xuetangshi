      /* ===== 唐诗整首诵读 =====
         · 数据：内联的 poem-data 文本节点中存有全量诗库（双击打开即可用）；
           通过本地服务器打开时会自动 fetch 同目录「唐诗.txt」覆盖；
           file:// 下也可点右下角「载入 唐诗.txt」手动选择
         · 流程：整首显示（逐字拼音）→ 诵读 N 遍（默认 1 遍）→ 停顿 → 下一首 → 全库循环
         · 开关：每首诵读遍数、逐字拼音显隐、「接着上次继续」用 localStorage 记住位置 */

      const POEM_INDEX_KEY = "tangpoem.index";
      const POEM_RESUME_KEY = "tangpoem.resume";
      const POEM_REPEAT_KEY = "tangpoem.repeat";
      const POEM_PINYIN_KEY = "tangpoem.pinyin";

      let poems = [];
      const rec = {
        current: 0,
        round: 0,
        repeat: 1,                 // 每首诵读遍数，默认 1
        pinyinOn: true,
        playing: false,
        timer: null,
        keepTimer: null,
        voiceOn: true,
        resumeMode: false,
        synth: window.speechSynthesis || null,
      };

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

      /* 把一行文字拆成逐字 span，拼音放在 data-py 属性里由 CSS 伪元素显示。
         这样 element.textContent 仍是纯汉字，不影响复制与状态判断。 */
      function fillText(el, text) {
        if (!rec.pinyinOn || !PY_ENGINE) { el.textContent = text; return; }
        const chars = Array.from(text);
        const py = pinyinFor(text);
        if (!py) { el.textContent = text; return; }
        el.textContent = "";
        for (let i = 0; i < chars.length; i++) {
          const c = chars[i];
          const s = document.createElement("span");
          s.className = "py";
          s.textContent = c;
          const p = py[i];
          if (HAN_RE.test(c) && typeof p === "string" && /[a-zA-Zü]/.test(p)) {
            s.setAttribute("data-py", p);
          }
          el.appendChild(s);
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

      function renderPoem(p) {
        const card = document.getElementById("poem-card");
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
        // 长诗 / 长句自动缩小字号与行高；带拼音时行距需额外留出发音空间
        const n = p.lines.length;
        const maxLen = p.lines.reduce(function (m, l) {
          return Math.max(m, Array.from(l).length);
        }, 0);
        body.style.fontSize = (n > 30 || maxLen > 20) ? "clamp(12px, 1.2vw, 15px)"
                            : (n > 16 || maxLen > 16) ? "clamp(13px, 1.45vw, 18px)"
                            : n > 10 ? "clamp(15px, 1.7vw, 21px)" : "";
        body.style.lineHeight = rec.pinyinOn
          ? (n > 16 ? "1.78" : n > 10 ? "1.9" : "")
          : (n > 16 ? "1.55" : "");
        if (rec.pinyinOn) card.classList.add("pinyin-on");
        else card.classList.remove("pinyin-on");
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

      function clearTimers() {
        if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
        if (rec.keepTimer) { clearInterval(rec.keepTimer); rec.keepTimer = null; }
      }

      function stopSpeech() {
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
          document.getElementById("poem-card").classList.remove("reading");
          updateStatus("准备下一首");
          // 设定遍数读完，稍作停顿后自动切下一首（末尾回到第 1 首，实现循环）
          rec.timer = setTimeout(function () { showPoem(rec.current + 1); }, 1400);
          return;
        }
        rec.round++;
        updateStatus();
        const p = poems[rec.current];
        const silentMs = Math.max(3500, speechText(p).length * 330);
        if (!rec.voiceOn || !rec.synth || typeof SpeechSynthesisUtterance === "undefined") {
          // 静音轮播：按字数估算每遍时长，流程完全一致
          rec.timer = setTimeout(nextRound, silentMs);
          return;
        }
        const u = new SpeechSynthesisUtterance(speechText(p));
        u.lang = "zh-CN";
        u.rate = 0.82;
        u.pitch = 1;
        u.volume = 1;
        const v = pickVoice();
        if (v) u.voice = v;
        u.onend = function () {
          if (rec.playing) rec.timer = setTimeout(nextRound, 650);
        };
        u.onerror = function () {
          if (rec.playing) rec.timer = setTimeout(nextRound, 650);
        };
        document.getElementById("poem-card").classList.add("reading");
        try {
          rec.synth.speak(u);
          keepAlive();
        } catch (e) {
          rec.timer = setTimeout(nextRound, silentMs);
        }
      }

      function startRounds() {
        clearTimers();
        rec.round = 0;
        nextRound();
      }

      function showPoem(i) {
        if (!poems.length) return;
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
          clearTimers();
          stopSpeech();
          document.getElementById("poem-card").classList.remove("reading");
        }
        document.getElementById("poem-play").textContent = on ? "⏸ 暂停" : "▶ 开始诵读";
        updateStatus();
      }

      function loadBook(text, source) {
        const list = parsePoemBook(text);
        if (!list.length) return false;
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

      function initPoemReciter() {
        initPinyin();
        rec.resumeMode = storeGet(POEM_RESUME_KEY, "0") === "1";
        rec.repeat = clampRepeat(storeGet(POEM_REPEAT_KEY, "1"));
        rec.pinyinOn = storeGet(POEM_PINYIN_KEY, "1") === "1";

        const resumeBox = document.getElementById("poem-resume");
        const voiceBox = document.getElementById("poem-voice");
        const pinyinBox = document.getElementById("poem-pinyin");
        const repeatSel = document.getElementById("poem-repeat");
        resumeBox.checked = rec.resumeMode;
        voiceBox.checked = rec.voiceOn;
        pinyinBox.checked = rec.pinyinOn;
        repeatSel.value = String(rec.repeat);

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
          if (poems.length) renderPoem(poems[rec.current]);
          updateStatus();
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


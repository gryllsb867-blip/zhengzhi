(function () {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const ACCOUNTS_KEY = "gk-accounts-v1";
  const LEGACY_STORE = "gk-workbench-v1";

  function loadAccountBook() {
    let book = null;
    try { book = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "null"); }
    catch { book = null; }
    if (!book || !Array.isArray(book.accounts) || book.accounts.length < 2) {
      book = {
        current: "hyk",
        accounts: [
          { id: "hyk", name: "何裕恺" },
          { id: "friend", name: "魏可惠" }
        ]
      };
    }
    if (!book.accounts.some((a) => a.id === book.current)) book.current = book.accounts[0].id;
    book.accounts.forEach((a) => {
      if (a.id === "friend" && (!a.name || a.name === "朋友")) a.name = "魏可惠";
    });
    const hykKey = LEGACY_STORE + ":hyk";
    if (!localStorage.getItem(hykKey)) {
      const legacy = localStorage.getItem(LEGACY_STORE);
      if (legacy) localStorage.setItem(hykKey, legacy);
    }
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(book));
    return book;
  }

  const accountBook = loadAccountBook();
  const STORE = LEGACY_STORE + ":" + accountBook.current;
  const load = () => {
    try { return JSON.parse(localStorage.getItem(STORE) || "{}"); }
    catch { return {}; }
  };
  let syncReady = false;
  let syncTimer = 0;

  function onStaticHost() {
    const host = location.hostname || "";
    return host.endsWith(".surge.sh") || host.endsWith(".github.io") || host.endsWith(".netlify.app") || host.endsWith(".pages.dev");
  }

  function syncUrl() {
    const id = accountBook.current;
    if (location.protocol === "file:" || location.port === "8765") {
      return "http://127.0.0.1:8766/sync/" + id;
    }
    if (onStaticHost()) return "sync/" + id + ".json";
    return "sync/" + id;
  }

  function snapshot(obj) {
    return {
      daily: obj.daily || {},
      notes: obj.notes || "",
      doneGaps: obj.doneGaps || {},
      quiz: obj.quiz || {},
      quizHard: obj.quizHard || {},
      szNotes: obj.szNotes || {},
      szInk: obj.szInk || {},
      szCursor: obj.szCursor || 0
    };
  }

  function richness(obj) {
    const quiz = Object.keys(obj.quiz || {}).length;
    const notes = Object.values(obj.szNotes || {}).filter((v) => String(v || "").trim()).length;
    const hard = Object.keys(obj.quizHard || {}).length;
    const ink = Object.keys(obj.szInk || {}).length;
    return quiz * 10 + notes * 10 + hard + ink + (Number(obj.szCursor) || 0);
  }

  function mergeMaps(localMap, remoteMap, remoteWins) {
    const out = { ...(localMap || {}) };
    Object.entries(remoteMap || {}).forEach(([key, value]) => {
      const current = out[key];
      const empty = current == null || current === "";
      if (empty) out[key] = value;
      else if (remoteWins && value != null && value !== "") out[key] = value;
      else if (typeof value === "string" && typeof current === "string" && value.length > current.length) out[key] = value;
    });
    return out;
  }

  function mergeState(local, remote) {
    const remoteWins = richness(remote) > richness(local);
    const notes = remoteWins && remote.notes ? remote.notes : (local.notes || remote.notes || "");
    return {
      daily: mergeMaps(local.daily, remote.daily, remoteWins),
      notes: typeof notes === "string" && remote.notes && remote.notes.length > notes.length ? remote.notes : notes,
      doneGaps: mergeMaps(local.doneGaps, remote.doneGaps, remoteWins),
      quiz: mergeMaps(local.quiz, remote.quiz, remoteWins),
      quizHard: mergeMaps(local.quizHard, remote.quizHard, remoteWins),
      szNotes: mergeMaps(local.szNotes, remote.szNotes, remoteWins),
      szInk: mergeMaps(local.szInk, remote.szInk, remoteWins),
      szCursor: Math.max(Number(local.szCursor) || 0, Number(remote.szCursor) || 0)
    };
  }

  function applySnapshot(next) {
    state.daily = next.daily || {};
    state.notes = next.notes || "";
    state.doneGaps = next.doneGaps || {};
    state.quiz = next.quiz || {};
    state.quizHard = next.quizHard || {};
    state.szNotes = next.szNotes || {};
    state.szInk = next.szInk || {};
    state.szCursor = next.szCursor || 0;
  }

  function pushSync(obj) {
    const url = syncUrl();
    if (!url || url.endsWith(".json")) return;
    const body = JSON.stringify(snapshot(obj));
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body
    }).catch(() => {});
  }

  const save = (obj) => {
    localStorage.setItem(STORE, JSON.stringify(obj));
    if (!syncReady) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => pushSync(obj), 350);
  };

  function pullSync() {
    const url = syncUrl();
    if (!url) {
      syncReady = true;
      return;
    }
    fetch(url, { cache: "no-store" })
      .then((res) => res.ok ? res.json() : {})
      .then((remote) => {
        const before = JSON.stringify(snapshot(state));
        const merged = mergeState(snapshot(state), remote || {});
        applySnapshot(merged);
        const after = JSON.stringify(snapshot(state));
        localStorage.setItem(STORE, JSON.stringify(state));
        syncReady = true;
        if (after !== JSON.stringify(snapshot(remote || {}))) pushSync(state);
        if (after !== before && typeof setRoute === "function") setRoute(current());
      })
      .catch(() => { syncReady = true; });
  }
  const state = load();
  if (!state.daily) state.daily = {};
  if (!state.notes) state.notes = "";
  if (!state.doneGaps) state.doneGaps = {};
  if (!state.quiz) state.quiz = {};
  if (!state.quizHard || typeof state.quizHard !== "object") state.quizHard = {};
  if (!state.szNotes || typeof state.szNotes !== "object") state.szNotes = {};
  if (!state.szInk || typeof state.szInk !== "object") state.szInk = {};
  if (state.szCursor == null) state.szCursor = 0;
  let szPendingScroll = 0;
  let szPen = "";
  let szDraw = null;
  let szLastInkId = "";
  let szInkObserver = null;

  const todayKey = () => new Date().toISOString().slice(0, 10);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const STEM_KEYS = [
    "错误的是", "不正确的是", "说法错误", "表述错误", "不属于",
    "正确的是", "说法正确", "表述正确", "正确的有几项", "有几项",
    "下列说法", "下列表述", "下列相关"
  ];

  function splitMarks(s) {
    return String(s || "")
      .split(/[／/|、，,;；]+/)
      .map((x) => x.replace(/\s+/g, "").trim())
      .filter((x) => x.length >= 2);
  }

  function uniqParts(list) {
    const seen = new Set();
    const out = [];
    [...list].filter(Boolean).sort((a, b) => b.length - a.length).forEach((p) => {
      if (seen.has(p)) return;
      seen.add(p);
      out.push(p);
    });
    return out;
  }

  function paint(text, layers) {
    const src = String(text || "");
    if (!src) return "";
    const taken = [];
    const hits = [];
    (layers || []).forEach(({ parts, cls }) => {
      uniqParts(parts).forEach((p) => {
        let from = 0;
        while (from < src.length) {
          const i = src.indexOf(p, from);
          if (i < 0) break;
          const j = i + p.length;
          const clash = taken.some(([a, b]) => !(j <= a || i >= b));
          if (!clash) {
            taken.push([i, j]);
            hits.push({ i, j, cls });
          }
          from = i + Math.max(1, p.length);
        }
      });
    });
    hits.sort((a, b) => a.i - b.i || b.j - a.j);
    let html = "";
    let pos = 0;
    hits.forEach(({ i, j, cls }) => {
      if (i < pos) return;
      html += esc(src.slice(pos, i));
      html += `<mark class="${cls}">${esc(src.slice(i, j))}</mark>`;
      pos = j;
    });
    html += esc(src.slice(pos));
    return html;
  }

  function trapKeys(t) {
    const lock = t.lock && t.lock !== "左词锁右词" ? [t.lock] : [];
    return uniqParts([...lock, ...splitMarks(t.wDiff), ...splitMarks(t.rDiff), ...STEM_KEYS]);
  }

  function paintWrong(t, text) {
    return paint(text, [
      { parts: splitMarks(t.wDiff).concat([t.wDiff]), cls: "pen-red" },
      { parts: trapKeys(t), cls: "pen-key" }
    ]);
  }

  function paintRight(t, text) {
    return paint(text, [
      { parts: splitMarks(t.rDiff).concat([t.rDiff]), cls: "pen-blue" },
      { parts: trapKeys(t), cls: "pen-key" }
    ]);
  }

  function paintStem(t) {
    const stem = [t.news, t.qn, t.mark, t.trap, t.lock && t.lock !== "左词锁右词" ? t.lock : ""]
      .filter(Boolean)
      .join(" · ");
    return paint(stem, [{ parts: trapKeys(t), cls: "pen-key" }]);
  }

  function pensLegend() {
    return `<div class="legend-pens" aria-label="标注说明">
      <span><mark class="pen-red">红笔加粗</mark>＝错点</span>
      <span><mark class="pen-blue">蓝笔加粗</mark>＝正确原话</span>
      <span><mark class="pen-key">橙黄荧光笔</mark>＝题干里用来判对错的钥匙词</span>
    </div>`;
  }

  const routes = {
    overview: { title: "总览", render: viewOverview },
    field: { title: "上场卡", render: viewField },
    verbal: { title: "言语", render: viewVerbal },
    ziliao: { title: "资料分析", render: viewZiliao },
    judge: { title: "判断推理", render: viewJudge },
    politics: { title: "政治时政", render: viewPolitics },
    zhengzhi: { title: "政治理论", render: viewZhengzhi },
    shizheng: { title: "时政对错对照", render: viewShizheng },
    quiz: { title: "政治理论题库", render: viewQuiz },
    yicuo: { title: "易错题", render: viewQuiz },
    essay: { title: "申论", render: viewEssay },
    quant: { title: "数量", render: viewQuant },
    ledger: { title: "漏缺账本", render: viewLedger },
    timeline: { title: "本月足迹", render: viewTimeline },
    library: { title: "材料库", render: viewLibrary },
    search: { title: "检索", render: viewSearch }
  };

  function barClass(g) {
    return g === "ok" ? "g-ok" : g === "warn" ? "g-warn" : "g-bad";
  }

  function viewOverview() {
    const { coverage, stats, weekFocus, patterns } = GK;
    return `
      <p class="lead">把 ${esc(GK.meta.range)} 你让我做过的题目分析、方法口径和漏缺收成一张桌面。方法已经成型的科目，按口径上场；空白模块如实标空，不装成体系。</p>
      <div class="grid g-4">
        <div class="card stat"><div class="k">本月操作窗口</div><div class="v">${stats.ops}</div><div class="s">申论 / 言语 / 资料 / 判断 / 时政 / 政治</div></div>
        <div class="card stat"><div class="k">已钉死的错题锚点</div><div class="v">${GK.wrongs.length}</div><div class="s">可检索套次、错因、口诀</div></div>
        <div class="card stat"><div class="k">方法手册</div><div class="v">${stats.methods}</div><div class="s">红领巾 / 花生 / 毛娃 / 龙飞 / 小Y / 白鹭</div></div>
        <div class="card stat"><div class="k">尚未开垦</div><div class="v">${stats.blanks}</div><div class="s">逻辑判断 · 数量 · 大作文 · 定义实战</div></div>
      </div>
      <h3>知识覆盖（方法完成度 × 刷题完成度）</h3>
      <div class="card cover">
        ${coverage.map((c) => `
          <div class="item">
            <div class="name">${esc(c.name)}</div>
            <div>
              <div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:var(--muted);width:28px">方法</span><div class="bar ${barClass(c.grade)}" style="flex:1"><i style="width:${c.method}%"></i></div></div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:4px"><span style="font-size:11px;color:var(--muted);width:28px">刷题</span><div class="bar ${barClass(c.grade)}" style="flex:1;opacity:.7"><i style="width:${c.drill}%"></i></div></div>
            </div>
            <div style="font-size:12px;color:var(--muted)">法 ${c.method}%<br>练 ${c.drill}%</div>
            <div class="note note-line">${esc(c.note)}</div>
          </div>
        `).join("")}
      </div>
      <div class="grid g-2" style="margin-top:16px">
        <div class="card">
          <h3 style="margin-top:0">本周先打这几块</h3>
          ${weekFocus.map((w) => `
            <div class="row">
              <div class="meta"><span class="tag ${w.pri === "P0" ? "red" : w.pri === "P1" ? "gold" : ""}">${w.pri}</span>${esc(w.title)}</div>
              <div>${esc(w.why)}</div>
              <div class="note" style="margin-top:6px"><span class="lab">动作：</span>${esc(w.do)}</div>
            </div>
          `).join("")}
        </div>
        <div>
          <div class="card">
            <h3 style="margin-top:0">今天上场前勾这6条</h3>
            <p class="lead" style="margin-bottom:8px">勾选存在本机，换浏览器不会同步。</p>
            ${GK.daily.map((d) => {
              const key = todayKey() + ":" + d.id;
              const on = state.daily[key] ? "checked" : "";
              return `<label class="check"><input type="checkbox" data-daily="${esc(key)}" ${on}><span>${esc(d.text)}</span></label>`;
            }).join("")}
          </div>
          <div class="card" style="margin-top:14px">
            <h3 style="margin-top:0">你反复出现的错因</h3>
            ${patterns.map((p) => `<div class="trap"><span class="lab">${esc(p.sub)}：</span>${esc(p.text)}</div>`).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function viewField() {
    const m = GK.methods;
    return `
      <p class="lead">打印或开着这页刷题。每科只留能执行的步骤，不讲道理。</p>
      <div class="grid g-2">
        <div class="card">
          <h3 style="margin-top:0">选词</h3>
          <div class="kou">${esc(m.xuanci.kou)}</div>
          <ol>${m.xuanci.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        </div>
        <div class="card">
          <h3 style="margin-top:0">片段</h3>
          <div class="kou">${esc(m.pianduan.kou)}</div>
          <div class="ok"><span class="lab">主题词三句：</span><ol>${m.pianduan.theme.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>
          <div class="note">${esc(m.pianduan.themeCopy)}</div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">资料四格</h3>
          <div class="kou">${esc(m.ziliao.kou)}</div>
          <ol>${m.ziliao.four.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          <div class="note">${esc(m.ziliao.read)}</div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">政治</h3>
          <div class="kou">${esc(m.zhengzhi.kou)}</div>
          <ol>${m.zhengzhi.flow.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        </div>
        <div class="card">
          <h3 style="margin-top:0">图推 / 类比 / 定义</h3>
          <div class="ok"><span class="lab">图推：</span>${esc(m.tui.kou)}</div>
          <div class="ok"><span class="lab">类比：</span>${esc(m.leibi.kouLei)}</div>
          <div class="ok"><span class="lab">定义：</span>${esc(m.leibi.kouDing)}</div>
          <div class="note">${esc(m.tui.nest)} ${esc(m.tui.nine)}</div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">申论小题</h3>
          <div class="ok"><span class="lab">概括：</span>就近合并 + 前置提炼（每点约6字）</div>
          <div class="ok"><span class="lab">对策：</span>对策详细、问题简明、对策前置</div>
          <div class="ok"><span class="lab">综合分析：</span>中好坏策 · 有谁写谁、不必求全、依序排列</div>
          <div class="ok"><span class="lab">应用文：</span>前提算点数段，点齐逻辑自现</div>
        </div>
      </div>
      <h3>资料翻译草稿纸（只练读题）</h3>
      <div class="card">
        <div class="six">
          ${["问的是量/率/差/比","时间（现期基期/同比环比/累计）","主体 · 分子 · 分母","材料给了吗，没给等于什么运算","换成甲乙之后的人话","题型（先翻译再贴）"].map((lab, i) => `
            <div class="field"><label>${esc(lab)}</label><textarea rows="2" data-note="t${i}">${esc(state["t"+i] || "")}</textarea></div>
          `).join("")}
        </div>
        <p class="lead" style="margin:8px 0 0">写完这六行再决定算不算。30季和花生27套的错，多数死在前四行。</p>
      </div>
    `;
  }

  function viewVerbal() {
    const x = GK.methods.xuanci, p = GK.methods.pianduan;
    return `
      <p class="lead">选词走红领巾，片段走花生。海海刷一套30题前15后15换方法。</p>
      <div class="grid g-2">
        <div class="card">
          <h3 style="margin-top:0">${esc(x.title)}</h3>
          <div class="kou">${esc(x.kou)}</div>
          <h4>步骤</h4>
          <ol>${x.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          <h4>对应标签</h4>
          <p>${x.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</p>
          <h4>错因</h4>
          ${x.traps.map((t) => `<div class="trap">${esc(t)}</div>`).join("")}
          <div class="note"><span class="lab">讲题格式：</span>${esc(x.format)}</div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">${esc(p.title)}</h3>
          <div class="kou">${esc(p.kou)}</div>
          <h4>主题词三句</h4>
          <ol>${p.theme.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          <div class="ok">${esc(p.themeCopy)}</div>
          <h4>对策纪律</h4>
          <div class="trap">${esc(p.duice)}</div>
          <h4>干扰项标签</h4>
          <p>${p.labels.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</p>
          <div class="note">${esc(p.chuchu)}</div>
          <div class="note">${esc(p.haihai)}</div>
        </div>
      </div>
      ${wrongTable(["选词", "片段"])}
    `;
  }

  function renderBaihua() {
    const bh = GK.baihua;
    const hot = bh.rows.filter((r) => r.hot);
    return `
      <div class="kou">${esc(bh.kou)}</div>
      <div class="grid g-2">
        <div class="card">
          <div class="ok"><span class="lab">增长：</span>${esc(bh.grow)}</div>
          <div class="trap"><span class="lab">下降：</span>${esc(bh.down)}</div>
        </div>
        <div class="card">
          <div class="note"><span class="lab">何时用：</span>${esc(bh.when)}</div>
          <div class="note"><span class="lab">误差：</span>${esc(bh.err)}</div>
          <div class="ok"><span class="lab">单独记：</span>${esc(bh.star)}</div>
        </div>
      </div>
      <p class="lead" style="margin:10px 0 6px">先扫高频（蓝底），再往下补到 1/30。上场记是口算用的一位小数；精确列用来核对，不另背一套。</p>
      <div class="toolgrid baihua-hot">
        ${hot.map((r) => `<div class="tool"><div class="t">${esc(r.pct)}% = 1/${r.n}</div><div class="n">n=${r.n}</div><div class="t">${r.n}:1:${r.n + 1}</div></div>`).join("")}
      </div>
      <div class="card" style="overflow:auto;margin-top:12px">
        <table class="baihua">
          <tr>
            <th>n</th><th>分数</th><th>上场记</th><th>精确%</th>
            <th>增长 基:增:现</th><th>下降 基:减:现</th>
            <th>增长一份</th><th>下降一份</th><th>备注</th>
          </tr>
          ${bh.rows.map((r) => `<tr class="${r.hot ? "hot" : ""}">
            <td>${r.n}</td>
            <td><b>1/${r.n}</b></td>
            <td><mark class="pen-key">${esc(r.pct)}%</mark></td>
            <td>${esc(r.exact)}</td>
            <td>${r.n} : 1 : ${r.n + 1}</td>
            <td>${r.n} : −1 : ${r.n - 1}</td>
            <td>现期 ÷ ${r.n + 1}</td>
            <td>现期 ÷ ${r.n - 1}</td>
            <td>${esc(r.note)}</td>
          </tr>`).join("")}
        </table>
      </div>
    `;
  }

  function viewZiliao() {
    const z = GK.methods.ziliao;
    return `
      <p class="lead">先翻译后计算。花生600按套问；海海刷资料方法已接上，但你几乎还没按套提问。</p>
      <div class="kou">${esc(z.kou)}</div>
      <div class="grid g-2">
        <div class="card">
          <h3 style="margin-top:0">读题四格</h3>
          <ol>${z.four.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          <div class="note">${esc(z.read)}</div>
          <h4>四类关系</h4>
          <ul>${z.systems.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        </div>
        <div class="card">
          <h3 style="margin-top:0">毛娃速算刀</h3>
          ${z.knives.map((k) => `<div class="ok"><span class="lab">${esc(k.name)}：</span>${esc(k.text)}</div>`).join("")}
        </div>
      </div>
      <h3>花生题型补丁</h3>
      <div class="card"><ul>${z.peanut.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <div class="kou">${esc(z.shuzhou)}</div></div>
      <h3>四年插值数轴（最常用）</h3>
      <div class="card">
        <table>
          <tr><th>年均 r</th><th>花生记忆 M</th><th>精确 (1+r)⁴</th></tr>
          ${GK.shuzhou4.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}
        </table>
        <p class="lead" style="margin:8px 0 0">粗插步长约 0.06。选项挤在 0.5 个点内必须细插或代回。隔年 21% 不是两年年均 10%。</p>
      </div>
      <h3>415 百化分（1/2～1/30 全表）</h3>
      ${renderBaihua()}
      ${wrongTable(["资料"])}
    `;
  }

  function viewJudge() {
    const t = GK.methods.tui, l = GK.methods.leibi;
    return `
      <p class="lead">图推有手册和400题笔记；类比只精讲了刷题1；定义方法在、实战几乎为零；逻辑判断整块空白。</p>
      <div class="grid g-3">
        <div class="card">
          <h3 style="margin-top:0">${esc(t.title)}</h3>
          <div class="kou">${esc(t.kou)}</div>
          <div class="ok"><span class="lab">对称轴：</span>${esc(t.dui)}</div>
          <div class="note">${esc(t.nest)}</div>
          <div class="note">${esc(t.nine)}</div>
          <div class="trap"><span class="lab">立体：</span>${esc(t.stereo)}</div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">类比</h3>
          <div class="kou">${esc(l.kouLei)}</div>
          <ol>${l.leiSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          <div class="note">高风险未问完：1-7褒贬相反近义、1-13方式—目的、1-20依据—对象—主体、1-25交叉当种属、1-28集合内位置、1-31特指/泛指。</div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">定义</h3>
          <div class="kou">${esc(l.kouDing)}</div>
          <p>四格：${l.dingFour.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</p>
          <div class="trap">${esc(l.dingNote)}</div>
          <div class="trap">海海刷定义刷题1–6共180题，工作台目前只能放方法，题库待你开刷。</div>
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">判断·逻辑（空白）</h3>
        <p>论证、削弱加强、翻译推理、朴素逻辑：这个月没有对话沉淀，本地也没有对口题本方法。下次开这块时再写入，不在这里编一套假体系。</p>
      </div>
      ${wrongTable(["类比", "图推"])}
    `;
  }

  const SZ_TYPES = ["绝对化", "方向写反", "主语偷换", "程度范围加码", "正确原理+错误后半句", "原话挪位", "专名数字张冠"];
  const SZ_PACKS = ["小黑1–6月", "小黑7–8月", "两会专题", "中央一号", "十五五农业规划", "小Y精选一百条", "小Y35季"];
  const SZ_MONTHS = [
    "1月·上", "1月·下", "2月·上", "2月·下", "3月·上", "3月·下",
    "4月·上", "4月·下", "5月·上", "5月·下", "6月·上", "6月·下",
    "7月·上", "7月·下", "8月·上", "8月·下",
    "两会专题", "一号专题", "一号必刷10", "一号必刷15", "一号原文", "十五五规划", "小Y一百条", "35季模考"
  ];

  function zhengzhiHome() {
    const u = location.href.split("#")[0].split("?")[0];
    const base = u.slice(0, u.lastIndexOf("/") + 1);
    let dir = base;
    try { dir = decodeURI(base); } catch { /* keep the encoded directory */ }
    return dir + "政治理论.html";
  }

  function viewZhengzhi() {
    const n = (window.SZ_TRAPS || []).length;
    const quizN = (window.ZK_QUIZ || []).length;
    const hardN = Object.keys(state.quizHard || {}).length;
    const home = zhengzhiHome();
    return `
      <p class="lead">政治理论单独这一页：题库、易错题、时政对错。正确表述在左，错误表述在右。</p>
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin-top:0">单独网址</h3>
        <p>把下面这个地址存下来，打开就是政治理论，不必从整张工作台里翻。</p>
        <p class="zhengzhi-url"><a href="${esc(home)}">${esc(home)}</a></p>
      </div>
      <div class="grid g-3">
        <div class="card">
          <h3 style="margin-top:0">题库</h3>
          <p>小黑 1–6 月 ${quizN} 道选择题。点选项后出答案和红蓝笔解析。</p>
          <p class="links" style="margin:0"><a href="#/quiz">进入题库</a></p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">易错题</h3>
          <p>在题库里点「标为易错」，题目就收进这一块。当前 <b>${hardN}</b> 题。</p>
          <p class="links" style="margin:0"><a href="#/yicuo">打开易错题板块</a></p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">时政对错</h3>
          <p>${n} 组对照。左边蓝笔是正确原话，右边红笔是错句。</p>
          <p class="links" style="margin:0"><a href="#/shizheng">打开对错对照</a></p>
        </div>
      </div>
      <p class="links"><a href="#/politics">方法口径、老演员和左词锁右词仍在政治时政页</a></p>
    `;
  }

  function viewPolitics(cur) {
    const z = GK.methods.zhengzhi;
    const n = (window.SZ_TRAPS || []).length;
    return `
      <p class="lead">政治理论用小Y的钥匙词配对；时政用小黑「新闻关键表述 → 题 → 设错点」。常识非政治还没做过专项。</p>
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin-top:0">政治理论题库（小黑 1–6 月选择题）</h3>
        <p>292 道原题，选项可点。选完锁定，自动出答案和解析：错句红笔，正确原话蓝笔，题干钥匙词橙黄荧光笔。默认先做「学习」里的政治理论原文。</p>
        <p class="links" style="margin:0">
          <a href="政治理论.html">打开政治理论单独页面</a>
          <a href="#/quiz">打开政治题库</a>
          <a href="#/yicuo">打开易错题板块</a>
        </p>
      </div>
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin-top:0">时政对错对照（小黑月度 + 专题 + 小Y一百条 + 第35季）</h3>
        <p>按小Y七种挖坑，把小黑 1–8 月、两会、中央一号、十五五农业规划、小Y精选一百条、第35季模考里的易错点抽成 <b>${n}</b> 组「错句 ↔ 正句」。每组有固定题号，右边可以写批注，并记下复习到第几题。</p>
        <p class="links" style="margin:0"><a href="#/shizheng">打开全部对错对照（可按月份 / 挖坑筛选）</a></p>
      </div>
      <div class="kou">${esc(z.kou)}</div>
      <div class="grid g-2">
        <div class="card">
          <h3 style="margin-top:0">上场五步</h3>
          <ol>${z.flow.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          <h4>老演员</h4>
          ${z.actors.map((a) => `
            <div class="row">
              <b><mark class="pen-key">${esc(a.name)}</mark></b>
              <div class="ok"><span class="lab">真请：</span>${esc(a.ok)}</div>
              <div class="trap"><span class="lab">必杀：</span>${esc(a.trap)}</div>
            </div>
          `).join("")}
        </div>
        <div class="card">
          <h3 style="margin-top:0">左词锁右词</h3>
          <table>
            <tr><th>左词（钥匙）</th><th>只能配（蓝笔）</th></tr>
            ${z.pairs.map((p) => `<tr><td><mark class="pen-key">${esc(p[0])}</mark></td><td><mark class="pen-blue">${esc(p[1])}</mark></td></tr>`).join("")}
          </table>
          <div class="note" style="margin-top:10px">${esc(z.missing)}</div>
          <p class="links">
            <a href="../政治理论基础/小Y政治理论考场思维.html" target="_blank">打开完整《小Y政治理论考场思维》</a>
            <a href="../1-6月时政/2026年1-6月时政知识点对题整合.html" target="_blank">打开《1–6月时政知识点对题》</a>
            <a href="../专题时政/" target="_blank">打开专题时政文件夹（7–8月 / 两会 / 一号 / 小Y一百条）</a>
          </p>
        </div>
      </div>
    `;
  }

  function viewEssay() {
    const s = GK.methods.shenlun;
    return `
      <p class="lead">小题方法以白鹭讲义和60天课上原答为准，不另编一套顶老师。</p>
      <div class="grid g-2">
        <div class="card">
          <h3 style="margin-top:0">概括</h3>
          <p>${esc(s.gaikuo)}</p>
          <h3>对策</h3>
          <p>${esc(s.duice)}</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">综合分析</h3>
          <p>${esc(s.fenxi)}</p>
          <div class="trap"><span class="lab">城市治理原答：</span>${esc(s.chengshi)}</div>
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">应用文</h3>
        <p>${esc(s.yingyong)}</p>
        <div class="trap">${esc(s.missing)}</div>
      </div>
      <h3>60天已对齐的课上原答锚点</h3>
      <div class="card">
        <table>
          <tr><th>题型</th><th>例题</th></tr>
          ${GK.shenlunCases.map((c) => `<tr><td>${esc(c.type)}</td><td>${esc(c.items)}</td></tr>`).join("")}
        </table>
      </div>
    `;
  }

  function viewQuant() {
    const q = GK.methods.shuliang;
    return `
      <p class="lead">数量在你这个月的操作里几乎没有展开。下面只放已经钉死的两条，其余标空。</p>
      <div class="card">
        <h3 style="margin-top:0">已经有的</h3>
        <ul>${q.have.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        <div class="trap">${esc(q.missing)}</div>
      </div>
    `;
  }

  function viewLedger() {
    return `
      <p class="lead">不是鸡汤计划，是这个月对话和材料对得上的缺口。补完一项可以勾掉（只存在本机）。</p>
      ${GK.blanks.map((b, i) => {
        const on = state.doneGaps[i] ? "checked" : "";
        return `<label class="check card" style="display:flex">
          <input type="checkbox" data-gap="${i}" ${on}>
          <div><b>${esc(b.name)}</b><div class="lead" style="margin:4px 0 0">${esc(b.detail)}</div></div>
        </label>`;
      }).join("")}
      <h3>问我时怎么说，才不会串题本</h3>
      <table>
        <tr><th>你怎么说</th><th>查哪本</th></tr>
        ${GK.ask.map((a) => `<tr><td>${esc(a.say)}</td><td>${esc(a.mean)}</td></tr>`).join("")}
      </table>
      <h3>个人备忘</h3>
      <div class="card">
        <textarea rows="6" data-note="notes" placeholder="例如：明天先刷定义刷题1前10题">${esc(state.notes)}</textarea>
      </div>
    `;
  }

  function viewTimeline() {
    return `
      <p class="lead">从8月17日吃毛娃，到9月16日花生27套和片段主题词模板。秋招简历、毕业论文不进这张表。</p>
      <div class="timeline">
        ${GK.timeline.map((t) => `
          <div class="tl">
            <div class="meta">${esc(t.date)} · ${esc(t.sub)}</div>
            <div>${esc(t.do)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function viewLibrary() {
    return `
      <p class="lead">已经做成网页的，点开就能用；DOCX/MD/PDF 仍在原文件夹，工作台只做入口。</p>
      <div class="card links">
        ${GK.library.map((l) => {
          if (l.href) return `<a href="${esc(l.href)}" target="_blank"><span class="tag">${esc(l.sub)}</span> ${esc(l.name)} · ${esc(l.type)}</a>`;
          return `<div style="padding:8px 0;border-bottom:1px dashed var(--line)"><span class="tag">${esc(l.sub)}</span> ${esc(l.name)} · ${esc(l.type)}<div style="font-size:12px;color:var(--muted)">${esc(l.path)}</div></div>`;
        }).join("")}
      </div>
    `;
  }

  function wrongTable(subs) {
    const rows = GK.wrongs.filter((w) => !subs || subs.includes(w.sub));
    return `
      <h3>这个月钉死的错题</h3>
      <div class="card" style="overflow:auto">
        <table>
          <tr><th>科目</th><th>来源</th><th>位置</th><th>错因</th><th>下次动作</th></tr>
          ${rows.map((w) => `<tr>
            <td>${esc(w.sub)}</td><td>${esc(w.src)}</td><td>${esc(w.loc)}</td>
            <td>${esc(w.trap)}</td><td>${esc(w.kou)}</td>
          </tr>`).join("")}
        </table>
      </div>
    `;
  }

  function szItem(t, no, mode, cursor) {
    const note = (state.szNotes && state.szNotes[no]) || "";
    const wCore = t.wDiff || t.wrong;
    const rCore = t.rDiff || t.right;
    const meta = `${esc(t.pack || "")} · ${esc(t.month)} · ${esc(t.qn)}${esc(t.mark)}`;
    const stem = `<div class="sz-stem"><span class="lab">题干钥匙</span>${paintStem(t)}</div>`;
    const inner = mode === "full"
      ? `<div class="row">
          ${stem}
          <div class="meta">${meta}</div>
          <div class="pair">
            <div class="ok"><span class="lab">对：</span>${paintRight(t, t.right)}</div>
            <div class="trap"><span class="lab">错 ${esc(t.mark)}：</span>${paintWrong(t, t.wrong)}</div>
          </div>
        </div>`
      : `<div class="core-line">
          ${stem}
          <div class="core-r"><span class="lab">对</span>${paintRight(t, rCore)}</div>
          <div class="neq" aria-hidden="true">≠</div>
          <div class="core-w"><span class="lab">错</span>${paintWrong(t, wCore)}</div>
          <div class="core-meta">${meta}</div>
        </div>`;
    const cls = ["sz-item"];
    if (cursor && no < cursor) cls.push("is-done");
    if (cursor && no === cursor) cls.push("is-cursor");
    if (String(note).trim()) cls.push("has-note");
    if (state.szInk[no] && state.szInk[no].length) cls.push("has-ink");
    const stamps = ["易错", "已会", "再看"].map((s) => {
      const on = note.includes(`【${s}】`) ? " on" : "";
      return `<button type="button" class="sz-stamp${on}" data-sz-stamp="${s}" data-sz-id="${no}">${s}</button>`;
    }).join("");
    return `<article class="${cls.join(" ")}" data-sz-no="${no}">
      <div class="sz-no">${no}</div>
      <div class="sz-body"><div class="sz-ink-wrap">${inner}<canvas class="sz-ink" data-sz-ink="${no}"></canvas></div></div>
      <aside class="sz-comment">
        <div class="sz-comment-h"><b>${no}</b> 批注</div>
        <div class="sz-marks">${stamps}</div>
        <textarea data-sz-note="${no}" rows="3" placeholder="直接写记号，或改成你自己的记法">${esc(note)}</textarea>
        <button type="button" class="ghost${cursor === no ? " on" : ""}" data-sz-cursor="${no}">${cursor === no ? "已记到这题" : "记到这题"}</button>
        <button type="button" class="ghost" data-sz-ink-clear="${no}">擦掉笔迹</button>
      </aside>
    </article>`;
  }

  function paintSzProgress() {
    const n = state.szCursor || 0;
    const now = document.querySelector("[data-sz-now]");
    if (now) now.textContent = n ? String(n) : "—";
    const noted = Object.values(state.szNotes || {}).filter((v) => String(v || "").trim()).length;
    const notedEl = document.querySelector("[data-sz-noted]");
    if (notedEl) notedEl.textContent = String(noted);
    const jump = document.querySelector("[data-sz-jump]");
    const clear = document.querySelector("[data-sz-clear]");
    if (jump) jump.disabled = !n;
    if (clear) clear.disabled = !n;
    $$(".sz-item").forEach((el) => {
      const no = parseInt(el.dataset.szNo, 10);
      el.classList.toggle("is-done", n > 0 && no < n);
      el.classList.toggle("is-cursor", n > 0 && no === n);
    });
    $$("[data-sz-cursor]").forEach((btn) => {
      const no = parseInt(btn.dataset.szCursor, 10);
      const on = n > 0 && no === n;
      btn.textContent = on ? "已记到这题" : "记到这题";
      btn.classList.toggle("on", on);
    });
    $$("[data-sz-stamp]").forEach((btn) => {
      const text = (state.szNotes && state.szNotes[btn.dataset.szId]) || "";
      btn.classList.toggle("on", text.includes(`【${btn.dataset.szStamp}】`));
    });
  }

  const SZ_PEN = {
    red: { color: "#c41e3a", width: 2.6, alpha: 1 },
    blue: { color: "#1857c4", width: 2.6, alpha: 1 },
    key: { color: "#ffe566", width: 14, alpha: 0.5 }
  };

  function syncPenUi() {
    const onPage = !!document.querySelector("[data-sz-pens]");
    document.body.classList.toggle("sz-drawing", !!szPen && onPage);
    document.body.dataset.pen = szPen || "";
    $$("[data-sz-pen]").forEach((btn) => {
      btn.classList.toggle("on", !!szPen && btn.dataset.szPen === szPen);
    });
    const hint = document.querySelector("[data-sz-pen-hint]");
    if (!hint) return;
    hint.textContent = szPen
      ? "按住鼠标在题目上画。再点一次这支笔，或点收笔，就回到普通翻页。"
      : "选一支笔，就可以用鼠标在题目上画。笔迹会留在这台电脑上。";
  }

  function inkPoint(canvas, e) {
    const r = canvas.getBoundingClientRect();
    const x = r.width ? (e.clientX - r.left) / r.width : 0;
    const y = r.height ? (e.clientY - r.top) / r.height : 0;
    return [
      Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000,
      Math.round(Math.min(1, Math.max(0, y)) * 1000) / 1000
    ];
  }

  function paintInkStroke(ctx, stroke, w, h, dpr) {
    const spec = SZ_PEN[stroke.c] || SZ_PEN.red;
    const pts = stroke.pts || [];
    if (!pts.length) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = spec.alpha;
    ctx.strokeStyle = spec.color;
    ctx.fillStyle = spec.color;
    ctx.lineWidth = spec.width * dpr;
    const x0 = pts[0][0] * w * dpr;
    const y0 = pts[0][1] * h * dpr;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(x0, y0, Math.max(1, spec.width * dpr * 0.5), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w * dpr, pts[i][1] * h * dpr);
      ctx.stroke();
    }
    ctx.restore();
  }

  function redrawInk(canvas) {
    if (!canvas) return;
    const id = canvas.dataset.szInk;
    const strokes = (state.szInk && state.szInk[id]) || [];
    const live = szDraw && szDraw.canvas === canvas && szDraw.stroke;
    if (!strokes.length && !live) {
      if (canvas.width) {
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach((s) => paintInkStroke(ctx, s, w, h, dpr));
    if (live) paintInkStroke(ctx, szDraw.stroke, w, h, dpr);
  }

  function releaseInk(canvas) {
    if (!canvas || (szDraw && szDraw.canvas === canvas)) return;
    if (canvas.width) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  function watchInk() {
    if (szInkObserver) szInkObserver.disconnect();
    const wraps = $$(".sz-ink-wrap");
    if (!wraps.length || !("IntersectionObserver" in window)) {
      $$("[data-sz-ink]").forEach(redrawInk);
      return;
    }
    szInkObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const canvas = en.target.querySelector("[data-sz-ink]");
        if (!canvas) return;
        if (en.isIntersecting) redrawInk(canvas);
        else releaseInk(canvas);
      });
    }, { rootMargin: "240px" });
    wraps.forEach((el) => szInkObserver.observe(el));
  }

  function eraseInkNear(id, p, canvas) {
    const list = (state.szInk && state.szInk[id]) || [];
    if (!list.length) return;
    const r = canvas.getBoundingClientRect();
    const nx = 18 / Math.max(1, r.width);
    const ny = 18 / Math.max(1, r.height);
    const next = list.filter((s) => !(s.pts || []).some((q) => {
      const dx = (q[0] - p[0]) / nx;
      const dy = (q[1] - p[1]) / ny;
      return dx * dx + dy * dy < 1;
    }));
    if (next.length) state.szInk[id] = next;
    else delete state.szInk[id];
  }

  function saveInk() {
    try {
      save(state);
    } catch {
      const hint = document.querySelector("[data-sz-pen-hint]");
      if (hint) hint.textContent = "笔迹存满了，这一笔可能没留下。先擦掉不用的再画。";
    }
  }

  function markInkItem(canvas) {
    const item = canvas && canvas.closest(".sz-item");
    if (!item) return;
    const id = canvas.dataset.szInk;
    item.classList.toggle("has-ink", !!(state.szInk[id] && state.szInk[id].length));
  }

  function endInk() {
    if (!szDraw) return;
    const canvas = szDraw.canvas;
    const id = szDraw.id;
    if (szDraw.stroke && szDraw.stroke.pts.length) {
      if (!state.szInk[id]) state.szInk[id] = [];
      state.szInk[id].push(szDraw.stroke);
      szLastInkId = id;
    }
    szDraw = null;
    saveInk();
    redrawInk(canvas);
    markInkItem(canvas);
  }

  function onInkDown(e) {
    if (!szPen || e.button != null && e.button !== 0) return;
    const canvas = e.target.closest && e.target.closest("[data-sz-ink]");
    if (!canvas) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic tests have no real pointer */ }
    const id = canvas.dataset.szInk;
    const p = inkPoint(canvas, e);
    if (szPen === "erase") szDraw = { canvas, id, erase: true };
    else szDraw = { canvas, id, stroke: { c: szPen, pts: [p] } };
    if (szDraw.erase) eraseInkNear(id, p, canvas);
    redrawInk(canvas);
  }

  function onInkMove(e) {
    if (!szDraw) return;
    const p = inkPoint(szDraw.canvas, e);
    if (szDraw.erase) {
      eraseInkNear(szDraw.id, p, szDraw.canvas);
      redrawInk(szDraw.canvas);
      return;
    }
    const pts = szDraw.stroke.pts;
    const last = pts[pts.length - 1];
    const dx = p[0] - last[0];
    const dy = p[1] - last[1];
    if (dx * dx + dy * dy < 0.000009) return;
    if (pts.length < 900) pts.push(p);
    redrawInk(szDraw.canvas);
  }

  function viewShizheng(cur) {
    const all = window.SZ_TRAPS || [];
    const trap = (cur && cur.trap) || "";
    const month = (cur && cur.month) || "";
    const pack = (cur && cur.pack) || "";
    const q = ((cur && cur.q) || "").trim();
    const mode = (cur && cur.mode) || "core";
    const keys = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all.filter((t) => {
      if (pack && t.pack !== pack) return false;
      if (trap && t.trap !== trap) return false;
      if (month && t.month !== month) return false;
      if (!keys.length) return true;
      const blob = [t.wrong, t.right, t.news, t.wDiff, t.rDiff, t.lock, t.trap, t.pack].join(" ").toLowerCase();
      return keys.every((k) => blob.includes(k));
    });
    const counts = {};
    const packCounts = {};
    all.forEach((t) => {
      counts[t.trap] = (counts[t.trap] || 0) + 1;
      packCounts[t.pack] = (packCounts[t.pack] || 0) + 1;
    });
    const chip = (key, val, label) => {
      const on = (cur && cur[key]) === val ? "on" : "";
      return `<button type="button" class="${on}" data-sz="${key}" data-v="${esc(val)}">${esc(label)}</button>`;
    };
    const monthChips = SZ_MONTHS.filter((m) => all.some((t) => t.month === m && (!pack || t.pack === pack)));
    const noOf = new Map(all.map((t, i) => [t, i + 1]));
    const cursor = state.szCursor || 0;
    const noted = Object.values(state.szNotes).filter((v) => String(v || "").trim()).length;
    const body = rows.map((t) => szItem(t, noOf.get(t), mode, cursor)).join("");
    return `
      <p class="lead">小Y挖坑：绝对化、方向写反、主语偷换、程度/范围加码、正确原理+错误后半句、手册原话挪位。已接入小黑 1–8 月、两会、中央一号（专题+必刷+原文）、十五五农业规划、小Y精选一百条、第35季模考。共 ${all.length} 组，当前显示 ${rows.length} 组。题号按全表顺序固定。正确表述在左，错误表述在右。</p>
      <div class="kou">题干找钥匙，选项找差异。时政选非先圈「错误的是」，再找最刺眼的硬伤：左词只能锁右词。</div>
      ${pensLegend()}
      <div class="sz-progress" data-sz-bar>
        <span>复习记到第 <b data-sz-now>${cursor ? cursor : "—"}</b> 题 / <span data-sz-total>${all.length}</span></span>
        <button type="button" class="ghost" data-sz-jump ${cursor ? "" : "disabled"}>跳到这题</button>
        <button type="button" class="ghost" data-sz-clear ${cursor ? "" : "disabled"}>清除进度</button>
        <span>已写批注 <b data-sz-noted>${noted}</b></span>
        <div class="sz-pens" data-sz-pens>
          <span class="lab">手写笔</span>
          <button type="button" data-sz-pen="red">红笔</button>
          <button type="button" data-sz-pen="blue">蓝笔</button>
          <button type="button" data-sz-pen="key">荧光笔</button>
          <button type="button" data-sz-pen="erase">橡皮</button>
          <button type="button" class="ghost" data-sz-undo>撤销上一笔</button>
          <button type="button" class="ghost" data-sz-pen="off">收笔</button>
          <span class="sz-pen-hint" data-sz-pen-hint>选一支笔，就可以用鼠标在题目上画。笔迹会留在这台电脑上。</span>
        </div>
      </div>
      <div class="filters">
        ${chip("mode", "core", "核心差异")}
        ${chip("mode", "full", "完整原句")}
        <button type="button" data-sz="clear" data-v="">清空筛选</button>
      </div>
      <div class="filters">
        ${SZ_PACKS.map((p) => chip("pack", p, `${p} ${packCounts[p] || 0}`)).join("")}
      </div>
      <div class="filters">
        ${SZ_TYPES.map((t) => chip("trap", t, `${t} ${counts[t] || 0}`)).join("")}
      </div>
      <div class="filters">
        ${monthChips.map((m) => chip("month", m, m)).join("")}
      </div>
      ${q ? `<p class="note"><span class="lab">检索：</span>${esc(q)}（在本页结果里筛）</p>` : ""}
      ${rows.length ? body : `<p class="empty">没有命中。换个专题或挖坑类型，或清空筛选。</p>`}
    `;
  }

  function viewSearch(q) {
    const query = (typeof q === "string" ? q : (q && q.q) || "").trim();
    const keys = query.toLowerCase().split(/\s+/).filter(Boolean);
    const expand = (k) => {
      const out = [k];
      const m = k.match(/^(\d+)\s*套$/);
      if (m) {
        out.push(m[1] + "-");
        out.push("第" + m[1] + "套");
      }
      return out;
    };
    if (!query) {
      return `<p class="lead">搜套次、错因、口诀、科目。例如：27套、主题词、百分点、收音机、长效。</p>${wrongTable()}`;
    }
    const hit = (obj) => {
      const blob = JSON.stringify(obj).toLowerCase();
      return keys.every((k) => expand(k).some((e) => blob.includes(e)));
    };
    const wrongs = GK.wrongs.filter(hit);
    const gaps = GK.blanks.filter(hit);
    const tls = GK.timeline.filter(hit);
    const sz = (window.SZ_TRAPS || []).filter(hit);
    return `
      <p class="lead">关键词「${esc(query)}」：错题 ${wrongs.length} · 时政对错 ${sz.length} · 漏缺 ${gaps.length} · 足迹 ${tls.length}</p>
      ${wrongs.length ? `<h3>错题</h3>` + wrongs.map((w) => `<div class="row"><div class="meta">${esc(w.sub)} · ${esc(w.src)} · ${esc(w.loc)}</div>${esc(w.trap)}<div class="ok"><span class="lab">下次：</span>${esc(w.kou)}</div></div>`).join("") : ""}
      ${sz.length ? `<h3>时政对错</h3>` + pensLegend() + sz.slice(0, 40).map((t) => `<div class="row"><div class="sz-stem"><span class="lab">题干钥匙</span>${paintStem(t)}</div><div class="pair"><div class="ok"><span class="lab">对：</span>${paintRight(t, t.right || t.rDiff)}</div><div class="trap"><span class="lab">错：</span>${paintWrong(t, t.wrong || t.wDiff)}</div></div></div>`).join("") + (sz.length > 40 ? `<p class="note">只显示前 40 组，到「时政对错对照」页看全部。</p>` : "") : ""}
      ${gaps.length ? `<h3>漏缺</h3>` + gaps.map((g) => `<div class="trap"><b>${esc(g.name)}</b> ${esc(g.detail)}</div>`).join("") : ""}
      ${tls.length ? `<h3>足迹</h3>` + tls.map((t) => `<div class="row"><div class="meta">${esc(t.date)} · ${esc(t.sub)}</div>${esc(t.do)}</div>`).join("") : ""}
      ${!wrongs.length && !sz.length && !gaps.length && !tls.length ? `<p class="empty">没有命中。试「四格」「主题词」「入市」「高质量发展」。</p>` : ""}
    `;
  }

  function quizKind(cur) {
    const k = (cur && cur.kind) || "";
    if (k === "all") return "";
    if (!k && cur && cur.name === "yicuo") return "";
    if (!k) return "学习";
    return k;
  }

  function quizQuery(cur, extra) {
    const next = {
      month: (cur && cur.month) || "",
      kind: (cur && cur.kind) || "",
      play: (cur && cur.play) || "",
      i: (cur && cur.i) || 0
    };
    Object.assign(next, extra || {});
    return next;
  }

  function quizPool(cur) {
    const all = window.ZK_QUIZ || [];
    const month = (cur && cur.month) || "";
    const kind = quizKind(cur);
    const play = cur && cur.name === "yicuo" ? "hard" : ((cur && cur.play) || "");
    return all.filter((q) => {
      if (month && q.month !== month) return false;
      if (kind && q.kind !== kind) return false;
      const picked = (state.quiz || {})[q.id];
      if (play === "todo" && picked) return false;
      if (play === "wrong" && !(picked && picked !== q.ans)) return false;
      if (play === "hard" && !(state.quizHard && state.quizHard[q.id])) return false;
      return true;
    });
  }

  function quizPaint(text, q, revealed) {
    const red = [];
    const blue = [];
    if (revealed) {
      (q.fixes || []).forEach((f) => {
        if (f.wrong) red.push(f.wrong);
        if (f.right) blue.push(f.right);
      });
      (q.pairs || []).forEach((p) => {
        if (p.wrong) red.push(p.wrong);
        if (p.wDiff) red.push(p.wDiff, ...splitMarks(p.wDiff));
        if (p.right) blue.push(p.right);
        if (p.rDiff) blue.push(p.rDiff, ...splitMarks(p.rDiff));
      });
      (q.kws || []).forEach((k) => {
        if (k && k.length >= 2) blue.push(k);
      });
    }
    return paint(text, [
      { parts: red, cls: "pen-red" },
      { parts: blue, cls: "pen-blue" },
      { parts: STEM_KEYS, cls: "pen-key" }
    ]);
  }

  function splitStem(stem) {
    const src = String(stem || "");
    const parts = src.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/);
    return {
      lead: (parts[0] || "").trim(),
      items: parts.slice(1).map((s) => s.trim()).filter(Boolean)
    };
  }

  function quizCards(q) {
    const cards = [];
    const shown = [];
    (q.fixes || []).forEach((f) => {
      const label = f.mark ? ` ${f.mark}` : "";
      const right = f.right
        ? `<div class="ok"><span class="lab">对${esc(label)}</span>${quizPaint(f.right, q, true)}</div>`
        : "";
      const wrong = f.wrong
        ? `<div class="trap"><span class="lab">错${esc(label)}</span>${quizPaint(f.wrong, q, true)}</div>`
        : "";
      if (f.wrong) shown.push(f.wrong);
      if (right && wrong) cards.push(`<div class="pair">${right}${wrong}</div>`);
      else if (right || wrong) cards.push(right || wrong);
    });
    const blob = shown.join("");
    (q.pairs || []).forEach((p) => {
      const diff = p.wDiff || "";
      if (diff && blob.includes(diff)) return;
      if (p.wrong && shown.includes(p.wrong)) return;
      if (!p.wrong && !diff) return;
      cards.push(`<div class="pair">
        <div class="ok"><span class="lab">对</span>${quizPaint(p.right || p.rDiff, q, true)}</div>
        <div class="trap"><span class="lab">错</span>${quizPaint(p.wrong || diff, q, true)}</div>
      </div>`);
    });
    if (!shown.length && /均正确|都正确|均符合/.test(q.exp || "")) {
      cards.unshift(`<div class="ok"><span class="lab">对</span>这几项说法都对，没有要改的错句。</div>`);
    }
    return cards.join("");
  }

  function viewQuiz(cur) {
    const all = window.ZK_QUIZ || [];
    if (!all.length) {
      return `<p class="empty">题库没载入。确认 zhengzhi-quiz.js 和页面在同一目录。</p>`;
    }
    const kind = quizKind(cur);
    const month = (cur && cur.month) || "";
    const play = (cur && cur.play) || "";
    const rows = quizPool(cur);
    const kinds = ["学习", "文件", "会议", "综合", "科技", "文体"];
    const kindN = {};
    const monthN = {};
    all.forEach((q) => {
      kindN[q.kind] = (kindN[q.kind] || 0) + 1;
      monthN[q.month] = (monthN[q.month] || 0) + 1;
    });
    const months = Object.keys(monthN).sort((a, b) => {
      const ra = (parseInt(a, 10) || 0) * 2 + (a.includes("下") ? 1 : 0);
      const rb = (parseInt(b, 10) || 0) * 2 + (b.includes("下") ? 1 : 0);
      return ra - rb;
    });
    const chip = (key, val, label, on) =>
      `<button type="button" class="${on ? "on" : ""}" data-quiz-set="${key}" data-v="${esc(val)}">${esc(label)}</button>`;
    const board = cur.name === "yicuo";
    const doneAll = all.filter((q) => state.quiz[q.id]).length;
    const rightAll = all.filter((q) => state.quiz[q.id] === q.ans).length;
    const hardN = Object.keys(state.quizHard || {}).length;
    const filters = `
      <div class="filters">
        ${chip("kind", "学习", `学习 ${kindN["学习"] || 0}`, kind === "学习")}
        ${kinds.filter((k) => k !== "学习").map((k) => chip("kind", k, `${k} ${kindN[k] || 0}`, kind === k)).join("")}
        ${chip("kind", "all", `全部 ${board ? hardN : all.length}`, !kind)}
      </div>
      <div class="filters">
        ${months.map((m) => chip("month", m, `${m} ${monthN[m]}`, month === m)).join("")}
      </div>
      ${board ? `<p class="note"><span class="lab">易错题板块</span>只收你在题库里标过的题。取消标记后，这题会从这里拿掉。<a href="#/quiz">回题库</a></p>` : `
      <div class="filters">
        ${chip("play", "", "这一筛全部", !play)}
        ${chip("play", "todo", "未做", play === "todo")}
        ${chip("play", "wrong", "做错的", play === "wrong")}
        ${chip("play", "hard", `易错 ${hardN}`, play === "hard")}
        <a class="ghost" href="#/yicuo">易错题板块</a>
      </div>`}`;
    const head = `
      <p class="lead">${board ? "这里是单独的易错题。左边是正确表述，右边是错误表述。" : "小黑 1–6 月原题。点 A/B/C/D，选完就锁定，并跳出答案和解析。觉得会再错的，标成易错题。"}</p>
      ${pensLegend()}
      <p class="meta">全库已做 ${doneAll}/${all.length}，做对 ${rightAll}。已标易错 <b data-hard-n>${hardN}</b>。当前 ${rows.length} 题。</p>
      ${filters}`;
    if (!rows.length) {
      const empty = board || play === "hard"
        ? `还没有易错题。到题库里点「标为易错」，题目会收进<a href="#/yicuo">易错题板块</a>。`
        : `这个筛选下没有题。换月份，或切回「这一筛全部」。`;
      return head + `<p class="empty">${empty}</p>`;
    }
    let i = parseInt((cur && cur.i) || "0", 10);
    if (Number.isNaN(i) || i < 0) i = 0;
    if (i >= rows.length) i = rows.length - 1;
    const q = rows[i];
    const picked = state.quiz[q.id] || "";
    const revealed = !!picked;
    const stem = splitStem(q.stem);
    const letters = "ABCDEFGH";
    const opts = (q.opts || []).map((text, idx) => {
      const letter = letters[idx] || String(idx + 1);
      let cls = "quiz-opt";
      if (revealed && letter === q.ans) cls += " is-right";
      else if (revealed && letter === picked) cls += " is-wrong";
      else if (revealed) cls += " is-dim";
      return `<button type="button" class="${cls}" data-quiz-pick="${letter}" data-quiz-id="${esc(q.id)}" ${revealed ? "disabled" : ""}>
        <b>${letter}</b><span>${esc(text)}</span>
      </button>`;
    }).join("");
    const clauses = stem.items.length
      ? `<ol class="quiz-clauses">${stem.items.map((item) => `<li>${quizPaint(item, q, revealed)}</li>`).join("")}</ol>`
      : "";
    let reveal = "";
    if (revealed) {
      const hit = picked === q.ans;
      reveal = `
        <div class="${hit ? "ok" : "trap"}">
          <span class="lab">${hit ? "选对了" : "选错了"}</span>
          你选了 <mark class="${hit ? "pen-blue" : "pen-red"}">${esc(picked)}</mark>
          · 答案 <mark class="pen-blue">${esc(q.ans)}</mark>
        </div>
        ${quizCards(q)}
        <div class="note"><span class="lab">解析</span>${quizPaint(q.exp, q, true)}</div>`;
    }
    const traps = (q.pairs || []).map((p) => p.trap).filter(Boolean);
    const trapTag = traps.length ? `<span class="tag">${esc([...new Set(traps)].join(" · "))}</span>` : "";
    const marked = !!(state.quizHard && state.quizHard[q.id]);
    return `
      ${head}
      <div class="card quiz-card${marked ? " is-hard" : ""}">
        <div class="meta">${esc(q.month)} · ${esc(q.qn)} · ${esc(q.kind)} ${trapTag}${marked ? ` <span class="tag gold">易错</span>` : ""}</div>
        <h3 style="margin:6px 0 0">${esc(q.news || "时政题")}</h3>
        <p class="quiz-lead">${quizPaint(stem.lead || q.stem, q, revealed)}</p>
        ${clauses}
        <div class="quiz-opts">${opts}</div>
        ${reveal}
        <div class="quiz-nav">
          <button type="button" class="ghost" data-quiz-nav="${i - 1}" ${i <= 0 ? "disabled" : ""}>上一题</button>
          <span>${i + 1} / ${rows.length}</span>
          <button type="button" class="ghost" data-quiz-nav="${i + 1}" ${i >= rows.length - 1 ? "disabled" : ""}>下一题</button>
          <button type="button" class="ghost quiz-hard${marked ? " on" : ""}" data-quiz-hard="${esc(q.id)}">${marked ? "已标易错" : "标为易错"}</button>
          ${revealed ? `<button type="button" class="ghost" data-quiz-reset="${esc(q.id)}">这题重做</button>` : ""}
        </div>
      </div>`;
  }

  function setRoute(cur) {
    if (typeof cur === "string") cur = { name: cur, q: arguments[1] || "" };
    const name = cur.name;
    const route = routes[name] || routes.overview;
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
    $("#title").textContent = route.title;
    $("#view").innerHTML = route.render(cur);
    bind();
    if (szPendingScroll) {
      const n = szPendingScroll;
      szPendingScroll = 0;
      const el = document.querySelector(`[data-sz-no="${n}"]`);
      if (el) el.scrollIntoView({ block: "center" });
    }
  }

  function current() {
    const hash = (location.hash || "#/overview").replace(/^#\/?/, "");
    const [name, ...rest] = hash.split("?");
    const params = new URLSearchParams(rest.join("?") || "");
    return {
      name: routes[name] ? name : "overview",
      q: params.get("q") || "",
      trap: params.get("trap") || "",
      month: params.get("month") || "",
      pack: params.get("pack") || "",
      mode: params.get("mode") || "core",
      kind: params.get("kind") || "",
      play: params.get("play") || "",
      i: params.get("i") || "0"
    };
  }

  function bind() {
    $$("[data-daily]").forEach((el) => {
      el.onchange = () => {
        state.daily[el.dataset.daily] = el.checked;
        save(state);
      };
    });
    $$("[data-gap]").forEach((el) => {
      el.onchange = () => {
        state.doneGaps[el.dataset.gap] = el.checked;
        save(state);
      };
    });
    $$("[data-note]").forEach((el) => {
      el.oninput = () => {
        state[el.dataset.note] = el.value;
        save(state);
      };
    });
    $$("[data-sz-note]").forEach((el) => {
      el.oninput = () => {
        const id = el.dataset.szNote;
        if (el.value) state.szNotes[id] = el.value;
        else delete state.szNotes[id];
        save(state);
        const item = el.closest(".sz-item");
        if (item) item.classList.toggle("has-note", !!el.value.trim());
        paintSzProgress();
      };
    });
    syncPenUi();
    watchInk();
  }

  function go(name, qOrObj) {
    const p = new URLSearchParams();
    if (typeof qOrObj === "string") {
      if (qOrObj) p.set("q", qOrObj);
    } else if (qOrObj && typeof qOrObj === "object") {
      Object.entries(qOrObj).forEach(([k, v]) => {
        if (v === 0 || v) p.set(k, String(v));
      });
    }
    const qs = p.toString();
    location.hash = `#/${name}${qs ? "?" + qs : ""}`;
  }

  window.addEventListener("hashchange", () => {
    const cur = current();
    if (cur.name === "search" || cur.name === "shizheng") $("#q").value = cur.q;
    setRoute(cur);
  });

  function runSearch() {
    const q = ($("#q").value || "").trim();
    const cur = current();
    if (cur.name === "shizheng") {
      go("shizheng", { q, trap: cur.trap, month: cur.month, pack: cur.pack, mode: cur.mode });
    } else {
      go("search", q);
    }
  }

  $("#q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  $("#goSearch").addEventListener("click", runSearch);

  function handleQuizClick(e) {
    const pick = e.target.closest("[data-quiz-pick]");
    if (pick) {
      e.preventDefault();
      const id = pick.dataset.quizId;
      if (!id || state.quiz[id] || pick.disabled) return true;
      state.quiz[id] = pick.dataset.quizPick;
      save(state);
      setRoute(current());
      return true;
    }
    const reset = e.target.closest("[data-quiz-reset]");
    if (reset) {
      e.preventDefault();
      delete state.quiz[reset.dataset.quizReset];
      save(state);
      setRoute(current());
      return true;
    }
    const nav = e.target.closest("[data-quiz-nav]");
    if (nav) {
      e.preventDefault();
      if (nav.disabled) return true;
      const cur = current();
      const rows = quizPool(cur);
      let i = parseInt(nav.dataset.quizNav, 10);
      if (Number.isNaN(i)) i = 0;
      i = Math.max(0, Math.min(rows.length - 1, i));
      go(cur.name === "yicuo" ? "yicuo" : "quiz", quizQuery(cur, { i }));
      return true;
    }
    const hard = e.target.closest("[data-quiz-hard]");
    if (hard) {
      e.preventDefault();
      const id = hard.dataset.quizHard;
      if (!id) return true;
      if (state.quizHard[id]) delete state.quizHard[id];
      else state.quizHard[id] = 1;
      save(state);
      const cur = current();
      if (cur.name === "yicuo" || cur.play === "hard") setRoute(cur);
      else {
        const on = !!state.quizHard[id];
        hard.classList.toggle("on", on);
        hard.textContent = on ? "已标易错" : "标为易错";
        const card = hard.closest(".quiz-card");
        if (card) card.classList.toggle("is-hard", on);
        const n = document.querySelector("[data-hard-n]");
        if (n) n.textContent = String(Object.keys(state.quizHard).length);
      }
      return true;
    }
    const set = e.target.closest("[data-quiz-set]");
    if (set) {
      e.preventDefault();
      const cur = current();
      const key = set.dataset.quizSet;
      const val = set.dataset.v || "";
      const extra = { i: 0 };
      extra[key] = val;
      if (key === "month" && cur.month === val) extra.month = "";
      if (key === "play" && (cur.play || "") === val) extra.play = "";
      go(cur.name === "yicuo" ? "yicuo" : "quiz", quizQuery(cur, extra));
      return true;
    }
    return false;
  }

  function handleSzMark(e) {
    const penBtn = e.target.closest("[data-sz-pen]");
    if (penBtn) {
      e.preventDefault();
      const v = penBtn.dataset.szPen;
      szPen = v === "off" || szPen === v ? "" : v;
      syncPenUi();
      return true;
    }
    if (e.target.closest("[data-sz-undo]")) {
      e.preventDefault();
      const id = szLastInkId;
      if (id && state.szInk[id] && state.szInk[id].length) {
        state.szInk[id].pop();
        if (!state.szInk[id].length) delete state.szInk[id];
        saveInk();
        const canvas = document.querySelector(`[data-sz-ink="${id}"]`);
        if (canvas) {
          redrawInk(canvas);
          markInkItem(canvas);
        }
      }
      return true;
    }
    const wipe = e.target.closest("[data-sz-ink-clear]");
    if (wipe) {
      e.preventDefault();
      const id = wipe.dataset.szInkClear;
      delete state.szInk[id];
      saveInk();
      const canvas = document.querySelector(`[data-sz-ink="${id}"]`);
      if (canvas) {
        redrawInk(canvas);
        markInkItem(canvas);
      }
      return true;
    }
    const stamp = e.target.closest("[data-sz-stamp]");
    if (stamp) {
      e.preventDefault();
      const id = stamp.dataset.szId;
      const tag = `【${stamp.dataset.szStamp}】`;
      const cur = state.szNotes[id] || "";
      const next = cur.includes(tag)
        ? cur.replace(tag, "").replace(/\s{2,}/g, " ").trim()
        : (tag + (cur ? " " + cur : "")).trim();
      if (next) state.szNotes[id] = next;
      else delete state.szNotes[id];
      save(state);
      const ta = document.querySelector(`[data-sz-note="${id}"]`);
      if (ta) ta.value = next;
      const item = stamp.closest(".sz-item");
      if (item) item.classList.toggle("has-note", !!next);
      paintSzProgress();
      return true;
    }
    const cursorBtn = e.target.closest("[data-sz-cursor]");
    if (cursorBtn) {
      e.preventDefault();
      state.szCursor = parseInt(cursorBtn.dataset.szCursor, 10) || 0;
      save(state);
      paintSzProgress();
      return true;
    }
    if (e.target.closest("[data-sz-clear]")) {
      e.preventDefault();
      state.szCursor = 0;
      save(state);
      paintSzProgress();
      return true;
    }
    if (e.target.closest("[data-sz-jump]")) {
      e.preventDefault();
      const n = state.szCursor || 0;
      if (!n) return true;
      const el = document.querySelector(`[data-sz-no="${n}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      else {
        szPendingScroll = n;
        go("shizheng", { mode: current().mode });
      }
      return true;
    }
    return false;
  }

  $("#view").addEventListener("pointerdown", onInkDown);
  $("#view").addEventListener("pointermove", onInkMove);
  $("#view").addEventListener("pointerup", endInk);
  $("#view").addEventListener("pointercancel", endInk);
  window.addEventListener("pointerup", endInk);
  window.addEventListener("pointercancel", endInk);
  window.addEventListener("resize", () => {
    if (!document.querySelector("[data-sz-ink]")) return;
    $$("[data-sz-ink]").forEach((canvas) => {
      const r = canvas.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) redrawInk(canvas);
    });
  });

  $("#view").addEventListener("click", (e) => {
    if (handleQuizClick(e)) return;
    if (handleSzMark(e)) return;
    const btn = e.target.closest("[data-sz]");
    if (!btn) return;
    e.preventDefault();
    const cur = current();
    const key = btn.dataset.sz;
    const val = btn.dataset.v || "";
    if (key === "clear") {
      go("shizheng", { mode: cur.mode });
      return;
    }
    const next = { q: cur.q, trap: cur.trap, month: cur.month, pack: cur.pack, mode: cur.mode };
    next[key] = next[key] === val ? "" : val;
    if (key === "pack") next.month = "";
    go("shizheng", next);
  });

  $$(".nav a").forEach((a) => {
    a.addEventListener("click", (e) => {
      if (!a.dataset.route) return;
      e.preventDefault();
      go(a.dataset.route);
    });
  });

  function renderWho() {
    const el = $("#who");
    if (!el) return;
    el.innerHTML = `
      <span class="who-lab">账号</span>
      ${accountBook.accounts.map((a) => `<button type="button" class="who-btn${a.id === accountBook.current ? " on" : ""}" data-account="${esc(a.id)}">${esc(a.name)}</button>`).join("")}
      <button type="button" class="ghost" data-account-rename>改名</button>
    `;
  }

  function saveAccountBook() {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accountBook));
  }

  function switchAccount(id) {
    if (!accountBook.accounts.some((a) => a.id === id) || id === accountBook.current) return;
    accountBook.current = id;
    saveAccountBook();
    location.reload();
  }

  function startRename() {
    const mine = accountBook.accounts.find((a) => a.id === accountBook.current);
    const el = $("#who");
    if (!el || !mine) return;
    el.innerHTML = `
      <span class="who-lab">改名</span>
      <input id="whoName" maxlength="12" value="${esc(mine.name)}">
      <button type="button" class="ghost" data-account-save>保存</button>
    `;
    const input = $("#whoName");
    if (input) input.focus();
  }

  function saveRename() {
    const input = $("#whoName");
    const mine = accountBook.accounts.find((a) => a.id === accountBook.current);
    if (!input || !mine) return;
    const name = input.value.trim().slice(0, 12);
    if (name) mine.name = name;
    saveAccountBook();
    renderWho();
  }

  const who = $("#who");
  if (who) {
    who.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-account]");
      if (btn) {
        switchAccount(btn.dataset.account);
        return;
      }
      if (e.target.closest("[data-account-rename]")) startRename();
      if (e.target.closest("[data-account-save]")) saveRename();
    });
    who.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.id === "whoName") saveRename();
    });
    renderWho();
  }

  const init = current();
  if (init.name === "search" || init.name === "shizheng") $("#q").value = init.q;
  setRoute(init);
  pullSync();
  window.addEventListener("pagehide", () => {
    if (syncReady) pushSync(state);
  });
})();

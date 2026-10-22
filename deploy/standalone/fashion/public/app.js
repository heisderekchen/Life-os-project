import { requestJSON } from "./request.js";
const API_BASE = location.pathname.startsWith("/fashion/") ? "/fashion" : "";
const $ = (s) => document.querySelector(s),
  root = $("#root");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const url = (v) => {
  try {
    const u = new URL(v);
    return /^https?:$/.test(u.protocol) ? esc(u.href) : "";
  } catch {
    return "";
  }
};
const icons = {
  home: "house",
  menu: "list",
  tasks: "magnifying-glass",
  delivery: "archive",
  back: "arrow-left",
  link: "arrow-square-out",
  arrow: "arrow-right",
  caret: "caret-up",
};
const icon = (name) =>
  `<span class="icon" aria-hidden="true" style="--icon-image:url('assets/icons/${icons[name] || icons.tasks}.svg')"></span>`;
let menuCloseTimer;
let state = {
    account: null,
    demo: true,
    tasks: [],
    sourceCatalog: [],
    page: "home",
    menuOpen: false,
    id: null,
    filter: "all",
    resultFilter: "all",
    visibleCount: 60,
  },
  timer,
  noticeTimer,
  draft = null;
const day = (v) =>
  v
    ? new Date(v).toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "发布日期未确认";
const selected = (t) =>
  t.items.filter((i) => i.selected && i.review === "verified");
const status = (t) =>
  t.status === "running"
    ? "检索中"
    : t.status === "error"
      ? "执行异常"
      : t.status === "delivered"
        ? "已交付"
        : selected(t).length
          ? "可交付"
          : "待核查";
const reviewLabels = {
  pending: "待核查",
  verified: "已核查",
  uncertain: "存疑",
  excluded: "已排除",
};
function notice(message) {
  $("#notice").textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($("#notice").textContent = ""), 4500);
}
async function api(path, body) {
  const { response: r, data } = await requestJSON(API_BASE + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { timeoutMs: body === undefined ? 15000 : 90000 });
  if (!r.ok) {
    if (r.status === 401) {
      state.account = null;
      render();
    }
    throw Error(data.error || "操作失败，请重试。");
  }
  return data;
}
function go(page, id = null) {
  draft = null;
  state.menuOpen = false;
  clearTimeout(menuCloseTimer);
  state.page = page;
  state.id = id;
  state.resultFilter = "all";
  state.visibleCount = 60;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
  const heading = root.querySelector("h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
function shell(content) {
  const current = ["tasks", "new", "detail"].includes(state.page)
    ? "tasks"
    : ["deliveries", "delivery"].includes(state.page)
      ? "deliveries"
      : "home";
  const entries = [
    ["home", "工作台", "home"],
    ["tasks", "检索任务", "tasks"],
    ["deliveries", "交付结果", "delivery"],
  ];
  root.innerHTML = `<div class="app ${state.page === "home" ? "app--home" : ""}">${state.page === "home" ? "" : `<header class="topbar"><button class="wordmark" data-page="home">鞋履设计工作台</button>${state.guest ? "" : `<button class="text-button" data-action="logout">退出</button>`}</header>`}<main class="main ${state.page === "home" ? "main--home" : ""}" id="main" data-screen="${state.page}">${content}</main><nav class="workspace-menu" aria-label="工作台功能" data-expanded="false"><div class="workspace-menu__panel" id="function-menu" hidden inert aria-hidden="true">${entries.map(([page, text, name]) => `<button type="button" data-page="${page}" ${page === current ? 'aria-current="page"' : ""}>${icon(name)}<span>${text}</span></button>`).join("")}</div><button class="workspace-menu__toggle" id="menu-toggle" type="button" aria-label="功能菜单" aria-expanded="false" aria-controls="function-menu">${icon("menu")}</button></nav></div>`;
  state.menuOpen = false;
  bind();
}
function home() {
  return `<header class="studio-hero"><div class="studio-hero__copy"><p class="studio-brand">鞋履设计工作台</p><h1>工作台</h1></div></header><section class="studio-modules" aria-label="功能模块"><article class="studio-module module-search"><div class="module-copy"><h2>检索任务</h2><button type="button" class="module-entry" data-page="tasks">进入检索${icon("arrow")}</button></div><img class="module-photo" src="assets/loafer-study.webp" alt="" width="1086" height="1448" fetchpriority="high"></article><article class="studio-module module-delivery"><img class="module-photo" src="assets/ballet-research.webp" alt="" width="1196" height="1315" loading="lazy"><div class="module-copy"><h2>交付结果</h2><button type="button" class="module-entry" data-page="deliveries">查看交付${icon("arrow")}</button></div></article></section>`;
}
function setMenu(open, returnFocus = false) {
  const host = root.querySelector(".workspace-menu"),
    panel = $("#function-menu"),
    trigger = $("#menu-toggle");
  if (!host || !panel || !trigger) return;
  clearTimeout(menuCloseTimer);
  state.menuOpen = open;
  trigger.setAttribute("aria-expanded", String(open));
  panel.setAttribute("aria-hidden", String(!open));
  panel.toggleAttribute("inert", !open);
  if (open) {
    panel.hidden = false;
    host.dataset.expanded = "true";
    panel.querySelector('[aria-current="page"]')?.focus();
  } else {
    host.dataset.expanded = "false";
    menuCloseTimer = setTimeout(() => {
      if (!state.menuOpen) panel.hidden = true;
    }, 170);
    if (returnFocus) trigger.focus();
  }
}
// Navigation is nonmodal: outside taps and Escape dismiss it without blocking the page.
document.addEventListener("pointerdown", (event) => {
  if (state.menuOpen && !event.target.closest(".workspace-menu"))
    setMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (!state.menuOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    setMenu(false, true);
  }
  if (
    ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(event.key) &&
    event.target.closest("#function-menu")
  ) {
    event.preventDefault();
    const items = [...root.querySelectorAll("#function-menu [data-page]")];
    const current = items.indexOf(document.activeElement);
    items[
      (current + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + items.length) %
        items.length
    ]?.focus();
  }
});
document.addEventListener("focusin", (event) => {
  if (state.menuOpen && !event.target.closest(".workspace-menu"))
    setMenu(false);
});
function login() {
  root.innerHTML = `<main class="login"><span class="wordmark">鞋履检索工作台</span><h1>从检索到交付</h1><p>查找鞋履信息，核对原始来源，把值得参考的款式留下来。</p>${state.demo ? '<button class="primary" data-login="demo-a">进入体验工作台</button><button class="secondary" data-login="demo-b">体验另一个独立账号</button><p class="hint">本地体验版 · 两个账号分别保存任务。历史素材示例与实时检索分开标记。</p>' : '<form id="login-form"><label class="field">账号<input name="account" autocomplete="username" required></label><label class="field">密码<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">进入工作台</button><p class="error-text" role="alert"></p></form>'}</main>`;
  root
    .querySelectorAll("[data-login]")
    .forEach((b) => (b.onclick = () => enter({ account: b.dataset.login }, b)));
  $("#login-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    enter(Object.fromEntries(new FormData(e.target)), e.submitter);
  });
}
async function enter(body, button) {
  button.disabled = true;
  try {
    const d = await api("/login", body);
    state.account = d.account;
    state.tasks = (await api("/tasks")).tasks;
    go("home");
  } catch (e) {
    notice(e.message);
    button.disabled = false;
  }
}
function row(t, delivery = false) {
  const count = delivery ? t.delivery.items.length : t.items.length;
  return `<button class="task-row" data-open="${t.id}" data-delivery="${delivery}"><span class="row-top"><h3>${esc(t.input.subject)}</h3><span class="status ${t.status}">${delivery ? "已交付" : status(t)}</span></span><p>${esc(sourceScopeText(t.input))} · ${t.input.days ? "近 " + t.input.days + " 天" : "不限时间"}</p><span class="row-foot"><span>${t.sample ? "历史示例 · " : ""}${count} 条${delivery ? "交付结果" : "检索结果"}${delivery ? "" : " · 已选 " + selected(t).length + " 条"}</span><span>${day(delivery ? t.delivery.createdAt : t.createdAt)}</span></span></button>`;
}
function tasks() {
  const list = state.tasks.filter(
    (t) =>
      state.filter === "all" ||
      (state.filter === "review"
        ? t.status === "review"
        : t.status === state.filter),
  );
  return `<div class="page-head"><div><h1>检索任务</h1></div><button class="primary new-link" data-page="new">新建任务</button></div><div class="tabs" role="tablist" aria-label="任务状态">${[
    ["all", "全部"],
    ["running", "检索中"],
    ["review", "待核查"],
    ["delivered", "已交付"],
  ]
    .map(
      ([v, l]) =>
        `<button role="tab" aria-selected="${state.filter === v}" data-filter="${v}">${l}</button>`,
    )
    .join(
      "",
    )}</div><section class="list-region ${list.length ? "" : "empty-state"}" aria-label="检索任务列表">${list.length ? list.map((t) => row(t)).join("") : `<span class="empty-icon">${icon("tasks")}</span><h2>${state.filter === "all" ? "暂无检索任务" : { running: "暂无检索中的任务", review: "暂无待核查任务", delivered: "暂无已交付任务" }[state.filter]}</h2>${state.tasks.length ? '<button class="text-button" data-filter="all">查看全部任务</button>' : ""}`}</section>`;
}
const scopeNames = ["聚焦", "均衡", "广泛"];
const scopeDescriptions = ["只查选中来源", "选中来源 + 公开图片", "选中来源 + 更多公开图片"];
function sourceScopeText(input) {
  if (input.sourceScope === undefined) return input.domains.length ? input.domains.join("、") : "公开网站检索";
  const selected = state.sourceCatalog.filter(source => input.sources?.includes(source.id)).map(source => source.label);
  return `${scopeNames[input.sourceScope]} · ${[...selected, ...(input.domains.length ? ["补充来源"] : [])].join("、") || "公开来源"}`;
}
function newTask() {
  const scope = Number(draft?.sourceScope ?? 1);
  const chosen = draft?.sources || state.sourceCatalog.map(source => source.id);
  return `<div class="new-form"><button class="back" data-page="tasks">${icon("back")}返回任务</button><div class="page-head"><h1>新建检索任务</h1></div><form class="form search-form" id="task-form"><label class="field">想找什么<textarea name="subject" maxlength="180" required placeholder="例如：女款乐福鞋，新材质与金属装饰">${esc(draft?.subject || "")}</textarea></label><section class="source-control" aria-labelledby="source-label"><div class="source-control__head"><h2 id="source-label">关注来源</h2><output id="scope-value" for="source-scope">${scopeNames[scope]}</output></div><input id="source-scope" class="source-range" type="range" name="sourceScope" min="0" max="2" step="1" value="${scope}" aria-labelledby="source-label" aria-describedby="scope-description" aria-valuetext="${scopeNames[scope]}：${scopeDescriptions[scope]}" style="--range-fill:${scope * 50}%"><div class="scope-stops">${scopeNames.map((label,index) => `<button type="button" data-scope="${index}" aria-pressed="${index === scope}">${label}</button>`).join("")}</div><p class="scope-description" id="scope-description">${scopeDescriptions[scope]}</p><div class="source-options">${state.sourceCatalog.map(source => `<label class="source-option"><input type="checkbox" name="sources" value="${esc(source.id)}" ${chosen.includes(source.id) ? "checked" : ""}><span>${esc(source.label)}</span></label>`).join("")}<span class="source-option source-option--extra" data-extra="news" ${scope < 1 ? "hidden" : ""}>公开图片</span><span class="source-option source-option--extra" data-extra="web" ${scope < 2 ? "hidden" : ""}>更多图片候选</span></div></section><div class="field"><span id="period-label">时间范围</span><div class="choices" role="group" aria-labelledby="period-label">${[[7,"近 7 天"],[30,"近 30 天"],[90,"近 90 天"],[0,"不限"]].map(([value,label]) => `<button type="button" data-days="${value}" aria-pressed="${Number(draft?.days ?? 0) === value}">${label}</button>`).join("")}</div><input type="hidden" name="days" value="${draft?.days ?? 0}"></div><div class="search-submit"><button class="primary" type="submit">开始检索${icon("arrow")}</button><p>最新优先 · 重复链接合并</p></div><p class="error-text" role="alert" id="form-error"></p></form></div>`;
}
function updateSourceScope(value) {
  const scope = Number(value), range = $("#source-scope");
  range.value = scope;
  range.style.setProperty("--range-fill", `${scope * 50}%`);
  range.setAttribute("aria-valuetext", `${scopeNames[scope]}：${scopeDescriptions[scope]}`);
  $("#scope-value").textContent = scopeNames[scope];
  $("#scope-description").textContent = scopeDescriptions[scope];
  root.querySelectorAll("[data-scope]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.scope) === scope)));
  root.querySelector('[data-extra="news"]').hidden = scope < 1;
  root.querySelector('[data-extra="web"]').hidden = scope < 2;
}
function image(i) {
  if (i.imageUnavailable) return '<div class="no-image">来源图片暂不可用 · 请重新检索，失效图片不能选入交付</div>';
  return i.image
    ? `<div class="photo"><a class="image-open" href="${i.imageSha256 ? API_BASE + "/api/images/" + i.imageSha256 : url(i.image)}" target="_blank" rel="noopener noreferrer" aria-label="查看图片：${esc(i.title)}"><img src="${i.imageSha256 ? API_BASE + "/api/images/" + i.imageSha256 : url(i.image)}" alt="${esc(i.title)}" loading="lazy" referrerpolicy="no-referrer"></a><span>${i.imageKind === "historical-sample" ? "历史参考图，需重新核查" : i.sourceImageMatched ? "已核对原页面包含此图 · 点击查看大图" : "来源页面预览图，需人工确认是否对应鞋款"}</span></div>`
    : '<div class="no-image">暂无来源配图 · 请打开原文查看鞋款</div>';
}
function result(i, readonly = false) {
  return `<article class="result" data-result="${i.id}">${image(i)}<div class="result-body"><h3>${esc(i.title)}</h3><div class="source-line"><span>${esc(i.source)} · ${day(i.publishedAt)}</span><a href="${url(i.url)}" target="_blank" rel="noopener noreferrer">打开原始来源 ${icon("link")}</a><span class="print-url" hidden>${esc(i.url)}</span></div>${i.summary ? `<p class="summary">${esc(i.summary)}</p>` : ""}<div class="review-meta"><span class="status ${i.review === "verified" ? "ready" : ""}">${reviewLabels[i.review]}</span><span class="small">${i.selected ? "已选入交付" : ""}</span></div>${
    readonly
      ? `<p class="review-note">${esc(i.note)}</p><p class="hint">采集于 ${day(i.collectedAt)}${i.reviewedAt ? " · 人工核查于 " + day(i.reviewedAt) : ""}</p>`
      : `<details><summary>核查与选入${i.note ? " · 已有记录" : ""}</summary><form class="review-form" data-review="${i.id}"><label>核查状态<select name="review">${Object.entries(
          reviewLabels,
        )
          .map(
            ([v, l]) =>
              `<option value="${v}" ${i.review === v ? "selected" : ""}>${l}</option>`,
          )
          .join(
            "",
          )}</select></label><label>核查依据与选入理由<textarea name="note" maxlength="2000" placeholder="例如：原文鞋款与图片一致；材质尚需确认">${esc(i.note)}</textarea></label><label class="check"><input type="checkbox" name="selected" ${i.selected ? "checked" : ""}>选入本次交付</label><p class="hint">核查通过需填写依据。只有已核查结果可选入交付。</p><button class="secondary" type="submit">保存核查</button><p class="error-text" role="alert"></p></form></details>`
  }</div></article>`;
}
let refreshError = '';
let refreshing = false;
function searchStatus(t) {
  const p = t.progress || {};
  const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(p.startedAt || t.updatedAt || t.createdAt)) / 1000));
  if (typeof p.plannedSources === 'number' && p.stage === 'source-queue') {
    const heading = '正在分批检索来源';
    const counts = `已查询 ${p.queriedSources || 0} / ${p.plannedSources || 0} 个来源 · 有素材 ${p.matchedSources || 0} 个 · 失败 ${p.failedSources || 0} 个`;
    const clock = `已保留 ${p.accepted || 0} 条素材，检索会继续在后台进行`;
    return { heading, counts, clock };
  }
  if (typeof p.plannedSources === 'number' && (p.stage === 'done' || p.stage === 'error')) {
    const heading = p.stage === 'error' ? '来源检索已中断' : '来源检索已完成';
    const counts = `已查询 ${p.queriedSources || 0} / ${p.plannedSources || 0} 个来源 · 有素材 ${p.matchedSources || 0} 个 · 失败 ${p.failedSources || 0} 个`;
    const clock = `已保留 ${p.accepted || 0} 条素材`;
    return { heading, counts, clock };
  }
  if (p.targetResults) return {
    heading: p.stage === 'verify' ? '正在核对商品与原图' : '正在补充图片线索',
    counts: `已保留 ${p.accepted || 0} / ${p.targetResults} 条图片线索 · 已核对 ${p.checked || 0} 个商品候选`,
    clock: `已用时 ${elapsed} 秒 · 第 ${p.round || 1} 轮检索`,
  };
  const limit = p.deadlineAt ? Math.ceil((Date.parse(p.deadlineAt) - Date.parse(p.startedAt)) / 1000) : 90;
  const heading = p.stage === 'verify' ? '正在核对原始来源与图片' : '正在检索公开来源';
  const counts = p.stage === 'verify' ? `已核对 ${p.checked || 0} / ${p.candidates || 0} 条候选 · 已保留 ${p.accepted || 0} 条`
    : `已完成 ${p.channelsDone || 0}${p.totalChannels ? ' / ' + p.totalChannels : ''} 组检索`;
  const clock = elapsed >= limit ? '正在同步任务状态…' : `已用时 ${elapsed} 秒 · 单次检索最多 ${limit} 秒`;
  return { heading, counts, clock };
}
function runningState(t) {
  const { heading, counts, clock } = searchStatus(t);
  return `<section class="run-state"><h2 data-run-heading>${heading}</h2><div class="activity" aria-hidden="true"></div><p data-run-counts role="status">${counts}</p><p data-run-clock>${clock}</p><p class="error-text" data-run-connection role="alert" ${refreshError ? '' : 'hidden'}>${esc(refreshError)}</p><button class="text-button" data-action="refresh">刷新状态</button></section>`;
}
function updateRunningState() {
  const task = state.tasks.find(t => t.id === state.id);
  if (state.page !== 'detail' || task?.status !== 'running') return;
  const values = searchStatus(task);
  for (const key of ['heading', 'counts', 'clock']) {
    const node = root.querySelector('[data-run-' + key + ']');
    if (node) node.textContent = values[key];
  }
  const connection = root.querySelector('[data-run-connection]');
  if (connection) { connection.hidden = !refreshError; connection.textContent = refreshError; }
}
function debugHistory(t) {
  if (t.sample) return '';
  const runs = t.debugRuns || [];
  const label = { running: '执行中', review: '已结束', error: '失败', 'timed-out': '超时', interrupted: '服务重启中断' };
  return `<details class="channel-log debug-log"><summary>搜索调试记录 · ${runs.length} 次执行</summary><p class="hint">逐轮保存查询、请求、候选与筛选原因；重试会保留前一轮记录。下载的 JSONL 文件可用于排查。</p>${runs.length ? `<ol>${[...runs].reverse().map(run => `<li><p>${esc(new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false }))} · ${esc(label[run.status] || run.status)}${run.resultCount !== undefined ? ` · ${Number(run.resultCount)} 条结果` : ''}</p><p class="small">执行编号：${esc(run.id)} · 版本 ${esc(run.version)} · ${Number(run.events) || 0} 条记录${run.durationMs !== undefined ? ` · ${(run.durationMs / 1000).toFixed(1)} 秒` : ''}</p>${run.storageError ? `<p class="error-text" role="alert">日志写入失败：${esc(run.storageError.message)}，部分记录可能未保存。</p>` : ''}${run.droppedEvents || run.documentSamplesOmitted ? `<p class="hint">已达到部分采样上限：省略 ${Number(run.droppedEvents) || 0} 条事件、${Number(run.documentSamplesOmitted) || 0} 份网页样本，下载文件中保留计数。</p>` : ''}<a class="text-button" href="${API_BASE}/api/tasks/${esc(t.id)}/debug?run=${esc(run.id)}" download>下载${run.status === 'running' ? '当前' : '本轮'}调试记录</a></li>`).join('')}</ol>` : '<p class="hint">历史执行未保存详细日志；新建或重试任务后开始记录。</p>'}</details>`;
}
function detail(t) {
  const n = selected(t).length;
  const items = [...t.items].sort((a,b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)).filter(
    (i) =>
      state.resultFilter === "all" ||
      (state.resultFilter === "selected"
        ? i.selected
        : i.review === state.resultFilter),
  );
  return `<button class="back" data-page="tasks">${icon("back")}返回任务</button><section class="task-summary"><div class="tag-line"><span class="status ${t.status}">${status(t)}</span>${t.sample ? '<span class="status sample">历史示例</span>' : ""}</div><h1>${esc(t.input.subject)}</h1><p>${t.input.days ? "近 " + t.input.days + " 天" : "不限时间"} · ${esc(sourceScopeText(t.input))}</p><p>创建于 ${day(t.createdAt)}</p><div class="counts"><span><b>${t.items.length}</b>条结果</span><span><b>${t.items.filter((i) => i.review === "verified").length}</b>条已核查</span><span><b>${n}</b>条已选</span></div></section>${t.sample ? `<p class="banner sample">${esc(t.message)}</p>` : ""}${t.status === "running" ? runningState(t) : t.status === "error" ? `<div class="banner error" role="alert">${esc(t.message)}</div><button class="secondary" data-action="retry">重试检索</button>` : t.delivery ? '<p class="banner">本任务已形成交付结果。重新打开后可继续调整。</p><button class="primary" data-action="view-delivery">查看交付结果</button>' : t.items.length ? (t.message ? `<p class="banner">${esc(t.message)}</p>` : "") : `<section class="empty"><h2>本次没有符合条件的结果</h2><p>${esc(t.message)}</p><button class="primary" data-action="adjust">调整条件</button><button class="text-button" data-action="retry">按原条件重试</button></section>`}${
    t.items.length
      ? `<div class="tools"><label><span class="small">显示 </span><select id="result-filter" aria-label="筛选结果">${[
          ["all", "全部结果"],
          ["pending", "待核查"],
          ["verified", "已核查"],
          ["uncertain", "存疑"],
          ["excluded", "已排除"],
          ["selected", "已选入"],
        ]
          .map(
            ([v, l]) =>
              `<option value="${v}" ${state.resultFilter === v ? "selected" : ""}>${l}</option>`,
          )
          .join(
            "",
          )}</select></label><span>先核查，再选入</span>${!t.delivery && t.status !== "running" ? '<button class="text-button" data-action="retry">重新检索</button>' : ""}</div><div class="results">${items.length ? items.slice(0, state.visibleCount).map((i) => result(i, !!t.delivery || (t.status === "running" && !t.progress?.plannedSources))).join("") : '<p class="hint">没有符合当前筛选的结果。</p>'}</div>${items.length > state.visibleCount ? '<button class="secondary" data-action="more-results">显示更多素材</button>' : ''}`
      : ""
  }${t.channels.length ? `<details class="channel-log"><summary>本次检索范围与渠道记录</summary><ul>${t.channels.map((c) => `<li>${esc(c.provider)} · ${c.status === "error" ? "请求失败" : c.count + " 条通过核对"}<br>${esc(c.query)}${c.intent ? `<br>英文需求：${esc(c.intent)}` : ""}${c.domains?.length ? `<br>网站：${esc(c.domains.join("、"))}` : ""}${c.discovered !== undefined ? `<br>发现 ${Number(c.discovered) || 0} 条 · 初筛保留 ${Number(c.intentMatched) || 0} 条` : ""}${c.error ? `<br>失败原因：${esc(c.error)}` : ""}${c.planningError ? `<br>${esc(c.planningError)}` : ""}${Object.keys(c.rejected || {}).length ? `<br>核对未通过：${esc(Object.entries(c.rejected).map(([reason,n]) => ({sourceUnavailable:"原网页不可读",productEvidenceMissing:"缺少该商品自身的图片证据",ambiguousProductPage:"页面包含多个商品，未自动选图",sourceIntentMismatch:"商品信息不符",imageSourceMismatch:"图片与来源不符",imageUnavailable:"图片不可读",dateUnconfirmed:"日期未确认",outsideDateRange:"超出时间范围"}[reason] || reason) + " " + n).join("；"))}` : ""}</li>`).join("")}</ul></details>` : ""}${debugHistory(t)}${t.items.length && !t.delivery ? `<div class="action-bar"><span>已选 ${n} 条<br>选入内容将保存为交付结果</span><button class="primary" data-action="deliver" ${n && t.status !== "running" ? "" : "disabled"}>生成交付结果</button></div>` : ""}`;
}
function delivery(t) {
  const d = t.delivery;
  return `<button class="back" data-page="deliveries">${icon("back")}返回交付结果</button><section class="delivery-head"><div class="tag-line"><span class="status delivered">已交付</span>${t.sample ? '<span class="status sample">历史示例</span>' : ""}</div><h1 style="margin-top:12px">${esc(t.input.subject)}</h1><p>${d.items.length} 条经人工核查的参考结果 · ${day(d.createdAt)}</p><p>检索范围：${t.input.days ? "近 " + t.input.days + " 天" : "不限时间"} · ${esc(sourceScopeText(t.input))}</p>${t.sample ? '<p class="banner sample">此交付来自历史示例，用于体验流程，不代表实时新品检索。</p>' : ""}<div class="export-tools"><button class="primary" data-action="print">打印 / 保存 PDF</button><button class="secondary" data-action="export-images">导出图片与来源</button><button class="secondary" data-action="export">导出 CSV 清单</button><button class="text-button" data-action="reopen">重新打开任务</button></div><p class="hint">图片包为可离线打开的 HTML，逐张保留原始来源、图片地址与核查依据。来源可追溯不代表获得商用授权。</p></section><div class="results">${d.items.map((i) => result(i, true)).join("")}</div>`;
}
function deliveries() {
  const list = state.tasks.filter((t) => t.delivery);
  return `<div class="page-head"><h1>交付结果</h1></div><section class="list-region ${list.length ? "" : "empty-state"}" aria-label="交付结果列表">${list.length ? list.map((t) => row(t, true)).join("") : `<span class="empty-icon">${icon("delivery")}</span><h2>暂无交付结果</h2><button class="text-button" data-page="tasks">查看检索任务</button>`}</section>`;
}
function render() {
  clearTimeout(timer);
  if (!state.account) return login();
  const t = state.tasks.find((t) => t.id === state.id);
  if (["detail", "delivery"].includes(state.page) && !t) state.page = "tasks";
  shell(
    state.page === "home"
      ? home()
      : state.page === "new"
        ? newTask()
        : state.page === "detail"
          ? detail(t)
          : state.page === "delivery" && t?.delivery
            ? delivery(t)
            : state.page === "deliveries"
              ? deliveries()
              : tasks(),
  );
  if (state.tasks.some((t) => t.status === "running"))
    timer = setTimeout(refresh, 2500);
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  clearTimeout(timer);
  const before = JSON.stringify(
    state.page === "detail"
      ? state.tasks.find((t) => t.id === state.id)
      : state.tasks,
  );
  try {
    const data = await api("/tasks");
    refreshError = "";
    if (!state.account) return;
    if (state.menuOpen) { timer = setTimeout(refresh, 2500); return; }
    state.tasks = data.tasks;
    const after = JSON.stringify(
      state.page === "detail"
        ? state.tasks.find((t) => t.id === state.id)
        : state.tasks,
    );
    const dirty = !!root.querySelector('[data-dirty="true"]');
    if (before !== after && !dirty && ["tasks", "detail"].includes(state.page))
      render();
    else updateRunningState();
  } catch {
    refreshError = '暂时无法更新状态，正在重新连接。也可以点“刷新状态”。';
    updateRunningState();
  } finally {
    refreshing = false;
    clearTimeout(timer);
    if (state.account && state.tasks.some(t => t.status === 'running')) timer = setTimeout(refresh, refreshError ? 4000 : 2500);
  }
}
// Mobile browsers suspend timers in the background; reconnect on return.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.account) void refresh(); });
window.addEventListener('pageshow', () => { if (state.account) void refresh(); });
window.addEventListener('focus', () => { if (state.account) void refresh(); });
function updateTask(t) {
  const i = state.tasks.findIndex((x) => x.id === t.id);
  if (i < 0) state.tasks.unshift(t);
  else state.tasks[i] = t;
}
async function taskAction(action, body = {}) {
  const { task } = await api("/tasks/" + state.id + "/" + action, body);
  updateTask(task);
  return task;
}
function bind() {
  $("#menu-toggle")?.addEventListener("click", () => setMenu(!state.menuOpen));
  $("#menu-toggle")?.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      setMenu(true);
    }
  });
  root
    .querySelectorAll("[data-page]")
    .forEach((b) => (b.onclick = () => go(b.dataset.page)));
  root.querySelectorAll("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        state.filter = b.dataset.filter;
        render();
      }),
  );
  root
    .querySelectorAll("[data-open]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          go(
            b.dataset.delivery === "true" ? "delivery" : "detail",
            b.dataset.open,
          )),
    );
  root.querySelectorAll("[data-days]").forEach(
    (b) =>
      (b.onclick = () => {
        $("[name=days]").value = b.dataset.days;
        root
          .querySelectorAll("[data-days]")
          .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      }),
  );
  $("#source-scope")?.addEventListener("input", event => updateSourceScope(event.target.value));
  root.querySelectorAll("[data-scope]").forEach(button => button.addEventListener("click", () => updateSourceScope(button.dataset.scope)));
  $("#task-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.submitter;
    b.disabled = true;
    const formData = new FormData(e.target);
    draft = { ...Object.fromEntries(formData), sources: formData.getAll("sources") };
    try {
      const { task } = await api("/tasks", draft);
      updateTask(task);
      go("detail", task.id);
    } catch (err) {
      $("#form-error").textContent = err.message;
      b.disabled = false;
    }
  });
  $("#result-filter")?.addEventListener("change", (e) => {
    state.resultFilter = e.target.value;
    state.visibleCount = 60;
    render();
  });
  root.querySelectorAll("[data-review]").forEach((f) => {
    f.addEventListener("input", () => {
      f.dataset.dirty = "true";
    });
    f.addEventListener("change", () => {
      f.dataset.dirty = "true";
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = e.submitter;
      b.disabled = true;
      const data = Object.fromEntries(new FormData(f));
      try {
        await taskAction("review", {
          id: f.dataset.review,
          review: data.review,
          note: data.note,
          selected: data.selected === "on",
        });
        render();
        notice("核查已保存");
      } catch (err) {
        f.querySelector(".error-text").textContent = err.message;
        b.disabled = false;
      }
    });
  });
  root.querySelectorAll(".photo img").forEach((img) =>
    img.addEventListener(
      "error",
      async () => {
        const host = img.closest(".photo");
        host.className = "no-image";
        host.textContent = "来源图片暂不可用 · 请重新检索，失效图片不能选入交付";
        const article = host.closest("[data-result]");
        if (article && img.getAttribute("src").startsWith(API_BASE + "/api/images/")) {
          article.querySelector('[name="selected"]')?.setAttribute("disabled", "");
          try { await taskAction("image-error", { id: article.dataset.result }); render(); notice("图片加载失败，已取消选入。请重新检索后再核查。"); }
          catch (error) { notice(error.message); }
        }
      },
      { once: true },
    ),
  );
  root.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = async () => {
        const action = b.dataset.action;
        b.disabled = true;
        try {
          if (action === "logout") {
            await api("/logout", {});
            state = {
              ...state,
              account: null,
              tasks: [],
              id: null,
              page: "tasks",
            };
            render();
          }
          if (action === "sample") {
            const { task } = await api("/sample", {});
            updateTask(task);
            go("detail", task.id);
          }
          if (action === "refresh") await refresh();
          if (action === "more-results") { state.visibleCount += 60; render(); }
          if (action === "retry") {
            refreshError = "";
            await taskAction("retry");
            render();
          }
          if (action === "deliver") {
            await taskAction("deliver");
            go("delivery", state.id);
            notice("交付结果已保存");
          }
          if (action === "reopen") {
            await taskAction("reopen");
            go("detail", state.id);
            notice("已重新打开，可修改后再次生成交付");
          }
          if (action === "view-delivery") go("delivery", state.id);
          if (action === "adjust") {
            const t = state.tasks.find((x) => x.id === state.id);
            draft = { ...t.input, domains: t.input.domains.join("\n") };
            state.page = "new";
            render();
            window.scrollTo(0, 0);
          }
          if (action === "print") window.print();
          if (action === "export-images") {
            const response = await fetch(API_BASE + "/api/tasks/" + state.id + "/export");
            if (!response.ok) throw Error((await response.json()).error || "图片包导出失败，请重新核查来源。");
            const blob = await response.blob(), link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "shoe-reference-images.html";
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
          }
          if (action === "export") {
            const t = state.tasks.find((x) => x.id === state.id),
              items = t.delivery.items;
            const header = [
              "任务",
              "标题",
              "来源",
              "原始来源链接",
              "图片编号",
              "原始图片地址",
              "图片 SHA-256",
              "来源核对时间",
              "授权说明",
              "发布日期",
              "采集时间",
              "核查依据",
            ];
            const clean = (v) =>
              '"' +
              String(v ?? "")
                .replace(/^(?=[\s]*[=+@\-]|[\t\r])/, "'")
                .replace(/"/g, '""') +
              '"';
            const csv =
              "\ufeff" +
              [
                header,
                ...items.map((i) => [
                  t.input.subject,
                  i.title,
                  i.source,
                  i.url,
                  i.id,
                  i.image,
                  i.imageSha256 || "",
                  i.sourceCheckedAt || "",
                  "来源可追溯不代表获得商用授权",
                  i.publishedAt || "未确认",
                  i.collectedAt,
                  i.note,
                ]),
              ]
                .map((r) => r.map(clean).join(","))
                .join("\r\n");
            const link = document.createElement("a");
            link.href = URL.createObjectURL(
              new Blob([csv], { type: "text/csv;charset=utf-8" }),
            );
            link.download = "鞋履交付结果.csv";
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
          }
        } catch (err) {
          notice(err.message);
        } finally {
          b.disabled = false;
        }
      }),
  );
}
root.innerHTML = '<p class="loading" role="status">正在打开工作台…</p>';
try {
  const session = await api("/session");
  state.account = session.account;
  state.demo = session.demo;
  state.guest = !!session.guest;
  state.sourceCatalog = session.sourceCatalog || [];
  if (state.account) state.tasks = (await api("/tasks")).tasks;
  const initialView = new URL(location.href).searchParams.get("view");
  if (state.account && ["new", "tasks", "deliveries"].includes(initialView)) state.page = initialView;
  render();
} catch (e) {
  root.innerHTML =
    '<main class="login"><h1>暂时无法打开工作台</h1><p>' +
    esc(e.message) +
    '</p><button class="primary" id="reload">重新加载</button></main>';
  $("#reload").onclick = () => location.reload();
}

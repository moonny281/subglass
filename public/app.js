"use strict";

import { animate } from "./vendor/motion.min.js";

/* ------------------------------------------------------------------ */
/* 动效基础设施                                                         */
/* ------------------------------------------------------------------ */

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 触觉反馈：只在有意义的时刻用（选中/复制成功），不滥用 */
function hapticTap() {
  if (navigator.vibrate) navigator.vibrate(8);
}

/** Apple 的动量投影公式：用释放速度预测手势最终会停在哪 */
function project(velocityPxPerSec, decelerationRate = 0.998) {
  return ((velocityPxPerSec / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** 橡皮筋阻力：越过边界后每多拖一点，跟手程度就衰减一点，而不是硬停 */
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** 读取元素当前"呈现值"（含正在进行中的动画位置），中断动画后从这里续接，而不是从目标值跳变 */
function getCurrentTranslateY(el) {
  const t = getComputedStyle(el).transform;
  if (t === "none") return 0;
  return new DOMMatrixReadOnly(t).m42;
}

/* ------------------------------------------------------------------ */
/* 基础状态 & 工具                                                      */
/* ------------------------------------------------------------------ */

const LS_PROFILE = "subglass_profile_id"; // 仅存不敏感的方案ID，token绝不进localStorage

const state = {
  authenticated: false,
  sessionExpiresAt: 0,
  profileId: localStorage.getItem(LS_PROFILE) || "",
  profile: null,
  pool: [],
  pendingSelected: new Set(),
  pendingRename: {},
};

let toastAnim = null;

function toast(msg, isError) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.borderColor = isError ? "rgba(239,68,68,.6)" : "rgba(255,255,255,.15)";
  clearTimeout(toast._t);
  toastAnim?.stop();

  if (prefersReducedMotion) {
    el.style.opacity = "1";
    el.style.transform = "translate(-50%, 0)";
  } else {
    toastAnim = animate(
      el,
      { opacity: 1, x: "-50%", y: 0, scale: 1 },
      { type: "spring", bounce: 0.25, duration: 0.4 },
    );
  }

  toast._t = setTimeout(() => {
    toastAnim?.stop();
    if (prefersReducedMotion) {
      el.style.opacity = "0";
    } else {
      toastAnim = animate(
        el,
        { opacity: 0, x: "-50%", y: 16, scale: 0.94 },
        { type: "spring", bounce: 0, duration: 0.3 },
      );
    }
  }, 3200);
}

async function api(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  const resp = await fetch(path, Object.assign({ credentials: "same-origin" }, opts, { headers }));
  let data = null;
  const text = await resp.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (resp.status === 401 && path.startsWith("/api/") && path !== "/api/session") {
    state.authenticated = false;
    renderLoginState();
    toast("登录已过期，请重新登录", true);
  }
  if (!resp.ok) {
    const message = (data && data.error) || `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return data;
}

function requireProfile() {
  if (!state.authenticated) {
    toast("请先在「设置」中登录", true);
    switchView("settings");
    return false;
  }
  if (!state.profileId) {
    toast("请先在「设置」中新建或加载一个订阅方案", true);
    switchView("settings");
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* 视图切换 — 交叉淡出+轻微位移的spring过渡，而不是瞬间切换                */
/* ------------------------------------------------------------------ */

function runViewSideEffects(name) {
  if (name === "nodes") refreshPool();
  if (name === "showcase") refreshShowcase();
  if (name === "export") refreshExportList();
  if (name === "dashboard") refreshDashboard();
}

let viewAnimations = [];
let viewSwitchToken = 0;

function stopViewAnimations() {
  viewAnimations.forEach((animation) => animation?.stop?.());
  viewAnimations = [];
}

function switchView(name) {
  const switchToken = ++viewSwitchToken;
  document.querySelectorAll(".menu button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));

  const target = document.querySelector(`.tabs-view[data-view="${name}"]`);
  const current = document.querySelector(".tabs-view.active");
  if (!target || current === target) {
    runViewSideEffects(name);
    return;
  }

  stopViewAnimations();

  if (prefersReducedMotion || !current) {
    if (current) current.classList.remove("active");
    target.classList.add("active");
    runViewSideEffects(name);
    return;
  }

  target.classList.add("active");
  target.style.opacity = "0";
  target.style.transform = "translate3d(0, 18px, 0) scale(.985)";
  target.style.pointerEvents = "none";
  current.style.pointerEvents = "none";

  const outgoing = animate(
    current,
    { opacity: 0, y: -10, scale: 0.99 },
    { type: "spring", bounce: 0.08, duration: 0.34 },
  );
  const incoming = animate(
    target,
    { opacity: 1, y: 0, scale: 1 },
    { type: "spring", bounce: 0.22, duration: 0.48 },
  );
  viewAnimations = [outgoing, incoming];

  Promise.all([outgoing, incoming]).then(() => {
    if (switchToken !== viewSwitchToken) return;
    current.classList.remove("active");
    current.style.opacity = "";
    current.style.transform = "";
    current.style.pointerEvents = "";
    target.style.opacity = "";
    target.style.transform = "";
    target.style.pointerEvents = "";
    viewAnimations = [];
  });

  runViewSideEffects(name);
}

document.querySelectorAll(".menu button").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

/* ------------------------------------------------------------------ */
/* 移动端底部抽屉导航 — 直接操纵、可中断、带动量投影与橡皮筋边界            */
/* ------------------------------------------------------------------ */

const sheetEl = document.getElementById("sheet");
const scrimEl = document.getElementById("sheetScrim");
const sheetHandleEl = sheetEl.querySelector(".sheet-handle");

let sheetAnim = null;
let scrimAnim = null;
let sheetIsOpen = false;
let dragState = null;

function getSheetHeight() {
  return sheetEl.getBoundingClientRect().height || 320;
}

function setSheetInteractive(open) {
  sheetEl.style.pointerEvents = open ? "auto" : "none";
  scrimEl.style.pointerEvents = open ? "auto" : "none";
}

function openSheet(releaseVelocity = 0) {
  sheetIsOpen = true;
  scrimEl.style.display = "block";
  setSheetInteractive(true);
  sheetAnim?.stop();
  scrimAnim?.stop();

  if (prefersReducedMotion) {
    sheetEl.style.transform = "translateY(0)";
    scrimEl.style.opacity = "1";
    return;
  }
  sheetAnim = animate(
    sheetEl,
    { y: 0 },
    { type: "spring", bounce: releaseVelocity ? 0.2 : 0, duration: 0.4, velocity: releaseVelocity },
  );
  scrimAnim = animate(scrimEl, { opacity: 1 }, { duration: 0.3 });
}

function closeSheet(releaseVelocity = 0) {
  sheetIsOpen = false;
  sheetAnim?.stop();
  scrimAnim?.stop();

  if (prefersReducedMotion) {
    sheetEl.style.transform = `translateY(${getSheetHeight()}px)`;
    scrimEl.style.opacity = "0";
    scrimEl.style.display = "none";
    setSheetInteractive(false);
    return;
  }
  const h = getSheetHeight();
  sheetAnim = animate(
    sheetEl,
    { y: h },
    { type: "spring", bounce: releaseVelocity ? 0.15 : 0, duration: 0.4, velocity: releaseVelocity },
  );
  scrimAnim = animate(scrimEl, { opacity: 0 }, { duration: 0.28 });
  sheetAnim.then(() => {
    setSheetInteractive(false);
    scrimEl.style.display = "none";
  });
}

document.getElementById("btnOpenSheet").addEventListener("click", () => {
  sheetIsOpen ? closeSheet() : openSheet();
});
scrimEl.addEventListener("click", () => closeSheet());

document.querySelectorAll(".sheet .menu button").forEach((btn) => {
  btn.addEventListener("click", () => closeSheet());
});

if (!prefersReducedMotion) {
  sheetHandleEl.addEventListener("pointerdown", (e) => {
    sheetHandleEl.setPointerCapture(e.pointerId);
    sheetAnim?.stop(); // 中断动画：从当前呈现值续接，而不是从目标值跳变
    const startY = getCurrentTranslateY(sheetEl);
    dragState = {
      pointerId: e.pointerId,
      startClientY: e.clientY,
      startY,
      history: [{ t: performance.now(), y: startY }],
    };
  });

  sheetHandleEl.addEventListener("pointermove", (e) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const delta = e.clientY - dragState.startClientY;
    let y = dragState.startY + delta;
    const h = getSheetHeight();
    if (y < 0) y = -rubberband(-y, h, 0.55); // 拖过"完全打开"边界：橡皮筋阻力

    sheetEl.style.transform = `translateY(${y}px)`;
    dragState.history.push({ t: performance.now(), y });
    if (dragState.history.length > 6) dragState.history.shift();

    scrimEl.style.opacity = String(1 - Math.min(Math.max(y / h, 0), 1));
  });

  sheetHandleEl.addEventListener("pointerup", (e) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const { history } = dragState;
    const first = history[0];
    const last = history[history.length - 1];
    const dt = Math.max(last.t - first.t, 1) / 1000;
    const velocity = (last.y - first.y) / dt; // px/s，向下为正
    dragState = null;

    const h = getSheetHeight();
    const projected = last.y + project(velocity);
    if (projected > h / 2) closeSheet(velocity);
    else openSheet(velocity);
  });

  sheetHandleEl.addEventListener("pointercancel", () => {
    dragState = null;
  });
}

/* ------------------------------------------------------------------ */
/* 设置：登录 & 方案                                                    */
/* ------------------------------------------------------------------ */

function renderLoginState() {
  const statusEl = document.getElementById("loginStatus");
  const tokenRow = document.getElementById("loginRow");
  const loggedInRow = document.getElementById("loggedInRow");
  if (state.authenticated) {
    const expireStr = state.sessionExpiresAt ? new Date(state.sessionExpiresAt).toLocaleString() : "";
    statusEl.textContent = `已登录，会话将在 ${expireStr} 过期`;
    tokenRow.style.display = "none";
    loggedInRow.style.display = "flex";
  } else {
    statusEl.textContent = "未登录";
    tokenRow.style.display = "flex";
    loggedInRow.style.display = "none";
  }
}

function renderSettingsInfo() {
  const info = document.getElementById("currentProfileInfo");
  if (state.profile) {
    info.textContent = `当前方案：${state.profile.name} (ID: ${state.profile.id})`;
  } else if (state.profileId) {
    info.textContent = `当前方案 ID: ${state.profileId}（尚未加载详情）`;
  } else {
    info.textContent = "尚未创建或加载任何方案";
  }
}

async function checkSession() {
  try {
    const result = await fetch("/api/session", { credentials: "same-origin" }).then((r) => r.json());
    state.authenticated = !!result.authenticated;
  } catch {
    state.authenticated = false;
  }
  renderLoginState();
  return state.authenticated;
}

document.getElementById("btnLogin").addEventListener("click", async () => {
  const v = document.getElementById("adminToken").value.trim();
  if (!v) return toast("令牌不能为空", true);
  try {
    const result = await api("/api/login", { method: "POST", body: JSON.stringify({ token: v }) });
    state.authenticated = true;
    state.sessionExpiresAt = result.expiresAt;
    document.getElementById("adminToken").value = "";
    renderLoginState();
    toast("登录成功");
    if (state.profileId) loadProfile(state.profileId);
  } catch (e) {
    toast("登录失败：" + e.message, true);
  }
});

document.getElementById("btnLogout").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    /* 忽略网络错误，前端状态照样清掉 */
  }
  state.authenticated = false;
  state.profile = null;
  renderLoginState();
  toast("已退出登录");
});

document.getElementById("btnCreateProfile").addEventListener("click", async () => {
  if (!state.authenticated) return toast("请先登录", true);
  const name = document.getElementById("profileName").value.trim() || "我的订阅";
  try {
    const profile = await api("/api/profile", { method: "POST", body: JSON.stringify({ name }) });
    setProfile(profile);
    toast("方案创建成功");
  } catch (e) {
    toast("创建失败：" + e.message, true);
  }
});

document.getElementById("btnLoadProfile").addEventListener("click", async () => {
  const id = document.getElementById("profileIdInput").value.trim();
  if (!id) return toast("请输入方案ID", true);
  await loadProfile(id);
});

function setProfile(profile) {
  state.profile = profile;
  state.profileId = profile.id;
  localStorage.setItem(LS_PROFILE, profile.id);
  state.pendingSelected = new Set(profile.selectedIds);
  state.pendingRename = Object.assign({}, profile.renameMap);
  renderSettingsInfo();
  renderSidebarStats();
  renderUpstreamList();
}

async function loadProfile(id) {
  if (!state.authenticated) return toast("请先登录", true);
  try {
    const profile = await api(`/api/profile/${id}`);
    setProfile(profile);
    toast("方案加载成功");
  } catch (e) {
    toast("加载失败：" + e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 导入订阅                                                             */
/* ------------------------------------------------------------------ */

function renderUpstreamList() {
  const box = document.getElementById("upstreamList");
  box.innerHTML = "";
  if (!state.profile || !state.profile.upstreams.length) {
    box.innerHTML = '<div class="helper-text">尚未添加任何上游订阅</div>';
    return;
  }
  for (const u of state.profile.upstreams) {
    const row = document.createElement("div");
    row.className = "upstream-item";
    row.innerHTML = `
      <div>
        <div>${escapeHtml(u.label)}</div>
        <div class="meta">${escapeHtml(u.url)}</div>
      </div>
      <button class="btn danger small" data-remove="${u.id}">移除</button>
    `;
    box.appendChild(row);
  }
  // 破坏性操作用"二次确认"取代原生confirm弹窗：第一次点击进入确认态，
  // 几秒内再点一次才真正执行，逾时自动还原
  box.querySelectorAll("[data-remove]").forEach((btn) => {
    const original = btn.textContent;
    btn.addEventListener("click", () => {
      if (btn.dataset.confirming === "1") {
        removeUpstream(btn.dataset.remove);
        return;
      }
      btn.dataset.confirming = "1";
      btn.classList.add("confirming");
      btn.textContent = "确认删除？";
      clearTimeout(btn._confirmTimer);
      btn._confirmTimer = setTimeout(() => {
        btn.dataset.confirming = "0";
        btn.classList.remove("confirming");
        btn.textContent = original;
      }, 4000);
    });
  });
}

async function removeUpstream(upstreamId) {
  if (!requireProfile()) return;
  const remaining = state.profile.upstreams.filter((u) => u.id !== upstreamId);
  try {
    const profile = await api(`/api/profile/${state.profileId}`, {
      method: "PUT",
      body: JSON.stringify({ upstreams: remaining }),
    });
    setProfile(profile);
    toast("已移除上游");
  } catch (e) {
    toast("移除失败：" + e.message, true);
  }
}

document.getElementById("btnAddUpstream").addEventListener("click", async () => {
  if (!requireProfile()) return;
  const label = document.getElementById("upstreamLabel").value.trim() || "未命名上游";
  const url = document.getElementById("upstreamUrl").value.trim();
  if (!url) return toast("请输入订阅链接", true);

  const btn = document.getElementById("btnAddUpstream");
  btn.disabled = true;
  btn.textContent = "拉取中...";
  try {
    const preview = await api("/api/import", { method: "POST", body: JSON.stringify({ url }) });
    const profile = await api(`/api/profile/${state.profileId}`, {
      method: "PUT",
      body: JSON.stringify({ addUpstream: { label, url } }),
    });
    setProfile(profile);
    document.getElementById("upstreamUrl").value = "";
    document.getElementById("upstreamLabel").value = "";
    toast(`已添加，解析到 ${preview.count} 个节点`);
  } catch (e) {
    toast("添加失败：" + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "拉取并添加";
  }
});

document.getElementById("btnPreviewPaste").addEventListener("click", async () => {
  const text = document.getElementById("pasteText").value.trim();
  const resultBox = document.getElementById("pastePreviewResult");
  if (!text) return toast("请先粘贴内容", true);
  if (!state.authenticated) return toast("请先登录", true);
  resultBox.textContent = "解析中...";
  try {
    const result = await api("/api/import", { method: "POST", body: JSON.stringify({ text }) });
    resultBox.innerHTML = `解析到 <b>${result.count}</b> 个节点：${result.nodes
      .slice(0, 20)
      .map((n) => escapeHtml(n.name))
      .join("、")}${result.nodes.length > 20 ? " ..." : ""}`;
  } catch (e) {
    resultBox.textContent = "解析失败：" + e.message;
  }
});

/* ------------------------------------------------------------------ */
/* 节点管理                                                             */
/* ------------------------------------------------------------------ */

function tlsTagsFor(node) {
  const tags = [];
  if (node.tls && node.tls.enabled) tags.push('<span class="tag tls">TLS</span>');
  if (node.tls && node.tls.reality) tags.push('<span class="tag reality">Reality</span>');
  return tags.join(" ");
}

function renderNodeGrid(filterText) {
  const grid = document.getElementById("nodeGrid");
  const emptyHint = document.getElementById("nodesEmptyHint");
  grid.innerHTML = "";

  const filtered = state.pool.filter((n) => {
    if (!filterText) return true;
    const hay = (n.name + " " + n.server).toLowerCase();
    return hay.includes(filterText.toLowerCase());
  });

  emptyHint.style.display = state.pool.length === 0 ? "block" : "none";

  for (const n of filtered) {
    const checked = state.pendingSelected.has(n.id);
    const customName = state.pendingRename[n.id] || "";
    const card = document.createElement("div");
    card.className = "node" + (checked ? " selected" : "");
    card.innerHTML = `
      <div class="node-top">
        <h3>${escapeHtml(n.name)}</h3>
      </div>
      <p>${escapeHtml(n.server)}:${n.port}</p>
      <span class="tag">${n.type.toUpperCase()}</span>
      ${tlsTagsFor(n)}
      <label class="checkbox">
        <input type="checkbox" data-id="${n.id}" ${checked ? "checked" : ""} />
        选择
      </label>
      <input type="text" class="rename-input" data-rename="${n.id}" placeholder="自定义名称（留空使用原名）" value="${escapeHtml(customName)}" />
    `;
    grid.appendChild(card);
  }

  grid.querySelectorAll("[data-id]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.id;
      const card = cb.closest(".node");
      if (cb.checked) state.pendingSelected.add(id);
      else state.pendingSelected.delete(id);
      card.classList.toggle("selected", cb.checked);
      hapticTap();
      if (!prefersReducedMotion) {
        animate(card, { scale: [1, 1.025, 1] }, { duration: 0.28, ease: "easeOut" });
      }
    });
  });

  grid.querySelectorAll("[data-rename]").forEach((input) => {
    input.addEventListener("input", () => {
      const id = input.dataset.rename;
      if (input.value.trim()) state.pendingRename[id] = input.value.trim();
      else delete state.pendingRename[id];
    });
  });
}

async function refreshPool() {
  if (!requireProfile()) return;
  const grid = document.getElementById("nodeGrid");
  grid.innerHTML = '<div class="empty-hint"><span class="spinner"></span>正在拉取上游并解析节点...</div>';
  try {
    const data = await api(`/api/profile/${state.profileId}/pool`);
    state.pool = data.nodes;
    state.pendingSelected = new Set(data.selectedIds);
    state.pendingRename = Object.assign({}, data.renameMap);
    renderNodeGrid(document.getElementById("nodeSearch").value.trim());
    renderSidebarStats();
  } catch (e) {
    grid.innerHTML = `<div class="empty-hint">拉取失败：${escapeHtml(e.message)}</div>`;
  }
}

document.getElementById("nodeSearch").addEventListener("input", (e) => renderNodeGrid(e.target.value.trim()));

document.getElementById("btnSelectAll").addEventListener("click", () => {
  state.pool.forEach((n) => state.pendingSelected.add(n.id));
  renderNodeGrid(document.getElementById("nodeSearch").value.trim());
});

document.getElementById("btnSelectNone").addEventListener("click", () => {
  state.pendingSelected.clear();
  renderNodeGrid(document.getElementById("nodeSearch").value.trim());
});

document.getElementById("btnSaveSelection").addEventListener("click", async () => {
  if (!requireProfile()) return;
  try {
    const profile = await api(`/api/profile/${state.profileId}`, {
      method: "PUT",
      body: JSON.stringify({
        selectedIds: [...state.pendingSelected],
        renameMap: state.pendingRename,
      }),
    });
    setProfile(profile);
    toast(`已保存，当前选中 ${profile.selectedIds.length} 个节点`);
  } catch (e) {
    toast("保存失败：" + e.message, true);
  }
});

/* ------------------------------------------------------------------ */
/* 我的订阅（展示页：二维码 + 复制）                                      */
/* ------------------------------------------------------------------ */

async function refreshShowcase() {
  const grid = document.getElementById("showcaseGrid");
  const emptyHint = document.getElementById("showcaseEmptyHint");
  if (!state.profileId) {
    emptyHint.style.display = "block";
    emptyHint.textContent = "请先在「设置」中创建或加载订阅方案";
    grid.innerHTML = "";
    return;
  }
  grid.innerHTML = '<div class="empty-hint"><span class="spinner"></span>加载中...</div>';
  try {
    const summary = await api(`/api/profile/${state.profileId}/summary`);
    grid.innerHTML = "";
    emptyHint.style.display = summary.nodeCount === 0 ? "block" : "none";
    emptyHint.textContent = "还没有选中任何节点，先在「节点管理」勾选节点后再来这里生成订阅";

    for (const link of summary.links) {
      const card = document.createElement("div");
      card.className = "node sub-card";
      card.innerHTML = `
        <h3>${escapeHtml(link.label)}</h3>
        <div class="qr-wrap"><div class="qr-canvas"></div></div>
        <span class="tag">${summary.nodeCount} 节点</span>
        <p class="sub-url-preview">${escapeHtml(link.url)}</p>
        <button class="btn small copy-btn">📋 复制链接</button>
      `;
      grid.appendChild(card);

      const qr = qrcode(0, "M");
      qr.addData(link.url);
      qr.make();
      card.querySelector(".qr-canvas").innerHTML = qr.createSvgTag(4, 0);

      const doCopy = () => copyToClipboard(link.url);
      card.querySelector(".qr-wrap").addEventListener("click", doCopy);
      card.querySelector(".copy-btn").addEventListener("click", doCopy);
    }
  } catch (e) {
    grid.innerHTML = `<div class="empty-hint">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

function copyToClipboard(text) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      hapticTap();
      toast("已复制订阅链接");
    })
    .catch(() => toast("复制失败，请手动选择链接文本", true));
}

/* ------------------------------------------------------------------ */
/* 导出配置                                                             */
/* ------------------------------------------------------------------ */

async function refreshExportList() {
  const box = document.getElementById("exportList");
  if (!state.profileId) {
    box.innerHTML = '<div class="helper-text">请先在「设置」中创建或加载订阅方案</div>';
    return;
  }
  try {
    const summary = await api(`/api/profile/${state.profileId}/summary`);
    box.innerHTML = "";
    for (const link of summary.links) {
      const row = document.createElement("div");
      row.className = "link-item";
      row.innerHTML = `
        <div><b>${escapeHtml(link.label)}</b><div class="url">${escapeHtml(link.url)}</div></div>
        <a class="btn small" href="${link.url}" target="_blank" rel="noopener">⬇ 下载</a>
      `;
      box.appendChild(row);
    }
  } catch (e) {
    box.innerHTML = `<div class="helper-text">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

/* ------------------------------------------------------------------ */
/* Dashboard & 侧边栏统计                                               */
/* ------------------------------------------------------------------ */

function renderSidebarStats() {
  document.getElementById("sidebarProfileName").textContent = state.profile ? state.profile.name : "未创建";
  document.getElementById("sidebarPoolCount").textContent = state.pool.length || "-";
  document.getElementById("sidebarSelectedCount").textContent = state.profile ? state.profile.selectedIds.length : "-";
}

async function refreshDashboard() {
  if (!state.profileId || !state.authenticated) {
    renderSidebarStats();
    return;
  }
  try {
    const profile = await api(`/api/profile/${state.profileId}`);
    setProfile(profile);
    document.getElementById("statSelected").textContent = profile.selectedIds.length;
    document.getElementById("statUpstreams").textContent = profile.upstreams.length;
    document.getElementById("statTargets").textContent = profile.targets.length;
    document.getElementById("statPool").textContent = state.pool.length || "—";
  } catch (e) {
    toast("加载方案信息失败：" + e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                             */
/* ------------------------------------------------------------------ */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ------------------------------------------------------------------ */
/* 初始化                                                               */
/* ------------------------------------------------------------------ */

(async function init() {
  renderLoginState();
  renderSettingsInfo();
  renderSidebarStats();
  const authed = await checkSession();
  if (authed && state.profileId) {
    await loadProfile(state.profileId);
    await refreshDashboard();
  }
})();

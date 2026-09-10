const $ = (selector) => document.querySelector(selector);
const state = {
  tokens: [],
  handoffState: null,
  authenticated: false,
  loading: false,
  online: null,
  currentPage: 1,
  pageSize: 5,
  fetchOffset: 0,
  hasMore: false,
  fetchingMore: false
};

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function setStatus(message = "", type = "") {
  const el = $("#status"); el.textContent = message; el.className = `status${type ? ` ${type}` : ""}`;
}
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}
async function api(path, options = {}) { const response = await fetch(path, { ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }, cache: "no-store" }); const data = await response.json().catch(() => ({})); return { response, data }; }

async function checkConnectivity() {
  const badge = $("#sessionBadge");
  badge.textContent = "Mengecek koneksi…";
  try {
    const { response, data } = await api("/api/connectivity");
    state.online = response.ok && data.ok === true && data.database === "connected";
    badge.textContent = state.online ? "● Online" : "● Offline";
    badge.className = `pill ${state.online ? "online" : "offline"}`;
    badge.title = state.online
      ? "Online = koneksi layanan/database sumber data berhasil."
      : "Offline = koneksi ke layanan/database sumber data gagal.";
  } catch {
    state.online = false;
    badge.textContent = "● Offline";
    badge.className = "pill offline";
    badge.title = "Offline = koneksi ke layanan/database sumber data gagal.";
  }
}

async function inspectHandoff() {
  state.handoffState = null;
  state.authenticated = false;

  const stateParam = new URLSearchParams(location.search).get("state");

  if (!/^[A-Za-z0-9_-]{40,64}$/.test(String(stateParam || ""))) {
    // Direct-open Token Center is valid.
    // Authentication starts only from Amprem's explicit GET TOKEN action.
    return;
  }

  state.handoffState = stateParam;

  try {
    const { response, data } = await api("/api/handoff/inspect", {
      method: "POST",
      body: JSON.stringify({ state: stateParam })
    });

    if (response.ok && data.authenticated === true) {
      state.authenticated = true;
      return;
    }

    state.handoffState = null;
  } catch {
    state.handoffState = null;
  }
}
function durationLabel(token) {
  if (token.duration_label) return token.duration_label;
  return token.duration === "permanent" ? "Unlimited" : token.duration || "Lifetime";
}
function firstTimestamp(token, keys = []) {
  for (const key of keys) {
    const value = token?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}
function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta"
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("day")} ${get("month")} ${get("year")} • ${get("hour")}:${get("minute")} WIB`;
}
function getLoadedPageCount() {
  return Math.max(1, Math.ceil(state.tokens.length / state.pageSize));
}
function getVisibleTokens() {
  const start = (state.currentPage - 1) * state.pageSize;
  return state.tokens.slice(start, start + state.pageSize);
}
function buildPaginationModel(totalPages) {
  if (totalPages <= 1) return [];
  let start = state.currentPage <= 3 ? 1 : Math.min(state.currentPage, Math.max(1, totalPages - 2));
  const pages = [];
  for (let page = start; page <= Math.min(totalPages, start + 2); page += 1) pages.push(page);
  return pages;
}
function renderPagination() {
  const pagination = $("#pagination");
  const totalPages = getLoadedPageCount();
  if (!state.tokens.length || (totalPages <= 1 && !state.hasMore)) {
    pagination.hidden = true;
    pagination.innerHTML = "";
    return;
  }

  pagination.hidden = false;
  const pages = buildPaginationModel(totalPages);
  const showPrevious = state.currentPage >= 4;
  const showFirst = state.currentPage >= 5;
  const showNext = state.currentPage < totalPages || state.hasMore;
  const showLast = state.hasMore || state.currentPage < totalPages;

  const navButton = (label, page, title, hidden = false, className = "") => hidden ? "" : `
    <button class="page-btn nav-btn ${className}" type="button" data-page="${page}" aria-label="${title}" title="${title}">${label}</button>`;
  const pageButton = (page) => `
    <button class="page-btn ${page === state.currentPage ? "current" : ""}" type="button" data-page="${page}" aria-label="Halaman ${page}" aria-current="${page === state.currentPage ? "page" : "false"}">${page}</button>`;

  pagination.innerHTML = [
    navButton("&lt;", state.currentPage - 1, "Previous", !showPrevious),
    navButton("&lt;&lt;", 1, "First", !showFirst),
    ...pages.map(pageButton),
    navButton("&gt;", state.currentPage + 1, "Next", !showNext),
    navButton("&gt;&gt;", 0, "Last", !showLast, "last-btn")
  ].join("");

  pagination.querySelectorAll(".page-btn").forEach((button) => {
    button.addEventListener("click", () => handlePagination(button.dataset.page));
  });
}
function render() {
  const list = $("#tokenList"); const empty = $("#empty");
  if (!state.tokens.length) {
    list.innerHTML = "";
    empty.hidden = false;
    renderPagination();
    return;
  }
  empty.hidden = true;
  const visibleTokens = getVisibleTokens();
  list.innerHTML = visibleTokens.map((token) => {
    const status = String(token.status || "unknown");
    const available = status === "active";
    const statusClass = ["active", "used", "expired", "revoked"].includes(status) ? status : "unknown";
    const statusLabel = available ? "Tersedia" : status === "used" ? "Digunakan" : status === "expired" ? "Kedaluwarsa" : escapeHtml(status);
    const publishedAt = formatTimestamp(firstTimestamp(token, ["published_at", "publishedAt", "token_published_at", "tokenPublishedAt", "created_at", "createdAt"]));
    const claimedAt = formatTimestamp(firstTimestamp(token, ["claimed_at", "claimedAt", "used_at", "usedAt", "consumed_at", "consumedAt"]));
    const claimant = token.claimed_username ? `<span class="meta-label">Digunakan oleh</span><span>${escapeHtml(token.claimed_username)}</span>` : "";
    const publishedMeta = publishedAt ? `<div class="timestamp"><span aria-hidden="true">◷</span><span>Dipublish ${escapeHtml(publishedAt)}</span></div>` : "";
    const claimedMeta = !available && claimedAt ? `<div class="timestamp claimed-at"><span aria-hidden="true">✓</span><span>Diambil ${escapeHtml(claimedAt)}</span></div>` : "";
    const action = available && token.token ? `<button class="btn primary get-token" data-id="${escapeHtml(token.id)}" type="button">GET TOKEN</button>` : "";
    const metaBlock = claimant || claimedMeta ? `<div class="row meta-row"><div class="meta">${claimant}</div>${claimedMeta}</div>` : "";
    const tokenValue = escapeHtml(token.token || "Token tidak tersedia");
    return `<article class="token-card"><div class="row"><span class="lifetime">${escapeHtml(durationLabel(token))}</span><span class="badge ${available ? "available" : statusClass}">${statusLabel}</span></div>${publishedMeta}<div class="token-action-row"><div class="token">${tokenValue}</div>${action}</div>${metaBlock}</article>`;
  }).join("");
  list.querySelectorAll(".get-token").forEach((button) => button.addEventListener("click", () => getToken(button.dataset.id)));
  renderPagination();
}
async function fetchTokenBatch(offset) {
  const { response, data } = await api(`/api/tokens?limit=50&offset=${offset}`);
  if (!response.ok) throw new Error(data.error || "Token belum dapat dimuat.");
  const batch = Array.isArray(data.tokens) ? data.tokens : [];
  state.fetchOffset = offset + batch.length;
  state.hasMore = batch.length === 50;
  return batch;
}
async function loadTokens({ preservePage = false } = {}) {
  if (state.loading || state.fetchingMore) return;
  state.loading = true;
  if (!preservePage) state.currentPage = 1;
  setStatus("Memuat token…");
  try {
    const batch = await fetchTokenBatch(0);
    state.tokens = batch;
    render();
    setStatus("");
  } catch (error) {
    setStatus(error.message || "Token belum dapat dimuat.", "error");
  } finally {
    state.loading = false;
  }
}
async function ensurePageLoaded(page) {
  const requiredCount = page * state.pageSize;
  while (state.tokens.length < requiredCount && state.hasMore) {
    const batch = await fetchTokenBatch(state.fetchOffset);
    if (!batch.length) break;
    state.tokens.push(...batch);
    if (!state.hasMore) break;
  }
  return state.tokens.length >= requiredCount || !state.hasMore;
}
async function loadAllTokens() {
  while (state.hasMore) {
    const batch = await fetchTokenBatch(state.fetchOffset);
    if (!batch.length) break;
    state.tokens.push(...batch);
  }
}
async function handlePagination(target) {
  if (state.fetchingMore || state.loading) return;
  const requested = Number(target);
  const isLast = target === "0";

  state.fetchingMore = true;
  const pagination = $("#pagination");
  pagination.querySelectorAll(".page-btn").forEach((button) => {
    button.disabled = true;
    button.classList.add("busy");
  });

  try {
    setStatus(isLast ? "Menyiapkan halaman terakhir…" : "");
    if (isLast) {
      await loadAllTokens();
      state.currentPage = getLoadedPageCount();
    } else {
      const targetPage = Math.max(1, requested);
      await ensurePageLoaded(targetPage);
      const totalPages = getLoadedPageCount();
      state.currentPage = Math.min(targetPage, totalPages);
    }
    render();
    setStatus("");
    $("#tokenList")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStatus(error.message || "Halaman token belum dapat dimuat.", "error");
  } finally {
    state.fetchingMore = false;
  }
}
async function copyToken(value) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; } } catch {}
  const area = document.createElement("textarea"); area.value = value; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} area.remove(); return ok;
}
function normalizeUsername(value) { const raw = String(value || "").trim(); return raw.startsWith("@") ? raw.toLowerCase() : `@${raw.toLowerCase()}`; }
function openUsernameModal() { const modal = $("#usernameModal"); modal.hidden = false; modal.setAttribute("aria-hidden", "false"); $("#usernameInput").focus(); }
function closeUsernameModal() { const modal = $("#usernameModal"); modal.hidden = true; modal.setAttribute("aria-hidden", "true"); $("#usernameStatus").textContent = ""; }
async function getToken(tokenId) {
  const button = document.querySelector(`[data-id="${CSS.escape(tokenId)}"]`); if (!button) return;
  button.disabled = true; button.textContent = "Mengambil…";
  try {
    if (state.handoffState && state.authenticated) {
      const handoffState = state.handoffState;
      const consume = await api("/api/handoff/consume", {
        method: "POST",
        body: JSON.stringify({ state: handoffState })
      });

      if (!consume.response.ok || consume.data.authenticated !== true) {
        state.handoffState = null;
        state.authenticated = false;
        throw new Error("Session handoff tidak valid atau sudah kedaluwarsa.");
      }

      state.handoffState = null;

      const cfg = await api("/api/runtime-config");
      const amprem = String(cfg.data?.ampremUrl || "").replace(/\/+$/, "");
      if (!cfg.response.ok || !amprem) {
        throw new Error("URL Amprem belum dikonfigurasi.");
      }

      const { response, data } = await api(`/api/tokens/${encodeURIComponent(tokenId)}`);
      if (!response.ok || !data.token?.token) {
        await loadTokens();
        throw new Error(data.error || "Token tidak tersedia.");
      }

      const token = data.token.token;
      const copied = await copyToken(token);
      if (copied) toast("✓ Token berhasil disalin");
      else toast("Token tidak dapat disalin otomatis. Silakan salin manual.");

        sessionStorage.setItem("jyyr:selected_token_id", data.token.id);

      window.location.assign(
        `${amprem}/home.html?token_context=${encodeURIComponent(tokenId)}`
      );
      return;
    }

    const { response, data } = await api(`/api/tokens/${encodeURIComponent(tokenId)}`);
    if (!response.ok || !data.token?.token) {
      await loadTokens();
      throw new Error(data.error || "Token tidak tersedia.");
    }

    const token = data.token.token;
    const copied = await copyToken(token);
    if (copied) toast("✓ Token berhasil disalin");
    else toast("Token tidak dapat disalin otomatis. Silakan salin manual.");

    sessionStorage.setItem("jyyr:selected_token_id", data.token.id);
    openUsernameModal();
    $("#usernameInput").dataset.tokenId = tokenId;
  } catch (error) {
    toast(error.message || "Token tidak dapat diambil.");
  } finally { button.disabled = false; button.textContent = "GET TOKEN"; }
}
$("#continueRegister").addEventListener("click", () => {
  const username = normalizeUsername($("#usernameInput").value);
  const tokenId = $("#usernameInput").dataset.tokenId;
  const valid = /^@[a-z0-9](?:[a-z0-9._-]{2,28})$/.test(username);
  if (!valid) { $("#usernameStatus").textContent = "Username harus 3–29 karakter dan hanya boleh huruf, angka, titik, underscore, atau strip."; return; }
  if (!/^[0-9a-f-]{36}$/i.test(tokenId || "")) { $("#usernameStatus").textContent = "Konteks token tidak valid."; return; }
  sessionStorage.setItem("jyyr:selected_token_id", tokenId);
  window.location.assign(`/register-redirect?username=${encodeURIComponent(username)}&token_id=${encodeURIComponent(tokenId)}`);
});
$("#closeUsername").addEventListener("click", closeUsernameModal);
$("#refreshBtn").addEventListener("click", () => Promise.all([checkConnectivity(), loadTokens()]));
(async function boot(){ await Promise.all([checkConnectivity(), inspectHandoff()]); await loadTokens(); })();

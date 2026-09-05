const $ = (selector) => document.querySelector(selector);
const state = { tokens: [], selected: null, handoffState: null, authenticated: false, loading: false };

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
async function inspectHandoff() {
  const badge = $("#sessionBadge");
  badge.textContent = "Session tidak terhubung";

  const stateParam = new URLSearchParams(location.search).get("state");
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(String(stateParam || ""))) return;

  state.handoffState = stateParam;

  try {
    const { response, data } = await api("/api/handoff/inspect", {
      method: "POST",
      body: JSON.stringify({ state: stateParam })
    });

    if (response.ok && data.authenticated === true) {
      state.authenticated = true;
      badge.textContent = data.username
        ? `Session aktif · ${data.username}`
        : "Session aktif";
      return;
    }

    state.handoffState = null;
    badge.textContent = "Session tidak valid";
  } catch {
    state.handoffState = null;
    badge.textContent = "Session gagal diverifikasi";
  }
}
function durationLabel(token) {
  if (token.duration_label) return token.duration_label;
  return token.duration === "permanent" ? "Unlimited" : token.duration || "Lifetime";
}
function render() {
  const list = $("#tokenList"); const empty = $("#empty");
  if (!state.tokens.length) { list.innerHTML = ""; empty.hidden = false; return; }
  empty.hidden = true;
  list.innerHTML = state.tokens.map((token) => {
    const status = token.status || "unknown";
    const available = status === "active";
    const statusLabel = available ? "🟢 Tersedia" : status === "used" ? "🔴 Digunakan" : status === "expired" ? "⚪ Kedaluwarsa" : `⚪ ${escapeHtml(status)}`;
    const claimant = token.claimed_username ? `<span>${escapeHtml(token.claimed_username)}</span>` : "";
    const action = available && token.token ? `<button class="btn primary get-token" data-id="${escapeHtml(token.id)}" type="button">GET TOKEN</button>` : "";
    return `<article class="token-card"><div class="row"><span class="lifetime">🔒 ${escapeHtml(durationLabel(token))}</span><span class="badge ${available ? "available" : status}">${statusLabel}</span></div><div class="token">${escapeHtml(token.token || "Token tidak tersedia")}</div><div class="row"><div class="meta"><span>${claimant}</span></div>${action}</div></article>`;
  }).join("");
  list.querySelectorAll(".get-token").forEach((button) => button.addEventListener("click", () => getToken(button.dataset.id)));
}
async function loadTokens() {
  if (state.loading) return; state.loading = true; setStatus("Memuat token…");
  try {
    const { response, data } = await api("/api/tokens?limit=50&offset=0");
    if (!response.ok) throw new Error(data.error || "Token belum dapat dimuat.");
    state.tokens = Array.isArray(data.tokens) ? data.tokens : [];
    render(); setStatus("");
  } catch (error) { setStatus(error.message || "Token belum dapat dimuat.", "error"); } finally { state.loading = false; }
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
    const { response, data } = await api(`/api/tokens/${encodeURIComponent(tokenId)}`);
    if (!response.ok || !data.token?.token) { await loadTokens(); throw new Error(data.error || "Token tidak tersedia."); }
    const token = data.token.token;
    const copied = await copyToken(token);
    if (copied) toast("✓ Token berhasil disalin"); else toast("Token tidak dapat disalin otomatis. Silakan salin manual.");
    state.selected = data.token;
    sessionStorage.setItem("jyyr:selected_token_id", data.token.id);
    if (state.handoffState && state.authenticated) {
      const consume = await api("/api/handoff/consume", { method: "POST", body: JSON.stringify({ state: state.handoffState }) });
      state.handoffState = null;
      if (consume.response.ok && consume.data.authenticated === true) {
        const target = new URL("/home.html", `${window.__AMPREM_URL || location.origin}`);
        // Runtime override is supplied through a safe redirect URL on the backend
        // only in a deployed build; local dev uses the explicit config endpoint below.
        const fallback = sessionStorage.getItem("jyyr:amprem_url") || null;
        if (fallback) target.href = `${fallback.replace(/\/+$/, "")}/home.html?token_context=${encodeURIComponent(tokenId)}`;
        else {
          const cfg = await api("/api/runtime-config");
          const amprem = cfg.data?.ampremUrl;
          if (!amprem) throw new Error("URL Amprem belum dikonfigurasi.");
          window.location.assign(`${amprem.replace(/\/+$/, "")}/home.html?token_context=${encodeURIComponent(tokenId)}`);
          return;
        }
        window.location.assign(target.href);
        return;
      }
    }
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
$("#refreshBtn").addEventListener("click", loadTokens);
(async function boot(){ await inspectHandoff(); await loadTokens(); })();

import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3100);
const AMPREM_URL = String(process.env.AMPREM_URL || "").trim().replace(/\/+$/, "");
const HANDOFF_SECRET = String(process.env.ECOSYSTEM_HANDOFF_SECRET || "").trim();
const TOKEN_LIST_LIMIT = Math.max(1, Math.min(50, Number(process.env.TOKEN_LIST_LIMIT || 20)));
const AMPREM_TIMEOUT_MS = Math.max(1000, Math.min(30000, Number(process.env.AMPREM_TIMEOUT_MS || 10000)));
if (!AMPREM_URL) throw new Error("AMPREM_URL belum dikonfigurasi.");
try {
  const parsedAmprem = new URL(AMPREM_URL);
  if (!/^https?:$/.test(parsedAmprem.protocol)) throw new Error("AMPREM_URL harus HTTP/HTTPS.");
} catch { throw new Error("AMPREM_URL harus URL HTTP/HTTPS valid."); }
if (HANDOFF_SECRET.length < 32) throw new Error("ECOSYSTEM_HANDOFF_SECRET harus minimal 32 karakter.");

const app = express();
app.disable("x-powered-by");
if (process.env.VERCEL) app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cache-Control", req.path.startsWith("/api/") ? "no-store, max-age=0" : "no-cache");
  next();
});
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: false }));

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { ok: false, error: "Terlalu banyak permintaan Token Center. Coba lagi nanti." },
});

function amprem(pathname, options = {}) {
  return fetch(`${AMPREM_URL}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
    signal: options.signal || AbortSignal.timeout(AMPREM_TIMEOUT_MS),
  });
}

function proxyError(res, fallback = "Server Amprem tidak dapat dihubungi.") {
  return res.status(502).json({ ok: false, error: fallback });
}

app.get("/api/tokens", publicLimiter, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || TOKEN_LIST_LIMIT)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    if (!Number.isInteger(limit) || !Number.isInteger(offset)) return res.status(400).json({ ok: false, error: "Pagination tidak valid." });
    const response = await amprem(`/api/public/tokens?limit=${limit}&offset=${offset}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404) return res.status(502).json({ ok: false, code: "AMPREM_ENDPOINT_NOT_FOUND", error: "Endpoint Token di JYY'R Amprem tidak tersedia." });
      return res.status(response.status).json(data?.error ? { ok: false, error: data.error } : { ok: false, error: "Token belum dapat dimuat." });
    }
    return res.json(data);
  } catch (error) {
    console.error("[TOKEN CENTER LIST]", { message: error?.message || "Unknown error" });
    return proxyError(res, "Token belum dapat dimuat.");
  }
});

app.get("/api/tokens/:id", publicLimiter, async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id || ""))) return res.status(400).json({ ok: false, error: "Token ID tidak valid." });
    const response = await amprem(`/api/public/tokens/${encodeURIComponent(req.params.id)}`);
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("[TOKEN CENTER GET]", { message: error?.message || "Unknown error" });
    return proxyError(res, "Token tidak dapat diambil.");
  }
});

async function handoffProxy(pathname, state) {
  return amprem(pathname, {
    method: "POST",
    headers: { Authorization: `Bearer ${HANDOFF_SECRET}` },
    body: JSON.stringify({ state }),
  });
}

app.post("/api/handoff/inspect", publicLimiter, async (req, res) => {
  try {
    const state = String(req.body?.state || "").trim();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(state)) return res.status(400).json({ ok: false, authenticated: false });
    const response = await handoffProxy("/api/ecosystem/handoff/inspect", state);
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json({ ok: response.ok, authenticated: data.authenticated === true, username: data.username || null });
  } catch (error) {
    console.error("[TOKEN CENTER HANDOFF INSPECT]", { message: error?.message || "Unknown error" });
    return proxyError(res, "Auth handoff tidak dapat diverifikasi.");
  }
});

app.post("/api/handoff/consume", publicLimiter, async (req, res) => {
  try {
    const state = String(req.body?.state || "").trim();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(state)) return res.status(400).json({ ok: false, authenticated: false });
    const response = await handoffProxy("/api/ecosystem/handoff/consume", state);
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json({ ok: response.ok, authenticated: data.authenticated === true, username: data.username || null });
  } catch (error) {
    console.error("[TOKEN CENTER HANDOFF CONSUME]", { message: error?.message || "Unknown error" });
    return proxyError(res, "Auth handoff tidak dapat diselesaikan.");
  }
});

app.get("/api/runtime-config", (_req, res) => res.json({ ok: true, ampremUrl: AMPREM_URL }));
app.get("/register-redirect", (req, res) => {
  const username = String(req.query.username || "").trim();
  const tokenId = String(req.query.token_id || "").trim();
  if (!/^@[a-z0-9](?:[a-z0-9._-]{2,28})$/i.test(username) || !/^[0-9a-f-]{36}$/i.test(tokenId)) return res.status(400).send("Invalid registration context");
  const target = new URL("/login.html", AMPREM_URL);
  target.searchParams.set("mode", "register");
  target.searchParams.set("username", username.toLowerCase());
  target.searchParams.set("token_id", tokenId);
  return res.redirect(302, target.toString());
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "jyyr-token-center" }));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

if (!process.env.VERCEL) app.listen(PORT, () => console.log(`JYY'R Token Center listening on http://localhost:${PORT}`));
export default app;

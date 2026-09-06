import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tokenRoot = new URL("../", import.meta.url);
const ampremRoot = path.resolve(fileURLToPath(tokenRoot), "../jyyramprem");
const tokenServer = fs.readFileSync(new URL("server.js", tokenRoot), "utf8");
const portalRoutes = fs.readFileSync(path.join(ampremRoot, "api/routes/portal-token.routes.js"), "utf8");
const appConfig = fs.readFileSync(path.join(ampremRoot, "lib/config/app.config.js"), "utf8");
const authJs = fs.readFileSync(path.join(ampremRoot, "public/js/auth.js"), "utf8");

for (const value of [tokenServer, portalRoutes, appConfig, authJs]) assert.equal(typeof value, "string");

test("Token Center and Amprem share the same handoff secret contract", () => {
  assert.match(tokenServer, /ECOSYSTEM_HANDOFF_SECRET/);
  assert.match(portalRoutes, /ECOSYSTEM_HANDOFF_SECRET/);
  assert.match(portalRoutes, /\/api\/ecosystem\/handoff\/(inspect|consume)/);
});

test("Amprem creates the stateful link consumed by Token Center", () => {
  assert.match(portalRoutes, /\/api\/access\/token-center-link/);
  assert.match(portalRoutes, /url\.searchParams\.set\("state", state\)/);
  assert.match(authJs, /AMAuth\.getTokenCenterLink\(\)/);
});

test("Token Center connectivity status uses Amprem database health", () => {
  assert.match(tokenServer, /app\.get\("\/api\/connectivity"/);
  assert.match(tokenServer, /amprem\("\/api\/health"\)/);
  assert.match(tokenServer, /data\.database === "connected"/);
  assert.doesNotMatch(tokenServer, /amprem\("\/health"\)/);
});

test("Token Center proxies the canonical Amprem public-token endpoints", () => {
  assert.match(tokenServer, /\/api\/public\/tokens\?limit=/);
  assert.match(tokenServer, /\/api\/public\/tokens\/\$\{encodeURIComponent\(req\.params\.id\)\}/);
  assert.match(ampremAppRoutes(ampremRoot), /app\.get\("\/api\/public\/tokens"/);
});

test("Amprem redirects registration back into login with token context", () => {
  assert.match(tokenServer, /new URL\("\/login\.html", AMPREM_URL\)/);
  assert.match(tokenServer, /token_id/);
  assert.match(authJs, /sessionStorage\.setItem\("jyyr:selected_token_id"/);
});

function ampremAppRoutes(root) {
  return fs.readFileSync(path.join(root, "api/routes/public.routes.js"), "utf8");
}

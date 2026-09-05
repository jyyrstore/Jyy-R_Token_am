import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8");

test("Vercel trusts exactly one proxy hop for rate limiting", () => {
  assert.ok(server.includes('if (process.env.VERCEL) app.set("trust proxy", 1);'));
});

test("Amprem proxy accepts only HTTP/HTTPS and has a finite timeout", () => {
  assert.match(server, /AMPREM_TIMEOUT_MS/);
  assert.match(server, /\^https\?:\$/);
  assert.match(server, /AbortSignal\.timeout\(AMPREM_TIMEOUT_MS\)/);
});

test("Token Center detects a missing upstream public-token endpoint", () => {
  assert.match(server, /AMPREM_ENDPOINT_NOT_FOUND/);
  assert.match(server, /\/api\/public\/tokens\?limit=/);
});

test("runtime config exposes the configured Amprem target for deployment diagnostics", () => {
  assert.match(server, /app\.get\("\/api\/runtime-config"/);
  assert.match(server, /ampremUrl: AMPREM_URL/);
});

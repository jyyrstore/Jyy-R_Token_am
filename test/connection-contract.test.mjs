import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tokenRoot = new URL("../", import.meta.url);
const configuredAmpremRoot = process.env.JYYR_AMPREM_ROOT?.trim();
const ampremRoot = path.resolve(
  fileURLToPath(tokenRoot),
  configuredAmpremRoot || "../jyyramprem"
);
const tokenServer = fs.readFileSync(new URL("server.js", tokenRoot), "utf8");
const tokenApp = fs.readFileSync(new URL("public/app.js", tokenRoot), "utf8");
const ampremFiles = {
  portalRoutes: path.join(ampremRoot, "api/routes/portal-token.routes.js"),
  authJs: path.join(ampremRoot, "public/js/auth.js"),
  publicRoutes: path.join(ampremRoot, "api/routes/public.routes.js"),
};
const ampremAvailable = Object.values(ampremFiles).every((file) => fs.existsSync(file));

if (!ampremAvailable) {
  test(
    "Amprem cross-repo contracts require an available Amprem source tree",
    { skip: `Amprem source not found at ${ampremRoot}; set JYYR_AMPREM_ROOT when running the integration contract suite.` },
    () => assert.ok(true)
  );
} else {
  const portalRoutes = fs.readFileSync(ampremFiles.portalRoutes, "utf8");
  const authJs = fs.readFileSync(ampremFiles.authJs, "utf8");

  for (const value of [tokenServer, portalRoutes, authJs]) assert.equal(typeof value, "string");

  test("Token Center and Amprem share the same handoff secret contract", () => {
    assert.match(tokenServer, /ECOSYSTEM_HANDOFF_SECRET/);
    assert.match(portalRoutes, /ECOSYSTEM_HANDOFF_SECRET/);
    assert.match(portalRoutes, /\/api\/ecosystem\/handoff\/(inspect|consume)/);
  });

  test("Amprem exposes a stateful Token Center link contract", () => {
    assert.match(portalRoutes, /\/api\/access\/token-center-link/);
    assert.match(portalRoutes, /url\.searchParams\.set\("state", state\)/);
    assert.match(tokenApp, /new URLSearchParams\(location\.search\)\.get\(\"state\"\)/);
    assert.match(tokenApp, /\/api\/handoff\/inspect/);
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
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname);

test("token center keeps secure flow contracts", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  assert.match(server, /ECOSYSTEM_HANDOFF_SECRET/);
  assert.match(server, /\/api\/tokens/);
  assert.match(js, /navigator\.clipboard/);
  assert.match(js, /sessionStorage\.setItem\("jyyr:selected_token_id"/);
  assert.match(js, /token_context=/);
});

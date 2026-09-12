import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStandaloneServer } from "./app.js";
import { registryFromEnvironment } from "./sourceRegistry.js";

test("standalone server serves the production UI and authenticated knowledge API", async () => {
  const root = await mkdtemp(join(tmpdir(), "action-pocket-server-"));
  const web = join(root, "web-dist");
  const graph = join(root, "graph");
  await mkdir(web);
  await mkdir(graph);
  await writeFile(join(web, "index.html"), "<!doctype html><head></head><body>Action Pocket</body>");
  await writeFile(join(web, "app.js"), "console.log('ok')");
  await writeFile(join(graph, "note.md"), "# Adam\n\n带记忆的梯度方向\n");
  const { server, sessionToken } = createStandaloneServer({
    documentRoot: web,
    registry: registryFromEnvironment({ AP_GRAPH_DIR: graph }),
    sessionToken: "test-token",
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /action-pocket-session-token" content="test-token"/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'self' ws:\/\/127\.0\.0\.1:\*/);

    const unauthorized = await fetch(`${base}/api/sources`);
    assert.equal(unauthorized.status, 403);
    const sources = await fetch(`${base}/api/sources`, { headers: { "X-Action-Pocket-Token": sessionToken } });
    assert.equal(sources.status, 200);
    assert.equal((await sources.json() as { sources: unknown[] }).sources.length, 1);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/app.js`, { method: "POST" })).status, 405);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

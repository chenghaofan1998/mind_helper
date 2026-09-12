import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registryFromEnvironment } from "./sourceRegistry.js";

test("explicit Logseq file profile reuses the provider-neutral file graph source", async () => {
  const root = await mkdtemp(join(tmpdir(), "action-pocket-logseq-"));
  await mkdir(join(root, "pages"));
  await mkdir(join(root, "journals"));
  await mkdir(join(root, "logseq", "bak"), { recursive: true });
  await writeFile(join(root, "pages", "adam.md"), "# Adam\n\n动量用于平滑梯度方向。\n");
  await writeFile(join(root, "logseq", "bak", "ignored.md"), "private-backup-marker\n");

  const registry = await registryFromEnvironment({ AP_GRAPH_DIR: root, AP_GRAPH_KIND: "logseq-files" });
  const descriptor = registry.descriptors()[0];
  assert.equal(descriptor.name, "Logseq 文件 Graph");
  assert.deepEqual(descriptor.capabilities, ["read", "search", "write", "locate"]);
  assert.equal((await registry.require(descriptor.id, "search").search("动量", 5)).length, 1);
  assert.equal((await registry.require(descriptor.id, "search").search("private backup marker", 5)).length, 0);

  const receipt = await registry.require(descriptor.id, "write").write!({
    rawContent: "逐字保存的 Logseq journal 内容",
    target: { sourceId: descriptor.id, relativePath: "journals/2025_01_02.md" },
  });
  assert.equal(receipt.ok, true);
  assert.equal(await readFile(join(root, "journals", "2025_01_02.md"), "utf8"), "逐字保存的 Logseq journal 内容\n");
});

test("graph profile configuration is explicit and validated", async () => {
  await assert.rejects(registryFromEnvironment({ AP_GRAPH_KIND: "logseq-files" }), /AP_GRAPH_DIR/);
  await assert.rejects(registryFromEnvironment({ AP_GRAPH_KIND: "logseq-db" }), /AP_GRAPH_KIND/);
});

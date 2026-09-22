import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileGraphSource } from "./fileGraph.js";
import { assertWritableOutsidePipeline } from "./fileGraphPaths.js";

test("pipeline-owned paths are blocked across platform separators and casing", () => {
  for (const path of ["/graph/pages/knowledge-pipeline/30-summaries/run/a.md",
    "C:\\graph\\pages\\KNOWLEDGE-PIPELINE\\40-REVIEW\\a.md",
    "/graph/pages/knowledge-pipeline/50-knowledge/decisions/a.md",
    "/graph/pages/knowledge-pipeline/AI Knowledge Index.md"]) {
    assert.throws(() => assertWritableOutsidePipeline(path), { code: "FORBIDDEN" });
  }
  assert.doesNotThrow(() => assertWritableOutsidePipeline("/graph/journals/today.md"));
});

test("pipeline protection covers graph roots, subtree roots and single-file sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "ap-pipeline-boundary-"));
  const subtree = join(root, "pages", "knowledge-pipeline", "50-knowledge");
  const file = join(subtree, "decision.md");
  try {
    await mkdir(subtree, { recursive: true });
    await writeFile(file, "Decision: generated content\n");
    const scopes = [
      { scope: root, path: "pages/knowledge-pipeline/50-knowledge/decision.md" },
      { scope: subtree, path: "decision.md" },
      { scope: { kind: "file" as const, path: file }, path: "decision.md" },
    ];
    for (const { scope, path } of scopes) {
      const source = new FileGraphSource(scope, "graph", "Test");
      await source.initialize();
      const receipt = await source.write({ rawContent: "overwrite", target: { sourceId: "graph", relativePath: path } });
      assert.equal(receipt.ok, false);
      if (!receipt.ok) assert.equal(receipt.code, "FORBIDDEN");
      assert.equal((await source.search("generated", 5)).length, 1);
    }
    assert.equal(await readFile(file, "utf8"), "Decision: generated content\n");
    const source = new FileGraphSource(root, "graph", "Test");
    await source.initialize();
    assert.equal((await source.write({ rawContent: "Captured", target: { sourceId: "graph", relativePath: "journals/today.md" } })).ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

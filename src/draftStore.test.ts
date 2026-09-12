import assert from "node:assert/strict";
import test from "node:test";
import { clearDraft, loadDraft, loadProjectDraft, saveDraft } from "./draftStore.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const draft = (projectId: string, rawContent: string, sourceId: string, relativePath: string) => ({
  projectId,
  rawContent,
  sourceId,
  relativePath,
  relativePathExplicit: Boolean(relativePath),
});

test("drafts keep content, source, and explicit path isolated across A to B to A switches", () => {
  const storage = new MemoryStorage();
  saveDraft(draft("project-a", "A 正文", "source-a", "a/inbox.md"), storage);
  saveDraft(draft("project-b", "B 正文", "source-b", "b/inbox.md"), storage);

  assert.deepEqual(loadProjectDraft("project-a", storage), draft("project-a", "A 正文", "source-a", "a/inbox.md"));
  assert.deepEqual(loadProjectDraft("project-b", storage), draft("project-b", "B 正文", "source-b", "b/inbox.md"));
  assert.deepEqual(loadProjectDraft("project-a", storage), draft("project-a", "A 正文", "source-a", "a/inbox.md"));
  assert.equal(loadDraft(storage).projectId, "project-b");

  clearDraft("project-b", storage);
  assert.equal(loadProjectDraft("project-b", storage).rawContent, "");
  assert.equal(loadProjectDraft("project-a", storage).rawContent, "A 正文");
});

test("derived defaults are not persisted while an explicit override is restored", () => {
  const storage = new MemoryStorage();
  saveDraft({ projectId: "project-a", sourceId: "source-a", relativePath: "", relativePathExplicit: false, rawContent: "" }, storage);
  assert.deepEqual(loadDraft(storage), { projectId: "project-a", sourceId: "source-a", relativePath: "", relativePathExplicit: false, rawContent: "" });

  saveDraft(draft("project-a", "正文", "source-a", "custom.md"), storage);
  assert.equal(loadDraft(storage).relativePath, "custom.md");
  assert.equal(loadDraft(storage).relativePathExplicit, true);
});

test("empty v2 daily-path draft migrates without freezing its derived date", () => {
  const storage = new MemoryStorage();
  storage.setItem("action-pocket-write-draft-v2", JSON.stringify({ projectId: "project-a", sourceId: "source-a", relativePath: "journals/2025_01_01.md", rawContent: "" }));
  assert.deepEqual(loadDraft(storage), { projectId: "project-a", sourceId: "source-a", relativePath: "", relativePathExplicit: false, rawContent: "" });
});

test("legacy draft with content is safely migrated with an empty project id", () => {
  const storage = new MemoryStorage();
  storage.setItem("action-pocket-write-draft-v1", JSON.stringify({ sourceId: "file-graph", relativePath: "inbox.md", rawContent: "legacy" }));
  assert.deepEqual(loadDraft(storage), { projectId: "", sourceId: "file-graph", relativePath: "inbox.md", relativePathExplicit: true, rawContent: "legacy" });
});

import assert from "node:assert/strict";
import test from "node:test";
import { feedbackForLocation, loadPreferences, savePreferences, setFeedback, togglePin } from "./preferenceStore.js";
import type { SourceLocation } from "./knowledge/types.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const location: SourceLocation = {
  sourceId: "file-graph", documentId: "notes.md", path: "notes.md", line: 4, blockId: "stable", version: "v1",
};

test("pins and feedback persist only source references, never excerpts or content", () => {
  const storage = new MemoryStorage();
  storage.setItem("command-pocket-library-v2", JSON.stringify({ cards: [{ content: "sensitive" }] }));
  const preferences = loadPreferences(storage);
  assert.equal(storage.getItem("command-pocket-library-v2"), null);
  assert.equal(togglePin(preferences, location), true);
  setFeedback(preferences, location, "useful");
  (preferences.pins[0].location as SourceLocation & { content?: string }).content = "must-strip";
  savePreferences(preferences, storage);
  const serialized = storage.getItem("action-pocket-preferences-v1") ?? "";
  assert.doesNotMatch(serialized, /excerpt|content|sensitive|must-strip/);
  const loaded = loadPreferences(storage);
  assert.equal(loaded.pins[0].sourceVersion, "v1");
  assert.equal(loaded.feedback[0].location.path, "notes.md");
});

test("a source version change can be detected without retaining an old body", () => {
  const preferences = loadPreferences(new MemoryStorage());
  togglePin(preferences, location);
  const current = { ...location, version: "v2" };
  assert.notEqual(preferences.pins[0].sourceVersion, current.version);
});

test("useful feedback is active only when both source version and block identity still match", () => {
  const preferences = loadPreferences(new MemoryStorage());
  setFeedback(preferences, location, "useful");

  assert.equal(feedbackForLocation(preferences, { ...location })?.value, "useful");
  assert.equal(feedbackForLocation(preferences, { ...location, version: "v2" }), undefined);
  assert.equal(feedbackForLocation(preferences, { ...location, blockId: "changed" }), undefined);
  assert.equal(feedbackForLocation(preferences, { ...location, version: undefined }), undefined);
  assert.equal(feedbackForLocation(preferences, { ...location, blockId: undefined }), undefined);
});

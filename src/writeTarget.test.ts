import assert from "node:assert/strict";
import test from "node:test";
import type { SourceDescriptor } from "./knowledge/types.js";
import { canSubmitWrite, effectiveWritePath } from "./writeTarget.js";

const writable: SourceDescriptor = {
  id: "source-a", name: "A", capabilities: ["write"], searchMode: "lexical-fallback",
  searchDescription: "local", defaultWritePath: "journals/today.md",
};

test("non-empty input immediately uses a writable source default path", () => {
  assert.equal(effectiveWritePath("", writable), "journals/today.md");
  assert.equal(canSubmitWrite("一", "", writable), true);
  assert.equal(canSubmitWrite(" \n", "", writable), false);
});

test("an explicit target consistently overrides the source default", () => {
  assert.equal(effectiveWritePath(" inbox/note.md ", writable), "inbox/note.md");
  assert.equal(canSubmitWrite("text", "inbox/note.md", writable), true);
});

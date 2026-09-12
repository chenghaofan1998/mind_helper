import assert from "node:assert/strict";
import test from "node:test";
import { nextResultIndex, resultKeyboardAction } from "./resultNavigation.js";
import { isDangerous } from "./search.js";

test("result keyboard maps arrows and Enter to the documented actions", () => {
  assert.equal(resultKeyboardAction("ArrowUp"), "previous");
  assert.equal(resultKeyboardAction("ArrowDown"), "next");
  assert.equal(resultKeyboardAction("Enter"), "primary");
  assert.equal(resultKeyboardAction("Escape"), undefined);
});

test("result selection wraps in both directions", () => {
  assert.equal(nextResultIndex(0, 3, "previous"), 2);
  assert.equal(nextResultIndex(2, 3, "next"), 0);
  assert.equal(nextResultIndex(1, 3, "next"), 2);
  assert.equal(nextResultIndex(0, 0, "next"), undefined);
});

test("the selected primary action still recognizes dangerous commands", () => {
  assert.equal(resultKeyboardAction("Enter"), "primary");
  assert.equal(isDangerous("rm -rf ./cache"), true);
});

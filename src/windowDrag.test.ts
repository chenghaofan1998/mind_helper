import assert from "node:assert/strict";
import test from "node:test";
import { shouldBeginWindowDrag } from "./windowDrag.js";

test("only a primary-button gesture on non-interactive header chrome starts window drag", () => {
  assert.equal(shouldBeginWindowDrag(0, true, false), true);
  assert.equal(shouldBeginWindowDrag(0, true, true), false);
  assert.equal(shouldBeginWindowDrag(0, false, false), false);
  assert.equal(shouldBeginWindowDrag(2, true, false), false);
});

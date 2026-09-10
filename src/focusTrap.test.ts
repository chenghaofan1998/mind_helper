import assert from "node:assert/strict";
import test from "node:test";
import { focusTarget, modalKeyboardAction, wrappedFocusIndex } from "./focusTrap.js";

test("modal focus wraps at both ends and enters from outside", () => {
  assert.equal(wrappedFocusIndex(1, 2, false), 0);
  assert.equal(wrappedFocusIndex(0, 2, true), 1);
  assert.equal(wrappedFocusIndex(-1, 2, false), 0);
  assert.equal(wrappedFocusIndex(-1, 2, true), 1);
  assert.equal(wrappedFocusIndex(0, 2, false), undefined);
});

test("danger confirmation identifies Escape and Tab and focuses initial/return targets", () => {
  let initialFocuses = 0;
  let returnFocuses = 0;
  assert.equal(focusTarget({ focus: () => { initialFocuses += 1; } }), true);
  assert.equal(focusTarget({ focus: () => { returnFocuses += 1; } }), true);
  assert.equal(focusTarget(undefined), false);
  assert.equal(initialFocuses, 1);
  assert.equal(returnFocuses, 1);
  assert.equal(modalKeyboardAction("Escape"), "close");
  assert.equal(modalKeyboardAction("Tab"), "trap-focus");
  assert.equal(modalKeyboardAction("Enter"), undefined);
});

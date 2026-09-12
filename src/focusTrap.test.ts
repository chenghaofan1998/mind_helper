import assert from "node:assert/strict";
import test from "node:test";
import { focusRiskReturnTarget, focusTarget, modalKeyboardAction, wrappedFocusIndex } from "./focusTrap.js";
import { resultKeyboardAction } from "./resultNavigation.js";

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

test("result-card Enter then modal Escape restores the result card", () => {
  let cardFocuses = 0;
  let buttonFocuses = 0;
  const targets = [
    { dataset: { id: "danger-1", riskReturn: "result-card" }, focus: () => { cardFocuses += 1; } },
    { dataset: { id: "danger-1", riskReturn: "copy-button" }, focus: () => { buttonFocuses += 1; } },
  ];
  assert.equal(resultKeyboardAction("Enter"), "primary");
  assert.equal(modalKeyboardAction("Escape"), "close");
  assert.equal(focusRiskReturnTarget(targets, { resultId: "danger-1", kind: "result-card" }), true);
  assert.equal(cardFocuses, 1);
  assert.equal(buttonFocuses, 0);
});

test("copy-button click then modal Escape restores the copy button", () => {
  let cardFocuses = 0;
  let buttonFocuses = 0;
  const targets = [
    { dataset: { id: "danger-1", riskReturn: "result-card" }, focus: () => { cardFocuses += 1; } },
    { dataset: { id: "danger-1", riskReturn: "copy-button" }, focus: () => { buttonFocuses += 1; } },
  ];
  assert.equal(modalKeyboardAction("Escape"), "close");
  assert.equal(focusRiskReturnTarget(targets, { resultId: "danger-1", kind: "copy-button" }), true);
  assert.equal(cardFocuses, 0);
  assert.equal(buttonFocuses, 1);
});
